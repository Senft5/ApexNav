# STATE
## Session 2026-11-17 (practice-loop): the owner's Practice Loop player (claude/project-thread-wwggcj)
- Done: Garage → Settings → Practice Loop, owner only (`/api/me` moderator) and in the app only (web/practice_loop.js,
  lazy 'practice'). An endless player: 4/4 click (beat 1 accented) at a random standard tempo, a random mode, scale or
  arpeggio up and down in 8ths over it, a drone on the root, a callout before each block, 5 to 10 repeats. Settings: key
  lock, focus (all, modes, scales, arpeggios), tempo range, repeats range, drone, volume, sleep timer; kept by the shell.
- The sound is ApexKit `PracticeRenderer` (pure, sample counted) inside an AVAudioSourceNode (PracticeLoop.swift); the
  callouts are pre-rendered with AVSpeechSynthesizer.write while the block before plays. ApexKit PracticeLoopTests plays
  30 minutes of blocks and checks every click lands on its block's grid with no gap between blocks.
- Not verified yet: lock screen and background on a real phone (TestFlight), call interruptions, the voice's sound.
- Next: the owner's device check (thread "Add owner-only Practice Loop player"); fix what it finds.

# CALL SHEET
## 2026-11-17 (practice-loop): callouts are pre-rendered, never spoken live (claude/project-thread-wwggcj)
Speech spoken live with the screen locked is the part iOS drops, so each callout is rendered to samples ahead of its block
and mixed in by the renderer on the same sample clock. Live speech is only the fallback when rendering gives nothing in 4 s.
Undo: speak `pick.callout` with `live` at each block change in PracticeLoop.swift tick().

## 2026-11-17 (practice-loop): block shape and pool details (claude/project-thread-wwggcj)
A block is the callout over the drone (at least 1 s), one count-in bar of clicks at the new tempo, then the repeats. Each
repeat is padded to whole bars (the eighths after its last note rest), so every repeat starts on beat 1. Melodic minor is
the jazz form (same notes down as up). Tempos are standard markings, 60 to 120 by default (60 66 72 76 80 ... 120); the
range can widen to 40 to 208. When no next block is ready in time, the current one gets one more repeat (no gap).
Undo: PracticeTheory and PracticeRenderer in ApexKit/Sources/ApexKit/PracticeLoop.swift.

## 2026-11-17 (practice-loop): the session while it plays (claude/project-thread-wwggcj)
.playback, mode default, not mixed, so the lock screen shows it and its keys (other music pauses, as for any player). A
co-driver line hands the session back to it (ApexSensorShell.releaseVoice, practiceOn); convoy voice stops it, since the
call needs the microphone. Headphones unplugged pause it; a call pauses it and it resumes when iOS says it should.
Undo: holdForPractice / setPractice in ApexNavApp.swift.
