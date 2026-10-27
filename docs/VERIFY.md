# APEX NAV — OWNER VERIFICATION CHECKLIST

## iOS route-loading freeze (2026-10-26; not yet device-verified)
1. Install an IPA rebuilt with the local route-loading patch; the already installed bundle does not update automatically. Test while parked or as a passenger, never by operating the phone while driving.
2. Load the route that froze, noting whether it is a destination, loop or saved replay, its approximate length and the last loading label. During loading, check that tabs and map gestures still respond.
3. Repeat a destination route and a loop. Progress must advance during stage scoring rather than showing completed scoring before it starts. Preview/Drive it must still appear on success; no measured road values should be invented.
4. Repeat with connectivity disabled or a stalled route service. Search has a 10 s deadline; individual routing/tile requests have 20 s deadlines including body reads. Multiple sequential steps/fallbacks can take longer than one deadline. An unavailable primary router must fall back or show a failure; controls must become usable for retry and an existing route must not be replaced by a failed result.
5. Restore connectivity and retry without restarting the app. Report whether the exact original freeze reproduces. If it does, capture the last label, approximate elapsed time, voice/road-name settings and device logs; automated timer/Node tests are not physical-phone evidence.

Four things I cannot do from my cloud container (no Google account, no live map servers, no real recording, no screen reader).
Each is a short, ordered check with what "good" looks like. Site: https://apexnav.senftns.workers.dev (replace if your workers.dev name differs).

## 1. Google sign-in (about 15 minutes)
**Create the client** (Google Cloud console, free):
1. console.cloud.google.com → create a project "ApexNav" → **APIs & Services → OAuth consent screen**: User type *External*, app name ApexNav, your email as support and developer contact, scopes: only the defaults (`openid`, `email`, `profile`), then **Publish app** (status "In production"; basic scopes like these do not need Google's app verification).
2. **Credentials → Create credentials → OAuth client ID → Web application.**
   Authorized redirect URI (exact): `https://apexnav.senftns.workers.dev/api/auth/google/callback`
3. Copy the **Client ID** and **Client secret**.

**Set the secrets** (Cloudflare dashboard → Workers & Pages → apexnav → Settings → Variables and Secrets → Add, type *Secret*):
| Name | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | from step 3 |
| `GOOGLE_CLIENT_SECRET` | from step 3 |
| `OWNER_EMAIL` | the Google account you will sign in with (it becomes the first member) |
| `PEPPER` | a long random string: run `openssl rand -hex 32` and paste the output; never change it later (it keys the "already contributed" check) |

Save, then deploy (a new version is needed for secrets to apply: push any commit or press *Deploy* in the dashboard).

**Check it works:**
1. Open the site on your phone → tab bar **SETUP** → Account → *SIGN IN WITH GOOGLE*. You should land back on the site, signed in, with a prompt to pick a handle.
2. Pick a handle → you should see "Signed in as @handle", CREATE INVITE, ROAD DATA toggle, DOWNLOAD MY DATA.
3. CREATE INVITE → send the link to a friend (or open it in a private window with a second Google account) → they sign in, the invite redeems, and they appear as a member. Add each other as friends by handle.
4. Bad signs: "503" or the Account panel missing = a secret is missing/misspelt or not deployed yet; Google "redirect_uri_mismatch" = the redirect URI differs by even one character.
Report back: which step failed and the exact message.

## 2. Live road matching and the road-feel lane (about 20 minutes, needs one real drive)
What is unverified: Valhalla `trace_attributes` map-matching, Overpass way geometry, and bin alignment on a real recording.
1. **Connectivity (30 seconds, from any computer):**
   `curl -s -X POST https://valhalla1.openstreetmap.de/trace_attributes -H 'content-type: application/json' -d '{"shape":[{"lat":LAT1,"lon":LON1},{"lat":LAT2,"lon":LON2}],"costing":"auto","shape_match":"map_snap","filters":{"attributes":["edge.way_id","matched.edge_index","matched.type"],"action":"include"}}'`
   (two points about 100 m apart on any road near you). Good: JSON with `edges[0].way_id`. Then
   `curl -s --data-urlencode 'data=[out:json];way(id:THE_WAY_ID);out geom;' https://overpass-api.de/api/interpreter` → good: a `geometry` list.
2. **Real recording:** record a 10+ minute drive with the iPhone app (record → share the `.csv`), keep it under two weeks old, on roads that are not residential.
3. Web analysis page → **HISTORY → IMPORT RECORDING** (the file must be imported after this build; older imports lack the roughness columns). Drive tab should show the drive.
4. Main page → Account → turn **ROAD DATA** on. Analysis page → Drive tab: a **Share road data** panel appears → press SHARE on the drive.
   Good: "SHARED n roads". Bad: "NO USABLE ROADS" (everything too short/private/unmatched) or a matching error in the button text.
5. **Prove it landed (no waiting any more):** Cloudflare dashboard → D1 → `apexnav-db` → Console → `SELECT way_id, dir, COUNT(*) AS bins, MAX(n) AS passes FROM road_bins GROUP BY way_id, dir;` — one row per road you drove. `SELECT * FROM points_ledger;` shows your points (3x if you were first on a road).
6. **Road-feel lane:** reopen the Drive tab for that drive; the **ROAD FEEL · MEMBERS** lane and the cockpit's "Measured by members" line now show your own data immediately. (If you want to clear your test data afterwards: `DELETE FROM road_bins; DELETE FROM rank_slots; DELETE FROM seen; DELETE FROM points_ledger; DELETE FROM upload_counts;` while there is no real data yet.)
Report back: the two curl results (or errors) and what the Share button said.

## 3. Screen reader (about 10 minutes)
**iPhone:** Settings → Accessibility → VoiceOver (or triple-click the side button after enabling the shortcut). Open the analysis page: https://apexnav.senftns.workers.dev/analysis.html
- Swipe right through the header: you should hear "Analysis views, tab list", then each tab ("Drive, tab, selected, 1 of 4"); double-tap to switch.
- On the Drive tab find the **"Position along the drive" slider**: swipe up/down (adjustable) should move it and speak e.g. "0.17 miles, 38 miles per hour".
- Zoom buttons should read "Zoom: 0.5 mi window"; corner buttons "Corner 5: Left 5 minus, apex 55 miles per hour".
- Note anything that is skipped, read twice, or read as "button" with no name.
**Android:** Settings → Accessibility → TalkBack, same walk-through.
Report back: anything unlabelled or confusing; I will fix it.

## 4. Voice
I have started a background investigation to remove the GPL **espeak-ng** code from the live (in-browser) voice path (it reaches users through the `phonemizer` package that kokoro-js pulls in). Pre-rendered voice clips are not affected. Results land in docs/VOICE.md ("Removing espeak-ng (GPL)") and docs/STATE.md.
Voice quality work that needs YOUR PC (RTX 5080), whenever you want it: see `tools/local/README.md` (fine-tune Kokoro on your own recordings).
