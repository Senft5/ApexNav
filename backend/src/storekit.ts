// StoreKit 2 signed transactions (docs/MONETIZATION.md §6). The app posts the JWS that StoreKit gave it; the JWS header
// carries the certificate chain [leaf, intermediate, root]. We check that the root is Apple Root CA - G3 (pinned by its
// SHA-256), that each certificate is signed by the next, that the leaf and intermediate carry Apple's marker extensions
// and were valid when the transaction was signed, and that the leaf signed the JWS. The same checks as Apple's
// SignedDataVerifier, written out because the Workers runtime has WebCrypto but no X.509 parser.
import { HttpError, b64urlDecode } from "./util";

/** SHA-256 of Apple Root CA - G3 (https://www.apple.com/certificateauthority/AppleRootCA-G3.cer). */
export const APPLE_ROOT_G3_SHA256 = "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179";
const OID_LEAF = "1.2.840.113635.100.6.11.1";        // Mac App Store and iTunes receipt signing
const OID_INTERMEDIATE = "1.2.840.113635.100.6.2.1"; // Apple Worldwide Developer Relations
const OID_P256 = "1.2.840.10045.3.1.7", OID_P384 = "1.3.132.0.34";
const OID_ECDSA_SHA256 = "1.2.840.10045.4.3.2", OID_ECDSA_SHA384 = "1.2.840.10045.4.3.3";

interface Tlv { tag: number; start: number; body: number; end: number }

function tlv(b: Uint8Array, at: number): Tlv {
  if (at + 2 > b.length) throw new Error("der");
  const tag = b[at];
  let len = b[at + 1], body = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n < 1 || n > 4) throw new Error("der");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[body + i];
    body += n;
  }
  if (body + len > b.length) throw new Error("der");
  return { tag, start: at, body, end: body + len };
}
function children(b: Uint8Array, t: Tlv): Tlv[] {
  const out: Tlv[] = [];
  for (let at = t.body; at < t.end;) { const c = tlv(b, at); out.push(c); at = c.end; }
  return out;
}
function oid(b: Uint8Array, t: Tlv): string {
  const v = b.subarray(t.body, t.end), parts = [Math.floor(v[0] / 40), v[0] % 40];
  let n = 0;
  for (let i = 1; i < v.length; i++) { n = n * 128 + (v[i] & 0x7f); if (!(v[i] & 0x80)) { parts.push(n); n = 0; } }
  return parts.join(".");
}
function time(b: Uint8Array, t: Tlv): number {
  const s = new TextDecoder().decode(b.subarray(t.body, t.end));
  const m = t.tag === 0x17 ? /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)Z$/.exec(s) : /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)Z$/.exec(s);
  if (!m) throw new Error("der");
  let y = Number(m[1]);
  if (t.tag === 0x17) y += y < 50 ? 2000 : 1900;
  return Date.UTC(y, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}

export interface Cert { der: Uint8Array; tbs: Uint8Array; sigAlg: string; sig: Uint8Array; spki: Uint8Array; curve: string;
                        notBefore: number; notAfter: number; extensions: string[] }

export function parseCert(der: Uint8Array): Cert {
  const top = tlv(der, 0), [tbsT, algT, sigT] = children(der, top);
  const f = children(der, tbsT), i = f[0].tag === 0xa0 ? 1 : 0;   // [0] version is optional
  const validity = children(der, f[i + 3]), spkiT = f[i + 5];
  const spkiAlg = children(der, children(der, spkiT)[0]);
  const exts: string[] = [];
  const extWrap = f.find((x) => x.tag === 0xa3);
  if (extWrap) for (const e of children(der, children(der, extWrap)[0])) exts.push(oid(der, children(der, e)[0]));
  const bits = der.subarray(sigT.body + 1, sigT.end);              // BIT STRING: first byte is the unused-bit count
  return { der, tbs: der.subarray(tbsT.start, tbsT.end), sigAlg: oid(der, children(der, algT)[0]), sig: bits,
           spki: der.subarray(spkiT.start, spkiT.end), curve: spkiAlg[1] ? oid(der, spkiAlg[1]) : "",
           notBefore: time(der, validity[0]), notAfter: time(der, validity[1]), extensions: exts };
}

/** DER ECDSA-Sig-Value (SEQUENCE of two INTEGERs) to the fixed-width r||s WebCrypto wants. */
function rawSig(der: Uint8Array, size: number): Uint8Array {
  const [r, s] = children(der, tlv(der, 0)), out = new Uint8Array(size * 2);
  const put = (t: Tlv, off: number) => {
    let v = der.subarray(t.body, t.end);
    while (v.length > size && v[0] === 0) v = v.subarray(1);
    if (v.length > size) throw new Error("der");
    out.set(v, off + size - v.length);
  };
  put(r, 0); put(s, size);
  return out;
}

const curveOf = (c: Cert) => (c.curve === OID_P256 ? { namedCurve: "P-256", size: 32 } : c.curve === OID_P384 ? { namedCurve: "P-384", size: 48 } : null);

export async function signedBy(child: Cert, parent: Cert): Promise<boolean> {
  const curve = curveOf(parent), hash = child.sigAlg === OID_ECDSA_SHA256 ? "SHA-256" : child.sigAlg === OID_ECDSA_SHA384 ? "SHA-384" : null;
  if (!curve || !hash) return false;
  const key = await crypto.subtle.importKey("spki", parent.spki, { name: "ECDSA", namedCurve: curve.namedCurve }, false, ["verify"]);
  return crypto.subtle.verify({ name: "ECDSA", hash }, key, rawSig(child.sig, curve.size), child.tbs);
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface TransactionPayload {
  transactionId?: string; originalTransactionId?: string; bundleId?: string; productId?: string; purchaseDate?: number;
  signedDate?: number; revocationDate?: number; expiresDate?: number; environment?: string; type?: string; appAccountToken?: string;
}

/** The verified payload of a StoreKit 2 JWS transaction, or a 400. `rootSha256` is replaced only in tests. */
export async function verifyTransaction(jws: string, rootSha256 = APPLE_ROOT_G3_SHA256): Promise<TransactionPayload> {
  const bad = () => new HttpError(400, "bad_transaction");
  const parts = jws.split(".");
  if (parts.length !== 3) throw bad();
  let header: { alg?: string; x5c?: string[] }, payload: TransactionPayload, chain: Cert[];
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
    if (header.alg !== "ES256" || !Array.isArray(header.x5c) || header.x5c.length !== 3) throw bad();
    chain = header.x5c.map((c) => parseCert(fromB64(c)));
  } catch { throw bad(); }
  const [leaf, inter, root] = chain;
  if (hex(await crypto.subtle.digest("SHA-256", root.der)) !== rootSha256) throw bad();
  if (!leaf.extensions.includes(OID_LEAF) || !inter.extensions.includes(OID_INTERMEDIATE)) throw bad();
  const at = typeof payload.signedDate === "number" ? payload.signedDate : Date.now();
  if (chain.some((c) => at < c.notBefore || at > c.notAfter)) throw bad();
  try {
    if (!(await signedBy(leaf, inter)) || !(await signedBy(inter, root))) throw bad();
    if (leaf.curve !== OID_P256) throw bad();
    const key = await crypto.subtle.importKey("spki", leaf.spki, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, b64urlDecode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) throw bad();
  } catch { throw bad(); }
  return payload;
}
