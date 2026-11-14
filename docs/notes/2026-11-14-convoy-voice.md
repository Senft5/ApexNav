# STATE
## Session 2026-11-14 (convoy voice): an open voice channel for convoys (claude/project-thread-agclij)
- Done: Worker routes + Durable Object state for convoy voice over Cloudflare Realtime (backend/src/convoy_voice.ts,
  tests in backend/test/convoy_voice.test.ts); web client web/convoy_voice.js (tests/test_convoy_voice.py) with one Talk /
  Mute key on the convoy's line, ducking under the co-driver, who-is-talking; iOS shell: microphone permission string,
  WKWebView mic grant for the app's own page, play-and-record audio session while the channel is on. docs/CONVOY_VOICE.md.
- Waiting on the owner: the two Worker secrets REALTIME_APP_ID / REALTIME_APP_TOKEN (docs/OWNER_TODO.md).
- Next: verify on the next TestFlight build (mic prompt, speaker, Bluetooth car audio, CarPlay); then push-to-talk from
  CarPlay and headset buttons as a bonus.

# CALL SHEET
## 2026-11-14 (convoy voice): open channel by default, one key, no DB change (claude/project-thread-agclij)
Open channel with the phone's noise suppression instead of push-to-talk, because most cars have no steering-wheel button
and many drivers don't use CarPlay. The co-driver ducks the voices to 22%. Who is on the channel lives in the convoy's
Durable Object memory only (no migration). Undo: remove the Talk key in convoy_ui.js (voiceOffered) or the secrets.
