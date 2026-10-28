# Convoy transport: first isolated slice (2026-10-26)

Status: server built (backend/src/convoy.ts, 2026-10-28) and tested locally against real Durable Objects, D1 and
sockets in the Workers test pool (backend/test/convoy.test.ts). Not phone-validated. The section "As built" below
records where the build differs from the draft that follows, and why.

## As built (2026-10-28)

- Routes: `POST /api/convoy` `{consent, name?}`, `POST /api/convoy/join` `{consent, invite}` (the invite is
  `<convoy id>.<secret>`, so a link `/?convoy=<invite>` is enough), `GET /api/convoy/:id`, `POST /api/convoy/:id/invite`
  (leader: new link, old one dies), `/ticket`, `/leave`, `/remove` `{member}` (leader), `GET /api/convoy/:id/connect` (socket).
- Bounds that changed, on purpose: invite 30 min (people gather at a meet before a drive; the leader can make a fresh one
  any time); frames up to 32 KiB, measured in bytes, but only a `route` frame may exceed 2 KiB (a shared route needs it);
  hazards live 3 min by default and 5 min at most, because the last car of a 16-car convoy can be minutes behind; hazard
  kinds add tap calls (gravel, debris, animal, police, camera, stopped) to bump and hard_braking.
- Anchors need lat/lon; pathId (ID-shaped), routeVersion, direction and progressM are optional. The shared route is the
  leader's planned route, versioned; progress along it is what followers compare.
- Live positions (lat, lon, heading, speed, progress on the shared route) go to the other members only, at most one per
  400 ms per member, kept in memory for 2 min. Regroup point: leader only.
- Context is `{ sessionId, name, leaderEpoch, leaderKey, role, you, expiresAtMs, seq, members }`. Members are shown by a
  per-convoy key, handle and name; account ids never leave the server. A new member gets every live hazard (they are
  behind the leader, which is exactly who needs them); a reconnecting client passes `{epoch, afterSeq}` to skip what it has.
- Persisted: room, member keys/roles, left/removed lists. Names are read from the accounts, not stored. A second object
  per user (ConvoyIndex: convoy ids and expiry only) lets a block, sign-out or account deletion reach that user's convoys
  at once, and caps each person at two led convoys at once and ten started an hour.
- Blocks: never in the same convoy. A block mid-drive drops the blocked member (or the blocker, if the blocked one leads)
  immediately, and every 15 s sweep re-checks. Removed by the leader = out for the life of the convoy. Sessions are
  re-checked on sign-out (immediately), every 15 s, and before a hazard (at most 5 s old).
- Sockets: two per member (a third replaces the oldest), 32 unauthenticated at once per convoy, frames sent behind
  `authenticate` are dropped until `ready`. Control characters and bidi overrides are refused in names, notes and routes.
- The iOS shell's origin (`apexnav://app`) is allowed; whether WKWebView sends exactly that Origin on a socket is
  untested on a phone.


## Decision and scope

Use one Cloudflare Durable Object per convoy with an authenticated WebSocket relay for the
first slice. This is the small-relay fallback in SOCIAL, not removal of its preference for
peer-to-peer where feasible. Keep the event/client interface replaceable. WebRTC signaling,
TURN and connection revocation are deferred, not claimed implemented. The current canonical
Worker configuration is root `wrangler.jsonc`; local tests use `backend/wrangler.test.jsonc`.

The first build implements real local API/auth/socket fanout tests, not another standalone
ledger. No native, sensor math, speech, HTML or road-learning integration in this slice.
No new production calls, deployment, account resources or migration execution.

## Privacy and lifecycle

- Use standard, non-hibernating WebSockets initially. This intentionally trades idle cost
  for a simpler memory-only live-event lifetime. It is not a production cost approval.
- Persist only minimal control metadata: room expiry, member IDs/roles and consent,
  account-session binding, hashed invitation/ticket secrets, actor generation and sequence
  safety metadata. Never persist hazard anchors, participant fixes, speeds, event bodies
  or movement history, including in socket attachments or routine logs.
- Draft operational bounds: 16 joined members, 2-hour room lifetime, 10-minute invitation,
  30-second single-use socket ticket, 5-second unauthenticated socket deadline, 8 KiB messages,
  and 256 live hazard/tombstone entries with at most 60-second event lifetime.
  These are reviewable engineering bounds, not validated product/sensor thresholds.
- Restart/eviction invalidates the previous actor/leader epoch. Fail closed: clients must
  reconnect, obtain fresh authorization/context and discard old events. Do not reconstruct
  locations from storage or promise replay continuity across a restart.
- In the same active actor, keep unexpired hazards and retraction tombstones in memory for
  bounded reconnect replay. Never evict a live tombstone to admit another hazard; report
  capacity failure. A retracted ID must not be resurrected by duplicate/reordered messages.
- Room expiry or leader leave ends the room, closes every socket and purges control data.
  Unknown/missing metadata must not recreate an ended room. Configure/test cleanup alarms.

## Frozen API boundary

All HTTP mutations use existing signed-in-member authorization and origin/CSRF rules.
Permanent Crew membership does not imply live-session consent. No wildcard origin expansion.

1. `POST /api/convoy/sessions`, JSON `{ consent: true }`: create random room ID, leader role,
   epoch, expiry and an invite token. Return public session context and an invitation encoding
   room ID plus a high-entropy secret. Link/copy-code UX comes later; no guessable short codes.
2. `POST /api/convoy/sessions/:id/join`, JSON `{ consent: true, invite }`: verify invite,
   expiry and capacity; return member role and current session context. Membership never
   authorizes sending leader events. Joining cannot undo a revoked membership using an old invite.
3. `POST /api/convoy/sessions/:id/ticket`: revalidate room, membership and account session;
   mint a random single-use ticket bound to user, role, epoch, account-session hash and expiry.
4. `WSS /api/convoy/sessions/:id/connect`: URL contains NO bearer token or ticket. Upgrade to
   a bounded unauthenticated socket. First frame `{ type: 'authenticate', ticket, afterSeq }`
   atomically consumes the ticket before any session metadata/replay/broadcast is sent.
   Missing/invalid/reused/expired tickets close the socket. This deliberate first-frame
   handshake avoids putting credentials in URLs/subprotocol headers or access-log paths.
5. Authenticated leader frames `{ type: 'publish', event }`: validate account session,
   room membership, role, epoch, sender, schema, byte/rate bounds and expiry on EVERY event;
   validate recipient authorization before fanout. Do not trust client envelope identity.
   Reject follower publication, unknown fields and malformed/nonfinite coordinates/progress.
6. `POST /api/convoy/sessions/:id/leave`: idempotent; revoke membership/tickets and close all
   of that member's sockets. Leader leave ends the room. A fresh join requires a fresh invite
   issued by the leader, not reuse of a revoked member's old credentials.

Return context `{ sessionId, leaderId, leaderEpoch, role, expiresAtMs, replayCutoffSeq }`.
Replay cutoff is an authorization lower bound, not merely last delivered sequence; replay
only authorized, unexpired entries. Keep stable event IDs distinct from increasing sequences.

## Event boundary

Use the event-ledger v1 base fields: `version`, `eventId`, `sessionId`, `leaderEpoch`,
`leaderId`, `seq`, `observedAtMs`, `expiresAtMs`, `type: bump | hard_braking`,
`action: hazard | retract`; hazards require
`anchor: { pathId, routeVersion, direction, progressM }`.
Retraction refers to the SAME event ID and is transmitted immediately after cancellation,
never used to delay initial publication. The server must independently validate the contract.
Server receipt time, sequence policy and bounded expiry are authoritative; do not treat
client fields as proof of identity, sensor quality or a confirmed pothole. Preserve explicit
nullable source/quality in the transport envelope; exact sensor evidence fields require the
shared-acquisition contract before detector integration. Unknown quality remains unknown.

The relay does not decide that an event is ahead or start speech. Followers still require
fresh, accurate matched path/version/direction and positive remaining progress, then priority
speech with actual-start acknowledgement. Source/quality validation, detector, matching and
speech remain integration gates; no claims of detection-to-speech success from socket tests.

## Acceptance and next build

Use isolated local D1/DO resources and one leader plus two followers. Exercise cookie and
app-bearer HTTP auth, explicit consent, ticket expiry/reuse, unauthorized/follower publishes,
immediate fanout, cancellation/reorder/tombstones, stale replay, revocation/account logout,
room expiry, actor reset, bounds, and sanitized errors/logs. Assert no anchors/event bodies
are persisted. Document WebSocket origin behavior on a real WKWebView as untested; do not
broaden origin policy to hide an opaque-origin compatibility issue.

Retain the unmeasured p95 <= 1.5 s detector-emission-to-ACTUAL-speech-start target. Socket
receipt time is not audible onset. Phone latency, navigation continuity and speech acceptance
require the later real-device flow. Root docs and the unrelated iOS freeze patch stay separate.

Primary references consulted: Cloudflare Durable Objects WebSocket best practices, lifecycle,
SQLite storage and alarms documentation. Hibernation resets in-memory state; any future
hibernation design must explicitly solve replay/privacy rather than silently persisting fixes.
