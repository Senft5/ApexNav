# STATE

## 2026-11-13: push notifications, the send path (big bet #3)
- backend/src/apns.ts: the provider token (ES256 JWT signed with WebCrypto, kept 50 minutes per isolate), `sendAlert` (one alert to one device: title, body, thread, collapse id, a tap's apexnav:// link, expiry, passive), and what each APNs answer means (`drop` the token on 410 / BadDeviceToken / DeviceTokenNotForTopic, `retry` on 429, 5xx, an expired provider token or no network). Production or sandbox per token: TestFlight and App Store builds use production.
- HTTP/2: APNs speaks nothing else. `GET /api/push/status` makes one credential-less POST to the sandbox (once an hour per isolate) and reports APNs' own answer; `{"apns":{"http":403,"reason":"MissingProviderToken","ok":true}}` from the deployed Worker proves the path.
- Keys: APNS_KEY_ID + APNS_KEY_P8, or else the Sign in with Apple key (APPLE_SIWA_KEY_ID / _P8), which works once APNs is also ticked on that key in the developer portal; APPLE_TEAM_ID either way. Nothing is sent without them.
- Not built (social's part of #3): device-token registration and storage (a migration), the app asking for permission at the moment of need, which events push, and silence while driving (C-06).

# CALL SHEET

## 2026-11-13: one Apple key for sign-in revocation and push
- What: apns.ts falls back to the Sign in with Apple key when no APNs key is set.
- Why: the owner then makes one key with both services ticked instead of two.
- Undo: drop the fallback in `keyOf` (apns.ts).
