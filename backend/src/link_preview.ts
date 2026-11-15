// Link previews (2026-11-15): a link to vettadrive.app pasted into Messages, Instagram, X, Discord or Slack shows a card,
// not a bare URL. The app's front page (/, /index.html) gets Open Graph and Twitter tags in its <head> on the way out:
// a public roadbook's link names the book, its roads and length and who keeps it (what its page shows anyone signed out);
// every other shared link (an invite, a crew, a convoy, a friend, a post) gets a line of what it is, never whose or
// where, since those need a member to see; a plain visit gets Vetta's own line. The picture is Vetta's icon.
// Nothing is stored or logged; a roadbook that is private, friends-only, reported or gone is previewed as a plain link.
import { reportedSql } from "./reports_sql";
import { Env } from "./util";

export interface Preview { title: string; description: string; image: string; url: string }

const ID_RE = /^[A-Za-z0-9_-]{16}$/;
const SITE = "Vetta";
const PLAIN = "Vetta reads the road ahead as rally pace notes, finds the good roads near you and keeps a road book with your friends.";
// a shared link's kind → its line (nothing about whose it is or where: those are members-only)
const KINDS: [string, string, string][] = [
  ["invite", "You're invited to Vetta", "A friend wants to drive with you. Open the link to add them."],
  ["friend", "A driver on Vetta", "Open the link to add them as a friend."],
  ["crew", "A crew on Vetta", "Open the link to see the crew and join its drives."],
  ["convoy", "Join the convoy", "A group drive on Vetta. Open the link to ride along."],
  ["post", "A drive on Vetta", "Open the link to see the drive."],
  ["add", "A driver on Vetta", "Open the link to add them as a friend."],
];

const miles = (m: number) => { const mi = m / 1609.344; return mi >= 10 ? `${Math.round(mi)} mi` : `${mi.toFixed(1)} mi`; };
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The card for a front-page request's link: a public roadbook from the database, else the link's kind, else Vetta's. */
export async function previewFor(env: Env, url: URL): Promise<Preview> {
  const image = `${url.origin}/brand/icon-1024.png`, at = `${url.origin}/`;
  const book = url.searchParams.get("roadbook");
  if (book && ID_RE.test(book) && env.DB) {
    const b = await env.DB.prepare(
      `SELECT b.name, b.about, b.roads_n, b.length_m, u.handle AS by FROM roadbooks b JOIN users u ON u.id = b.owner
        WHERE b.id = ?1 AND b.visibility = 'public' AND b.roads_n > 0 AND NOT ${reportedSql("roadbook", "b.id")}`).bind(book)
      .first<{ name: string; about: string | null; roads_n: number; length_m: number; by: string | null }>().catch(() => null);
    if (b) {
      const facts = [`${b.roads_n} ${b.roads_n === 1 ? "road" : "roads"}`, b.length_m > 0 ? miles(b.length_m) : null, b.by ? `kept by @${b.by}` : null].filter(Boolean).join(" · ");
      return { title: clip(`${b.name} · a roadbook on Vetta`, 90), description: clip(b.about ? `${facts}. ${b.about}` : `${facts}. Open it to drive them.`, 200), image, url: `${at}?roadbook=${book}` };
    }
  }
  for (const [k, title, description] of KINDS) if (url.searchParams.has(k)) return { title, description, image, url: at };
  return { title: SITE, description: PLAIN, image, url: at };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The tags for a card, for the page's <head>. */
export function tags(p: Preview): string {
  const m = (attr: string, k: string, v: string) => `<meta ${attr}="${k}" content="${esc(v)}" />`;
  return [
    m("property", "og:site_name", SITE), m("property", "og:type", "website"), m("property", "og:title", p.title),
    m("property", "og:description", p.description), m("property", "og:image", p.image), m("property", "og:url", p.url),
    m("name", "twitter:card", "summary"), m("name", "twitter:title", p.title), m("name", "twitter:description", p.description),
    m("name", "twitter:image", p.image), m("name", "description", p.description),
  ].join("");
}

/** The app's front page with the card's tags in its <head> (and the card's title when it names a roadbook). */
export async function withPreview(res: Response, env: Env, url: URL): Promise<Response> {
  if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html")) return res;
  const p = await previewFor(env, url), named = p.title !== SITE;
  const out = new HTMLRewriter()
    .on("head", { element(e) { e.append(tags(p), { html: true }); } })
    .on("title", { element(e) { if (url.searchParams.has("roadbook") && named) e.setInnerContent(p.title); } })
    .transform(res);
  const headers = new Headers(out.headers);
  headers.delete("content-length"); headers.delete("etag");
  // a roadbook's name can change, or the book go private: crawlers may keep the card a while, a browser only briefly
  if (url.search) headers.set("cache-control", "public, max-age=300");
  return new Response(out.body, { status: out.status, headers });
}
