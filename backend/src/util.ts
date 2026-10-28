export interface Env {
  DB: D1Database;
  CONVOY: DurableObjectNamespace<import("./convoy").ConvoyRoom>;
  CONVOY_INDEX: DurableObjectNamespace<import("./convoy").ConvoyIndex>;
  ASSETS?: Fetcher;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  OWNER_EMAIL?: string;     // secret: the first sign-in with this address becomes the owner/first member
  PEPPER?: string;          // secret: server-side hmac key for dedupe hashes
  PUBLIC_ORIGIN?: string;
  WRITE_LIMIT?: RateLimit;  // wrangler.jsonc ratelimits: writes per session (or per IP when signed out)
  AUTH_LIMIT?: RateLimit;   // sign-in endpoints per IP
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256b64url(s: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))));
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** SQLite 'YYYY-MM-DD HH:MM:SS' (UTC), comparable as a string with datetime('now'). */
export function sqlTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers },
  });
}

export function getCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** __Host- cookies must be Secure, Path=/, no Domain. */
export function cookie(name: string, value: string, maxAgeS: number): string {
  return `${name}=${value}; Max-Age=${maxAgeS}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > 64 * 1024) throw new HttpError(413, "too_large");
  const raw = await req.text();   // content-length can be missing (chunked): check what actually arrived
  if (raw.length > 64 * 1024) throw new HttpError(413, "too_large");
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, "bad_json");
  }
}

export function str(v: unknown, field: string, min = 1, max = 200): string {
  if (typeof v !== "string" || v.length < min || v.length > max) throw new HttpError(400, `bad_${field}`);
  return v;
}

export function int(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new HttpError(400, `bad_${field}`);
  return v;
}

export function num(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new HttpError(400, `bad_${field}`);
  return v;
}

export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const pair = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);
