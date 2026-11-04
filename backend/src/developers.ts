// Developers (the owner, 2026-11-04: "dev only satellite map layer access for troubleshooting"): the owner (OWNER_EMAIL,
// as safety.ts isModerator) and the co-developer, who is known here only by a fingerprint of his address: the first 16
// hex of the sha256 of the address, trimmed and lower-cased, the same fingerprint tools/crash_logs.py CODEV follows his
// TestFlight notes by. No address is in the repo. GET /api/me says `developer: true` to a developer and nothing to anyone
// else; the app shows its developer tools (the Satellite layer) only then. DEV_FINGERPRINTS (a var, comma-separated)
// adds more without a release; it can't take one away.
import type { Viewer } from "./auth";
import { isModerator } from "./safety";
import { Env, sha256hex } from "./util";

/** The co-developer (tools/crash_logs.py CODEV). */
export const DEV_FINGERPRINTS = ["6af4f2d604522a57"];

export async function emailFingerprint(email: string): Promise<string> {
  return (await sha256hex(email.trim().toLowerCase())).slice(0, 16);
}

/** A member who is the owner or one of the fingerprinted developers. A banned or not-yet-member account never is. */
export async function isDeveloper(env: Env, v: Viewer): Promise<boolean> {
  if (!v.member || !v.email) return false;
  if (isModerator(env, v)) return true;
  const extra = (env.DEV_FINGERPRINTS || "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => /^[0-9a-f]{16}$/.test(s));
  return [...DEV_FINGERPRINTS, ...extra].includes(await emailFingerprint(v.email));
}
