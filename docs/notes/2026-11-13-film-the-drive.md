# STATE

## 2026-11-13 Film the drive: the app films the road and the drive's page lines the video up by itself (big bet 5, step 2b)
- Done: Settings → Film the drive (off by default, in the app only; the row hides on the web). While a drive runs with it on, the back camera films the road at 720p HEVC with no sound (new DriveCam.swift). Each stretch of filming is one file, Documents/DriveCam/<first frame's Unix ms>.mov. iOS stops the camera off screen, and filming carries on in a new file when the app is back. The app serves `drivecam/index.json` and the files, with byte ranges, on its own scheme (ApexBundleSchemeHandler). On the drive's page the Dashcam panel offers "This drive's video · 12 min" (or Video 1, 2…). One tap opens it already lined up from the file's start and the drive's `t0` (#679), and Corner clips work straight away. Corner clips now also cut a corner whose lead runs before the video's first frame, shortening the lead. Tests: test_dashcam (ownVideos), test_corner_clip; e2e "film the drive".
- Not verified on a phone yet: the capture itself (CI compiles it; the next TestFlight build is the first real run). Check that filming starts at a drive's start, that a file survives the phone locking, and that the video plays in the drive's page.
- Next (step 3): one tap from a great corner on the drive page (the end card's best corner, a corner card) to its clip, and the post side with the social thread.

# CALL SHEET

## 2026-11-13 Drive videos: 720p HEVC, no sound, kept on the phone up to about 6 GB
- What: DriveCam.swift films 1280×720 HEVC with standard stabilisation, records no audio, and deletes the oldest files once the folder passes 6 GB (about two hours). The files are in the app's Files folder (UIFileSharingEnabled), so a driver can copy the raw video off. Why: a phone in a mount for an hour at 1080p would take 8+ GB; no microphone permission means no in-car conversation is ever recorded; Files gives the driver their own data. Undo: `capBytes` and `sessionPreset` in DriveCam.swift; an audio input needs NSMicrophoneUsageDescription and an APP_REVIEW.md update.

## 2026-11-13 A video's start is the moment its first frame was recorded
- What: a file is named for the Unix ms at AVCaptureFileOutput's didStartRecording, and offsetS = (start_ms - d.t0) / 1000. The offset slider now steps 0.1 s, so that start isn't rounded to half a second. Why: it is the same clock as the drive's frames (`at`), with no hand lining up; the ±0.5 s keys stay for a fine nudge. Undo: dashcam.js `step` and `setOffset` rounding.
