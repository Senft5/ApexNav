// Build threads (docs/design/REVIEW.md 5.3, roadmap 23, mockup docs/design/10-build-thread.html): a car's build told
// over time. The car header (its cover, the name, the owner's spec line, followers), the stage bar as the table of
// contents, numbered steps on a timeline rule (text, photos, parts as stamps, the Vetta Score of the drive it was tested
// on when the owner picks one from the Log), replies on an ink rule and suggestions on a red rule, which the owner answers
// with "Tried it". The compose bar replies to the newest step, or the one you chose. backend/src/builds.ts. Everything
// people typed is set as text. The pure helpers (stageBar, partsOf, carName) are tested in tests/test_builds.py.
(function (root) {
  'use strict';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** The stage bar: how many stages, how far the posts reached (the highest stage posted), and its label. */
  function stageBar(stages, posts) {
    const n = Array.isArray(stages) ? stages.length : 0;
    const reached = (posts || []).reduce((m, p) => (Number.isInteger(p.stage) && p.stage < n ? Math.max(m, p.stage + 1) : m), 0);
    return { n, reached, label: n ? (reached ? `Stage ${reached} of ${n} · ${stages[reached - 1]}` : `${n} stages planned`) : '' };
  }
  /** Parts typed as one line ("Ohlins DFV R&T, 7k / 5k springs") as a list: trimmed, no empties, at most 12 of 40 chars. */
  function partsOf(line) {
    return String(line || '').split(/[,\n]/).map((s) => s.trim().slice(0, 40)).filter(Boolean).slice(0, 12);
  }
  /** "Nate's NB Miata" when the car has a nickname, else "2004 Mazda Miata". */
  function carName(c) {
    if (!c) return '';
    if (c.nickname) return c.nickname;
    return [c.year, c.make, c.model].filter(Boolean).join(' ');
  }
  /** "Oct 27" from D1's 'YYYY-MM-DD HH:MM:SS'. */
  function day(at) {
    const t = Date.parse(String(at || '').replace(' ', 'T') + 'Z');
    if (!Number.isFinite(t)) return '';
    const d = new Date(t);
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  }

  const STYLE = `
    .build-view { padding: 0 env(safe-area-inset-right) calc(84px + env(safe-area-inset-bottom)) env(safe-area-inset-left); }
    .bv-top { position: sticky; top: 0; z-index: 2; display: flex; justify-content: space-between; align-items: center; padding: calc(10px + env(safe-area-inset-top)) 16px 10px; margin: 0 calc(-1 * env(safe-area-inset-right)) 0 calc(-1 * env(safe-area-inset-left)); padding-left: calc(16px + env(safe-area-inset-left)); padding-right: calc(16px + env(safe-area-inset-right)); background: var(--panel); border-bottom: 2px solid var(--panel-ink); }
    .bv-head { display: grid; grid-template-columns: 96px 1fr; gap: 14px; padding: 14px 16px; align-items: center; }
    .bv-head h2 { margin: 0; font-size: 26px; line-height: 1.1; overflow-wrap: anywhere; }
    .bv-head .spec { color: var(--panel-dim); margin: 4px 0 0; overflow-wrap: anywhere; }
    .bv-head .who { font-weight: 600; margin: 4px 0 0; }
    .bv-car { width: 96px; height: 64px; display: grid; place-items: center; overflow: hidden; }
    .bv-car img { width: 100%; height: 100%; object-fit: cover; }
    .bv-cover { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block; }
    .bv-stages { display: flex; align-items: center; gap: 8px; padding: 14px 16px; }
    .bv-stages i { flex: 1; height: 6px; background: var(--panel-dim); opacity: 0.3; } .bv-stages i.on { background: var(--panel-ink); opacity: 1; }
    .bv-stages span { flex: none; color: var(--panel-dim); font-size: 14px; margin-left: 6px; }
    .bv-posts { padding: 0 16px; }
    .bv-post { position: relative; display: grid; grid-template-columns: 40px 1fr; gap: 12px; padding-bottom: 22px; }
    .bv-post::before { content: ""; position: absolute; left: 19px; top: 40px; bottom: 0; width: 2px; background: var(--panel-dim); opacity: 0.35; }
    .bv-n { width: 40px; height: 40px; border: 2px solid var(--panel-ink); border-radius: 50%; display: grid; place-items: center; font-family: var(--font-num); font-size: 18px; background: var(--panel); }
    .bv-post h3 { margin: 4px 0 0; font-size: 20px; border: 0; padding: 0; overflow-wrap: anywhere; }
    .bv-post .date { color: var(--panel-dim); font-size: 14px; }
    .bv-post p, .bv-reply p { white-space: pre-wrap; overflow-wrap: anywhere; margin: 6px 0; color: var(--panel-ink); }
    .bv-photos { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 6px 0; }
    .bv-photos img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; }
    .bv-parts { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; }
    .bv-parts span { border: 1.5px solid var(--rule); padding: 2px 8px; color: var(--panel-dim); font-size: 14px; }
    .bv-post .bv-score { font-weight: 600; font-family: var(--font-num); }
    .bv-reply { border-left: 3px solid var(--panel-ink); padding: 4px 0 4px 10px; margin: 8px 0; }
    .bv-reply.sugg { border-left-color: var(--accent); }
    .bv-reply .row { gap: 10px; align-items: baseline; flex-wrap: wrap; }
    .bv-reply .tried { margin: 4px 0 0; font-weight: 600; }
    .bv-say { position: fixed; left: 0; right: 0; bottom: 0; z-index: 3; display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: center;
      padding: 10px calc(16px + env(safe-area-inset-right)) calc(10px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left)); background: var(--panel); border-top: 2px solid var(--panel-ink); }
    .bv-say .to { grid-column: 1 / -1; font-size: 13px; color: var(--panel-dim); }
    .bv-chat { margin: 0 16px 16px; border-top: 2px solid var(--panel-ink); padding-top: 10px; }
    .bv-chat summary { cursor: pointer; padding: 6px 0; }
    .bv-form { display: grid; gap: 8px; padding: 0 16px 16px; }
    .bv-list button { display: grid; grid-template-columns: 56px 1fr auto; gap: 10px; align-items: center; width: 100%; text-align: left; padding: 8px 0; border: 0; border-top: 1px solid var(--rule); background: none; color: inherit; }
    .bv-list .thumb { width: 56px; height: 40px; background: var(--panel-dim); overflow: hidden; } .bv-list .thumb img { width: 100%; height: 100%; object-fit: cover; }
    .bv-list small { display: block; color: var(--panel-dim); }
    .bv-list em { font-style: normal; font-weight: 600; }
  `;
  // A drawn car for a build without a cover photo (never a stock photograph).
  function carSvg(d) {
    const svg = d.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 96 48'); svg.setAttribute('width', '96'); svg.setAttribute('height', '48'); svg.setAttribute('aria-hidden', 'true');
    const add = (tag, a) => { const n = d.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in a) n.setAttribute(k, a[k]); svg.append(n); };
    add('path', { d: 'M6 34 C8 24 22 22 30 20 C38 13 54 12 64 19 C76 20 88 24 90 34 Z', fill: 'var(--accent)' });
    add('path', { d: 'M34 20 C40 15 52 15 60 20 Z', fill: 'var(--panel-ink)', opacity: '0.55' });
    for (const x of [24, 72]) { add('circle', { cx: x, cy: 35, r: 7, fill: 'var(--panel-ink)' }); add('circle', { cx: x, cy: 35, r: 2.5, fill: 'var(--panel)' }); }
    return svg;
  }

  function mount(page) {
    const { el, btn, toast, apiCall, jsonOf } = page;
    const P = () => root.ApexPhotos, d = root.document;
    if (!d.getElementById('buildsStyle')) d.head.append(el('style', { id: 'buildsStyle', textContent: STYLE }));
    const call = (m, p, b) => apiCall(m, p, b).catch(() => null);

    // Your Log's drives with a Vetta Score, newest first, for "Tested on a drive" (scores stay as the Log computed them).
    async function scoredDrives() {
      const R = root.ApexRecording, C = root.ApexCore;
      if (!R || !C) return [];
      const all = (await R.all().catch(() => [])).map((x) => { try { return R.repair(C, x); } catch (_) { return null; } }).filter(Boolean);
      return all.map((x) => {
        let s = null;
        try { const ds = C.driverScore(x.speed_mps, x.lon_g, x.lat_g, R.scorableCorners(x, R.cornersOf(x))); s = Number.isFinite(ds.score) ? Math.round(ds.score) : null; } catch (_) {}
        return { name: x.name || 'Drive', date: x.date, score: s };
      }).filter((x) => x.score != null).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 20);
    }

    function open(id, { onClose } = {}) {
      const ov = el('div', { className: 'overlay show build-view' });
      ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Build thread');
      const close = () => { ov.remove(); if (onClose) onClose(); };
      let replyTo = null;
      const draw = async () => {
        const r = await call('GET', `/api/builds/${encodeURIComponent(id)}`);
        const b = r && r.ok ? await r.json() : null;
        const top = el('div', { className: 'bv-top' }, btn('‹ Back', close, 'linkbtn'));
        if (!b) { ov.replaceChildren(top, el('p', { className: 'note', style: 'padding:16px', textContent: 'Couldn’t load the build. Check signal.' })); return; }
        if (b.mine) top.append(btn('Stages', () => editStages(b, draw), 'linkbtn'));
        else {
          const f = btn(b.following ? 'Following' : 'Follow', async () => {
            const x = await call(b.following ? 'DELETE' : 'PUT', `/api/builds/${encodeURIComponent(id)}/follow`);
            if (x && x.ok) {
              // in the app: may it notify about new steps (ApexBuildNotifier.swift)? asked now, when it means something
              const native = root.webkit && root.webkit.messageHandlers && root.webkit.messageHandlers.apex;
              if (!b.following && native) { try { native.postMessage({ cmd: 'notifyBuilds' }); } catch (_) {} }
              draw();
            } else toast('Couldn’t change that. Try again.');
          }, b.following ? 'ink-btn solid' : 'ink-btn');
          f.setAttribute('aria-pressed', String(!!b.following));
          top.append(f);
        }
        const name = carName(b), spec = [b.trim, b.mods].filter(Boolean).join(' · ');
        const pic = el('div', { className: 'bv-car' }, carSvg(d));
        const head = el('div', { className: 'bv-head' }, pic, el('div', {}, el('h2', { textContent: name }),
          spec ? el('p', { className: 'spec', textContent: spec }) : '',
          el('p', { className: 'who', textContent: `@${b.handle || '?'} · ${b.followers} follower${b.followers === 1 ? '' : 's'}` })));
        const cover = b.cover_photo_id && P() ? P().img(b.cover_photo_id, 'bv-cover', `${name}, the cover photo`) : null;
        const sb = stageBar(b.stages, b.posts), bar = el('div', { className: 'bv-stages' });
        if (sb.n) {
          for (let i = 0; i < sb.n; i++) { const seg = el('i', { className: i < sb.reached ? 'on' : '', title: b.stages[i] }); bar.append(seg); }
          bar.append(el('span', { textContent: sb.label }));
          bar.setAttribute('role', 'img'); bar.setAttribute('aria-label', sb.label);
        }
        const posts = el('div', { className: 'bv-posts' });
        if (b.mine) posts.append(el('div', { className: 'row', style: 'margin-bottom:14px' }, btn('Add a step', () => postForm(b, draw), 'ink-btn solid')));
        if (!b.posts.length) posts.append(el('p', { className: 'note', textContent: b.mine ? 'The first step starts the story: what you did, the parts, a photo.' : 'Nothing posted yet.' }));
        for (const p of b.posts) posts.append(postEl(b, p, draw, (target) => { replyTo = target; paintSay(); input.focus(); }));
        // the compose bar: a reply, or a suggestion, to the newest step or the one you chose
        const input = el('input', { className: 'field', maxLength: 1000, placeholder: b.mine ? 'Reply' : 'Reply, or suggest something', autocomplete: 'off' });
        input.setAttribute('aria-label', 'Reply or suggestion');
        const sugg = btn('Suggestion', () => { sugg.classList.toggle('on'); sugg.setAttribute('aria-pressed', String(sugg.classList.contains('on'))); }, 'ink-btn');
        sugg.setAttribute('aria-pressed', 'false');
        const to = el('span', { className: 'to' });
        const paintSay = () => { const p = replyTo || b.posts[0]; to.textContent = p ? `To ${p.n}. ${p.title}` : ''; };
        const send = btn('Post', async () => {
          const p = replyTo || b.posts[0], text = input.value.trim();
          if (!p || !text) return;
          send.disabled = true;
          const x = await call('POST', `/api/builds/posts/${encodeURIComponent(p.id)}/replies`, { body: text, suggestion: sugg.classList.contains('on') });
          send.disabled = false;
          if (x && x.ok) { input.value = ''; replyTo = null; draw(); }
          else toast(x && x.status === 429 ? 'That’s a lot of replies. Wait a while.' : 'Couldn’t post. Check signal.');
        }, 'ink-btn solid');
        paintSay();
        const say = b.posts.length && !b.mine ? el('div', { className: 'bv-say' }, to, input, sugg, send) : (b.posts.length ? el('div', { className: 'bv-say' }, to, input, el('span'), send) : '');
        ov.replaceChildren(top, ...(cover ? [cover] : []), head, bar, posts, chatSection(b), say);
      };
      d.body.append(ov);
      draw();
      return close;
    }

    // The thread's chat (REVIEW.md 5.3): the back and forth that doesn't belong in the log, kept 30 days; folded away.
    function chatSection(b) {
      const list = el('div'), box = el('details', { className: 'bv-chat' }, el('summary', {}, el('b', { textContent: 'Chat' }), el('span', { className: 'note', textContent: ' \u00b7 kept 30 days' })), list);
      list.setAttribute('aria-live', 'polite');
      const fill = async () => {
        const r = await call('GET', `/api/builds/${encodeURIComponent(b.id)}/chat`);
        const msgs = r && r.ok ? await r.json() : null;
        if (!msgs) { list.replaceChildren(el('p', { className: 'note', textContent: 'Couldn\u2019t load the chat. Check signal.' })); return; }
        list.replaceChildren(...(msgs.length ? msgs.map((m) => {
          const acts = [];
          if (m.mine || b.mine) acts.push(btn('Delete', async () => { const x = await call('DELETE', `/api/builds/${encodeURIComponent(b.id)}/chat/${encodeURIComponent(m.id)}`); if (x && x.ok) fill(); }, 'linkbtn'));
          if (!m.mine && page.report) acts.push(btn('Report', () => page.report({ kind: 'build_chat', target: m.id, label: `a message from @${m.handle}`, who: m.handle, done: fill }), 'linkbtn'));
          return el('div', { className: 'bv-reply' }, el('div', { className: 'row' }, el('b', { textContent: `@${m.handle || '?'}` }), el('span', { className: 'note', textContent: day(m.created_at) }), ...acts), el('p', { textContent: m.body }));
        }) : [el('p', { className: 'note', textContent: 'Nothing said yet.' })]), sayRow);
      };
      const input = el('input', { className: 'field', maxLength: 500, placeholder: 'Say something', autocomplete: 'off' });
      input.setAttribute('aria-label', 'Chat message');
      const send = btn('Send', async () => {
        const t = input.value.trim(); if (!t) return;
        const x = await call('POST', `/api/builds/${encodeURIComponent(b.id)}/chat`, { body: t });
        if (x && x.ok) { input.value = ''; fill(); } else toast(x && x.status === 429 ? 'That\u2019s a lot of messages. Wait a while.' : 'Couldn\u2019t send. Check signal.');
      }, 'ink-btn');
      const sayRow = el('div', { className: 'row', style: 'margin-top:8px' }, input, send);
      box.addEventListener('toggle', () => { if (box.open) fill(); });
      return box;
    }

    function postEl(b, p, redo, replyHere) {
      const body = el('div', { style: 'min-width:0' }, el('h3', { textContent: p.title }),
        el('span', { className: 'date', textContent: [day(p.created_at), Number.isInteger(p.stage) && b.stages[p.stage] ? b.stages[p.stage] : ''].filter(Boolean).join(' · ') }));
      if (p.body) body.append(el('p', { textContent: p.body }));
      if (p.photos && p.photos.length && P()) {
        const grid = el('div', { className: 'bv-photos' });
        for (const id of p.photos) {
          const im = P().img(id, '', `Photo for step ${p.n}`); im.tabIndex = 0;
          im.addEventListener('click', () => P().view(id, b.mine ? [['Remove', async () => { if (await P().remove(id)) redo(); }]]
            : (page.report ? [['Report', () => page.report({ kind: 'photo', target: id, label: `a photo on ${carName(b)}'s build`, done: redo })]] : [])));
          grid.append(im);
        }
        body.append(grid);
      }
      if (p.parts && p.parts.length) body.append(el('div', { className: 'bv-parts' }, ...p.parts.map((t) => el('span', { textContent: t }))));
      if (Number.isInteger(p.score)) body.append(el('p', { className: 'bv-score', textContent: `Tested on a drive: Vetta Score ${p.score}` }));
      const acts = el('div', { className: 'row', style: 'gap:12px;flex-wrap:wrap' });
      if (!b.mine) acts.append(btn('Reply here', () => replyHere(p), 'linkbtn'));
      if (b.mine) {
        if (P() && (p.photos || []).length < 8) acts.append(P().picker('Add a photo', 'post', p.id, redo, { toast }));
        acts.append(btn('Delete step', async () => {
          if (!(await ApexConfirm.ask(`Delete step ${p.n}, its photos and replies?`, 'Delete'))) return;
          const x = await call('DELETE', `/api/builds/posts/${encodeURIComponent(p.id)}`); if (x && x.ok) redo(); else toast('Couldn’t delete it. Try again.');
        }, 'linkbtn'));
      } else if (page.report) acts.append(btn('Report', () => page.report({ kind: 'post', target: p.id, label: `step ${p.n} of ${carName(b)}'s build`, who: b.handle, done: redo }), 'linkbtn'));
      body.append(acts);
      for (const r of p.replies || []) body.append(replyEl(b, r, redo));
      return el('div', { className: 'bv-post' }, el('span', { className: 'bv-n', textContent: String(p.n) }), body);
    }

    const plain = (s) => (root.ApexFormat && root.ApexFormat.noEmoji ? root.ApexFormat.noEmoji(s) : s);   // replies render emoji as text: none (REVIEW.md "Not doing")
    function replyEl(b, r, redo) {
      const box = el('div', { className: 'bv-reply' + (r.suggestion ? ' sugg' : '') });
      const acts = [];
      if (r.mine || b.mine) acts.push(btn('Delete', async () => {
        if (!(await ApexConfirm.ask('Delete this reply?', 'Delete'))) return;
        const x = await call('DELETE', `/api/builds/replies/${encodeURIComponent(r.id)}`); if (x && x.ok) redo(); else toast('Couldn’t delete it. Try again.');
      }, 'linkbtn'));
      if (!r.mine && page.report) acts.push(btn('Report', () => page.report({ kind: 'reply', target: r.id, label: `a reply from @${r.handle}`, who: r.handle, done: redo }), 'linkbtn'));
      if (r.suggestion && b.mine) acts.push(btn(r.tried ? 'Change result' : 'Tried it', async () => {
        const res = await ApexConfirm.prompt('What happened when you tried it?', { action: 'Save', value: r.tried || '', maxLength: 200 });
        if (res === null) return;
        call('PUT', `/api/builds/replies/${encodeURIComponent(r.id)}/tried`, { tried: res.trim() || null }).then((x) => { if (x && x.ok) redo(); else toast('Couldn’t save that. Try again.'); });
      }, 'linkbtn'));
      // what was said, then what you can do about it
      box.append(el('div', { className: 'row' }, el('b', { textContent: `@${r.handle || '?'}` }), el('span', { className: 'note', textContent: [r.suggestion ? 'Suggestion' : '', day(r.created_at)].filter(Boolean).join(' · ') })),
        el('p', { textContent: plain(r.body) }), ...(acts.length ? [el('div', { className: 'row' }, ...acts)] : []));
      if (r.tried) box.append(el('p', { className: 'tried', textContent: `Tried it: ${r.tried}` }));
      return box;
    }

    function sheet(title, kids) {
      const ov = el('div', { className: 'overlay show build-view' });
      ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', title);
      const close = () => ov.remove();
      ov.append(el('div', { className: 'bv-top' }, btn('Cancel', close, 'linkbtn'), el('b', { textContent: title }), el('span')), el('div', { className: 'bv-form' }, ...kids(close)));
      d.body.append(ov);
      return close;
    }

    function postForm(b, redo) {
      const title = el('input', { className: 'field', maxLength: 80, placeholder: 'What you did, like Coilovers in', autocomplete: 'off' });
      const stage = el('select', { className: 'field' }, el('option', { value: '', textContent: 'No stage' }), ...b.stages.map((s, i) => el('option', { value: String(i), textContent: s })));
      const text = el('textarea', { className: 'field', maxLength: 4000, rows: 5, placeholder: 'How it went' });
      const parts = el('input', { className: 'field', maxLength: 500, placeholder: 'Parts, separated by commas', autocomplete: 'off' });
      const drive = el('select', { className: 'field' }, el('option', { value: '', textContent: 'Not tested on a drive yet' }));
      title.setAttribute('aria-label', 'Step title'); stage.setAttribute('aria-label', 'Stage'); text.setAttribute('aria-label', 'Step text'); parts.setAttribute('aria-label', 'Parts'); drive.setAttribute('aria-label', 'Tested on a drive');
      scoredDrives().then((list) => drive.append(...list.map((x) => el('option', { value: String(x.score), textContent: `${x.name} · Vetta Score ${x.score}` }))));
      sheet('Add a step', (close) => [title, stage, text, parts, el('b', { textContent: 'Tested on a drive (your Log)' }), drive,
        el('p', { className: 'note', textContent: 'Add photos to the step once it’s posted. Photos lose their location data before they leave your phone.' }),
        el('div', { className: 'row' }, btn('Post the step', async () => {
          if (!title.value.trim()) { toast('Give the step a title.'); return; }
          const x = await call('POST', `/api/builds/${encodeURIComponent(b.id)}/posts`, { title: title.value.trim(), body: text.value.trim() || null,
            stage: stage.value === '' ? null : Number(stage.value), parts: partsOf(parts.value), score: drive.value === '' ? null : Number(drive.value) });
          if (x && x.ok) { close(); redo(); } else toast('Couldn’t post the step. Check signal.');
        }, 'ink-btn solid'))]);
      if (root.ApexRowSelect) { root.ApexRowSelect.enhance(stage); root.ApexRowSelect.enhance(drive); }   // the app's row lists, now that they are on the sheet
      title.focus();
    }

    function stagesField(initial) {
      const list = [...initial], box = el('div', { className: 'stack-8' });
      const input = el('input', { className: 'field', maxLength: 24, placeholder: 'A stage, like Suspension', autocomplete: 'off' });
      input.setAttribute('aria-label', 'New stage');
      const paint = () => box.replaceChildren(...list.map((s, i) => el('div', { className: 'row', style: 'align-items:baseline;justify-content:space-between' },
        el('span', { textContent: `${i + 1}. ${s}` }), btn('Remove', () => { list.splice(i, 1); paint(); }, 'linkbtn'))));
      paint();
      const add = btn('Add', () => { const s = input.value.trim(); if (!s) return; if (list.length >= 8) { toast('Eight stages at most.'); return; } list.push(s); input.value = ''; paint(); }, 'ink-btn');
      return { list, el: el('div', { className: 'stack-8' }, box, el('div', { className: 'row' }, input, add)) };
    }

    function editStages(b, redo) {
      const f = stagesField(b.stages);
      sheet('Stages', (close) => [el('p', { className: 'note', textContent: 'The thread’s table of contents, in the order you’ll do them.' }), f.el,
        el('div', { className: 'row' }, btn('Save', async () => {
          const x = await call('PUT', `/api/builds/${encodeURIComponent(b.id)}`, { stages: f.list });
          if (x && x.ok) { close(); redo(); } else toast('Couldn’t save the stages. Try again.');
        }, 'ink-btn solid'))]);
    }

    /** Starts a build thread for one of your cars, then opens it. */
    function start(car, done) {
      const f = stagesField([]);
      sheet('Start a build thread', (close) => [el('b', { textContent: carName(car) }),
        el('p', { className: 'note', textContent: 'Name the stages you plan (Suspension, Brakes, Power). You can change them later.' }), f.el,
        el('div', { className: 'row' }, btn('Start the thread', async () => {
          const x = await call('POST', '/api/builds', { car_id: car.id, stages: f.list });
          const j = x && x.ok ? await jsonOf(x) : null;
          if (!j || !j.id) { toast(x && x.status === 409 ? 'That car has a build thread already.' : 'Couldn’t start it. Check signal.'); return; }
          close(); if (done) done(j.id); open(j.id);
        }, 'ink-btn solid'))]);
    }

    /** A list of builds as rows (the crew page's Builds row, Builds you follow). */
    function rows(list, onOpen) {
      const box = el('div', { className: 'bv-list' });
      for (const b of list) {
        const thumb = el('span', { className: 'thumb' });
        if (b.cover_photo_id && P()) thumb.append(P().img(b.cover_photo_id, '', ''));
        const sub = [`@${b.handle || '?'}`, Number.isFinite(b.posts) ? `${b.posts} step${b.posts === 1 ? '' : 's'}` : '', b.last ? `last ${day(b.last)}` : ''].filter(Boolean).join(' · ');
        const right = b.new_posts > 0 ? el('em', { textContent: `${b.new_posts} new` }) : el('span');
        const row = el('button', { type: 'button' }, thumb, el('span', {}, el('b', { textContent: carName(b) }), el('small', { textContent: sub })), right);
        row.addEventListener('click', () => open(b.id, { onClose: onOpen }));
        box.append(row);
      }
      return box;
    }

    /** "Builds you follow" for the Garage: nothing at all when you follow none. */
    function followingSection() {
      const sec = el('div', { className: 'stack-8' });
      const fill = async () => {
        const x = await call('GET', '/api/builds/following');
        const list = x && x.ok ? await x.json() : [];
        sec.replaceChildren(...(list.length ? [el('h3', { textContent: 'Builds you follow' }), rows(list, fill)] : []));
      };
      fill();
      return sec;
    }

    return { open, start, rows, followingSection };
  }

  const api = { mount, stageBar, partsOf, carName, day };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexBuilds = api;
})(typeof window !== 'undefined' ? window : globalThis);
