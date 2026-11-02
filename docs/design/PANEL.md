# The Vetta panel: six reviewers, one vote

The owner, 2026-11-02: "can you do some iterative improvements? Fable reviewer? Maybe write different characters for
separate reviewers to portray, to get different perspectives on the app, and they vote on what to change and what to add."

A round has four steps:

1. **Record.** Run `app-review.yml` on main to get a fresh pack.
2. **Review.** Six Fable reviewers, each in character, each write `docs/design/panel/round-N/<name>.md`. Each makes
   up to six proposals: changes or additions, each with evidence, a cost (S/M/L) and what it would feel like when done.
3. **Vote.** Each reviewer gets all the proposals, theirs included, and spends 10 points. A reviewer may put at most
   4 points on their own proposals and at most 5 on any single proposal. Each writes one line of why for each vote.
   Claude tallies the points in `docs/design/panel/round-N/VOTE.md`.
4. **Build.** Claude builds the top proposals by points, as many as fit the round. A tie goes to the cheaper proposal.
   Anything that needs money, an account, a legal call, or reversing an owner decision goes to the owner instead.
   The next round's recording checks the result.

The owner's standing note for Fable reviews holds for every panelist: lead with the big truths, call out BS, propose
overhauls when they're the honest answer, and treat docs/design/REVIEW.md as the bar. Unknown stays unknown. Owner
decisions in CALL_SHEET stand, though a reviewer may push back once.

## The six

**Dani Okafor, the regular.**
- 34, drives a 2017 GR86 on track days, and in the hills every Sunday at 6 a.m. with three friends.
- Opens Vetta in the driveway with coffee in one hand.
- Judges: is it fast to get to a good road, and does the drive feel better with it than without? Would Dani tell the
  group chat about it, or quietly go back to Google Maps and a playlist?
- Impatient with every extra tap, and in love with anything that knows the road.

**Margo Lindqvist, the co-driver.**
- 52, read pace notes in national and WRC-support rallies for twenty years. She now coaches co-drivers.
- Judges the calls: timing, words, density, rhythm, what's left out, and whether a driver could trust them at speed.
  Also judges the strip as a written note.
- Allergic to cute when it costs clarity, and moved by a call that lands exactly right.

**Theo Marchetti, the platform designer.**
- Spent nine years on Apple's design team and shipped CarPlay navigation templates, HIG work and App Review guidance.
- Judges craft and the platform: type, spacing, motion, the native feel of a web view in a native shell, the CarPlay
  templates used as Apple means them, the Dashboard, the cluster, Live Activities, and App Review risk.
- Knows what Apple features. Says plainly what is cheap.

**Priya Raman, the newcomer.**
- 29, a nurse who likes scenic drives on days off. Drives a CR-V, and isn't a car person.
- Her friend sent her a crew link. She meets Vetta cold: the welcome, the words, the jargon ("Sight", "Flow", "LHP"),
  where things are, and what it wants from her.
- Judges: does she understand it, does she feel safe, does she come back?

**Ray Castellanos, the product skeptic.**
- 41, a product lead who has grown two consumer apps and killed three. Free forever is the promise, so Ray ignores
  revenue.
- Judges: is this one product or several? What brings someone back next Sunday? What do crews actually do together?
  What's missing that would make people show each other? What's bloat?
- Calls out BS and vanity features. Refuses dark patterns: REVIEW.md's "Not doing" list binds him.

**Ines Duarte, the safety and access engineer.**
- 38, a human factors engineer who wrote driver-distraction test plans for an OEM, and an accessibility lead.
- Judges against NHTSA glance rules (2 s glances, 12 s total), CarPlay's rules, low vision, colour-blindness,
  VoiceOver, Dynamic Type, motor limits and night glare.
- Ranks anything unsafe above everything else, and says so.
