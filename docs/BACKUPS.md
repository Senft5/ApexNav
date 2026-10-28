# APEX NAV — DATABASE BACKUPS AND RESTORE (IDEAS Y-09)

The production database is D1 `apexnav-db` (id `b0c559d5-…`). The preview database `apexnav-preview-db` holds no real data
and needs no backup. All of this is free on the Workers Free plan.

## 1. What protects the data

| Layer | What it is | How far back | Who acts |
|---|---|---|---|
| D1 Time Travel | Cloudflare keeps every change; any minute can be restored in place | 7 days on Free (30 on Workers Paid) | automatic, restore by hand |
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

From the repo root, signed in to wrangler (`npx wrangler login`):

```
npx wrangler d1 export apexnav-db --remote --output=apexnav-db-YYYY-MM-DD.sql
npx wrangler d1 execute apexnav-db --remote --file=tools/d1_rowcounts.sql
```

The export blocks other queries to the database while it runs (seconds at today's size), so run it when no one is driving.
Keep the `.sql` file and the row counts printed by the second command together. Keep the last three exports and delete older ones.

## 4. Restore

Something wrong in the last 7 days (bad migration, bad deploy that wrote junk, mistaken bulk delete):

```
npx wrangler d1 time-travel restore apexnav-db --timestamp=2026-10-28T01:00:00Z
```

Use `--bookmark=<bookmark>` instead of `--timestamp` when there is one from section 2. A restore replaces the whole database:
every write after that moment is lost, and the command prints a bookmark that undoes the restore. Check the result with
`tools/d1_rowcounts.sql` and by signing in on the live site.

Older than 7 days, or the database is gone: create a fresh database from the last export (section 5), then point
`database_id` in `wrangler.jsonc` at it and deploy.

## 5. Restore drill (every 3 months, about 10 minutes)

Proves an export can really be brought back, without touching the live database:

```
npx wrangler d1 create apexnav-restore-drill
npx wrangler d1 execute apexnav-restore-drill --remote --file=apexnav-db-YYYY-MM-DD.sql
npx wrangler d1 execute apexnav-restore-drill --remote --file=tools/d1_rowcounts.sql
npx wrangler d1 delete apexnav-restore-drill
```

The row counts must match the ones saved with the export. Then delete the drill database (the last command), because it is a
second copy of personal data. Note the date and the result in docs/STATE.md.

## 6. Keeping this current

- `tools/d1_rowcounts.sql` lists every table. `tests/test_backups.py` fails when a migration adds a table that is not in it.
- Durable Objects (convoy rooms) hold only live, short-lived state (2 h drives, nothing personal kept) and are not backed up.
- Workers Logs (crash reports, `client_error`) are not data to keep and are not backed up.

## 7. Log

| Date | What | Result |
|---|---|---|
| 2026-10-28 | `tools/d1_rowcounts.sql` run on the live database (read only) | works: 27 tables (26 + `d1_migrations`), 909 road bins, 3 users. No export or drill yet: needs the owner's wrangler login |
