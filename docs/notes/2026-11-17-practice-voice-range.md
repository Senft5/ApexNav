# STATE
## Session 2026-11-17 (practice-voice-range): the Practice Loop's voice range test (claude/project-thread-wwggcj)
- Done: Practice Loop → Voice range → Test my range. The owner sings their lowest note, then their highest; the app
  listens on the microphone (asked for only then), finds each held note with YIN (ApexKit PracticeVoice.swift,
  PracticeRangeTracker), and from then until the app quits every block's root goes where root to octave fits inside it
  (PracticePicker.next(range:), PracticePick.base). Clear goes back to middle C's octave.
- Tested: ApexKit PracticeVoiceTests (made-up voices E2 to C6 with strong 2nd harmonics, a slide that doesn't count,
  every block inside a baritone range, a locked key), tests/test_practice_loop.py (the sheet's steps, the wiring).
- Not verified yet: a real voice through the phone's microphone and AirPods (TestFlight).
- Next: the owner's device check; tune `PracticeRangeTracker.holdS` (0.35 s) or the YIN threshold if it misses notes.

# CALL SHEET
## 2026-11-17 (practice-voice-range): the range lasts the session, a block's whole octave must fit (claude/project-thread-wwggcj)
Nate: "only include tones in that range for that session". The range lives in memory only (never saved, gone when the app
quits), and a range under an octave is refused with a message, since every block goes root to octave and back. A locked
key with no octave inside the range goes where it sticks out least. The drone stays two octaves under the root (one when
that would be under E1). The player pauses while the test listens and carries on after. The session is play-and-record
in measurement mode for those seconds only; convoy talk stops the test, and the test won't start during convoy talk.
Undo: drop `range:` from makeBlock's PracticePicker.next call in PracticeLoop.swift (the sheet's buttons then do nothing).
