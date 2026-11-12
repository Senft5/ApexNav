# STATE

## 2026-11-12 the Log page's script is its own file (claude/project-thread-5sbga7)
- Done: analysis.html's 1,185-line inline script moved as is to web/analysis_page.js (byte-identical body, a two-line header comment added), loaded by `<script src="analysis_page.js">` where the inline tag stood. The page's CSP keeps one hash (the service worker line). sw.js picks the file up from the page's script tags. Tests that read the page's code now read both files.
- Tests: pytest (1807 passed); e2e flows matching "Log", "screen by screen", "your roads", "Dynamic Type", "drive's page", "tags", "stage" and the startup budget pass.
- Next: Log changes go in web/analysis_page.js; no csp.py run needed for them anymore.

# CALL SHEET

## 2026-11-12 move the Log's inline script out of analysis.html
- What: purely mechanical move, no behavior change; coordinated with the Driver analysis thread, which held its analysis.html PRs until this merged.
- Why: every PR touching the Log's script changed the CSP hash in analysis.html lines 5-9, so parallel Log PRs conflicted on every merge.
- Undo: paste web/analysis_page.js's body back into a `<script>` in analysis.html, delete the file, run `python tools/csp.py`, and point the tests back at analysis.html.
