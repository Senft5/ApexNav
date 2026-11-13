// Weekly database backup (docs/BACKUPS.md, IDEAS Y-12): the cron trigger dumps every table through the D1 binding as
// SQL, the same shape as `wrangler d1 export`, into the private BACKUPS KV namespace. No API token is involved.
// KV rather than R2 because R2 is not enabled on the account; a value holds up to 25 MiB and the dump is ~0.1 MB today.
import { Env } from "./util";

export const KEEP = 8;                         // weekly copies kept: two months
export const MAX_BYTES = 24 * 1024 * 1024;     // under KV's 25 MiB value limit
export const META_MAX = 1000;                   // under KV's 1024-byte metadata limit
const PAGE = 1000;

interface Column { name: string; pk: number }

/** SQL literal for one value as D1 hands it back: NULL, number, text, or blob (array of bytes or ArrayBuffer). */
export function literal(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`cannot dump ${v}`);
    return String(v);                          // shortest form that reads back as the same double
  }
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string") return `'${v.replaceAll("'", "''")}'`;
  const bytes = v instanceof ArrayBuffer ? new Uint8Array(v) : ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : Array.isArray(v) ? Uint8Array.from(v as number[]) : null;
  if (!bytes) throw new Error(`cannot dump a ${typeof v}`);
  return `X'${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()}'`;
}

const ident = (s: string) => `"${s.replaceAll('"', '""')}"`;

/** Every statement needed to rebuild an empty database: tables, rows, AUTOINCREMENT counters, then indexes.
 *  All rows are read in one db.batch, which D1 runs as a single transaction: the dump is a consistent snapshot even while
 *  drives are being uploaded. It also keeps the run inside Workers Free's 50 queries per invocation (a batch counts as one):
 *  one query for the schema, one batch for where each table's pages start, one batch for the rows. */
export async function dumpStatements(db: D1Database): Promise<{ statements: string[]; counts: Record<string, number> }> {
  const objects = (await db.prepare(
    "SELECT m.type, m.name, m.sql, (SELECT json_group_array(json_object('name', p.name, 'pk', p.pk)) FROM pragma_table_info(m.name) p) AS cols " +
    "FROM sqlite_master m WHERE m.sql IS NOT NULL AND m.name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND m.name NOT LIKE '\\_cf\\_%' ESCAPE '\\' " +
    "ORDER BY CASE m.type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, m.name",
  ).all<{ type: string; name: string; sql: string; cols: string }>()).results;
  const tables = objects.filter((o) => o.type === "table").map((o) => {
    const cols = JSON.parse(o.cols) as Column[];
    const pk = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => ident(c.name));
    // Pages are key ranges, never OFFSET: SQLite reads and throws away every skipped row, and D1 bills them, so OFFSET
    // paging read about N^2/2000 rows (a 100,000-row road_bins would have spent Workers Free's whole 5M-row day).
    const keys = pk.length ? pk : ["rowid"], tuple = keys.length > 1 ? `(${keys.join(", ")})` : keys[0];
    const marks = (from: number) => (keys.length > 1 ? `(${keys.map((_, i) => `?${from + i}`).join(", ")})` : `?${from}`);
    const base = `SELECT ${cols.map((c) => ident(c.name)).join(", ")} FROM ${ident(o.name)}`;
    return { ...o, keys, tuple, marks, base, order: ` ORDER BY ${keys.join(", ")}` };
  });
  const hasSeq = !!(await db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'sqlite_sequence'").first());
  // First the key that starts each page of PAGE rows (one pass over each table's key, in key order), then one batch reads
  // every page by key range. That batch is the snapshot: rows that arrive in between land in a range (the last one is
  // open-ended), so nothing is missed and nothing is read twice.
  const starts = tables.length ? await db.batch(tables.map((t) => db.prepare(
    `SELECT ${t.keys.map((_, i) => `k${i}`).join(", ")} FROM (SELECT ${t.keys.map((k, i) => `${k} AS k${i}`).join(", ")}, row_number() OVER (ORDER BY ${t.keys.join(", ")}) AS rn FROM ${ident(t.name)}) WHERE rn % ${PAGE} = 1 AND rn > 1 ORDER BY rn`,
  ))) : [];
  const plan = tables.flatMap((t, i) => {
    const b = (starts[i].results as Record<string, unknown>[]).map((r) => t.keys.map((_, j) => r[`k${j}`]));
    const n = t.keys.length;
    return Array.from({ length: b.length + 1 }, (_, p) => {
      const lo = p > 0 ? `${t.tuple} >= ${t.marks(1)}` : null, hi = p < b.length ? `${t.tuple} < ${t.marks(lo ? n + 1 : 1)}` : null;
      const where = [lo, hi].filter(Boolean).join(" AND ");
      const args = [...(p > 0 ? b[p - 1] : []), ...(p < b.length ? b[p] : [])];
      return { t: i, stmt: db.prepare(t.base + (where ? ` WHERE ${where}` : "") + t.order).bind(...args) };
    });
  });
  const seq = hasSeq ? [db.prepare("SELECT name, seq FROM sqlite_sequence ORDER BY name")] : [];
  const pages = plan.length + seq.length ? await db.batch([...plan.map((p) => p.stmt), ...seq]) : [];
  // Every table exists before any row goes in: a row's foreign key names its parent table even while checks are deferred.
  const statements = ["PRAGMA defer_foreign_keys=TRUE;", ...tables.map((t) => t.sql + ";")];
  const counts: Record<string, number> = Object.fromEntries(tables.map((t) => [t.name, 0]));
  for (const [j, p] of plan.entries()) {
    const t = tables[p.t], rows = rowsOf(pages[j]);
    for (const r of rows) statements.push(`INSERT INTO ${ident(t.name)} VALUES(${r.map(literal).join(",")});`);
    counts[t.name] += rows.length;
  }
  if (hasSeq) {
    for (const r of rowsOf(pages.at(-1))) statements.push(`DELETE FROM sqlite_sequence WHERE name = ${literal(r[0])};`, `INSERT INTO sqlite_sequence (name, seq) VALUES(${r.map(literal).join(",")});`);
  }
  for (const o of objects.filter((o) => o.type !== "table")) statements.push(o.sql + ";");
  return { statements, counts };
}

/** Rows of a query result as arrays, in the select's column order. */
function rowsOf(r: D1Result | undefined): unknown[][] {
  return (r?.results ?? []).map((row) => Object.values(row as Record<string, unknown>));
}

/** Write this week's dump to KV and drop copies beyond KEEP. Returns the key written. */
export async function backupDatabase(env: Env, now = new Date()): Promise<string | null> {
  if (!env.BACKUPS) return null;
  const { statements, counts } = await dumpStatements(env.DB);
  const sql = statements.join("\n") + "\n";
  const bytes = new TextEncoder().encode(sql).byteLength;
  const day = now.toISOString().slice(0, 10);
  if (bytes > MAX_BYTES) {
    console.error(JSON.stringify({ event: "backup_failed", reason: "too_big", bytes }));
    return null;
  }
  const key = `d1/apexnav-db/${day}.sql`;
  // KV metadata holds at most 1024 bytes: the counts of every table outgrew it (migration 0045 added three, and the put failed),
  // so only tables with rows are listed, and past META_MAX only the totals (the dump itself is whole either way).
  const rows = Object.values(counts).reduce((a, b) => a + b, 0), tables = Object.keys(counts).length;
  let metadata: Record<string, unknown> = { bytes, counts: Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0)), tables, rows, at: now.toISOString() };
  if (JSON.stringify(metadata).length > META_MAX) metadata = { bytes, counts: {}, tables, rows, at: now.toISOString() };
  await env.BACKUPS.put(key, sql, { metadata });
  const kept = (await env.BACKUPS.list({ prefix: "d1/apexnav-db/" })).keys.map((k) => k.name).sort().reverse();
  // A run killed for CPU time writes no log line, so the next run reports the hole it finds.
  const prev = kept.find((k) => k < key);
  if (prev && now.getTime() - Date.parse(prev.slice(-14, -4)) > 8 * 86400_000) console.error(JSON.stringify({ event: "backup_gap", since: prev }));
  const old = kept.slice(KEEP);
  await Promise.all(old.map((k) => env.BACKUPS!.delete(k)));
  console.log(JSON.stringify({ event: "backup", key, bytes, tables: Object.keys(counts).length, rows: Object.values(counts).reduce((a, b) => a + b, 0), dropped: old.length }));
  return key;
}
