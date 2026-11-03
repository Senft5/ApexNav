// Private themes (migration 0044 theme_grants): a theme granted to an account by hand. Its look lives here, not in the
// web app's public files, and GET /api/me sends it only to an account holding the grant; the app checks it against the
// theme contract (web/theme_contract.js) before showing it, and drops it when /api/me stops sending it.
import { Env } from "./util";
import PRIVATE_THEMES from "./private_themes.json";

export type ThemeDef = (typeof PRIVATE_THEMES)[keyof typeof PRIVATE_THEMES];
const KNOWN: Record<string, ThemeDef> = PRIVATE_THEMES;

/** The looks of the themes granted to this user, in a fixed order; a grant naming a theme this server doesn't know is skipped. */
export async function grantedThemes(env: Env, userId: string): Promise<ThemeDef[]> {
  const rows = (await env.DB.prepare("SELECT theme FROM theme_grants WHERE user_id = ? ORDER BY theme").bind(userId).all<{ theme: string }>()).results;
  return rows.map((r) => (Object.prototype.hasOwnProperty.call(KNOWN, r.theme) ? KNOWN[r.theme] : null)).filter((t): t is ThemeDef => !!t);
}
