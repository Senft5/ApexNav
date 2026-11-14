# STATE

## 2026-11-14 This road over time: how far you've come since your first drive here
- Done: a drive's This road over time panel now opens with one line, e.g. "Since your first drive here (Jul 1) · Score +120 · 1.4 s quicker over 8 corners", against the oldest earlier drive of the road that shares 3 corners with it. It is shown green when quicker. The panel's chart and table were already there (the drive job's road rows), so this adds only the headline (drive_view.js `roadProgress`). Tests: tests/test_new_bests.py, e2e "your best yet".
- Next: conditions-aware analysis (coordinator 2026-11-14). Tag each drive with the road surface (OHGO weather sensors: wet, near-freezing, surface temperature) so best passes and time gaps compare like with like, and the co-driver can say when grip is likely lower than on your best pass.
