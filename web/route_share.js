// Share a route (the route card's Share): the panel under the card that picks friends and crews and sends the line.
// A Social module (lazy.js social group), loaded on the first Share, so the launch doesn't carry it (startup budget, P-06).
// cockpit.js draws the loading row first and hands in what it knows: o.route (the planned route), o.to (a friend's handle
// picked from their profile), o.geom(route) (the line to send), o.again (Try again), o.findFriends, o.bookPart (the
// roadbook key, or []), and its el, btn, toast, apiCall, jsonOf. Shared states (screen inventory 2026-11-16): no answer is
// one line and Try again, nobody yet is one line and Find friends.
(function (root) {
  'use strict';
  async function open(box, o) {
    const { el, btn, toast, apiCall, jsonOf } = o, t = o.route;
    const ask = (path) => apiCall('GET', path).then((r) => (r && r.ok ? jsonOf(r) : null)).catch(() => null);
    const [friends, crews] = await Promise.all([ask('/api/friends'), ask('/api/crews')]);
    if (!box.isConnected || !box.childElementCount) return;              // closed while it asked
    if (!Array.isArray(friends) && !Array.isArray(crews)) {
      box.replaceChildren(el('div', { className: 'share-lost' }, el('p', { className: 'note', textContent: 'Couldn’t load your friends and crews. Check signal.' }),
        btn('Try again', o.again, 'ink-btn')));
      return;
    }
    const fr = (Array.isArray(friends) ? friends : []).filter(f => f.status === 'accepted' && f.handle), cr = Array.isArray(crews) ? crews : [];
    // the road can also go into one of your roadbooks (roadbooks.js addPart), friends or none
    const bookPart = o.bookPart;
    if (!fr.length && !cr.length) {
      const books = bookPart();                                        // signed in with nobody to send it to yet: the roadbook is the way to keep it
      box.replaceChildren(el('div', { className: 'share-lost' }, el('p', { className: 'note', textContent: 'No friends or crews to send it to yet.' }),
        btn('Find friends', o.findFriends, 'ink-btn')), ...books);
      if (books.length) box.scrollIntoView({ block: 'nearest' });
      return;
    }
    const picked = { friends: new Set(), crews: new Set() };
    if (o.to && fr.some(f => f.handle === o.to)) picked.friends.add(o.to);
    // Nate 2026-11-12 (as easy as a big social app): before Send, one line says who gets it and what goes, and follows the picks
    const goes = el('p', { className: 'note share-goes', 'aria-live': 'polite' });
    const paintGoes = () => {
      const who = [...[...picked.friends].map(h => '@' + h), ...cr.filter(c => picked.crews.has(c.id)).map(c => c.name)];
      const names = who.length > 3 ? `${who.slice(0, 2).join(', ')} and ${who.length - 2} more` : who.length > 1 ? `${who.slice(0, -1).join(', ')} and ${who[who.length - 1]}` : who[0];
      goes.textContent = who.length ? `Goes to ${names}. The line only, first 400 m hidden.` : 'Pick who gets it. The line only, first 400 m hidden.';
    };
    const chip = (label, set, key) => { const b = el('button', { className: 'ink-btn' + (set.has(key) ? ' on' : ''), textContent: label }); b.setAttribute('aria-pressed', String(set.has(key)));
      b.onclick = () => { if (set.has(key)) set.delete(key); else set.add(key); b.classList.toggle('on', set.has(key)); b.setAttribute('aria-pressed', String(set.has(key))); paintGoes(); }; return b; };
    paintGoes();
    box.replaceChildren(el('div', { className: 'row', style: 'flex-wrap:wrap' }, ...fr.map(f => chip('@' + f.handle, picked.friends, f.handle)), ...cr.map(c => chip(c.name, picked.crews, c.id))),
      goes,
      el('div', { className: 'row' }, btn('Send', async () => {
        if (!picked.friends.size && !picked.crews.size) { toast('Pick who to share it with.'); return; }
        const r = await apiCall('POST', '/api/routes', { name: t.name || 'Route', geom: o.geom(t), friends: [...picked.friends], crews: [...picked.crews] });
        const j = await jsonOf(r);
        if (!r.ok) { toast(r.status === 429 ? 'That\'s a lot of shares today.' : 'Couldn\'t share it. Try again.'); return; }
        toast(j && j.shared ? `Shared. They'll find it in Social.` : 'Nobody to share it with.'); box.replaceChildren();
      }, 'ink-btn solid')), ...bookPart());
    box.scrollIntoView({ block: 'nearest' });
  }
  root.ApexRouteShare = { open };
})(typeof window !== 'undefined' ? window : globalThis);
