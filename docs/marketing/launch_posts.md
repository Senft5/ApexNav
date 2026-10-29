# Launch posts (drafts)

All of these are posted by the owner from their own accounts (MARKETING.md section 3). One community per day in
launch week, never the same text twice, and the owner answers every comment that day (Claude drafts replies).

## Show HN

**Title:** Show HN: Vetta, phones as 100 Hz road probes for a pace-note co-driver

**Text:**

I like driving back roads, and every app I tried either knew only the map's line or wanted a subscription. So I
built Vetta: an iPhone co-driver that calls corners before you reach them, rally-style, and learns how roads
actually feel from the phones of the people driving them.

The technical part I'd love feedback on:

- The phone's motion sensors run at 100 Hz. Gravity alignment and a yaw estimate rotate them into the car's axes
  (ISO 8855) whatever the mount, and a GPS cross-check only trusts the result once the phone's lateral g agrees with
  the GPS turn rate.
- Roads are split into 5 m sections. Each pass contributes banking, crest unweighting and roughness (a high-pass
  vertical RMS). A section is published only after two or more members drove it, and the first and last km of every
  trip never leave the phone.
- Pace notes are generated from map curvature plus measured feel, spoken on the device, and timed to your speed.
- The math lives in a Python core with JavaScript and Swift ports checked against it in CI.

No ads, no tracking, no subscription. {Pro sentence once it ships.} {App Store link}

{one line about you: OWNER}

## Product Hunt

**Name:** Vetta
**Tagline (60):** A co-driver that reads the road ahead out loud
**Description (260):** Vetta calls every corner before you reach it, finds the twisty roads near you, and scores
how smoothly you drove them, never how fast. Members' phones measure how roads feel, so the good ones rise. No
subscription, no ads, no tracking.
**First comment:** the Show HN text, shortened to its first paragraph and the list of what it does.
**Gallery:** the six press kit images, then the road of the week flyover.

## Reddit

Rules for every post: read the subreddit's self-promotion rule first (some allow it only in a weekly thread);
say in the first line that you made it; ask a real question; no link in the title; never post the same text twice.

### r/Miata (and r/GR86, r/Porsche, r/GolfGTI, r/Mustang: change the first line and the road)

**Title:** I made a co-driver app for back roads, and I'd like Miata people to tell me what's wrong with it

I'm the developer, so take this with salt. Vetta sits on your dash and reads the road ahead out loud like a
rally co-driver ("left 3, crest, right 4 tightens"), timed to your speed. It'll build a loop of the length you ask
for from the twistiest roads nearby, and it gives every drive a score.

The part I think is new: with a switch on, your phone measures how the road actually feels (banking, crests,
bumps) and shares just those road numbers, so the roads that are twisty and also smooth float to the top.

It's free, with no ads and no subscription. {App Store link}

What would make you actually use something like this on a Sunday drive?

### r/roadtrip

**Title:** I built an app that finds the twisty way between two places (developer here, looking for feedback)

Give it a start and a destination and it plans the fun way instead of the fast way: the twistiest roads that still
get you there, with viewpoints, cafés and fuel along it and the weather on the way. It works with no signal once
you've saved the area. Free, no ads. {App Store link}. What do you look for when you pick a scenic route?

### Regional (r/Asheville, r/Knoxville, r/NorthCarolina: launch region, MARKETING.md section 4)

**Title:** Local dev here: I mapped how the roads around {area} actually feel and I'd love locals to check it

{2 sentences on what the area page shows, with the real numbers from the road page.} Link: {site}/roads/{area}.
Which road did I miss?

### r/CarPlay (only once CarPlay ships)

Held until Apple approves the CarPlay entitlement.

## Reply bank (for the questions that always come)

- **"Isn't this for speeding?"** No. There's no speed or time on any leaderboard, and the score rewards smooth
  inputs and braking before the corner. It's the same skill an HPDE instructor teaches.
- **"What do you do with my location?"** Drives stay on your phone. With road data on, only road measurements are
  sent, never your position, path, times or speeds, and not the first and last km of any trip. {privacy link}
- **"Android?"** Later. iPhone first because it's one person building it.
- **"How do you make money?"** {Free forever for driving, notes and crews; an optional Pro subscription (or lifetime) for coaching, track days and clean video, once Pro ships. No ads, and we never sell data about drivers.}
  No ads, no data sales, no subscription.
