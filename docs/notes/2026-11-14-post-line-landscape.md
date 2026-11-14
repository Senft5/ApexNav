# STATE

## 2026-11-14 A post's line fits a phone on its side

- **Done:** with the phone in landscape (a dash mount), a drive post's line picture spanned the full width at 2:1, so it
  was taller than the screen, and the post's words, stages and Drive it were out of sight. The line is now at most 90vh
  wide (so at most half the screen tall) with its shape kept (web/drive_posts.js `.feed-line`). Portrait is unchanged.
  - The e2e flow "drive posts: Drive it…" checks it at 844×390. It fails on main (736×368 on a 390 px screen).
- **Active bugs:** none known.
- **Next:** keep walking the social screens in landscape.
