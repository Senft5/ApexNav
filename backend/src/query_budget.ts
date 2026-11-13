// D1 queries per request (docs/BACKEND.md): Workers Free allows 50 per invocation, and an env.DB.batch counts as one.
// Going past it fails the request in production, but the local test D1 has no such limit, so a loop of single queries
// passes every test and breaks for real. Every request's DB is counted here: tests set QUERY_LIMIT so a request over it
// fails like production does, and in production a request that comes near is counted in error_counts (kind 'queries').
import { noteD1 } from "./usage";

export const QUERY_CAP = 50, QUERY_WARN = 40;

export class QueryLimitError extends Error {
  constructor(n: number) { super(`D1 query ${n} in one request (Workers Free allows ${QUERY_CAP}; batch them)`); this.name = "QueryLimitError"; }
}

const RAW = new WeakMap<object, D1PreparedStatement>();

/** A D1Database that counts each run/all/first/raw, batch and exec as one query in `count`, throwing past `limit` when set. */
export function countedDb(db: D1Database, count: { n: number }, limit?: number): D1Database {
  const tick = () => { count.n++; if (limit && count.n > limit) throw new QueryLimitError(count.n); };
  const wrap = (st: D1PreparedStatement): D1PreparedStatement => {
    const p = new Proxy(st, {
      get(t, k) {
        if (k === "bind") return (...a: unknown[]) => wrap(t.bind(...a));
        // every result's meta goes to the usage guard (src/usage.ts). first() is all() and its first row: D1 reads every row
        // for first() too (workerd d1-api), but only all() hands back the meta.
        // (tick() throws before any promise, as a D1 call over the limit does)
        if (k === "all" || k === "run") return (...a: unknown[]) => { tick(); return (t[k] as (...x: unknown[]) => Promise<D1Result>)(...a).then((r) => { noteD1(r?.meta); return r; }); };
        if (k === "first") return (col?: string) => {
          tick();
          return t.all<Record<string, unknown>>().then((r) => {
            noteD1(r?.meta);
            const row = r.results[0];
            if (!row) return null;
            if (col === undefined) return row;
            if (!(col in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${col})`);
            return row[col];
          });
        };
        if (k === "raw") return (...a: unknown[]) => { tick(); return (t[k] as (...x: unknown[]) => unknown)(...a); };
        const v = Reflect.get(t, k, t);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    RAW.set(p, st);
    return p;
  };
  return new Proxy(db, {
    get(t, k) {
      if (k === "prepare") return (sql: string) => wrap(t.prepare(sql));
      if (k === "batch") return (stmts: D1PreparedStatement[]) => {
        tick();
        return t.batch(stmts.map((s) => RAW.get(s) ?? s)).then((rs) => { for (const r of rs) noteD1(r?.meta); return rs; });
      };
      if (k === "exec") return (sql: string) => { tick(); return t.exec(sql); };
      const v = Reflect.get(t, k, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}
