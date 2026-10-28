# Marketing plan

How ApexNav finds its first 10,000 drivers with almost no budget, run by Claude as far as the platforms allow.
Drafted 2026-10-28. Draft materials are in `docs/marketing/`; nothing is posted or sent until the owner has made the
accounts in section 7 and approved the first batch. The money side is in docs/MONETIZATION.md.

## 1. Who it is for

| segment | where they are | what they want to hear |
|---|---|---|
| **Weekend back-road drivers** (Miata, GR86/BRZ, GTI, Civic Si, Mustang, 911 and Cayman, older BMWs): the core | marque forums and subreddits, Cars & Coffee, Instagram, YouTube car channels | "find the good roads near you, and get a co-driver for them" |
| **Car clubs and crews** (PCA, BMW CCA, Miata clubs, SCCA regions, informal crews) | club newsletters, Facebook groups, Discord | convoys that don't lose people, hazards relayed down the line, a route everyone can open |
| **Road-trippers** who take the scenic way | r/roadtrip, travel Instagram, Blue Ridge and Pacific Coast groups | loops, viewpoints and cafés on the way, works with no signal |
| **Track day beginners** | HPDE groups, track Discords | the same app on a raceway with lap timing (Pro) |
| Later: **motorcyclists** (largest market for twisty-road apps; Calimoto's audience) | moto subreddits, ADV forums | needs helmet-audio testing and a bike profile first; not marketed until it works on a bike |

## 2. Position

**"The co-driver for the long way home."** Three proof points, in this order, everywhere:

1. **It reads the road out loud**: pace notes before every corner, timed to your speed, with no signal.
2. **It knows how the road feels, not just its shape**: every member's phone measures banking, crests and rough
   surface, so the good roads float up and the broken ones sink.
3. **No subscription, no ads, no tracking.** Free, or one payment for Pro, once.

Words we use: flow, smooth, technique, the long way, co-driver, crew. Words we never use: fast, speed, race, beat
the time, police alerts, "evade". Every image and video: no speedometer, no speeds, no street racing, no
on-road lap times, no phone in hand. This is App Review 1.4 and the platforms' dangerous-driving rules, and it keeps
the brand legal-speed fun. `tests/test_listing.py` already enforces this for the listing; section 8 extends it.

## 3. Channels, ranked by reach per hour and how much Claude can run alone

| # | channel | what | Claude runs | owner does | cost |
|---|---|---|---|---|---|
| 1 | **Road pages on the web (SEO)** | a public page per notable road and per area ("Twisty roads near Asheville"): map shape, corner counts, climb, members' measured feel where 2+ members drove it, a flyover video, Open in ApexNav. Built from real data only; map-derived numbers say "from the map" | all of it: generate, publish, sitemap, internal links | nothing | $0 |
| 2 | **Road of the week** (short video) | a 20–30 s flyover of a real road (D-10 renders from the map and terrain: real geometry, nothing fabricated) with its corner count and a one-line why. Same clip to YouTube Shorts, Instagram Reels, TikTok, Bluesky, Threads, X, Facebook page | render, caption, schedule, post (where the API allows), weekly report | make the accounts, approve the first 4 weeks | $0 |
| 3 | **Communities** (Reddit, marque forums, Facebook groups, Discord) | honest developer posts: "I built a co-driver app, here is what it does, roast it". One post per community, never repeated, replies to every comment | drafts every post and reply, finds the threads where people ask "what app for twisty roads?" | **posts as yourself** (automated posting there is against the rules and gets banned) | $0 |
| 4 | **Car clubs** | email to club organisers: founding-crew beta (Pro for life for founding members), a ready-made convoy route for their next drive | finds clubs and contacts, drafts personalised emails, sends them once you approve the template (Cloudflare Email Sending, needs the domain) | approve the template, take the calls that come back | $0 |
| 5 | **Launch moments** | Show HN (the technical story: phones as 100 Hz road probes), Product Hunt, r/CarPlay when CarPlay ships | drafts, timing, the reply plan | posts (they need a person's account) | $0 |
| 6 | **Press and creators** | car media (Jalopnik, The Drive, Road & Track, Hagerty, Car Throttle, Motor1), Apple press (9to5Mac, MacStories for CarPlay), small and mid YouTube car channels | press kit page, pitch emails, promo codes, follow-ups | approve; appear on camera if anyone asks | $0 (promo codes) |
| 7 | **App Store optimisation** | keywords, subtitle, screenshots, Product Page Optimisation A/B tests, in-app rating prompt after a good drive (never during one, Apple caps it at 3 a year) | all of it through the App Store Connect API, version by version | approve listing changes | $0 |
| 8 | **Built-in loops** | drive cards and videos carry the ApexNav mark (MONETIZATION §2), crew invites earn Octane (O-07), shared routes open the app | already shipped; Claude tunes | nothing | $0 |
| 9 | **Apple Search Ads** (optional) | only after launch, only if the product page converts above 30%, capped | sets up and watches | decide a monthly cap (suggest $0 until data, then $50–100) | owner's call |

## 4. The launch region

Crowd data makes the app better where people drive, so launch is concentrated before it is spread. Suggestion:
**the Southern Appalachians** (Tail of the Dragon US-129, the Cherohala Skyway, the Blue Ridge Parkway, the
Moonshiner 28): the densest cluster of famous driving roads in the US, a calendar of club drives, and the region the
router suggestion already covers. The goal before launch: 25 founding drivers there, every famous road measured by
2+ members, so the first road pages and videos show real measured feel, not just map shape. Owner to confirm or
pick another region (OWNER_TODO).

## 5. Timeline

| phase | when | what | done when |
|---|---|---|---|
| 0. Set-up | now → App Store submission | accounts (section 7), domain, landing page and press kit, road pages for the launch region, the first 6 videos rendered | accounts exist, `/roads/` live, 6 videos ready |
| 1. Founding beta | 4–6 weeks before launch | TestFlight public link; recruit 100 founding drivers from 5 clubs and 5 communities; weekly road of the week starts; feedback in-app (L-05) | 100 testers, 25 in the launch region, the famous roads measured |
| 2. Launch week | App Store approval + up to 7 days (pick a Tuesday) | launch price, Show HN, Product Hunt, Reddit posts (one community a day, not all at once), press pitches out 7 days before with embargo, founding crews drive the same weekend | launch posts out, every comment answered within the day |
| 3. Steady | after | weekly video, monthly "what's new", 5 club emails a week, new road pages as data arrives, ASO test each month, a weekly report | the report says what worked; move effort to it |

## 6. How it runs without the owner

```
Monday (scheduled task)  ──>  pick the road of the week from real data (coverage + map scores, launch region first)
                              render the flyover (headless browser, web/flyover_video.js), write captions per channel
                              draft the week's community replies and club emails
                              open a PR "marketing: week N" with everything in docs/marketing/queue/
Owner (first 4 weeks)    ──>  thumbs-up the PR (or edit), Claude merges
After 4 approved weeks   ──>  channels the owner switches to "auto" post on schedule without the PR gate;
                              Reddit, forums and Product Hunt always stay "owner posts"
Every Monday             ──>  report: App Store Connect (impressions, page views, downloads, conversion, sales),
                              each channel's own stats, app health counts; what to do more of; posted in the PR
Kill switch              ──>  MARKETING_PAUSE=1 in the Worker (or "stop marketing" in any session) stops all posting
```

Each queued item is one markdown file with front matter (`channel`, `when`, `status: draft|approved|posted`, `link`).
Posting tools live in `tools/marketing/` and post only `approved` items. Attribution without tracking: App Store
campaign links (`?pt=…&ct=road-of-week-12`) count downloads per campaign in App Store Connect, no pixels, no SDK.

## 7. What the owner needs to set up (once)

Listed in docs/OWNER_TODO.md too. In order of value:

1. **A domain** (about $15/yr, e.g. apexnav.app or getapexnav.com): needed for email sending, a professional press
   kit, road pages people can link, and the social handles to point at. Add it to Cloudflare.
2. **A contact email** on that domain (Cloudflare Email Routing to your Gmail: free).
3. **Accounts, all named ApexNav** (same handle everywhere, check availability first): YouTube channel, Instagram
   (Professional, needed for posting by API), TikTok, Bluesky, Threads, Facebook page, X. For each, an API token
   or app as section 6 needs (Claude writes the steps per platform when you're ready).
4. **Your own Reddit account** in good standing, and a few forum accounts on the marques you know: those posts
   must come from a real person.
5. **A few sentences about you**: why you built it, what you drive. Press and Show HN need a real founder story;
   Claude will not invent one.
6. **The launch region** (section 4) and whether you can attend one club drive there during the beta.

## 8. Guardrails

- **Honest only.** No made-up reviews, testimonials, user counts, or "as seen in". No fabricated road data: every
  number in a post is from the app's real data or the map, labelled which. Unknown stays unknown.
- **Disclose.** Every community post says you are the developer. Creators who get promo codes are told to disclose
  it (FTC). No buying reviews, followers or upvotes; no sock puppets; no vote rings.
- **Safe driving.** Section 2's words and images; a test (`tests/test_marketing.py`, built with the posting tools)
  rejects queued copy with speeds, "race", "fastest", police evasion or phone-in-hand.
- **Privacy.** No tracking pixels, no third-party analytics on the site, no email to anyone who didn't publish a club
  contact address; every email has an unsubscribe line and a postal address (CAN-SPAM), and one follow-up at most.
- **Platform rules.** Automated posting only through official APIs on our own accounts; never on Reddit, forums,
  Product Hunt or Hacker News.
- **Truth in the store.** Copy only describes what is in the shipped build (guideline 2.3.1). CarPlay, Android and
  Pro appear only once they ship.
