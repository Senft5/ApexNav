declare module "*.sql?raw" { const sql: string; export default sql; }
// The phone's own UMD modules, loaded by the road-data tests (loop.test.ts, coverage.test.ts)
declare module "*/web/contributor.js";
declare module "*/web/fun_route.js";
declare module "*/web/sync.js";
