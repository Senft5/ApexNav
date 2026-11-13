# STATE

## 2026-11-13: the map's road data reads a third as many rows
- GET /api/roads and /api/roads/cells (roads.ts binsChunk) checked the open-road / two-driver rule (shownSql) once per bin. On top of that, an ORDER BY sorted every row a second time. Measured in the local D1 with 50 ways x 400 bins: 69,699 rows read for 20,000 bins. Now the rule is checked once per way and direction, those pairs are joined to road_bins on its primary key, and the ORDER BY is gone (rows arrive in key order; the code checks this and sorts only if not). Same data: 20,223 rows read. D1 Free allows 5 million rows read a day, and the map asks for this on every pan.
- Test: several ways asked out of order, bins inserted out of order, every direction comes back in bin order (roads.test.ts).
- Next: nothing open here.
