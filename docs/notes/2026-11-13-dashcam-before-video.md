# STATE

## 2026-11-13 Dashcam overlay: a line and Pick a video until a video opens

- **Done:** before any video, a drive page's Dashcam overlay section showed a lot with nothing to act on. It had a
  three-line paragraph of steps, the Earlier/Later slider, the − 0.5 s and + 0.5 s nudges, "Video starts 0 s into the
  drive" and a disabled Make the video.
  - It now shows one line ("Your speed, g and calls on a video you filmed on this drive. It stays on this phone.") and
    the Pick a video key.
  - The line-up controls appear with the video. The line under the picture already says what to do ("Slide until the
    car is at this corner").
  - The e2e flow "dashcam overlay" checks the bare state. It fails on main.
- **Done:** main's e2e flow "side by side" failed its contrast floor. The drive page's card look in signature.css
  (`.log-page :is(… .dv-time button …)`) also caught the Clip this corner key inside a "Where to find time" row, so the
  dark key got the card's light face: 1.11:1. The rule now takes only the row's own button (`.dv-time li > button`).
- **Active bugs:** none known.
- **Next:** keep walking the phone screens.

# CALL SHEET

## 2026-11-13 Dashcam line-up controls wait for a video

- **What:** dashcam.js wraps the balance slider, the nudges, the offset line and Make the video in `.dc-lineup`. That
  block is hidden until `ready()`, hidden again by `openSrc()`, and hidden on a video error.
- **Why:** Nate's standing UX rule asks for clean, intuitive screens, so nothing should show before it can be used.
- **Undo:** append `balance, fine, offsetNote, exportBtn` straight to `box` again, and restore the old note text.
