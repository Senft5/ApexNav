# STATE
## Session 2026-11-15 (road insights): plan for a sellable aggregate road-data product (claude/project-thread-26f4xi)
- Done: docs/ROAD_INSIGHTS.md (products, buyers, price ranges, US legal path, k-anonymity and differential privacy rules, consent and policy changes, minimum volume, next steps). Pointers from MONETIZATION.md §5 and ROAD_DATA.md §4; a lawyer-review row in OWNER_TODO.md. No sale or export feature built.
- Next: count distinct contributors per section per period without ids (monthly salted token or HyperLogLog in road_bins), so the k >= 10 floor can be checked.

# CALL SHEET
## 2026-11-15 (road insights): sold insights get their own opt-in switch, off by default
Nate wants as much anonymous data as possible; the internal "Help improve Vetta roads" switch stays on by default, but anything that feeds a sold product needs informed consent to survive FTC and state-law scrutiny, and Maryland bans selling sensitive data at all. Also set: k >= 10 distinct contributors per released cell (>= 20 when split by age or hour), through roads only, month granularity, no origin-destination product, no sales to police, insurers' individual pricing or brokers. Undo: edit docs/ROAD_INSIGHTS.md §3–§4 (nothing is built).
