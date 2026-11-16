// Friend requests (screen inventory 2026-11-16, as Instagram's): the sheet the Requests row on Friends opens: each ask with
// its face, handle, how many friends you share (counted, never named) and Accept / Not now; the last answer closes it.
// A Social module (lazy.js social group), so the launch doesn't carry it (startup budget, P-06). cockpit.js hands in the
// requests (o.incoming), its el, btn, toast, apiCall, onBackdrop, o.face(f, size) and o.done (redraw Friends).
(function (root) {
  'use strict';
  function open(o) {
    const { incoming, el, btn, toast, apiCall, onBackdrop } = o, document = root.document, reqFace = o.face, redo = o.done;
    const answer = async (f, yes) => {
      const r = await (yes ? apiCall('POST', '/api/friends/accept', { user_id: f.id }) : apiCall('DELETE', `/api/friends/${f.id}`)).catch(() => null);
      if (!r || !r.ok) { toast('Couldn’t answer that. Check signal.'); return false; }
      toast(yes ? `You and @${f.handle} are friends.` : `Declined. @${f.handle} isn’t told.`); return true;
    };
    document.querySelectorAll('.req-sheet').forEach((n) => n.remove());
    const ov = el('div', { className: 'overlay dim show req-sheet' }); ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Friend requests');
    let changed = false;
    const close = () => { ov.remove(); if (changed) redo(); };
    onBackdrop(ov, close);
    const left = [...incoming];
    const list = el('div', { className: 'req-list' });
    const paint = () => list.replaceChildren(...left.map((f) => {
      const why = f.mutual ? `${f.mutual} mutual friend${f.mutual === 1 ? '' : 's'}` : f.name || '';
      const keys = el('div', { className: 'req-keys' });
      const go = (yes) => async () => { keys.querySelectorAll('button').forEach((b) => { b.disabled = true; }); if (await answer(f, yes)) { changed = true; left.splice(left.indexOf(f), 1); if (!left.length) close(); else paint(); } else keys.querySelectorAll('button').forEach((b) => { b.disabled = false; }); };
      keys.append(btn('Accept', go(true), 'ink-btn solid'), btn('Not now', go(false), 'ink-btn'));
      return el('div', { className: 'req-item' }, reqFace(f, 44), el('div', { className: 'req-who' }, el('b', { textContent: `@${f.handle || '?'}` }), ...(why ? [el('small', { textContent: why })] : [])), keys);
    }));
    paint();
    ov.append(el('div', { className: 'card-sheet' }, el('div', { className: 'post-head' }, el('h2', { textContent: 'Requests' }), btn('Done', close, 'linkbtn post-not-now')), list));
    document.body.append(ov);
  }
  root.ApexFriendRequests = { open };
})(typeof window !== 'undefined' ? window : globalThis);
