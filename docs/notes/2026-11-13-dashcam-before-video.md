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
- **Done:** the e2e flow "desk: on a big screen" failed about 2 runs in 3 on main locally. Its Settings sheet measured
  479.99994 px wide while sliding, against an exact `=== 480`. The check now rounds to the pixel.
- **Active bugs:** none known.
- **Next:** keep walking the phone screens.

# CALL SHEET

## 2026-11-13 Dashcam line-up controls wait for a video

- **What:** dashcam.js wraps the balance slider, the nudges, the offset line and Make the video in `.dc-lineup`. That
  block is hidden until `ready()`, hidden again by `openSrc()`, and hidden on a video error.
- **Why:** Nate's standing UX rule asks for clean, intuitive screens, so nothing should show before it can be used.
- **Undo:** append `balance, fine, offsetNote, exportBtn` straight to `box` again, and restore the old note text.
