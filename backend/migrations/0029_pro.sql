-- ApexNav Pro (docs/MONETIZATION.md §6). One row per App Store purchase, keyed by Apple's original transaction id so a
-- restore on another account moves it rather than copying it. The phone's own StoreKit entitlement is what the app
-- trusts; this copy is for the website and, later, Android. Founding drivers need no row (PRO_FOUNDING_BEFORE).
CREATE TABLE pro_purchases (
  original_tx  TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product      TEXT NOT NULL,                    -- com.senft.ApexNav.pro or .pro.trial
  environment  TEXT NOT NULL,                    -- Production or Sandbox (TestFlight, App Review)
  purchased_at TEXT NOT NULL,
  expires_at   TEXT,                             -- the trial's end; null for Pro
  revoked_at   TEXT,                             -- refunded or Family Sharing removed
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX pro_purchases_user ON pro_purchases(user_id);
