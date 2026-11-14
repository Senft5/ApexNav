# Convoy voice

An open voice channel for the people in a live convoy (the owner, 2026-11-14: "could convoys have comms? like real time
voice chat?"), built so nobody needs a button, steering-wheel controls or CarPlay.

## How it feels
- **Hands-free by default.** Tap **Talk** on the convoy's line once; from then on everyone just talks. The phone's own
  voice processing (echo cancelling, noise suppression, automatic gain: the WebRTC defaults, asked for explicitly) keeps
  road and wind noise out. Opus with DTX sends almost nothing while nobody talks.
- **One key.** The same key reads Talk, then **Mute** (green: your mic is open) and **Unmute** (accent: muted). Leave voice
  is in the convoy sheet. Once you have talked in a convoy, the next convoy joins the channel by itself when it connects.
- **The co-driver wins.** While a pace note, hazard or direction plays, the voices drop to about a fifth (`DUCK`), and come
  back up when it ends (`speech.busy` in cockpit.js).
- **Who is talking** shows on the convoy's line ("@ana talking").
- **Any audio route.** Phone speaker, Bluetooth car audio (hands-free profile, the car's own mic), AirPods or a headset. On
  iOS the shell switches the audio session to play-and-record / voice chat while the channel is on (`setTalk`), and the
  co-driver's lines no longer switch it back to playback-only.

## How it works
- Cloudflare Realtime (SFU) carries the audio. Each phone has one session: it publishes its microphone as track `mic` and
  subscribes to the others' `mic` tracks on the same connection.
- The Worker makes every SFU call with the app token (`backend/src/convoy_voice.ts`); the phone never sees it.
  - `POST /api/convoy/:id/voice` {sdp offer, mid}: publish, returns the SFU's answer and who is already on.
  - `POST /api/convoy/:id/voice/pull` {keys}: subscribe to those members; returns the SFU's offer and mid -> member.
  - `PUT /api/convoy/:id/voice/answer` {sdp answer}: the phone's answer to that offer.
  - `DELETE /api/convoy/:id/voice`: off the channel.
- The convoy's Durable Object decides who may: a member, in a live convoy, with its socket open. It keeps member key ->
  SFU session in memory only and tells the convoy `{type: "voice", key, on, muted, joined?}`; session ids never go to
  phones. A member whose socket drops is taken off the channel (and rejoins with a new session when it reconnects);
  leaving, removal, a block or the convoy ending take them off too. Mute travels on the socket: `{type: "voice", muted}`.
- The web side (`web/convoy_voice.js`) serializes every change to its SFU session (Realtime's rule), plays each voice
  through Web Audio so it can be ducked (iOS ignores an `<audio>` element's volume), and caps the bitrate at 24 kb/s.

## Cost
Free up to 1,000 GB of SFU egress a month, then $0.05/GB. Each listener receives each talker at up to 24 kb/s (DTX: far
less in silence): a full 16-car convoy for an hour is about 3 GB at worst.

## Setup (owner)
Two Worker secrets, `REALTIME_APP_ID` and `REALTIME_APP_TOKEN` (docs/OWNER_TODO.md). Without them the convoy context
says `voiceReady: false` and no Talk key shows.

## Not built yet
- Push-to-talk from CarPlay or a headset button (bonuses, not needed: the channel is open).
- Android (the web side is plain WebRTC and ports as is).

## To verify on a phone
WKWebView's getUserMedia on the app's `apexnav://app` page (a custom scheme with a host; WebKit treats it as a secure
context since iOS 15), and audio routing with CarPlay / Bluetooth car audio on the next TestFlight build.
