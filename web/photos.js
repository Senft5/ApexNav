// Photos on the phone (docs/design/REVIEW.md 5.2; backend/src/photos.ts): a picked photo is redrawn at most 1600 px on its
// long side and re-encoded as JPEG before it leaves the phone, which drops its EXIF (where it was taken) along with
// everything else; the server strips again. Photos are fetched through the API (members only, the app's bridge in the
// shell) into object URLs, cached for the page. A missing photo is an initial in a bezelled circle, never a broken image.
(function (root) {
  'use strict';
  const MAX_SIDE = 1600, MAX_BYTES = 650000;

  /** The size to draw at: the long side at most `max`, never upscaled; whole pixels. */
  function fitSize(w, h, max = MAX_SIDE) {
    if (!(w > 0) || !(h > 0)) return null;
    const k = Math.min(1, max / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }
  /** The letter shown when there is no photo: the handle's first letter or digit, upper case; '?' when there is none. */
  function initial(handle) {
    const m = /[\p{L}\p{N}]/u.exec(String(handle || ''));
    return m ? m[0].toUpperCase() : '?';
  }

  /** A File or Blob from the picker, as a JPEG Blob ready to send (EXIF gone), or null when it can't be read. */
  async function prepare(file) {
    if (!file || !root.createImageBitmap || !root.document) return null;
    let bmp;
    try { bmp = await root.createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (_) { return null; }
    const s = fitSize(bmp.width, bmp.height);
    if (!s) return null;
    const c = root.document.createElement('canvas'); c.width = s.w; c.height = s.h;
    c.getContext('2d').drawImage(bmp, 0, 0, s.w, s.h);
    if (bmp.close) bmp.close();
    for (const q of [0.85, 0.75, 0.65, 0.55]) {
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', q));
      if (blob && blob.size <= MAX_BYTES) return blob;
    }
    return null;
  }

  const api = () => root.ApexSync;
  /** Sends a prepared photo: kind profile | car | crew | crest | post; ref the thing it belongs to; cover for a car. */
  async function upload(kind, ref, blob, { cover = false } = {}) {
    const q = new URLSearchParams({ kind }); if (ref) q.set('ref', ref); if (cover) q.set('cover', '1');
    const r = await api().apiFetch(`/api/photos?${q}`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: blob });
    if (!r.ok) { const e = new Error(r.status === 429 ? 'too_many' : r.status === 413 ? 'too_big' : 'failed'); e.status = r.status; throw e; }
    return r.json();
  }
  async function remove(id) { const r = await api().apiFetch(`/api/photos/${encodeURIComponent(id)}`, { method: 'DELETE' }); return r.ok; }
  async function list(kind, ref) {
    const r = await api().apiFetch(`/api/photos?kind=${encodeURIComponent(kind)}&ref=${encodeURIComponent(ref)}`);
    return r.ok ? r.json() : [];
  }

  const urls = new Map();
  /** An object URL for a photo id, or null when it is gone, hidden or offline. */
  function url(id) {
    if (!id) return Promise.resolve(null);
    if (!urls.has(id)) {
      urls.set(id, api().apiFetch(`/api/photos/${encodeURIComponent(id)}`).then(async (r) => (r.ok ? URL.createObjectURL(await r.blob()) : null)).catch(() => null));
    }
    return urls.get(id);
  }
  /** An <img> that fills in when the photo arrives; `alt` is for screen readers. */
  function img(id, cls, alt = '') {
    const el = root.document.createElement('img');
    el.className = cls || ''; el.alt = alt; el.decoding = 'async'; el.hidden = true;
    url(id).then((u) => { if (u) { el.src = u; el.hidden = false; } });
    return el;
  }
  /** A round avatar: the photo when there is one, else the initial in a bezelled circle. */
  function avatar(id, handle, px = 40) {
    const box = root.document.createElement('span');
    box.className = 'avatar'; box.style.setProperty('--av', `${px}px`);
    const letter = root.document.createElement('b'); letter.textContent = initial(handle); box.append(letter);
    if (id) { const i = img(id, '', ''); i.addEventListener('load', () => { letter.hidden = true; }); box.append(i); }
    box.setAttribute('aria-hidden', 'true');
    return box;
  }

  /** A photo full screen, with a row of actions ([label, fn]); tap outside or Done to close. */
  function view(id, actions = []) {
    const d = root.document, ov = d.createElement('div');
    ov.className = 'overlay dim show photo-view'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Photo');
    const close = () => ov.remove();
    const row = d.createElement('div'); row.className = 'row';
    for (const [label, fn] of [...actions, ['Done', null]]) {
      const b = d.createElement('button'); b.className = label === 'Done' ? 'ink-btn solid' : 'ink-btn'; b.textContent = label;
      b.addEventListener('click', async () => { if (fn) await fn(); close(); }); row.append(b);
    }
    ov.append(img(id, 'photo-full', 'Photo'), row);
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    d.body.append(ov);
    return close;
  }
  /** A labelled file picker that prepares and uploads a photo; `done(result)` after. */
  function picker(label, kind, ref, done, { cover = false, toast = null } = {}) {
    const d = root.document, l = d.createElement('label'), input = d.createElement('input');
    l.className = 'ink-btn photo-pick'; l.textContent = label;
    input.type = 'file'; input.accept = 'image/*'; input.hidden = true; l.append(input);
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0]; input.value = '';
      if (!f) return;
      const say = toast || (() => {});
      const blob = await prepare(f);
      if (!blob) { say('That photo couldn\u2019t be read. Try another.'); return; }
      try { const r = await upload(kind, ref, blob, { cover }); say('Photo added. Its location data stayed on your phone.'); done(r); }
      catch (e) { say(e.message === 'too_many' ? 'That\u2019s the most photos it can hold. Remove one first.' : 'Couldn\u2019t send the photo. Check signal and try again.'); }
    });
    return l;
  }

  /** Your own photo as a key (TestFlight 2026-11-05: "tapping your own pfp should let you change/remove it like every
   *  other app"): `face` (an avatar) wrapped in a button. With no photo a tap opens the photo picker; with one it opens a
   *  sheet: Choose a new photo (the picker, a real <label> so the tap itself opens it in a web view), Remove photo, Cancel.
   *  `done()` after a change or a removal. */
  function mine(face, id, kind, done, { toast = null, name = 'your photo' } = {}) {
    const d = root.document, say = toast || (() => {});
    const key = d.createElement('button'); key.type = 'button'; key.className = 'my-photo';
    key.setAttribute('aria-label', id ? `Change or remove ${name}` : `Add ${name}`);
    const badge = d.createElement('i'); badge.className = 'my-photo-edit'; badge.setAttribute('aria-hidden', 'true');
    const NS = 'http://www.w3.org/2000/svg', pen = d.createElementNS(NS, 'svg'), nib = d.createElementNS(NS, 'path');   // a pencil
    pen.setAttribute('viewBox', '0 0 16 16'); nib.setAttribute('d', 'M2.5 13.5l.6-3 7.4-7.4 2.4 2.4-7.4 7.4zM9.8 3.8l2.4 2.4'); pen.append(nib); badge.append(pen);
    key.append(face, badge);
    const pick = picker('Choose a new photo', kind, null, (r) => done(r), { toast });
    pick.hidden = true;
    const wrap = d.createElement('span'); wrap.className = 'my-photo-wrap'; wrap.append(key, pick);
    key.addEventListener('click', () => {
      if (!id) { pick.querySelector('input').click(); return; }
      const back = d.createElement('div'); back.className = 'confirm-sheet my-photo-sheet';
      back.setAttribute('role', 'dialog'); back.setAttribute('aria-modal', 'true'); back.setAttribute('aria-label', name);
      const box = d.createElement('div'); box.className = 'cs-box cs-choose';
      const p = d.createElement('p'); p.textContent = name.charAt(0).toUpperCase() + name.slice(1);
      const list = d.createElement('div'); list.className = 'cs-list';
      const close = () => { back.remove(); d.removeEventListener('keydown', esc); key.focus({ preventScroll: true }); };
      const esc = (ev) => { if (ev.key === 'Escape') close(); };
      const change = picker('Choose a new photo', kind, null, (r) => { close(); done(r); }, { toast });
      change.className = 'cs-opt';
      for (const ev of ['change', 'cancel']) change.querySelector('input').addEventListener(ev, () => setTimeout(close, 0));   // picked (it uploads) or not
      const rm = d.createElement('button'); rm.type = 'button'; rm.className = 'cs-yes'; rm.textContent = 'Remove photo';
      rm.addEventListener('click', async () => { rm.disabled = true; const ok = await remove(id).catch(() => false); close(); if (ok) done(null); else say('Couldn’t remove it. Try again.'); });
      const no = d.createElement('button'); no.type = 'button'; no.className = 'cs-no'; no.textContent = 'Cancel'; no.addEventListener('click', close);
      list.append(change, rm, no); box.append(p, list); back.append(box);
      back.addEventListener('click', (ev) => { if (ev.target === back) close(); });
      d.addEventListener('keydown', esc);
      d.body.append(back);
      no.focus({ preventScroll: true });
    });
    return wrap;
  }

  const apiOut = { fitSize, initial, prepare, upload, remove, list, url, img, avatar, view, picker, mine, MAX_SIDE, MAX_BYTES };
  if (typeof module !== 'undefined' && module.exports) module.exports = apiOut; else root.ApexPhotos = apiOut;
})(typeof window !== 'undefined' ? window : globalThis);
