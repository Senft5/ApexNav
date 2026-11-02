# Round 2: JA, Jamal Wright (19, '09 Civic Si, eight months licensed)

## First impressions

I'm 19 and I've had my license for eight months, so I'm not going to pretend I know the roads like Dani does. What hit me first is the car screen. The OPEN R plate, the 55 MPH sight eye and the 0.3 mi arrow on a big map, that's the thing I'd film (`guided-drive/car/066-report-sheet-landscape.png`; the file name says report sheet, the picture is the car guide card). That's already cool, so don't mess with it.

The phone is where it stops being cool. The map idle is a search bar that says "Where to?", a red Start, and a loop suggestion (`first-run/sheet-phone.png`, frame 009). Nothing tells me why I'd open it on a Friday. The Crews tab is a dashed ghost box called "Your crew" with "Next drive: Sunday morning" in grey, and the top line is "Find or start a crew" (`tabs/phone/024-crews.png`). If my friends aren't on it, it's an empty waiting room.

The drive-ended card is the best moment in the app. Big score, one sentence, and the one filled button is "Share card" (`tabs/phone/015-drive-ended.png`). Then, right after "Notes closed. Have a good one.", the phone says "Score seven hundred ninety-three" out loud (`tabs/transcript.txt`, 22:53:46). That's a scoreboard read out at the exact moment I pull over, and my group chat would roast me for it. Also, the pack has the Share card button but not the card it makes, so I can't tell if it's something I'd post.

From a parent's side, the Dynamic Island showing "250 FT" and the Report and End buttons look like a kid on his phone. Parents judge the screenshot, not the 290 frames, so the screenshot has to look like a driver who is not on his phone.

## Proposals

**JA-1. A share card I'd actually post.** (cost M)
- Why: "Share card" is the one filled button on the drive-ended card, and it's the only way a drive leaves the phone. A kid posts a route, not a settings page. The card in the pack is a text list with a number. The app doesn't yet make anything I'd put on a story.
- Build: a 9:16 export (1080 x 1920 PNG, through the share sheet) with the drive's own road drawn as a line with its corner ticks, the road name, miles and time. The Vetta Score only if the driver turns it on. No speed figures ever. The first and last kilometre are cut off, the same way home zones already work. Show the exact image on screen before the share sheet opens.
- Done looks like: I can post the image to Instagram without cropping, there's no top speed on it, and the start and end of my drive are not on it unless I say so.

**JA-2. Stop reading the score out loud.** (cost S)
- Why: "Score seven hundred ninety-three" is spoken at 3:50 of the drive, right after the call closes. It turns the end of a drive into a result. It's the same beat the not-doing list keeps out of the app. The number belongs on the card, where I choose to look at it.
- Build: the end-of-drive call is "Notes closed. Have a good one." and nothing else. The Score stays on the card and in the Log. Add a test that the end call contains no number.
- Done looks like: the end call has no number in it, the test passes, and the card still shows the Score.

**JA-3. A drive link my friends open without an account.** (cost M)
- Why: the Friends tab says "Bring a friend: they sign in with your link" (`tabs/sheet-phone.png`, frame 023). My group chat won't make an account to look at my drive. Right now the only thing I can send them is the app.
- Build: "Send replay" on a drive's card makes a read-only web link to the replay: route, corners and the card, with no sign-in. The first and last kilometre are cut. The link expires after seven days by default and can be revoked from Garage > Your data. This is a new public data surface, so Victor has to sign off on it, and it needs server work.
- Done looks like: a friend with no account taps the link in iMessage and watches the replay with the ends cut, and I can kill the link from my phone in two taps.

**JA-4. Tell family I'm on my way, one tap.** (cost S)
- Why: the first thing my parents ask is "where are you and when will you be home". The ETA share already exists (S-19), but it's buried in the drive's page, so nobody uses it.
- Build: on the drive card and the Live Activity, a "Tell family" key sends the existing ETA link with a plain sentence. It is sent only when I tap it. The link stops at arrival, and the card says so ("Ends when you arrive").
- Done looks like: one tap sends an ETA message, the card reads "Ends when you arrive", and nothing is shared unless I tap it.

## Did round 1 land?

- Yes: "Drive it again" is on the drive-ended card (`tabs/phone/015-drive-ended.png`). Your roads show on the idle map ("Mount Hope Road, not driven yet, 6.6 mi", `first-run/sheet-phone.png`, frames 008 to 009).
- Yes: End has Undo. Frame 014 shows "Drive ended" with Undo in the red key where End was (`tabs/phone/014-drive-ending.png`).
- Can't tell: the crew welcome. No pack frame shows a crew link opening.

## What I'd protect

1. The car screen: the OPEN R plate, the sight eye and the 55 MPH read. It's the thing people screenshot, so don't add chrome to it.
2. The voice lines and Kit's line, "Quick, dry, a little cheeky, never silly" (`tabs/sheet-phone.png`, frame 026-027). That's the personality, it isn't cringe, and it has no emoji.
