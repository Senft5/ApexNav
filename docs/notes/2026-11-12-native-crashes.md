# STATE
## Session 2026-11-12 (native crash reports): the shell's crashes and hangs reach the error counts (claude/project-thread-g9yher)
- Done: `ApexCrashReports.swift` subscribes to MetricKit; each crash or hang diagnostic (delivered by iOS on a later launch, at most 5 per launch) is posted to `/api/errors` as kind `crash` or `hang`, app `ios`, with the build and the crashed thread's frames (binary + offset, unsymbolicated). The Worker accepts the two new kinds; they show in Garage → Settings → Account → Service check and `/api/ops/errors` like any other.
- Before this only the page's JS errors were counted; a crash in the shell, CarPlay or the sensor pipeline was visible only in TestFlight's own crash list.
- Next: symbolicate the frames (the dSYM from build-ipa) when the first ones arrive.
