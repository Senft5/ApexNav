# APEX NAV — DATABASE BACKUPS AND RESTORE (IDEAS Y-09)

The production database is D1 `apexnav-db` (id `b0c559d5-…`). The preview database `apexnav-preview-db` holds no real data
(all tables empty on 2026-10-28); a schema-only export of it is still taken alongside, because it is the copy that gets
migrations first. All of this is free on the Workers Free plan.

## 1. What protects the data

| Layer | What it is | How far back | Who acts |
|---|---|---|---|
| D1 Time Travel | Cloudflare keeps every change; any minute can be restored in place | 7 days on Free (30 on Workers Paid) | automatic, restore by hand |
| Weekly automatic copy | The Worker's cron (Mondays 07:00 UTC) dumps every table to the private `apexnav-backups` KV namespace (section 3a) | 8 weeks (last 8 copies) | automatic |
| Monthly export | `wrangler d1 export` writes the whole database as one `.sql` file | as long as the files are kept | owner, once a month and before risky work |
| Bookmark before a migration | The Time Travel bookmark noted just before a hand-applied migration | 7 days | whoever applies the migration |

The export has e-mail addresses and handles in it. Keep it on the owner's own disk (or an encrypted drive). Never put it in
the repo, an issue, a chat or a CI artifact.

## 2. Before applying a migration by hand

Migrations are applied by hand to both databases before the code that needs them merges (see docs/STATE.md). First:

```
npx wrangler d1 time-travel info apexnav-db
```

Write the bookmark it prints in the PR or STATE.md entry for the migration. If the migration goes wrong, restore to it (section 4).

## 3. Monthly export (about a minute)

From the repo root, signed in to wrangler (`npx wrangler login`), or without a login by setting an API token in the shell
(never in a file in the repo): `CLOUDFLARE_API_TOKEN` (a custom token with Account > D1 > Edit; export goes through the D1
export API, which needs Edit even though nothing changes) and `CLOUDFLARE_ACCOUNT_ID`. Wrangler picks both up on its own:

```
npx wrangler d1 export apexnav-db --remote --output=apexnav-db-YYYY-MM-DD.sql
npx wrangler d1 execute apexnav-db --remote --file=tools/d1_rowcounts.sql
```

Do the same for `apexnav-preview-db` (`--output=apexnav-preview-db-YYYY-MM-DD.sql`).

The export blocks other queries to the database while it runs (seconds at today's size), so run it when no one is driving.
Keep the `.sql` file and the row counts printed by the second command together. Keep the last three exports and delete older ones.

**Where they are kept.** On the owner's own disk. The first exports (2026-10-28) are in the project's private file area at
`backups/d1/` (with `2026-10-28-verify.txt`: checksums, row counts, how they were checked); copy them to your own disk.

**Without wrangler (what Claude can do).** Claude sessions reach Cloudflare through the Cloudflare connector, not a token. It
can run read-only `SELECT`s on both databases, so an export can be rebuilt from `sqlite_master` plus one `quote()`-formatted
`SELECT` per table, then checked by loading it into a local SQLite and comparing a per-table fingerprint (rows, total
characters of the quoted values, sum of the REAL columns) run identically on both sides. That is how the 2026-10-28 export
was taken. Two traps found doing it: `printf('%g', NULL)` prints `0.0` (use `quote()` or a `CASE typeof(x)` for nullable
REAL columns), and D1's `quote()` prints 15 significant digits where newer SQLite prints 17, so compare REAL values with `=`
on D1 rather than by their text.

**What the connector can and can't do** (checked 2026-10-28; there is no `CLOUDFLARE_API_TOKEN` in Claude's environment):

| Can | Can't |
|---|---|
| list D1 databases; run SQL on them (reads and writes) | `wrangler d1 export` / the export API, Time Travel info or restore, undelete |
| list/create/delete KV namespaces, R2 buckets, Hyperdrive configs | read or write R2 objects or KV values |
| list Workers, read a Worker's deployed code | Workers Logs (`client_error` crash reports), Workers analytics, D1 metrics, rate-limit events |

A second, full-API Cloudflare connector was added on 2026-10-28; sessions started before it was authorized don't see it.
If a session lists `cloudflare` tools beyond the ones above (Workers observability, GraphQL analytics), use those for logs
and analytics and update this table.

So Time Travel bookmarks before a migration (section 2), restores (section 4) and reading crash reports still need the
owner's wrangler login or dashboard, or an API token added to the environment with: Account > D1 > Edit, Account > Workers
Scripts > Read, Account > Account Analytics > Read, and Workers Observability (logs) > Read.

## 3a. Weekly automatic copy (IDEAS Y-12)

`backend/src/backup.ts`, run by the cron trigger in `wrangler.jsonc`, reads every table through the Worker's own D1
binding (no API token anywhere) and writes one `.sql` file to the KV namespace `apexnav-backups`
(id `3be0be04839649c0a5b474c8389e8e4b`) as `d1/apexnav-db/YYYY-MM-DD.sql`. Its metadata carries the byte size and the
row count of every table, and the Worker logs one `{"event":"backup",...}` line (or `backup_failed`). Copies beyond the
last 8 are deleted. The file has the same shape as `wrangler d1 export`: all `CREATE TABLE`s, then the rows, then the
indexes, so it restores with `wrangler d1 execute <db> --remote --file=<file>` (section 5). Only the production Worker
has the binding and the cron; preview builds have neither.

KV, not R2, because R2 isn't enabled on the account (it needs the owner to turn it on in the dashboard). One KV value
holds up to 25 MiB and the dump is about 0.1 MB today; the Worker refuses to write past 24 MiB and logs
`backup_failed` / `too_big`, which is the signal to move to R2. All rows are read in one `db.batch`, which D1 runs as one
transaction, so a copy is a consistent snapshot even while drives upload; a run uses 4 of Workers Free's 50 D1 queries (a
batch counts as one). The file restores into an empty database only (plain `CREATE TABLE`), and it carries the
AUTOINCREMENT counters so restored ids are never reused.
The other Free-plan ceiling is 10 ms of CPU per cron run: formatting about a thousand rows fits easily, but somewhere in the
tens of thousands of rows the run will stop with `exceededCpu` in the Worker's metrics and no `backup` log line. The next
run that succeeds logs `backup_gap` (no copy for more than 8 days before it), and a week without a new key under
`d1/apexnav-db/` means the same. Then either move to Workers Paid (30 s per cron run) or split the dump across several
runs. Integers above 2^53 would lose precision on the way through JavaScript; no column holds one (way ids are under 2^32).

To fetch a copy: dashboard > Storage & Databases > KV > `apexnav-backups`, or
`npx wrangler kv key get --namespace-id=3be0be04839649c0a5b474c8389e8e4b --remote "d1/apexnav-db/YYYY-MM-DD.sql" > copy.sql`.

**Deleted accounts.** `DELETE /api/me` erases a person from the live database at once, but they stay in these copies for
up to 8 weeks (and in Time Travel for 7 days) until the copies age out. A restore from a copy would bring them back:
after any restore, re-run deletions made since the copy's date. The privacy policy, when written, has to say this.

## 4. Restore

Something wrong in the last 7 days (bad migration, bad deploy that wrote junk, mistaken bulk delete):

```
npx wrangler d1 time-travel restore apexnav-db --timestamp=2026-10-28T01:00:00Z
```

Use `--bookmark=<bookmark>` instead of `--timestamp` when there is one from section 2. A restore replaces the whole database:
every write after that moment is lost, and the command prints a bookmark that undoes the restore. Check the result with
`tools/d1_rowcounts.sql` and by signing in on the live site.

Database deleted in the last 7 days: undelete it first (dashboard, or the D1 undelete API); it comes back with its Time Travel
history, then restore as above if needed. Older than 7 days, or gone for good: create a fresh database from the last export (section 5), then point
`database_id` in `wrangler.jsonc` at it and deploy.

## 5. Restore drill (every 3 months, about 10 minutes)

Proves an export can really be brought back, without touching the live database:

```
npx wrangler d1 create apexnav-restore-drill
npx wrangler d1 execute apexnav-restore-drill --remote --file=apexnav-db-YYYY-MM-DD.sql
npx wrangler d1 execute apexnav-restore-drill --remote --file=tools/d1_rowcounts.sql
npx wrangler d1 delete apexnav-restore-drill
```

When `d1 create` asks whether to add the database to your config, answer **No** (the drill database must never end up in
`wrangler.jsonc`). The row counts must match the ones saved with the export. Then delete the drill database (the last command), because it is a
second copy of personal data. Note the date and the result in docs/STATE.md.

Free-plan daily limits apply (100,000 rows written and 5 million read per day): the drill import writes every row and the
export reads every row. Fine at today's size; as the database grows, run the drill on a quiet day and, if the import stops
partway, check the database's metrics in the dashboard before blaming the export.

## 6. Keeping this current

- `tools/d1_rowcounts.sql` lists every table. `tests/test_backups.py` fails when a migration adds a table that is not in it.
- Durable Objects (convoy rooms) hold only live, short-lived state (2 h drives, nothing personal kept) and are not backed up.
- Workers Logs (crash reports, `client_error`) are not data to keep and are not backed up. `error_counts` (anonymous daily crash counts) is in the export like any table, but losing it costs nothing.

## 6a. What Claude can reach (Cloudflare connector, checked 2026-10-28)

There is no API token in Claude's environment. Its Cloudflare access is the claude.ai "Cloudflare Developer Platform" connector, which Cloudflare marks deprecated in favour of the full Cloudflare API connector (mcp.cloudflare.com).

| Can | Cannot |
|---|---|
| D1: list, read and write SQL on both databases (backups in section 3 are rebuilt from SELECTs) | D1 export, Time Travel, undelete |
| Workers: list scripts, read the deployed (bundled) code | Workers Logs, Observability queries, invocation errors, CPU/wall time, request analytics |
| KV, R2 buckets, Hyperdrive: create, list, delete | R2 objects, secrets, deployments, routes |
| Search Cloudflare's docs | Anything in the dashboard (Custom Dashboards, Monitors, Issues) |

So crash reports and server 500s are also counted in D1 `error_counts` (docs/BACKEND.md), which this connector can read. Latency and the real error rate still need the dashboard (Workers → apexnav → Metrics / Observability) until the full connector is signed in or a token with Workers Observability read is added.

## 7. Log

| Date | What | Result |
|---|---|---|
| 2026-10-28 | `tools/d1_rowcounts.sql` run on the live database (read only) | works: 27 tables (26 + `d1_migrations`), 909 road bins, 3 users. No export or drill yet: needs the owner's wrangler login |
| 2026-10-28 | First export of both databases, by Claude through the connector (section 3, "Without wrangler") | `apexnav-db`: 28 tables (also `bans`, from the not-yet-merged 0009 migration), 72 KB; loaded into a fresh local SQLite, integrity and foreign-key checks clean, fingerprint identical to live D1 on every table. `apexnav-preview-db`: 27 tables, all empty, schema only. `d1_migrations` is empty on prod (not 1 row as IDEAS Y-08 says) and missing on preview. Stored in the project files `backups/d1/`. Not yet: a restore into a real D1 database (drill, section 5) |
| 2026-10-28 | KV namespace `apexnav-backups` created for the weekly copy (R2 refused: not enabled on the account) | first run: the Monday after the Y-12 PR deploys |
| 2026-10-28 | `d1_migrations` backfilled on both databases (created on preview), 0001–0009, `applied_at` = the backfill time (03:03–03:04Z), after checking each migration's tables and columns exist on both | `wrangler d1 migrations list` now shows nothing pending. A future hand-applied migration must add its row: `INSERT INTO d1_migrations (name) VALUES ('00NN_name.sql')` |
| 2026-10-28 | Migration 0010 (`error_counts`, additive) applied by hand to `apexnav-preview-db`, then `apexnav-db`, with its `d1_migrations` row on both | ok; no Time Travel bookmark (the connector can't read one) |
