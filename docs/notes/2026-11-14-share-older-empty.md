# STATE

## 2026-11-14 Stages: no empty "Share older drives" fold

- **Done:** signed out (or with no account), Log → Stages showed a "Share older drives" fold that opened to nothing,
  because its only content, the road-data panel, stays hidden until you are a member. The fold now shows only when the
  panel is shown. A member sees it as before.
  - New e2e flow "Stages: Share older drives shows only when it holds something…". It fails on main.
- **Active bugs:** none known.
- **Next:** keep walking the phone screens.

# CALL SHEET

## 2026-11-14 Hide the share fold by CSS, not by script

- **What:** signature.css `#shareOlder:not(:has(> #contribPanel:not([hidden]))) { display: none; }`.
- **Why:** two scripts set the fold's and the panel's `hidden` at different times (renderSegments and renderContribute);
  one rule that follows the panel can't be undone by whichever runs last.
- **Undo:** delete that rule.
