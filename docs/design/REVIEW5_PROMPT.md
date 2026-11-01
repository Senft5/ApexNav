# Fable review 5: the full frontend review, with the design skills (the owner, 2026-11-01: "can we now use these skills for a full frontend fable review?")

Review 5 reuses the review 4 brief (docs/design/REVIEW4_PROMPT.md, stage 1): the same critic, the same standard, the
same ground rules and the owner's standing note. It is quoted there in full and is not repeated here. Below is what
changes.

## What's new this time

1. **A fresh recording**: recording 5, made on main at 2a9c15d (after the TestFlight-feedback build, PR #277), at
   `{PACK}`. Same layout as recording 4.
2. **The design skills in `.claude/skills/`.** Use them as instruments, not as a replacement for your own judgment.
   Read each `SKILL.md` and the references it points to, then apply its method to the recording and the code:
   - `impeccable`: run its **critique** and **audit** methods (reference/critique.md, reference/audit.md,
     reference/craft-floor.md, plus ios.md and the native-app references). If its launcher won't run, say so and read
     the references directly.
   - `intent` and its disciplines: **evaluate** (Nielsen heuristics, severity-ranked, plus the anti-pattern catalog;
     check the social features, Score, streaks and leaderboards for engagement dark patterns), **fortify** (the nine
     states of each screen: empty, loading, error, offline, first run), **include** (WCAG 2.2, VoiceOver, Dynamic Type,
     touch targets, reduced motion) and **articulate** (every word on screen and every call the co-driver says).
   - `carplay`, `app-store-review`, `swiftui-pro`, `activitykit` and `widgetkit`: for the car screen, App Review risk,
     and the native views (Live Activity, widgets, the shell).
3. **Scope: the whole frontend.** That's every phone screen and sheet, the car screen, the Live Activity, the themes,
   the empty, loading and error states, and the words. Back-end and sensor math are out of scope.

## What stays the bar

The standing note is the point of the whole review. Lead with the big, intangible truths: is the premise right, is the
app one thing or several, where is it fake, and what would the best version of Vetta be. Call out BS and propose
overhauls where they're the honest answer. The skills' checklists feed the findings table, and the table comes after
the big picture, never instead of it. docs/design/REVIEW.md is the bar.

## What to write

`docs/design/REVIEW5.md`, in the REVIEW4 shape, with these changes:
- Number findings from where REVIEW4_CHECK.md stopped.
- Add a column saying which lens found each finding: own eye, impeccable, evaluate, fortify, include, articulate,
  carplay or app-store-review.
- Add a short **"What the skills got wrong"** section: anything a skill's checklist flagged that is wrong for Vetta
  (a driving app with themes on purpose), so we know which rules to ignore next time.

Fable reviews only and changes no code; Claude builds afterwards.
