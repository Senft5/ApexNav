# VI: Victor Lindgren, privacy and security

I'm 42 and I've audited location apps for a living. I don't read a privacy page for its tone. I read it against the wire.
For this review I read `web/privacy.html` line by line, then `backend/src` (all of it, plus the migrations and
`wrangler.jsonc`), the shell's API bridge (`ApexNavApp.swift` `ApexApiBridge`, the Apple sign-in, MapKit search and traffic
code), and the web code that calls out (`cockpit.js`, `contributor.js`, `friends_map.js`, `flags.js`, `health.js`,
`voice.js`). The photos from recording 7 are cited where the screen makes a promise.

## 1. First impressions

This is the most carefully written privacy page I've seen in an indie app, and most of it is true. The ETA share holds
no position, keeps only a hash of the token, and expires after 4 hours (`eta_share.ts`). Photos are redrawn on the phone.
Presence samples are snapped to a grid before they're stored. The bridge sends the bearer token only to its own host, and
only for the main frame. Somebody here cares.

That care is why the gaps matter. The page makes absolute promises, "Never your position", "Inside one, nothing is
recorded or shared", "anonymous", and the code breaks three of them.

**The big truth: every signed-in driver sends a position beacon, and nothing on screen says so.** During a drive,
`feedReported → loadReported` (`cockpit.js` ~5472, 5716) sends `GET /api/hazards?lat=…&lon=…` to 5 decimal places (about
1 m) every 120 s, with the session token. The first call goes out the moment the drive starts. `state.lastPosition` is
updated inside privacy zones, so the first beacon of a drive that starts at home is your driveway. The server doesn't store
the query. But `wrangler.jsonc` has `"observability": { "enabled": true }`, and the request URL is the kind of thing Workers
Logs keeps. Meanwhile the Garage says **"Who sees what · Nobody sees where you are"** (signed-in/004-account.png), and the
drive screen shows only "Rec" (guided-drive/068-reported.png).

**The second truth: "Road data" isn't anonymous while it moves, and only partly anonymous at rest.** With Road data on,
the app streams 500 m chunks live (`contributor.js` `createLive`, and `createAmbient`, which runs "whenever the app is open
and the phone is mounted", even with no drive recording). Each chunk carries your session, a road id, a direction, a bin range
and the date. In arrival order, that is your path, timed. The raw GPS trace also goes to the public Valhalla server
continuously, which the page only admits "when the Log matches a drive". At rest, the server keeps `upload_counts` (your
user id, the hour, km) for 8 days, plus `seen` and `rank_slots`, which hold an HMAC of user, way and direction under one
fixed `PEPPER`. Anyone with the pepper can enumerate users × ways and get back every road each person has mapped, and
`rank_slots.driven_on` adds the date. None of these rows is deleted with the account. That is pseudonymous data, not
anonymous data.

The rest is drift: hosts and data the page doesn't list.

## 2. Proposals

### VI-1: Kill the position beacon (hazards by tile, never from inside a zone, no URLs in logs)
- **Why:** this breaks the page's central promise and the privacy zone feature, for every signed-in driver, with no switch.
  The evidence is above: `cockpit.js` `loadReported` (`toFixed(5)`, a 120 s cadence, `reported.at = -Infinity` so the first
  call fires at once) and the closure lookup at ~1991 (`toFixed(4)`). It sits against "Nobody sees where you are"
  (signed-in/004-account.png).
- **Build:**
  1. Ask for hazards by coarse tile: round to 0.1° (as the closure cache's key already does), or a fixed ~25 km cell id,
     with a server radius that covers the cell. Filter and sort by distance on the phone. Cache per tile for 2 minutes.
  2. Send no hazard lookup while `inPrivacyZone(lastPosition)` is true, and none in the first 1 km of a drive. Reuse
     `privateEdge()`.
  3. Do the same for `/api/events/near` and `/api/crews/discover` (`social.ts:141`, `events.ts:132`).
  4. In `wrangler.jsonc`, turn invocation logs off. That's `observability.logs.invocation_logs: false`; check the key
     against current wrangler docs. Or keep them and scrub query strings. Keep the structured `console.log` lines,
     because `errors.ts` already scrubs them.
  5. Add a test like `tests/test_csp.py` that fails if any `/api/*` URL a page builds carries lat or lon at more than 1
     decimal place.
- **Cost:** S
- **Done looks like:** a whole drive from a home zone, captured at the bridge, shows no coordinate finer than 0.1°, and
  none at all before the first km. The Garage line is true.

### VI-2: A privacy page that the test suite holds to the code
- **Why:** the page is hand-written, and the code has drifted from it in at least ten places. Each one is small; together
  they make the page wrong.
  - **Apple isn't listed.** In the app, Where to? typing goes to Apple's `MKLocalSearchCompleter` with a region around the
    phone (`ApexNavApp.swift` ~1118). The traffic probe sends route endpoints to Apple `MKDirections` (~1211). CarPlay search
    uses `MKLocalSearch`. The page names only Photon and Nominatim.
  - **Sign in with Apple** exists (`apple.ts`). The page says "From Google sign-in". Revoking the Apple token on deletion is
    still open (APP_REVIEW O-05, 5.1.1(v)).
  - **Convoys send your speed and progress** to every car (`convoy.ts` `Position.speedMps`, broadcast at line ~330). The
    page says "position, heading and handle".
  - **Friends map** has "Only while driving" off, which means "whenever the app is open" (`friends_map.js:62`). The page says
    "sent while you drive". With Live and Exact, the road name goes too.
  - **Road data** sends the live raw trace to Valhalla, and it keeps an hourly per-user upload log (see VI-3).
  - **Hazard reports** keep who reported (`reported_by`), with the exact spot and time, until a day after expiry: up to 8+
    days, renewed by confirmations. `hazard_votes` link people to places too. The page says only "they never see who".
  - **App health** is on by default (`toggles.health: true`). The page reads as if it were opt-in.
  - **Feedback diagnostics** include `drives`, `voice`, `page` and `offline` (`feedback.ts cleanDiag`), more than the page
    lists.
  - **Overpass mirrors** `overpass.private.coffee` and `overpass.kumi.systems` are run by third parties, not OpenStreetMap.
  - **Hugging Face and jsDelivr** (the website's voice) aren't listed.
  - **Used invites** are kept forever as "invite chains" (`sweep.ts`). That isn't on the page.
- **Build:**
  1. Add `schemas/data_flows.json`: one row per outbound flow (host or endpoint, what's sent, when, the switch, retention,
     who sees it).
  2. Generate the "Services" and per-feature sections of `privacy.html` from it, the way `tools/csp.py` generates the CSP.
  3. Add a test that fails when a `connect-src` host, a `fetch('https://…')` literal, an MK* call in Swift, or a
     `/api/*` route in `index.ts` has no row.
  4. Fix the ten items above in the same PR.
  5. Add a "What's on" summary at the top of Garage → Your data: each live flow with its current switch state.
- **Cost:** M
- **Done looks like:** adding a new host without a privacy row turns CI red, and every sentence on the page can be traced
  to a row.

### VI-3: Make "anonymous road data" true
- **Why:** the claim "Never your position, your path, speeds or times… anonymous" fails three ways (section 1):
  - live, authenticated, ordered chunks, which give your path in real time;
  - `upload_counts`, which keeps your user id and the hour for 8 days;
  - a fixed-pepper HMAC per (user, way, direction), and the date in `rank_slots`, kept after deletion.

  The CALL_SHEET records "real time, no holding period" as the owner's decision (`contributor.js:146`). I'm pushing back on
  it once, as the rules allow: real time is the one choice that turns road data into tracking.
- **Build:**
  1. Queue chunks on the phone and send them after the trip ends, shuffled, with a random 0 to 6 h delay.
  2. Send them through an unauthenticated endpoint that takes a short-lived, unlinkable upload token. Batch-issue tokens
     at sign-in, a blind-signature-lite: the server signs a token's hash without learning which drive spends it. Points
     are then claimed by count, not by road.
  3. Coarsen `upload_counts` to the day and keep it 2 days. Store `rank_slots.driven_on` as a month.
  4. Rotate the HMAC pepper for `seen` and `holder` each quarter, so old rows stop being linkable to anyone.
  5. On deletion, drop `seen` and `rank_slots` rows by recomputing the user's holders over `road_ways`.
  6. Map-match on the phone against the Overpass ways the app already fetches, instead of sending the trace to Valhalla.
     Do this last; it's the expensive part.
- **Cost:** L (S for items 3 and 5 alone, which should ship now)
- **Done looks like:** the server can't say which member drove which road, or when. Live reception stops, so a server
  breach or a subpoena yields averages, not routes.

### VI-4: Deletion and backups mean what the page says
- **Why:** "Delete account erases… Server backups are kept for up to 8 weeks."
  - The backup is a full D1 dump (`backup.ts dumpStatements`, every table) in KV. It includes `presence_settings.zones`,
    which holds the exact centres of people's home and work. That's the single most sensitive thing Vetta holds, and the page
    says it's "deleted when you choose Nobody". It is, in D1, but not in the eight weekly copies.
  - It also includes `sessions` hashes, `hazard_reports.reported_by`, and the `seen` HMACs from VI-3.
  - The export (`account.ts`) omits kudos, ETA shares, presence samples and invites, so "everything the server holds"
    isn't everything.
- **Build:**
  1. Add a `BACKUP_SKIP` list: `sessions`, `app_auth_codes`, `presence_samples`, `eta_shares`, `upload_counts`,
     `health_counts`.
  2. Null out `presence_settings.zones` in the dump. Better: don't store zones on the server at all. The phone already
     refuses to send from inside a zone (`friends_map.js shouldSend inZone`). The server copy only defends against a modified
     client, and a modified client could lie about zones anyway.
  3. Make the export complete: kudos, ETA shares, presence, invites. Add a test that every table with a user column is
     either in the export or on a documented exclusion list.
  4. Put Apple token revocation on deletion in OWNER_TODO, since it needs the owner's key.
- **Cost:** M
- **Done looks like:** the week after someone deletes their account or chooses Nobody, no backup holds their home.
  Download my data matches a `SELECT` over every user-keyed table.

## 3. Did round 1 land?

Yes, and well from where I sit. Your roads are grouped by drive name, so "drives aren't sent to the map-matching server".
"Not driven yet" reads only map tiles. The Reminder is off until asked for. Each of those was the privacy-preserving choice
when it could have gone the other way. Keep making that kind of call; VI-1 and VI-3 are the same kind of call.

## 4. What I'd protect

1. **The ETA share** (`eta_share.ts`): no position, only a hash of the token, a 4 h life and a 1-day sweep. It's the
   template every other social feature should copy.
2. **The API bridge** (`ApexApiBridge`): the Keychain bearer, the main frame only, a fixed host, the path checked, and
   review-account writes held. Don't let anyone turn it into a general fetch proxy.
