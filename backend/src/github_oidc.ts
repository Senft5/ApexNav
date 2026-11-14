// GitHub Actions OIDC (docs.github.com "About security hardening with OpenID Connect"): a workflow with `id-token: write`
// asks GitHub for a short-lived RS256 JWT naming its repository, ref and workflow. The Worker checks it against GitHub's
// published keys, so CI can write the map data to R2 (src/data_store.ts) with no secret stored anywhere: only a run of
// this repository's main branch is let in.
export const ISSUER = "https://token.actions.githubusercontent.com";
export const AUDIENCE = "vetta-data";
export const REPO = "senft5/apexnav";              // compared lower-case (GitHub's names are case-insensitive)
export const REF = "refs/heads/main";
/** GitHub's ids for the repository and its owner: a name can be freed and taken again (a rename, a deleted account), an id
 *  can't. */
export const REPO_ID = "1432495043", OWNER_ID = "55918175";
/** Only the workflows that upload map data, as files on main (workflow_ref): any other workflow on main, or one that runs
 *  a pull request's code with main's token (pull_request_target), is refused. */
export const WORKFLOWS = [".github/workflows/data-mirror.yml", ".github/workflows/graph-us.yml"];
const EVENTS = ["push", "schedule", "workflow_dispatch", "workflow_run"];
const JWKS_URL = `${ISSUER}/.well-known/jwks`;
const JWKS_MS = 3600_000, SKEW_S = 60;

type Jwk = JsonWebKey & { kid?: string };
let jwks: { at: number; keys: Jwk[] } | null = null;
let fetchJwks: () => Promise<Jwk[]> = async () => {
  const r = await fetch(JWKS_URL, { headers: { "user-agent": "Vetta-oidc/1.0" } });
  if (!r.ok) throw new Error(`jwks ${r.status}`);
  return ((await r.json()) as { keys?: Jwk[] }).keys ?? [];
};
/** Tests only: GitHub's keys come from here instead. */
export function setJwksForTest(f: () => Promise<Jwk[]>): void { fetchJwks = f; jwks = null; }

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function keyFor(kid: string, now: number): Promise<CryptoKey | null> {
  for (let fresh = 0; fresh < 2; fresh++) {
    if (!jwks || now - jwks.at > JWKS_MS || fresh) jwks = { at: now, keys: await fetchJwks() };
    const jwk = jwks.keys.find((k) => k.kid === kid && k.kty === "RSA");
    if (jwk) return crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  }
  return null;   // GitHub rotated past it, or a made-up kid (looked up again once, then refused)
}

export interface Claims { repository: string; ref: string; workflow: string; run_id: string; sha: string }

/** The token's claims when it is a valid GitHub Actions token for this repository's main branch and our audience; else null. */
export async function verifyGitHubOidc(token: string, now = Date.now()): Promise<Claims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let head: { alg?: string; kid?: string }, c: Record<string, unknown>;
  try {
    head = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
    c = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
  } catch { return null; }
  if (head.alg !== "RS256" || typeof head.kid !== "string") return null;
  const s = Math.floor(now / 1000);
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (c.iss !== ISSUER || !aud.includes(AUDIENCE)) return null;
  if (typeof c.exp !== "number" || c.exp < s - SKEW_S || (typeof c.nbf === "number" && c.nbf > s + SKEW_S)) return null;
  if (String(c.repository).toLowerCase() !== REPO || c.ref !== REF) return null;
  if (String(c.repository_id) !== REPO_ID || String(c.repository_owner_id) !== OWNER_ID) return null;
  if (!EVENTS.includes(String(c.event_name))) return null;
  if (!WORKFLOWS.some((w) => String(c.workflow_ref).toLowerCase() === `${REPO}/${w}@${REF}`)) return null;
  let key: CryptoKey | null;
  try { key = await keyFor(head.kid, now); } catch { return null; }
  if (!key) return null;
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;
  return { repository: String(c.repository), ref: String(c.ref), workflow: String(c.workflow ?? ""), run_id: String(c.run_id ?? ""), sha: String(c.sha ?? "") };
}
