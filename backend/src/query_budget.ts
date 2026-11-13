// D1 queries per request (docs/BACKEND.md): Workers Free allows 50 per invocation, and an env.DB.batch counts as one.
// Going past it fails the request in production, but the local test D1 has no such limit, so a loop of single queries
// passes every test and breaks for real. Every request's DB is counted here: tests set QUERY_LIMIT so a request over it
// fails like production does, and in production a request that comes near is counted in error_counts (kind 'queries').
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
        if (k === "first" || k === "all" || k === "run" || k === "raw") return (...a: unknown[]) => { tick(); return (t[k] as (...x: unknown[]) => unknown)(...a); };
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
      if (k === "batch") return (stmts: D1PreparedStatement[]) => { tick(); return t.batch(stmts.map((s) => RAW.get(s) ?? s)); };
      if (k === "exec") return (sql: string) => { tick(); return t.exec(sql); };
      const v = Reflect.get(t, k, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}
