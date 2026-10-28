// ApexNav Pro entitlement on the server (docs/MONETIZATION.md §6). The app trusts StoreKit on the phone; this is the copy
// the website (and later Android) reads, so a purchase follows the account. Founding drivers, everyone who joined before
// PRO_FOUNDING_BEFORE, have Pro without a purchase. Nothing here charges anyone: the products are created in App Store
// Connect and the app's purchase sheet is behind the `pro` flag (off until the owner approves the price).
import { Env, HttpError, body, sqlTime, str } from "./util";
import { verifyTransaction } from "./storekit";
import type { Viewer } from "./auth";

export const BUNDLE_ID = "com.senft.ApexNav";
export const PRODUCT_PRO = "com.senft.ApexNav.pro", PRODUCT_TRIAL = "com.senft.ApexNav.pro.trial";
export const TRIAL_DAYS = 14;

export interface ProStatus { active: boolean; source: "founding" | "purchase" | "trial" | null; until: string | null; trial_used: boolean }

export async function proStatus(env: Env, userId: string, nowMs = Date.now()): Promise<ProStatus> {
  const now = sqlTime(nowMs);
  const rows = (await env.DB.prepare("SELECT product, expires_at, revoked_at FROM pro_purchases WHERE user_id = ?").bind(userId)
    .all<{ product: string; expires_at: string | null; revoked_at: string | null }>()).results;
  const trialUsed = rows.some((r) => r.product === PRODUCT_TRIAL);
  if (rows.some((r) => r.product === PRODUCT_PRO && !r.revoked_at)) return { active: true, source: "purchase", until: null, trial_used: trialUsed };
  const before = env.PRO_FOUNDING_BEFORE;
  if (before && /^\d{4}-\d{2}-\d{2}/.test(before)) {
    const m = await env.DB.prepare("SELECT 1 FROM members WHERE user_id = ? AND joined_at < ?").bind(userId, before.replace("T", " ").slice(0, 19)).first();
    if (m) return { active: true, source: "founding", until: null, trial_used: trialUsed };
  }
  const trial = rows.filter((r) => r.product === PRODUCT_TRIAL && !r.revoked_at && r.expires_at && r.expires_at > now)
    .sort((a, b) => (a.expires_at! < b.expires_at! ? 1 : -1))[0];
  if (trial) return { active: true, source: "trial", until: trial.expires_at!.replace(" ", "T") + "Z", trial_used: true };
  return { active: false, source: null, until: null, trial_used: trialUsed };
}

/** POST /api/pro/verify {jws}: record a StoreKit 2 transaction for this account and return the account's Pro state. */
export async function proVerify(env: Env, v: Viewer, req: Request): Promise<ProStatus> {
  const b = await body<{ jws?: unknown }>(req);
  const t = await verifyTransaction(str(b.jws, "jws", 100, 20000), env.STOREKIT_ROOT_SHA256 || undefined);
  if (t.bundleId !== BUNDLE_ID || (t.productId !== PRODUCT_PRO && t.productId !== PRODUCT_TRIAL)
      || !t.originalTransactionId || typeof t.purchaseDate !== "number") throw new HttpError(400, "bad_transaction");
  // Sandbox purchases (TestFlight, App Review, Xcode) are free, so they only count where the owner allows it
  if (t.environment !== "Production" && env.PRO_ALLOW_SANDBOX !== "1") throw new HttpError(400, "sandbox_transaction");
  const expires = t.productId === PRODUCT_TRIAL ? sqlTime(t.purchaseDate + TRIAL_DAYS * 86400_000) : null;
  await env.DB.prepare(
    `INSERT INTO pro_purchases (original_tx, user_id, product, environment, purchased_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(original_tx) DO UPDATE SET user_id = excluded.user_id, revoked_at = excluded.revoked_at, updated_at = datetime('now')`)
    .bind(String(t.originalTransactionId), v.id, t.productId, String(t.environment ?? ""), sqlTime(t.purchaseDate), expires,
          typeof t.revocationDate === "number" ? sqlTime(t.revocationDate) : null).run();
  return proStatus(env, v.id);
}
