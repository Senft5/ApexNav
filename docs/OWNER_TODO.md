# Needs the owner (Nate)

Things only you can do, newest decisions first within each group. Claude keeps this list current: add a row when
something blocks on you, delete it once it's done. Everything else is in docs/IDEAS.md and done without asking.

## Before the first App Store submission

| what | why | how long |
|---|---|---|
| **Read and approve the privacy policy and terms** (https://apexnav.senftns.workers.dev/privacy.html, /terms.html once merged). Tell Claude any changes, and **which contact email** to print on them | App Review 5.1.1(i) and 1.2; they say "Draft" until you approve | 15 min |
| **Create a Sign in with Apple key**: developer.apple.com → Certificates, IDs & Profiles → Keys → **+** → name "ApexNav SIWA", tick **Sign in with Apple**, Configure → Primary App ID `com.senft.ApexNav` → Save → Register → download the `.p8` (only once). Then in Cloudflare (Workers → apexnav → Settings → Variables and Secrets) add secrets `APPLE_SIWA_KEY_ID` (the key's id) and `APPLE_SIWA_KEY_P8` (the file's contents) | When someone who signed in with Apple deletes their account, Apple requires the app to revoke their Apple token (5.1.1(v)); that call needs this key. The API key Claude has can't create it | 5 min |
| **Apply for the CarPlay entitlement**: https://developer.apple.com/contact/carplay/ (category: Navigation) | CarPlay screens (IDEAS C-01, C-02) can't ship without it, and approval takes days to weeks | 10 min |

## Decisions

| what | options |
|---|---|
| **Routing server** (IDEAS Y-04). The app uses the free public Valhalla server, which has fair-use limits and no uptime promise | a) Cloudflare Workers Paid ($5/mo) + a Container with Southeast-US road tiles; b) a $5–7/mo VPS with the whole US; c) stay on the public server until users arrive. Claude's suggestion: (a) before an App Store launch |
| **Repo visibility.** `Senft5/ApexNav` is public: anyone can read the code (the licence still reserves all rights). CI is free and unlimited while public | Keep public until launch (Claude's suggestion), or make it private (Settings → General → Danger Zone; about 13 iOS builds a month free after that) |

## Nice to know

- TestFlight: internal group "First Testers" gets every build automatically. Builds 342.1 and 349.1 are installable.
- An unused App ID `com.senft.ApexNav.JNX759T5W6` (from the first attempt) is still registered. Harmless; delete it in Identifiers if you like.
