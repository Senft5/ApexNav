-- Decals and livery tiers (docs/design/REVIEW.md 5.1, roadmap 22). Vetta Pro, as the server knows it: written only from a
-- verified source (App Store Server Notifications once StoreKit ships, the founders' grant, earned Pro), never by the page.
CREATE TABLE pro_entitlements (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  source     TEXT NOT NULL CHECK (source IN ('app_store', 'founder', 'earned')),
  since      TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  verified_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Members who keep their Decals off a crew they're in (Decals go to every crew you're in unless you say so).
CREATE TABLE decal_optouts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, crew_id)
);
-- The livery beyond Plain: a second colour (Club), a third and a stripe pattern (Works).
ALTER TABLE crews ADD COLUMN stripe2 TEXT;
ALTER TABLE crews ADD COLUMN stripe3 TEXT;
ALTER TABLE crews ADD COLUMN pattern TEXT;
