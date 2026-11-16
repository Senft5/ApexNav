/* Vetta: the Social home (Nate 2026-11-16: "social should sort of steal instagram's main page", "this is still vetta").
 * The Feed side of the Social tab: a row of rings across the top (who is out driving now, who drove today, your crews),
 * then every drive your friends and crews posted, each a road first. One tap from a ring to the thing it is about.
 * docs/SOCIAL.md 2.16. The feed cards are drive_posts.js's; this only lays the home out. */
(function (root) {
  'use strict';
  const DAY = 24 * 3600e3, MAX = 20;
  const tsOf = (at) => { const t = Date.parse(String(at || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(at || '')) ? '' : 'Z')); return Number.isFinite(t) ? t : NaN; };

  /**
   * The rings, in order: friends driving now (newest first), then friends who posted a drive in the last day (their newest
   * post, newest first), then your crews. A friend is in it once: driving now wins over posted today. Your own posts are
   * not rings (you know you drove). At most MAX.
   * live: [{handle, photo_id}] already ordered; posts: feed rows; crews: [{id, name, photo_id?}].
   */
  function rings(live, posts, crews, now = Date.now()) {
    const out = [], seen = new Set();
    for (const f of Array.isArray(live) ? live : []) {
      if (!f || !f.handle || seen.has(f.handle)) continue;
      seen.add(f.handle); out.push({ kind: 'live', handle: f.handle, photo_id: f.photo_id || null, label: f.handle });
    }
    const fresh = (Array.isArray(posts) ? posts : []).filter((p) => p && !p.mine && p.handle && now - tsOf(p.created_at) < DAY)
      .sort((a, b) => tsOf(b.created_at) - tsOf(a.created_at));
    for (const p of fresh) {
      if (seen.has(p.handle)) continue;
      seen.add(p.handle); out.push({ kind: 'new', handle: p.handle, photo_id: p.photo_id || null, label: p.handle, post: p.id, title: p.title || '' });
    }
    for (const c of Array.isArray(crews) ? crews : []) {
      if (!c || !c.id) continue;
      out.push({ kind: 'crew', crew: c.id, photo_id: c.photo_id || null, label: c.name || 'Crew' });
    }
    return out.slice(0, MAX);
  }
  /** What a screen reader hears for a ring: what tapping it does. */
  function ringLabel(r) {
    if (r.kind === 'live') return `@${r.handle}, driving now. See them on the map`;
    if (r.kind === 'new') return `@${r.handle} drove today${r.title ? `: ${r.title}` : ''}. Open it`;
    return `${r.label}, your crew. Open it`;
  }

  const CSS = `
    #feedBody { gap: 0; }
    .sh-rings { display: flex; gap: 14px; overflow-x: auto; margin: -4px -16px 0; padding: 4px 16px 14px; scrollbar-width: none; scroll-snap-type: x proximity; }
    .sh-rings::-webkit-scrollbar { display: none; }
    .sh-rings[hidden] { display: none; }
    .sh-ring { flex: none; width: 72px; display: grid; justify-items: center; gap: 6px; border: 0; background: none; padding: 0; color: var(--panel-ink); font: inherit; cursor: pointer; scroll-snap-align: start; }
    .sh-ring > small { max-width: 72px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--panel-dim); }
    .sh-ring.live > small { color: var(--panel-ink); font-weight: 600; }
    .sh-asks { display: grid; margin: 0 -16px; border-top: 1px solid var(--hair, var(--rule)); }
    .sh-rings[hidden] + .sh-asks { border-top: 0; margin-top: -14px; }   /* the head's rule is its top */
    .sh-asks > button { display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 0 16px; border: 0; border-bottom: 1px solid var(--hair, var(--rule)); background: none; color: var(--panel-ink); font: inherit; font-weight: 600; text-align: left; cursor: pointer; }
    .sh-asks > button > i { margin-left: auto; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
    .sh-empty { display: grid; justify-items: start; gap: 12px; padding: 28px 0 8px; }
    .sh-empty h3 { margin: 0; padding: 0; border: 0; font: 700 26px var(--font-num); }
    .sh-empty p { margin: 0; color: var(--panel-dim); }
    /* the feed: each post goes edge to edge, its road the picture (Nate: "this is still vetta") */
    #feedBody .feed { margin: 0 -16px; }
    #app #feedBody .feed-card { padding: 14px 16px 8px; border: 0; border-top: 1px solid var(--hair, var(--rule)); border-radius: 0; background: none; }
    #feedBody .feed-pic { margin: 0 -16px; }
    #feedBody .feed-pic .feed-stats { padding: 10px 16px 0; }
    #feedBody .feed > .note { padding: 0 16px; }
    #feedBody .feed-pick { margin: 0 0 6px; }
    #feedBody .feed-more-key { justify-self: center; margin: 8px 0; }
  `;

  /** page: el, btn, avatar(photo_id, handle, px), ring(face, kind) (avatar.js), feed({onRows}) → the full feed's node (drive_posts.js full). */
  function mount(page) {
    const { el, btn } = page, d = root.document;
    if (d && d.head && !d.getElementById('social-home-css')) { const s = d.createElement('style'); s.id = 'social-home-css'; s.textContent = CSS; d.head.append(s); }

    function ringKey(r, o) {
      const face = page.avatar(r.photo_id, r.kind === 'crew' ? r.label : r.handle, 60);
      const b = el('button', { type: 'button', className: `sh-ring ${r.kind}`, 'aria-label': ringLabel(r) },
        page.ring(face, r.kind), el('small', { textContent: r.kind === 'crew' ? r.label : r.handle }));
      b.addEventListener('click', () => {
        if (r.kind === 'live') o.seeOnMap(r.handle);
        else if (r.kind === 'new') o.openPost(r.post);
        else o.openCrew(r.crew);
      });
      return b;
    }

    /**
     * Draws the home into `box`. o: live (friends driving now, ordered), crews, requests (friend requests waiting),
     * hasFriends, and what the keys do: seeOnMap(handle), openPost(id), openCrew(id), openFriends() (the Friends side),
     * invite(). Returns nothing; the feed fills itself.
     */
    function render(box, o) {
      const strip = el('div', { className: 'sh-rings', role: 'list', 'aria-label': 'Today' });
      let posts = [];
      const paintRings = () => {
        const rs = rings(o.live, posts, o.crews);
        strip.replaceChildren(...rs.map((r) => { const k = ringKey(r, o); k.setAttribute('role', 'listitem'); return k; }));
        strip.hidden = !rs.length;
      };
      paintRings();
      box.append(strip);
      // what waits on you stays in sight on the home, one row each, and goes where it is answered
      const asks = el('div', { className: 'sh-asks' });
      if (o.requests > 0) {
        const b = el('button', { type: 'button' }, el('span', { textContent: o.requests === 1 ? '1 friend request' : `${o.requests} friend requests` }), el('i', { 'aria-hidden': 'true' }));
        b.addEventListener('click', () => o.openFriends());
        asks.append(b);
      }
      if (asks.childElementCount) box.append(asks);
      if (!o.hasFriends) {
        // in a crew but no friends yet: the crews' posts still come, and the way to friends is one key
        box.append(el('div', { className: 'sh-empty' }, el('p', { textContent: 'Your friends’ drives land here too.' }), btn('Find friends', () => o.invite(), 'ink-btn')));
      }
      box.append(page.feed({ onRows: (rows) => { if (Array.isArray(rows)) { posts = posts.concat(rows); paintRings(); } } }));
    }

    return { render };
  }

  const api = { rings, ringLabel, mount, MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexSocialHome = api;
})(typeof window !== 'undefined' ? window : globalThis);
