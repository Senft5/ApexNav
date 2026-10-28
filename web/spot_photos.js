// Photos on your saved spots (IDEAS S-18). A photo is re-drawn through a canvas before it is kept, so nothing from the
// camera file survives: no EXIF (GPS position, time, phone model), only pixels, at most 1600 px on the long side. Kept on
// this phone only (IndexedDB 'apexnav-photos'); shared spots never carry a photo. Pure parts (fit, exifSegments) are tested
// in tests/test_spot_photos.py; the canvas and storage part in the e2e flow.
(function (root) {
  'use strict';
  const MAX_PX = 1600, QUALITY = 0.85, DB = 'apexnav-photos', STORE = 'photos';
  /** Target size for an image of w x h: the long side at most max, never enlarged. */
  function fit(w, h, max = MAX_PX) {
    if (!(w > 0 && h > 0)) return null;
    const k = Math.min(1, max / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }
  /** The metadata segments a JPEG carries: APP1 'Exif' / 'XMP' (where a camera writes GPS). [] for anything else. */
  function exifSegments(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), out = [];
    if (b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return out;
    let i = 2;
    while (i + 4 <= b.length && b[i] === 0xFF) {
      const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
      if (m === 0xDA || m === 0xD9) break;                              // start of scan: no more headers
      if (m === 0xE1) {
        const tag = String.fromCharCode(...b.subarray(i + 4, Math.min(b.length, i + 8)));
        out.push(tag.startsWith('Exif') ? 'exif' : tag.startsWith('http') ? 'xmp' : 'app1');
      }
      i += 2 + len;
    }
    return out;
  }
  /** A clean JPEG Blob from a picked image File: decoded, scaled, re-encoded. Rejects when it isn't an image. */
  async function prepare(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const size = fit(bmp.width, bmp.height);
    if (!size) throw new Error('not an image');
    const c = document.createElement('canvas'); c.width = size.w; c.height = size.h;
    c.getContext('2d').drawImage(bmp, 0, 0, size.w, size.h);
    if (bmp.close) bmp.close();
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', QUALITY));
    if (!blob) throw new Error('could not encode');
    return blob;
  }
  let dbp = null;
  function idb() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => { dbp = null; rej(r.error); };
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const q = fn(t.objectStore(STORE)); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); });
  }
  const put = (id, blob) => tx('readwrite', (s) => s.put(blob, id));
  const get = async (id) => { try { return (await tx('readonly', (s) => s.get(id))) || null; } catch (_) { return null; } };
  const remove = async (id) => { try { await tx('readwrite', (s) => s.delete(id)); } catch (_) {} };
  const count = async () => { try { return await tx('readonly', (s) => s.count()); } catch (_) { return 0; } };
  const clear = async () => { try { await tx('readwrite', (s) => s.clear()); } catch (_) {} };
  const api = { fit, exifSegments, prepare, put, get, remove, count, clear, MAX_PX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexSpotPhotos = api;
})(typeof window !== 'undefined' ? window : globalThis);
