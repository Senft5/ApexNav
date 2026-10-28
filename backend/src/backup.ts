// Weekly database backup (docs/BACKUPS.md, IDEAS Y-12): the cron trigger dumps every table through the D1 binding as
// SQL, the same shape as `wrangler d1 export`, into the private BACKUPS KV namespace. No API token is involved.
// KV rather than R2 because R2 is not enabled on the account; a value holds up to 25 MiB and the dump is ~0.1 MB today.
import { Env } from "./util";

export const KEEP = 8;                         // weekly copies kept: two months
export const MAX_BYTES = 24 * 1024 * 1024;     // under KV's 25 MiB value limit
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

/** Every statement needed to rebuild the database: tables, rows, then indexes. Row counts per table alongside.
 *  Workers Free allows 50 D1 queries per invocation and a batch counts as one, so the schema is one query, every table's
 *  first page one batch, and only tables longer than a page cost more. */
export async function dumpStatements(db: D1Database): Promise<{ statements: string[]; counts: Record<string, number> }> {
  const objects = (await db.prepare(
    "SELECT m.type, m.name, m.sql, (SELECT json_group_array(json_object('name', p.name, 'pk', p.pk)) FROM pragma_table_info(m.name) p) AS cols " +
    "FROM sqlite_master m WHERE m.sql IS NOT NULL AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%' " +
    "ORDER BY CASE m.type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, m.name",
  ).all<{ type: string; name: string; sql: string; cols: string }>()).results;
  const tables = objects.filter((o) => o.type === "table").map((o) => {
    const cols = JSON.parse(o.cols) as Column[];
    const keys = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => ident(c.name));
    const select = `SELECT ${cols.map((c) => ident(c.name)).join(", ")} FROM ${ident(o.name)} ORDER BY ${keys.length ? keys.join(", ") : "rowid"} LIMIT ${PAGE} OFFSET ?`;
    return { ...o, select };
  });
  const first = tables.length ? await db.batch(tables.map((t) => db.prepare(t.select).bind(0))) : [];
  // Every table exists before any row goes in: a row's foreign key names its parent table even while checks are deferred.
  const statements = ["PRAGMA defer_foreign_keys=TRUE;", ...tables.map((t) => t.sql.replace(/^CREATE TABLE /, "CREATE TABLE IF NOT EXISTS ") + ";")];
  const counts: Record<string, number> = {};
  for (const [i, t] of tables.entries()) {
    let rows = rowsOf(first[i]);
    counts[t.name] = 0;
    for (let offset = 0; ; ) {
      for (const r of rows) statements.push(`INSERT INTO ${ident(t.name)} VALUES(${r.map(literal).join(",")});`);
      counts[t.name] += rows.length;
      if (rows.length < PAGE) break;
      offset += PAGE;
      rows = (await db.prepare(t.select).bind(offset).raw()) as unknown[][];
    }
  }
  for (const o of objects.filter((o) => o.type !== "table")) statements.push(o.sql + ";");
  return { statements, counts };
}

/** Rows of a batch result as arrays, in the select's column order. */
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
  await env.BACKUPS.put(key, sql, { metadata: { bytes, counts, at: now.toISOString() } });
  const old = (await env.BACKUPS.list({ prefix: "d1/apexnav-db/" })).keys.map((k) => k.name).sort().reverse().slice(KEEP);
  await Promise.all(old.map((k) => env.BACKUPS!.delete(k)));
  console.log(JSON.stringify({ event: "backup", key, bytes, tables: Object.keys(counts).length, rows: Object.values(counts).reduce((a, b) => a + b, 0), dropped: old.length }));
  return key;
}
