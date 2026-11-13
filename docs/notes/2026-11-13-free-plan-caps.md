# STATE

## 2026-11-13: daily free-plan caps answered honestly
- Since 2026-09-01, Cloudflare blocks every D1 query on the Workers Free plan once the account uses up its daily rows (100,000 written or 5 million read) until midnight UTC. Road-data upload writes at least 200 rows per km driven, so at most about 500 km of uploads a day would stop the whole app (sign-in included). docs/LAUNCH.md Costs now spells this out. Moving to Workers Paid is the owner's call.
- The API now answers that case with 503 `service_unavailable` and a Retry-After to midnight UTC, instead of a 500 it can't even count (index.ts handle).
- Photos: when KV refuses the bytes (Free allows 1,000 KV writes a day), the photo row is deleted and the upload answers 503 `photo_store_unavailable`. Before, the row stayed, showed as broken and counted against the caps.
- Next: nothing open here.
