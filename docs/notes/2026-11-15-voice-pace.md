# STATE
## Session 2026-11-15 (voice pace): every pack at one pace, fewer phone-voice lines (claude/project-thread-mtq095)
- Nate's first real drive: the voice was rushed sometimes and sluggish other times, and some lines were in the phone voice.
- What was wrong: inside one pack, clip speaking rates varied by up to 1.6x. One word rendered alone came out quick, and the slow 12 % retakes stayed slow. Commas held 0.4 to 0.6 s of silence. The app also started each clip of a call only after the previous one finished, on the main thread, so joins dragged.
- Done:
  - `tools/voice_pace.py` caps pauses inside a clip at 0.24 s and stretches each clip to its pack's rate (phonemes a second). It keeps a stretched clip only if Whisper hears it as well as before. Each manifest entry gets a `"pace"`.
  - When Whisper rejects the full stretch, it tries a stretch to the band's edge, then half way there, then pauses capped only. A clip under 8 phonemes is stretched at most 0.88 to 1.18x and gets `"pace": null`, since a rate over so few sounds is rough.
  - Result: within 8 % of the pack's pace are 99 % of Hale's measured clips, 90 % of Kit's and 97 % of Marguerite's. About 10 slow Kit clips stay slow because Whisper only hears their numbers right at that pace.
  - `voicebank.py --rebuild-checked` paces new clips the same way. `tests/test_voice_pace.py` holds the packs to it.
  - `ApexClipPlayer` (ApexNavApp.swift) prepares every clip and schedules each start time up front with `play(atTime:)`.
- Phone-voice lines (found by `VOICE_LOG=1 node e2e/smoke.js`, which prints every line spoken without clips) now have clips:
  - ghost duel and stage gaps up to 9.9 s, "Stage done.", "Level.";
  - the no-stages lines, the crash check, the plan-a-route and none-ahead lines for cafés, fuel, chargers, viewpoints and waterfalls;
  - "T-junction".
- Ghost and stage lines in a pack voice leave out the friend's or stage's name, because a name has no clip. The full line still shows on screen.
- App health now counts `voice_pack` and `voice_phone` per spoken line (no DB change). Read them after the next TestFlight build to see how often the phone voice still speaks.
- Each drive record now keeps `said`, a log of what the co-driver said. Each entry has `t` (seconds), `m` (metres along the drive), `line`, `eng` (pack, phone, a prompt style, or null if the line was cut off) and `ahead` (metres to the note when its call began). It stays on the phone; the anonymous upload's columns (anon_drives.js COLS) leave it out, and dev-account uploads carry it. Drives recovered after a reload have no `said`.
- The replay strip showing bumps about a mile ahead does not affect the voice: notes are only called within `ApexNoteTiming.leadM` (cockpit.js, the note loop). That strip issue belongs to the UI thread.
- Still on the phone voice by design: lines that name a place (for example "Next fuel: Shell, in 1.9 mi").
- Next: read voice_pack and voice_phone from Nate's next drives. If voice_phone stays high, run the e2e VOICE_LOG pass again to find the lines.

# CALL SHEET
## 2026-11-15 (voice pace): one target pace for each voice, not one for all three (claude/project-thread-mtq095)
Marguerite 12.5, Kit 10.5 and Hale 11.5 phonemes a second. Each target is near that voice's own natural pace (bm_fable is slow at any speed), and the three are within 1.25x of one another. One shared target would have stretched some voices past where Whisper still heard them right. To undo, change `TARGETS` in tools/voice_pace.py and run `voice_pace.py --all --force`.

## 2026-11-15 (voice pace): atempo, not rubberband, for the stretch (claude/project-thread-mtq095)
After a rubberband stretch, Whisper misheard "Limit ten ahead" and "Long into". After ffmpeg atempo, it heard every word. Any stretched clip that Whisper scores lower is kept as it was. To undo, change `stretch()` in tools/voice_pace.py.

## 2026-11-15 (voice pace): pack voice leaves out ghost and stage names (claude/project-thread-mtq095)
"4.0 seconds up on Sam" has no clip for "Sam", so the whole line fell back to the robot voice. The pack now says "4.0 seconds up." and the screen still shows the name. With the phone voice selected, the full line with the name is spoken. To undo, remove the `bare` text in cockpit.js `sayQuietLine` calls.
