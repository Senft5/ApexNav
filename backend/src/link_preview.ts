// Link previews (2026-11-15): a link to vettadrive.app pasted into Messages, Instagram, X, Discord or Slack shows a card,
// not a bare URL. The app's front page (/, /index.html) gets Open Graph and Twitter tags in its <head> on the way out:
// a public roadbook's link names the book, its roads and length and who keeps it (what its page shows anyone signed out);
// a public crew's invite link names the crew, its size, area and line (what non-members see of a public crew, social.ts);
// every other shared link (an invite, a crew, a convoy, a friend, a post) gets a line of what it is, never whose or
// where, since those need a member to see; a plain visit gets Vetta's own line. The picture is the book's roads on the
// map when its owner's phone made one (roadbooks.ts cardPut), else Vetta's icon.
// Nothing is stored or logged; a roadbook that is private, friends-only, reported or gone is previewed as a plain link.
import { reportedSql } from "./reports_sql";
import { cardShown } from "./roadbooks";
import { Env, sha256hex } from "./util";

/** `named`: the card names a roadbook or a crew, and the page's title takes its name too. */
export interface Preview { title: string; description: string; image: string; url: string; large?: boolean; named?: boolean }

const ID_RE = /^[A-Za-z0-9_-]{16}$/, TOKEN_RE = /^[A-Za-z0-9_-]{10,100}$/;
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
      // its roads on the map, when its owner's phone made the picture (roadbooks.ts cardPut); else the icon
      const pic = await cardShown(env, book);
      return { title: clip(`${b.name} · a roadbook on Vetta`, 90), description: clip(b.about ? `${facts}. ${b.about}` : `${facts}. Open it to drive them.`, 200),
        image: pic ? `${url.origin}/api/roadbooks/${book}/card.jpg` : image, url: `${at}?roadbook=${book}`, large: pic, named: true };
    }
  }
  const crew = url.searchParams.get("crew");
  if (crew && TOKEN_RE.test(crew) && env.DB) {
    // a live invite to a public crew, from someone still in it, as joining would take it (social.ts CREW_INVITE_OK, less the
    // viewer's blocks: a crawler is nobody); a private crew, or a dead, reported or stray link, is the plain crew line
    const c = await env.DB.prepare(
      `SELECT c.name, c.about, c.area_name, (SELECT COUNT(*) FROM crew_members m WHERE m.crew_id = c.id) AS members
         FROM crew_invites i JOIN crews c ON c.id = i.crew_id
        WHERE i.token_hash = ?1 AND i.expires_at > datetime('now') AND c.visibility = 'public'
          AND EXISTS (SELECT 1 FROM crew_members im WHERE im.crew_id = c.id AND im.user_id = i.created_by)
          AND (c.invites = 'anyone' OR i.created_by = c.owner) AND NOT ${reportedSql("crew", "c.id")}`).bind(await sha256hex(crew))
      .first<{ name: string; about: string | null; area_name: string | null; members: number }>().catch(() => null);
    if (c) {
      const facts = [`${c.members} ${c.members === 1 ? "driver" : "drivers"}`, c.area_name].filter(Boolean).join(" · ");
      return { title: clip(`${c.name} · a crew on Vetta`, 90),
        description: clip(c.about ? `${facts}. ${c.about}` : `${facts}. Open the link to join its drives.`, 200), image, url: at, named: true };
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
    ...(p.large ? [m("property", "og:image:width", "1200"), m("property", "og:image:height", "630")] : []),
    m("name", "twitter:card", p.large ? "summary_large_image" : "summary"), m("name", "twitter:title", p.title), m("name", "twitter:description", p.description),
    m("name", "twitter:image", p.image), m("name", "description", p.description),
  ].join("");
}

/** The app's front page with the card's tags in its <head> (and the card's title when it names a roadbook or a crew). */
export async function withPreview(res: Response, env: Env, url: URL): Promise<Response> {
  if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html")) return res;
  const p = await previewFor(env, url);
  const out = new HTMLRewriter()
    .on("head", { element(e) { e.append(tags(p), { html: true }); } })
    .on("title", { element(e) { if (p.named) e.setInnerContent(p.title); } })
    .transform(res);
  const headers = new Headers(out.headers);
  headers.delete("content-length"); headers.delete("etag");
  // a roadbook's name can change, or the book go private: crawlers may keep the card a while, a browser only briefly
  if (url.search) headers.set("cache-control", "public, max-age=300");
  return new Response(out.body, { status: out.status, headers });
}
