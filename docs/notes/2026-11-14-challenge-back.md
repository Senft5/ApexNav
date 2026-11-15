# STATE

## 2026-11-14 Challenge back from a ghost result on the drive page
- Done: under "Dry Ridge vs @sam" on the drive page there is now one key. "Challenge @sam back" shows when they were quicker, and "Dare @sam to beat it" when you were. It sends a 7-day time duel on your stage (POST /api/duels, kind time), and the panel then says what happened ("Sent. @sam has 7 days on Dry Ridge once they say yes.", or that you already have a duel there). There is no key while an open duel with them on that stage exists (the ghost's `duel`). Pure `challengeKey` / `challengeSaid` in web/ghost_duel.js (tests/test_ghost_duel.py), e2e "a ghost duel on the drive page".
- Next: nothing open here. A duel the friend declines or ignores stays on People → Friends as before.

# CALL SHEET

## 2026-11-14 Challenge back is a 7-day time duel, one tap, no sheet
- What: the key sends at once, with no stage, length or kind to pick. Why: the stage is the one you just compared, a ghost is a time, and 7 days is the Challenge sheet's default; one tap beats a sheet with three choices already made. Undo: web/analysis_page.js renderGhost (`days: 7, kind: 'time'`), or open duels.js's Challenge sheet instead.
