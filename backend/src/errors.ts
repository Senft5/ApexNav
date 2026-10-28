// Client crash and error reports (docs/IDEAS.md Y-02, web/errors.js). Anonymous: no session is read, nothing is stored in
// the database. The report is validated, scrubbed again (the client may be old or hostile) and written as one structured
// log line, which Workers Logs keeps (wrangler.jsonc observability). Read: Cloudflare → Workers → apexnav → Logs, event client_error.
import { HttpError, body } from "./util";

/** Same rules as web/errors.js scrub(): URLs lose query and fragment, e-mails, precise numbers and token-like strings go. */
export function scrub(text: string, max: number): string {
  let s = text;
  s = s.replace(/\bdata:[^\s)'"]+/g, "data:[…]");
  s = s.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s)'"]+/gi, (u) => u.replace(/[?#].*?((?::\d+){1,2})?$/, "$1"));
  s = s.replace(/[\w.+-]+(?:@|%40)[\w-]+(\.[\w-]+)+/gi, "[email]");
  s = s.replace(/-?\d{1,3}\.\d{3,}/g, "[num]");
  s = s.replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g, "[token]");
  return s.length > max ? s.slice(0, max) : s;
}

const KINDS = new Set(["error", "rejection"]);
const APPS = new Set(["ios", "web"]);
const text = (v: unknown, field: string, max: number): string => {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string" || v.length > max * 2) throw new HttpError(400, `bad_${field}`);
  return scrub(v, max);
};

export async function clientError(req: Request): Promise<void> {
  const b = await body<Record<string, unknown>>(req);
  if (typeof b.kind !== "string" || !KINDS.has(b.kind)) throw new HttpError(400, "bad_kind");
  if (typeof b.app !== "string" || !APPS.has(b.app)) throw new HttpError(400, "bad_app");
  const report = { event: "client_error", kind: b.kind, app: b.app, message: text(b.message, "message", 300),
                   stack: text(b.stack, "stack", 2000), page: text(b.page, "page", 80) };
  if (!report.message) throw new HttpError(400, "bad_message");
  console.log(JSON.stringify(report));
}
