# STATE

## Session 2026-11-13 (siri drive to): "Drive somewhere with Vetta" and "Find a 1 hour loop in Vetta" (claude/project-thread-me97iw)
- The car's keyboard is locked while moving, so a destination needed the phone. Apple Maps and Waze take one by voice. Now Siri does: DriveToIntent asks "Where to?", and the words go to the page (go=to, q base64url), which types them into Where to? and presses Go (goSpoken: your own places by that name first, then the map's search). The preview is up on the phone and on CarPlay. FindLoopIntent takes the loop dial's five lengths (go=loop60). A failure says why on the car too (carAsked). Nothing over a drive.
- No microphone or speech permission: Siri does the listening.
- Next: check on Nate's phone that Siri offers the new phrases (App Shortcuts update on install); then the next in-car gap.

# CALL SHEET

## 2026-11-13 (siri drive to): voice destinations through Siri, not the app's own speech recogniser (claude/project-thread-me97iw)
- Why: no new permission prompts (which would land on the phone mid-drive), works with "Hey Siri" and the car's voice button, and reuses Where to?'s search as is. CPVoiceControlTemplate with SFSpeechRecognizer stays an option if Siri's String prompt proves clumsy in the car.
- Undo: drop DriveToIntent/FindLoopIntent from ApexShortcuts (ApexIntents.swift); the page's go=to/loop handling is then unused.
