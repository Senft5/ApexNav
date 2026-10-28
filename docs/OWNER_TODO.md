# Needs the owner (Nate)

Things only you can do, newest decisions first within each group. Claude keeps this list current: add a row when
something blocks on you, delete it once it's done. Everything else is in docs/IDEAS.md and done without asking.

## Before the first App Store submission

| what | why | how long |
|---|---|---|
| **Optional tidy-up: revoke 10 leftover CI certificates**: developer.apple.com → Certificates, IDs & Profiles → Certificates → each **"Apple Development: Created via API"** (made 28 Oct, 04:06–05:35 UTC) → Revoke. Keep **"iOS Development: Jennifer senft"** and anything from your own Mac | They block nothing any more: since #181 CI archives without a certificate (build 377.1 uploaded and is VALID). They only use up Apple's per-account limit, which Xcode on your Mac also needs. Claude couldn't revoke them (blocked as irreversible) | 3 min |
| **Read and approve the privacy policy and terms** (https://apexnav.senftns.workers.dev/privacy.html, /terms.html once merged). Tell Claude any changes, and **which contact email** to print on them | App Review 5.1.1(i) and 1.2; they say "Draft" until you approve | 15 min |
| **Create a Sign in with Apple key**: developer.apple.com → Certificates, IDs & Profiles → Keys → **+** → name "ApexNav SIWA", tick **Sign in with Apple**, Configure → Primary App ID `com.senft.ApexNav` → Save → Register → download the `.p8` (only once). Then in Cloudflare (Workers → apexnav → Settings → Variables and Secrets) add secrets `APPLE_SIWA_KEY_ID` (the key's id) and `APPLE_SIWA_KEY_P8` (the file's contents) | When someone who signed in with Apple deletes their account, Apple requires the app to revoke their Apple token (5.1.1(v)); that call needs this key. The API key Claude has can't create it | 5 min |
| **Paste the App Review notes** (Claude sent the text and the review code in chat; it is not in the repo because the repo is public): App Store Connect → ApexNav → 1.0 → App Review Information → Notes. Also fill in your contact name, phone and email there | Reviewers need a way past the invite-only sign-up (guideline 2.1) | 5 min |
| **Paste the listing** from docs/LISTING.md into App Store Connect → ApexNav → 1.0 (subtitle, promotional text, description, keywords, category) and answer App Privacy and the age rating as it lists. Edit the text there first if you want different words | The submission needs them (guideline 2.3); App Privacy answers must match what the app does, which the doc traces | 15 min |
| **Apply for the CarPlay entitlement**: https://developer.apple.com/contact/carplay/ (category: Navigation) | CarPlay screens (IDEAS C-01, C-02) can't ship without it, and approval takes days to weeks | 10 min |

## Decisions

| what | options |
|---|---|
| **Routing server** (IDEAS Y-04). The app uses the free public Valhalla server, which has fair-use limits and no uptime promise | a) Cloudflare Workers Paid ($5/mo) + a Container with Southeast-US road tiles; b) a $5–7/mo VPS with the whole US; c) stay on the public server until users arrive. Claude's suggestion: (a) before an App Store launch |
| **Repo visibility.** `Senft5/ApexNav` is public: anyone can read the code (the licence still reserves all rights). CI is free and unlimited while public | Keep public until launch (Claude's suggestion), or make it private (Settings → General → Danger Zone; about 13 iOS builds a month free after that) |

## Nice to know

- **Please check on the next TestFlight build**: the app now runs under a Content-Security-Policy (IDEAS Z-11). It was verified in Chromium with the live map and voice, but not inside the iOS app. If the map, routing, sign-in or the Log stop working there, tell Claude: it's a one-line fix in `tools/csp.py`.
- **Worth trying on the next TestFlight build** (all merged today): Map panel → Measured roads; add your car's ride height and width in the Garage; say "Hey Siri, start a drive in ApexNav"; mount the phone sideways (landscape cockpit); map panel → 3D terrain, then Preview a route; Settings → Units → kilometres; on a planned route, tap a viewpoint pin → Add as a stop, and drag the route line to reshape it; the route card's forecast, climb and closure lines; Log → a drive → Your notes (recce) and "Which road was better?"; Crew → Friends → Profile and Kudos.

- TestFlight: internal group "First Testers" gets every build automatically; every main merge uploads one (377.1 onward VALID).
- Tester feedback (Settings → Feedback, once #196 merges) shows in the app under Crew → your owner section, with Done to clear it.
- An unused App ID `com.senft.ApexNav.JNX759T5W6` (from the first attempt) is still registered. Harmless; delete it in Identifiers if you like.
