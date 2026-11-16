# STATE

## Replay stutter on corner calls (replay stutter thread, 2026-11-16, claude/project-thread-87sevh)
- Done: Nate (TestFlight) saw the replay hitch briefly each time a corner call fired. The shell's AVAudioSession `setCategory` / `setActive(true)` (at voiceBegin) and `setActive(false)` (after the line) ran on the main thread for every call, and the clip files were opened and decoded there too; those calls block until the audio hardware is set up again, and the main thread is where the web view's frames reach the screen. They now run on one serial queue (`ApexAudioSession` in `ApexNavApp.swift`), in the order asked; the prompt style comes back to the main thread when known. Haptic generators are kept and prepared instead of made at each call. The web side showed no call-time spike in Chromium (desktop and 4x CPU).
- Not yet seen on a phone: needs the next TestFlight build. If a hitch remains, the next suspect is the theme pre-call sound through WebAudio (`ApexThemeSounds.play` in `pumpSpeech`), which resumes the page's AudioContext each call.

# CALL SHEET

## 2026-11-16 (replay stutter): audio session work moved off the main thread (claude/project-thread-87sevh)
- What: every AVAudioSession category/activation change and the voice clips' AVAudioPlayer loading run on a serial `app.vetta.audio-session` queue; the voice is held (`webVoiceActive`) from voiceBegin instead of from the prompt-style answer.
- Why: blocking audio calls on the main thread froze the web view's frames for a beat at the start and end of every call.
- Undo: revert the PR; `ApexAudioSession` is the only new type, and its four calls map one to one onto the old inline `try? AVAudioSession.sharedInstance()` lines.
