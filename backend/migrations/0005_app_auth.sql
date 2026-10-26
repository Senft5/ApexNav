-- One-time codes for app sign-in: the Worker's Google callback hands the app (ASWebAuthenticationSession,
-- apexnav://auth?code=...) a single-use code; the app trades it plus its PKCE verifier for a session token.
CREATE TABLE app_auth_codes (
  code_hash  TEXT PRIMARY KEY,                          -- sha256 hex of the code; the code itself is never stored
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge  TEXT NOT NULL,                             -- base64url sha256 of the app's verifier
  expires_at TEXT NOT NULL                              -- 2 minutes after issue
);
