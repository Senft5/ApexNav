// Drive posts and the friends feed (docs/SOCIAL.md 2.13; backend/src/drive_posts.ts): after a drive, Post sends its card to
// your friends or to one of your crews: the drive's name, the day, its length, its Score, the roads, and a line of its
// shape with both ends cut (your privacy zones and 500 m here, 500 m again on the server). Friends see it in the Feed on
// People → Friends and give kudos and comments, as on any social app. Report and Block are one tap in, on the post.
// trimLine(), lineSvg(), facts(), ago() are pure (tests/test_drive_posts.py); mount() draws the Feed, a post and the
// Post sheet.
(function (root) {
  'use strict';
  const CUT_M = 500, MAX_POINTS = 600, PREVIEW = 3;

  const metres = (a, b) => {
    const R = 6371000, r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  /** The drive's points with both ends cut: first everything inside a privacy zone at either end, then CUT_M more, thinned
   *  to MAX_POINTS. `inZone(lat, lon)` says whether a point is in one of your zones. Null when nothing is left. */
  function trimLine(lat, lon, inZone = () => false) {
    if (!Array.isArray(lat) || !Array.isArray(lon)) return null;
    let pts = [];
    for (let i = 0; i < Math.min(lat.length, lon.length); i++) if (Number.isFinite(lat[i]) && Number.isFinite(lon[i])) pts.push([lat[i], lon[i]]);
    let a = 0, b = pts.length - 1;
    while (a <= b && inZone(pts[a][0], pts[a][1])) a++;
    while (b >= a && inZone(pts[b][0], pts[b][1])) b--;
    pts = pts.slice(a, b + 1);
    if (pts.length < 2) return null;
    const along = [0];
    for (let k = 1; k < pts.length; k++) along.push(along[k - 1] + metres(pts[k - 1], pts[k]));
    const total = along[along.length - 1];
    const kept = pts.filter((_, k) => along[k] >= CUT_M && along[k] <= total - CUT_M);
    if (kept.length < 2) return null;
    const step = Math.ceil(kept.length / MAX_POINTS);
    const thin = kept.filter((_, k) => k % step === 0);
    if (thin[thin.length - 1] !== kept[kept.length - 1]) thin.push(kept[kept.length - 1]);
    return thin.slice(0, MAX_POINTS);
  }
  function encode(pts) {
    let out = '', pLat = 0, pLon = 0;
    const enc = (v) => { v = v < 0 ? ~(v << 1) : v << 1; while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } out += String.fromCharCode(v + 63); };
    for (const [la, lo] of pts) { const x = Math.round(la * 1e5), y = Math.round(lo * 1e5); enc(x - pLat); enc(y - pLon); pLat = x; pLon = y; }
    return out;
  }
  function decode(s) {
    const pts = []; let i = 0, la = 0, lo = 0;
    const next = () => { let r = 0, sh = 0, c; do { c = s.charCodeAt(i++) - 63; r |= (c & 31) << sh; sh += 5; } while (c >= 32 && i < s.length); return r & 1 ? ~(r >> 1) : r >> 1; };
    try { while (i < s.length) { la += next(); lo += next(); pts.push([la / 1e5, lo / 1e5]); } } catch (_) { return []; }
    return pts;
  }
  /** Up to max points along a post's line, evenly by distance, both ends kept: the stops a route is laid through so it
   *  follows the friend's roads (the line itself is thinned, too coarse to draw corners from). [] for under two points. */
  function throughPoints(pts, max = 12) {
    if (!Array.isArray(pts) || pts.length < 2) return [];
    const m = (a, b) => Math.hypot((b[0] - a[0]) * 111320, (b[1] - a[1]) * 111320 * Math.cos(a[0] * Math.PI / 180));
    const along = [0];
    for (let k = 1; k < pts.length; k++) along.push(along[k - 1] + m(pts[k - 1], pts[k]));
    const total = along[along.length - 1], n = Math.max(2, Math.min(max, Math.round(total / 1500) + 1)), out = [];
    for (let j = 0, k = 0; j < n; j++) {
      const want = total * j / (n - 1);
      while (k < pts.length - 1 && along[k] < want) k++;
      if (!out.length || out[out.length - 1] !== pts[k]) out.push(pts[k]);
    }
    return out.map(([lat, lon]) => ({ lat, lon }));
  }
  /** An SVG path for the line in a w×h box, north up, its shape kept (longitude scaled by the latitude), with a margin. */
  function lineSvg(pts, w, h, pad = 8) {
    if (!Array.isArray(pts) || pts.length < 2) return '';
    const k = Math.cos((pts.reduce((s, p) => s + p[0], 0) / pts.length) * Math.PI / 180);
    const xs = pts.map((p) => p[1] * k), ys = pts.map((p) => p[0]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const s = Math.min((w - 2 * pad) / Math.max(x1 - x0, 1e-9), (h - 2 * pad) / Math.max(y1 - y0, 1e-9));
    const ox = (w - (x1 - x0) * s) / 2, oy = (h - (y1 - y0) * s) / 2;
    return pts.map((p, i) => `${i ? 'L' : 'M'}${(ox + (p[1] * k - x0) * s).toFixed(1)} ${(oy + (y1 - p[0]) * s).toFixed(1)}`).join('');
  }
  const tsOf = (at) => { const t = Date.parse(String(at || '').replace(' ', 'T') + 'Z'); return Number.isFinite(t) ? t : NaN; };
  /** "just now", "12 min", "3 h", "yesterday", "Nov 9" from a server time. */
  function ago(at, now) {
    const t = tsOf(at);
    if (!Number.isFinite(t)) return '';
    const m = Math.max(0, Math.round((now - t) / 60000));
    if (m < 2) return 'just now';
    if (m < 60) return `${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h`;
    if (h < 48) return 'yesterday';
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  /** The card's facts, in the order a driver reads them: length, then the roads (two named, the rest counted). */
  function facts(p, fmtLen) {
    const roads = Array.isArray(p.roads) ? p.roads : [];
    const r = roads.length > 2 ? `${roads.slice(0, 2).join(', ')} +${roads.length - 2}` : roads.join(', ');
    return [Number.isFinite(p.length_m) && p.length_m > 0 ? fmtLen(p.length_m) : '', r].filter(Boolean).join(' · ');
  }

  const STYLE = `
    .feed-media { position: relative; background: #000; min-height: 120px; }
    .feed-media video, .feed-media img { display: block; width: 100%; max-height: 440px; object-fit: contain; }
    .feed-media-label { position: absolute; left: 8px; top: 8px; background: var(--panel); color: var(--panel-ink); padding: 2px 8px; font-weight: 700; font-size: 13px; }
    .post-media { display: flex; align-items: center; gap: 10px; }
    .post-media img, .post-media video { width: 64px; height: 64px; object-fit: cover; background: #000; }
    .feed { display: grid; }
    .feed-stages { display: grid; gap: 4px; }
    .feed-stages small { color: var(--panel-dim); font-size: 11px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
    .feed-stages div { display: flex; justify-content: space-between; gap: 12px; border-top: 1px solid var(--rule); padding-top: 4px; }
    .feed-stages span { overflow-wrap: anywhere; min-width: 0; }
    .feed-stages b { font-family: var(--font-num); font-variant-numeric: tabular-nums; }
    .feed-card { border-top: 1px solid var(--rule); color: var(--panel-ink); display: grid; gap: 10px; padding: 14px 0 4px; }
    .feed-sheet .feed-card { border-top: 0; padding-top: 0; }
    .feed-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .feed-head .who { display: grid; min-width: 0; } .feed-head .who b { overflow-wrap: anywhere; }
    .feed-head .who small { color: var(--panel-dim); font-size: 13px; }
    .feed-head .feed-more { margin-left: auto; width: 44px; height: 44px; display: grid; place-items: center; text-decoration: none; font-size: 20px; letter-spacing: 1px; color: var(--panel-ink); }
    .feed-card .feed-title { font-size: 20px; font-weight: 700; margin: 0; padding: 0; border: 0; overflow-wrap: anywhere; }
    .feed-sec > .cp-sec h3 { border: 0; padding: 0; margin: 0; }
    .feed-stats { display: flex; gap: 0; }
    .feed-stats > div { display: grid; align-content: start; padding-right: 18px; margin-right: 18px; border-right: 1px solid var(--rule); }
    .feed-stats > div:last-child { border-right: 0; margin-right: 0; padding-right: 0; }
    .feed-stats small { color: var(--panel-dim); font-size: 11px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
    .feed-stats b { font-family: var(--font-num); font-size: 30px; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .feed-stats b span { font-family: inherit; font-size: 15px; font-weight: 600; color: var(--panel-dim); margin-left: 3px; }
    .feed-line { width: 100%; height: auto; aspect-ratio: 2 / 1; display: block; background: var(--well, rgba(0,0,0,0.05)); }
    .feed-line path { fill: none; stroke: var(--accent); stroke-width: 3.5; stroke-linecap: round; stroke-linejoin: round; }
    .feed-line .casing { display: none; }
    .feed-line.on-map { background-size: 100% 100%; background-position: center; }
    .feed-line.on-map .casing { display: inline; stroke: var(--panel, #fff); stroke-width: 7; }
    .feed-line .go { fill: var(--panel, #fff); stroke: var(--panel-ink); stroke-width: 2.5; }
    .feed-line .end { fill: var(--accent); stroke: none; }
    .feed-facts { color: var(--panel-dim); font-size: 14px; margin: 0; overflow-wrap: anywhere; }
    .feed-caption { margin: 0; font-size: 16px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .feed-acts { display: flex; gap: 22px; }
    .feed-acts button { border: 0; background: none; color: var(--panel-ink); font: inherit; font-weight: 600; min-height: 40px; padding: 0; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
    .feed-acts button[aria-pressed="true"] { color: var(--accent); }
    .feed-acts .feed-drive { margin-left: auto; }
    .feed-acts svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; }
    .feed-acts button[aria-pressed="true"] svg { fill: currentColor; }
    .feed-comments { display: grid; gap: 10px; }
    .feed-comment { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: start; }
    .feed-comment p { margin: 2px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .feed-comment small { color: var(--panel-dim); font-size: 12px; }
    .feed-comment .feed-more { width: 44px; height: 44px; display: grid; place-items: center; text-decoration: none; font-size: 20px; color: var(--panel-ink); }
    .feed-say { display: flex; gap: 8px; }
    .feed-say .field { flex: 1; min-width: 0; }
    .post-sheet textarea { width: 100%; min-height: 72px; resize: vertical; }
  `;
  const ICON = {
    kudos: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11v9H4v-9zM7 11l4-7c1.5 0 2.5 1 2 3l-1 4h6a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 21H7"/></svg>',
    comment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    drive: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 18-7-4-7 4z"/></svg>',
  };

  /**
   * page: el, btn, toast, apiCall, jsonOf, avatar(photo_id, handle, px), fmtLen(m), report({kind,target,label,who}),
   * block(handle), crews() → a promise of [{id, name}], inZone(lat, lon) (your privacy zones), openFriend(handle) (their profile),
   * driveLine(stops, post) (Drive it: a route through stops along the post's line).
   */
  function mount(page) {
    const { el, btn, toast, apiCall, jsonOf } = page;
    const doc = root.document;
    if (doc && !doc.getElementById('drivePostsStyle')) doc.head.append(el('style', { id: 'drivePostsStyle', textContent: STYLE }));
    const face = (p, px) => (page.avatar ? page.avatar(p.photo_id || null, p.handle, px) : el('span'));
    const sheet = (label, cls = '') => {
      const ov = el('div', { className: `overlay dim show ${cls}` });
      ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', label);
      const close = () => ov.remove();
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      const box = el('div', { className: 'card-sheet' });
      ov.append(box); doc.body.append(ov);
      return { ov, box, close };
    };

    // a post's clip or photo (backend/src/post_media.ts): fetched when its card comes near the screen, kept for the page
    const mediaUrls = new Map();
    const near = (node, fn) => {
      if (!root.IntersectionObserver) { fn(); return; }
      const io = new root.IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); fn(); } }, { rootMargin: '300px' });
      io.observe(node);
    };
    function mediaBox(p) {
      const clip = p.media.kind === 'clip';
      const m = el('div', { className: `feed-media ${clip ? 'clip' : 'photo'}` });
      m.setAttribute('role', 'img'); m.setAttribute('aria-label', clip ? `Clip${p.media.label ? `, ${p.media.label}` : ''}` : 'Photo');
      if (p.media.label) m.append(el('span', { className: 'feed-media-label', textContent: p.media.label }));
      near(m, async () => {
        if (!mediaUrls.has(p.id)) mediaUrls.set(p.id, apiCall('GET', `/api/posts/${encodeURIComponent(p.id)}/media`)
          .then(async (r) => (r && r.ok ? URL.createObjectURL(await r.blob()) : null)).catch(() => null));
        const url = await mediaUrls.get(p.id);
        if (!url) { m.hidden = true; return; }
        if (clip) {
          // muted, looping and inline, as any feed's video; a tap stops or starts it
          const v = el('video', { src: url, muted: true, loop: true, autoplay: true, playsInline: true });
          v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
          v.addEventListener('click', () => { if (v.paused) v.play().catch(() => {}); else v.pause(); });
          m.prepend(v);
        } else m.prepend(el('img', { src: url, alt: '' }));
      });
      return m;
    }

    function kudosKey(p) {
      const n = el('span', { textContent: String(p.kudos || 0) });
      const b = el('button', { type: 'button' }); b.innerHTML = ICON.kudos; b.append(n);
      const paint = () => { b.setAttribute('aria-pressed', String(!!p.my_kudos)); b.setAttribute('aria-label', `Kudos, ${p.kudos || 0}`); n.textContent = String(p.kudos || 0); };
      paint();
      if (p.mine) { b.disabled = true; return b; }                      // kudos are for others' drives; yours shows the count
      b.addEventListener('click', async () => {
        const give = !p.my_kudos;
        p.my_kudos = give; p.kudos = Math.max(0, (p.kudos || 0) + (give ? 1 : -1)); paint();   // at once, as any social app
        const r = await apiCall(give ? 'POST' : 'DELETE', `/api/posts/${encodeURIComponent(p.id)}/kudos`).catch(() => null);
        if (!r || !r.ok) { p.my_kudos = !give; p.kudos = Math.max(0, p.kudos + (give ? -1 : 1)); paint(); toast('Couldn’t send that. Check signal.'); }
      });
      return b;
    }

    /** One post as a card. o.full: inside its own sheet (no Comments key; the comments are under it). */
    function card(p, o = {}) {
      const box = el('article', { className: 'feed-card' }); box.dataset.id = p.id;
      const when = ago(p.created_at, Date.now());
      const who = el('span', { className: 'who' }, el('b', { textContent: p.mine ? 'You' : `@${p.handle || '?'}` }),
        el('small', { textContent: [p.crew ? p.crew.name : '', when].filter(Boolean).join(' · ') }));
      const head = el('div', { className: 'feed-head' }, face(p, 40), who);
      if (!p.mine && p.handle && page.openFriend && !p.crew) {          // a friend's face and name open their profile
        head.style.cursor = 'pointer'; head.addEventListener('click', (e) => { if (!e.target.closest('.feed-more')) page.openFriend(p.handle); });
      }
      head.append(moreKey(p, o));
      box.append(head, el('h3', { className: 'feed-title', textContent: p.title }));
      if (p.caption) box.append(el('p', { className: 'feed-caption', textContent: p.caption }));
      // the numbers a driver reads first, Strava's row: Score, then the length (unknown stays --)
      const stat = (label, v, unit) => { const b = el('b', { textContent: v }); if (unit) b.append(el('span', { textContent: unit }));
        return el('div', {}, el('small', { textContent: label }), b); };
      const fmtLen = page.fmtLen || ((m) => `${(m / 1000).toFixed(1)} km`);
      const stats = el('div', { className: 'feed-stats' }, stat('Vetta Score', p.score == null ? '--' : String(p.score)));
      if (Number.isFinite(p.length_m) && p.length_m > 0) { const m = /^([\d.,]+)\s*(.*)$/.exec(fmtLen(p.length_m)) || [];
        stats.append(m[1] ? stat('Distance', m[1], m[2]) : stat('Distance', fmtLen(p.length_m))); }
      box.append(stats);
      const pts = p.line ? decode(p.line) : [];
      if (pts.length > 1) {                                             // the road it drew, wide, from the start ring to the red finish dot
        const W = 340, H = 170, NS = 'http://www.w3.org/2000/svg', svg = doc.createElementNS(NS, 'svg'), path = doc.createElementNS(NS, 'path');
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'feed-line'); svg.setAttribute('aria-hidden', 'true');
        const d = lineSvg(pts, W, H, 18), casing = doc.createElementNS(NS, 'path');
        casing.setAttribute('d', d); casing.setAttribute('class', 'casing'); path.setAttribute('d', d); svg.append(casing, path);
        const xy = d.match(/-?[\d.]+ -?[\d.]+/g) || [];
        [[xy[0], 'go', 5.5], [xy[xy.length - 1], 'end', 6]].forEach(([q, cls, r]) => { if (!q) return; const [x, y] = q.split(' ');
          const c = doc.createElementNS(NS, 'circle'); c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', r); c.setAttribute('class', cls); svg.append(c); });
        box.append(svg);
        // the streets round it (post_map.js): one still picture of the real map, laid exactly under the line once drawn
        if (page.mapUnder) near(svg, () => Promise.resolve(page.mapUnder(p.id, pts, W, H, 18)).then((url) => {
          if (!url || !svg.isConnected) return;
          svg.style.backgroundImage = `url("${url}")`; svg.classList.add('on-map');
        }).catch(() => {}));
      }
      if (p.media) box.append(mediaBox(p));
      if (Array.isArray(p.stages) && p.stages.length) {                // the saved stages it went over, each with its Score
        box.append(el('div', { className: 'feed-stages' }, el('small', { textContent: p.stages.length === 1 ? 'Stage' : 'Stages' }),
          ...p.stages.map((x) => el('div', {}, el('span', { textContent: x.name }), el('b', { textContent: x.score == null ? '--' : String(x.score) })))));
      }
      const f = facts({ roads: p.roads }, fmtLen);
      if (f) box.append(el('p', { className: 'feed-facts', textContent: f }));
      const acts = el('div', { className: 'feed-acts' }, kudosKey(p));
      if (!o.full) {
        const c = el('button', { type: 'button' }); c.innerHTML = ICON.comment;
        c.append(el('span', { textContent: p.comments ? String(p.comments) : 'Comment' }));
        c.setAttribute('aria-label', p.comments ? `${p.comments} comments` : 'Comment');
        c.addEventListener('click', () => open(p.id, { focus: true, after: o.after }));
        acts.append(c);
      }
      // Drive it: the route laid along the friend's line (its stops on their roads), as a roadbook road is
      if (pts.length > 1 && page.driveLine) {
        const d = el('button', { type: 'button', className: 'feed-drive' }); d.innerHTML = ICON.drive; d.append(el('span', { textContent: 'Drive it' }));
        d.setAttribute('aria-label', p.mine ? `Drive ${p.title} again` : `Drive @${p.handle || '?'}'s ${p.title}`);
        d.addEventListener('click', () => { doc.querySelectorAll('.feed-sheet').forEach((n) => n.remove()); page.driveLine(throughPoints(pts), p); });
        acts.append(d);
      }
      box.append(acts);
      return box;
    }
    // ··· on the post: Delete for yours; Report and Block for anyone else's (P-06: never on the card's face)
    function moreKey(p, o) {
      const b = el('button', { type: 'button', className: 'linkbtn feed-more', textContent: '···' });
      b.setAttribute('aria-label', 'More for this post');
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const s = sheet('This post', 'feed-menu');
        const keys = el('div', { className: 'row', style: 'flex-wrap:wrap' });
        if (p.mine) keys.append(btn('Delete post', async () => {
          s.close();
          const r = await apiCall('DELETE', `/api/posts/${encodeURIComponent(p.id)}`).catch(() => null);
          if (r && r.ok) { toast('Post deleted.'); if (o.gone) o.gone(); if (o.after) o.after(); } else toast('Couldn’t delete it. Check signal.');
        }, 'ink-btn'));
        else {
          if (page.report) keys.append(btn('Report', () => { s.close(); page.report({ kind: 'drive', target: p.id, label: `@${p.handle}'s drive "${p.title}"`, who: p.handle }); }, 'ink-btn'));
          if (page.block && p.handle) keys.append(btn(`Block @${p.handle}`, () => { s.close(); page.block(p.handle); }, 'ink-btn'));
        }
        keys.append(btn('Cancel', s.close, 'linkbtn'));
        s.box.append(keys);
      });
      return b;
    }

    /** A post on its own, with its comments and a line to add one. */
    async function open(id, o = {}) {
      const s = sheet('Drive post', 'feed-sheet');
      s.box.append(el('p', { className: 'note', textContent: 'Loading…' }));
      const p = await apiCall('GET', `/api/posts/${encodeURIComponent(id)}`).then(jsonOf).catch(() => null);
      if (!p || !p.id) { s.box.replaceChildren(el('p', { className: 'note', textContent: 'This post is gone.' }), btn('Done', s.close, 'linkbtn')); return; }
      const list = el('div', { className: 'feed-comments' });
      const draw = () => list.replaceChildren(...p.comment_list.map((c) => {
        const row = el('div', { className: 'feed-comment' }, face(c, 30),
          el('div', {}, el('b', { textContent: c.mine ? 'You' : `@${c.handle || '?'}` }), el('small', { textContent: ` ${ago(c.created_at, Date.now())}` }), el('p', { textContent: c.body })));
        const k = el('button', { type: 'button', className: 'linkbtn feed-more', textContent: '···' }); k.setAttribute('aria-label', 'More for this comment');
        k.addEventListener('click', () => {
          const m = sheet('This comment', 'feed-menu'); const keys = el('div', { className: 'row', style: 'flex-wrap:wrap' });
          if (c.can_delete) keys.append(btn('Delete', async () => {
            m.close();
            const r = await apiCall('DELETE', `/api/comments/${encodeURIComponent(c.id)}`).catch(() => null);
            if (r && r.ok) { p.comment_list = p.comment_list.filter((x) => x.id !== c.id); draw(); if (o.after) o.after(); } else toast('Couldn’t delete it. Check signal.');
          }, 'ink-btn'));
          if (!c.mine && page.report) keys.append(btn('Report', () => { m.close(); page.report({ kind: 'comment', target: c.id, label: `@${c.handle}: "${c.body.slice(0, 60)}"`, who: c.handle }); }, 'ink-btn'));
          keys.append(btn('Cancel', m.close, 'linkbtn')); m.box.append(keys);
        });
        row.append(k);
        return row;
      }));
      draw();
      const field = el('input', { className: 'field', maxLength: 280, placeholder: 'Add a comment', 'aria-label': 'Add a comment' });
      const send = btn('Send', async () => {
        const t = field.value.trim(); if (!t) return;
        send.disabled = true;
        const r = await apiCall('POST', `/api/posts/${encodeURIComponent(p.id)}/comments`, { body: t }).catch(() => null);
        send.disabled = false;
        if (!r || !r.ok) { toast(r && r.status === 429 ? 'That’s a lot of comments. Try again in a bit.' : 'Couldn’t send it. Check signal.'); return; }
        const { id: cid } = await jsonOf(r);
        p.comment_list.push({ id: cid, body: t, created_at: new Date().toISOString().slice(0, 19).replace('T', ' '), handle: page.myHandle ? page.myHandle() : null, photo_id: null, mine: true, can_delete: true });
        field.value = ''; draw(); if (o.after) o.after();
      }, 'ink-btn solid');
      field.addEventListener('keydown', (e) => { if (e.key === 'Enter') send.click(); });
      s.box.replaceChildren(card(p, { full: true, after: o.after, gone: s.close }), list, el('div', { className: 'feed-say' }, field, send), el('div', { className: 'row' }, btn('Done', s.close, 'linkbtn')));
      if (o.focus) field.focus();
    }

    /** The Feed on People → Friends: the newest PREVIEW posts, and See all for the rest. Hidden while there is none. */
    function section(onAll) {
      const box = el('section', { className: 'stack-8 feed-sec' }); box.hidden = true;
      const list = el('div', { className: 'feed' });
      const all = btn('See all', () => onAll && onAll(), 'linkbtn');
      box.append(el('div', { className: 'cp-sec' }, el('h3', { textContent: 'Feed' }), all), list);
      const redo = () => apiCall('GET', '/api/feed').then(jsonOf).then((rows) => {
        if (!Array.isArray(rows)) return;
        list.replaceChildren(...rows.slice(0, PREVIEW).map((p) => card(p, { after: redo })));
        all.hidden = rows.length <= PREVIEW;
        box.hidden = !rows.length;
      }).catch(() => {});
      redo();
      return box;
    }
    /** A friend's drives on their profile (author: their user id): their newest posts you can see, as cards. Hidden while
     *  there is none, or with no signal (the profile says that itself). */
    function drivesOf(author) {
      const box = el('section', { className: 'stack-8 feed-sec profile-drives' }); box.hidden = true;
      const list = el('div', { className: 'feed' });
      box.append(el('b', { textContent: 'Drives' }), list);
      let all = false;   // See all: every post the Feed gives (its latest page), in place
      const redo = () => apiCall('GET', `/api/feed?author=${encodeURIComponent(author)}`).then(jsonOf).then((rows) => {
        if (!Array.isArray(rows)) return;
        const more = !all && rows.length > PREVIEW;
        list.replaceChildren(...(all ? rows : rows.slice(0, PREVIEW)).map((p) => card(p, { after: redo })),
          ...(more ? [btn('See all', () => { all = true; redo(); }, 'linkbtn feed-all')] : []));
        box.hidden = !rows.length;
      }).catch(() => {});
      redo();
      return box;
    }
    /** Every post, newest first, More for older ones. For a side sheet of its own. */
    function full() {
      const list = el('div', { className: 'feed' }), more = btn('More', () => load(), 'linkbtn');
      let last = null;
      const load = () => apiCall('GET', `/api/feed${last ? `?before=${encodeURIComponent(last)}` : ''}`).then(jsonOf).then((rows) => {
        if (!Array.isArray(rows)) return;
        list.append(...rows.map((p) => card(p, {})));
        last = rows.length ? rows[rows.length - 1].created_at : last;
        more.hidden = rows.length < 30;
        if (!list.childElementCount) list.append(el('p', { className: 'note', textContent: 'No drives posted yet. Post yours from the card after a drive.' }));
      }).catch(() => {});
      load();
      return el('div', { className: 'stack-12' }, list, more);
    }

    // a post's body: the drive's card, its line without its ends (trimLine), to a crew (to) or your friends (null)
    function bodyOf(d, to, caption) {
      const line = trimLine(d.lat, d.lon, page.inZone || (() => false));
      return { title: String(d.name || 'Drive').slice(0, 60), caption: caption || null, driven_on: d.driven_on, length_m: Number.isFinite(d.len_m) ? Math.round(d.len_m) : null,
        score: Number.isFinite(d.score) ? Math.round(d.score) : null, roads: (d.roads || []).slice(0, 8), line: line ? encode(line) : null, crew_id: to || null,
        stages: (d.stages || []).filter((x) => x && x.name).slice(0, 3).map((x) => ({ name: String(x.name).slice(0, 60), score: Number.isFinite(x.score) ? Math.round(x.score) : null })) };
    }
    /** One tap (2026-11-14, the drive's card): the drive to your friends, no sheet. Resolves its id, or null (said in a toast). */
    async function post(d) {
      const body = bodyOf(d, null, null), r = await apiCall('POST', '/api/posts', body).catch(() => null);
      // no signal (IDEAS F-05): it waits on the phone and goes when there is one (outbox.js), as from the sheet
      if ((!r || r.status >= 500) && page.later) { page.later('/api/posts', body); toast('No signal. Your post goes up when you have one.'); return true; }
      if (!r || !r.ok) { toast(r && r.status === 429 ? 'That’s ten posts today.' : 'Couldn’t post it. Check signal.'); return null; }
      const j = await Promise.resolve().then(() => jsonOf(r)).catch(() => null);
      return (j && j.id) || true;
    }
    /** Takes a post back (yours only): true once gone. */
    async function remove(id) {
      const r = await apiCall('DELETE', `/api/posts/${encodeURIComponent(id)}`).catch(() => null);
      return !!(r && r.ok);
    }

    /** Sends the clip or photo of a post just made; false when it didn't go up. */
    async function putMedia(id, m) {
      const path = `/api/posts/${encodeURIComponent(id)}/media${m.label ? `?label=${encodeURIComponent(String(m.label).slice(0, 60))}` : ''}`;
      const send = page.upload || ((pa, blob, type) => root.ApexSync.apiFetch(pa, { method: 'PUT', headers: { 'content-type': type }, body: blob }));
      const r = await send(path, m.blob, m.mime).catch(() => null);
      return !!(r && r.ok);
    }

    /** The Post sheet after a drive. d: { name, driven_on, len_m, score, lat, lon, roads, media? }, media a clip made on the
     *  drive's page ({ blob, mime, label }); without one the driver can add a photo. Resolves true once posted. */
    async function compose(d) {
      let crews = [];
      try { crews = (page.crews ? await page.crews() : []) || []; } catch (_) { crews = []; }
      if (!Array.isArray(crews)) crews = [];
      return new Promise((done) => {
        const s = sheet('Post this drive', 'post-sheet');
        let to = null;                                                   // null: your friends
        const opts = [[null, 'Friends'], ...crews.map((c) => [c.id, c.name])];
        // who sees it: one slide switch (Friends, or a crew), as every pick of one in the app; stamps past three
        const chips = el('div', { className: opts.length <= 3 ? 'switch' : 'stamps', role: 'radiogroup' });
        chips.setAttribute('aria-label', 'Post to');
        const paint = () => chips.querySelectorAll('button').forEach((b, i) => { const on = opts[i][0] === to; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
        for (const [id, label] of opts) {
          const b = btn(label, () => { to = id; paint(); }, 'chip'); b.setAttribute('role', 'radio'); chips.append(b);
        }
        paint();
        const say = el('textarea', { className: 'field', maxLength: 280, placeholder: 'How was it? (optional)', 'aria-label': 'Caption' });
        // the clip that came with it, or a photo the driver adds (redrawn as a JPEG on the phone, so no EXIF leaves it)
        let media = d.media && d.media.blob ? d.media : null;
        const mrow = el('div', { className: 'post-media' });
        const pick = el('input', { type: 'file', accept: 'image/*', hidden: true });
        const paintMedia = () => {
          if (!media) {
            mrow.replaceChildren(pick, btn('Add a photo', () => pick.click(), 'ink-btn'));
            mrow.hidden = !(page.preparePhoto || (root.ApexPhotos && root.ApexPhotos.prepare));
            return;
          }
          const url = URL.createObjectURL(media.blob), clip = /^video\//.test(media.mime);
          const thumb = clip ? el('video', { src: url, muted: true, playsInline: true }) : el('img', { src: url, alt: '' });
          mrow.hidden = false;
          mrow.replaceChildren(pick, thumb, el('span', { textContent: clip ? `Clip${media.label ? `: ${media.label}` : ''}` : 'Photo' }),
            btn('Remove', () => { media = null; paintMedia(); }, 'linkbtn'));
        };
        pick.addEventListener('change', async () => {
          const f = pick.files && pick.files[0]; pick.value = '';
          if (!f) return;
          const prep = page.preparePhoto || root.ApexPhotos.prepare;
          const blob = await prep(f).catch(() => null);
          if (!blob) { toast('Couldn’t read that photo.'); return; }
          media = { blob, mime: 'image/jpeg', label: null }; paintMedia();
        });
        paintMedia();
        const line = trimLine(d.lat, d.lon, page.inZone || (() => false));
        const post = btn('Post', async () => {
          post.disabled = true;
          const body = bodyOf(d, to, say.value.trim());
          const r = await apiCall('POST', '/api/posts', body).catch(() => null);
          // no signal (IDEAS F-05): the post waits on the phone and goes when there is one (outbox.js), as a hazard report does
          // (a post with a clip or photo can't wait: the outbox keeps text only, so the sheet stays open for another try)
          if ((!r || r.status >= 500) && page.later && !media) { page.later('/api/posts', body); s.close(); done(true); toast('No signal. Your post goes up when you have one.'); return; }
          if (!r || !r.ok) { post.disabled = false; toast(r && r.status === 429 ? 'That’s ten posts today.' : 'Couldn’t post it. Check signal.'); return; }
          const where = to ? `Posted to ${(crews.find((c) => c.id === to) || {}).name || 'your crew'}.` : 'Posted to your friends.';
          if (media) {
            post.textContent = 'Posting…';
            const { id } = (await jsonOf(r)) || {};
            const up = id ? await putMedia(id, media) : false;
            s.close(); done(true);
            toast(up ? where : `${where} The ${/^video\//.test(media.mime) ? 'clip' : 'photo'} didn’t go up.`);
            return;
          }
          s.close(); done(true);
          toast(where);
        }, 'ink-btn solid');
        const cancel = btn('Cancel', () => { s.close(); done(false); }, 'linkbtn');
        s.box.append(el('h2', { textContent: 'Post this drive' }), chips, say, mrow,
          el('p', { className: 'note', textContent: line ? 'Its start and end stay off the line.' : 'No line: too short to show without its start and end.' }),
          el('div', { className: 'row' }, post, cancel));
      });
    }

    return { section, full, open, compose, post, remove, card, drivesOf };
  }

  const api = { trimLine, encode, decode, throughPoints, lineSvg, ago, facts, mount, CUT_M, MAX_POINTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexDrivePosts = api;
})(typeof window !== 'undefined' ? window : globalThis);
