// Send feedback (IDEAS L-05): Settings → Feedback. What you type goes to the owner (POST /api/feedback) with, if you leave
// it ticked, a few diagnostics: the app's version, the kind of device, screen size, language and how many errors this page
// load saw. Never your position, drives or contacts. Your handle only when you're signed in and ask for a reply.
// diagnostics() and payload() are pure (tests/test_feedback.py); mount() draws the form.
(function (root) {
  'use strict';
  const MAX = 2000;

  /** The diagnostics to attach, from what the page can see: env = { ua, w, h, lang, errors, drives, online, page }. */
  function diagnostics(env) {
    const ua = String((env && env.ua) || '');
    const app = ua.match(/ApexNav\/([\w.]+) \((\w+)\)/);
    const platform = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'other';
    const out = { platform };
    if (app) { out.version = app[1]; out.build = app[2]; }
    if (Number.isFinite(env.w) && Number.isFinite(env.h)) out.screen = `${Math.round(env.w)}x${Math.round(env.h)}`;
    if (env.lang) out.lang = String(env.lang).slice(0, 20);
    if (env.page) out.page = String(env.page).slice(0, 40);
    if (Number.isInteger(env.errors) && env.errors >= 0) out.errors_today = env.errors;
    if (Number.isInteger(env.drives) && env.drives >= 0) out.drives = env.drives;
    if (typeof env.online === 'boolean') out.offline = env.online ? 0 : 1;
    return out;
  }

  /** The body to send, or null when there is nothing to send. */
  function payload({ kind, message, app, attach, reply, env }) {
    const text = String(message || '').trim().slice(0, MAX);
    if (!text) return null;
    return { kind: ['bug', 'idea', 'other'].includes(kind) ? kind : 'other', message: text, app: app === 'ios' ? 'ios' : 'web',
             ...(attach ? { diag: diagnostics(env || {}) } : {}), ...(reply ? { reply: true } : {}) };
  }

  /** page: el, btn, toast, apiFetch, app ('ios'|'web'), signedIn() → bool, env() → diagnostics env. */
  function mount(box, page) {
    const { el, btn, toast } = page;
    let kind = 'bug';
    const chips = el('div', { className: 'row', style: 'flex-wrap:wrap' });
    chips.setAttribute('role', 'radiogroup'); chips.setAttribute('aria-label', 'Kind of feedback');
    const paint = () => chips.replaceChildren(...[['bug', 'Something’s wrong'], ['idea', 'An idea'], ['other', 'Something else']].map(([k, label]) => {
      const b = btn(label, () => { kind = k; paint(); }, 'chip' + (kind === k ? ' on' : ''));
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(kind === k));
      return b;
    }));
    paint();
    const text = el('textarea', { className: 'field', maxLength: MAX, rows: 4, placeholder: 'What happened, or what would make it better?', style: 'width:100%;box-sizing:border-box' });
    text.setAttribute('aria-label', 'Your feedback');
    const tick = (label, on) => { const i = el('input', { type: 'checkbox', checked: on }); return [i, el('label', { className: 'note', style: 'display:flex;gap:8px;align-items:center' }, i, label)]; };
    const [attach, attachRow] = tick('Attach diagnostics: app version, device type, screen size, language, error count. Never your position or drives.', true);
    const [reply, replyRow] = tick('I’d like a reply (shares your handle with the owner)', false);
    const send = btn('Send', async () => {
      const body = payload({ kind, message: text.value, app: page.app, attach: attach.checked, reply: reply.checked && page.signedIn(), env: page.env() });
      if (!body) { toast('Write something first.'); return; }
      send.disabled = true;
      let r = null;
      try { r = await page.apiFetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); } catch (_) {}
      send.disabled = false;
      if (r && r.ok) { text.value = ''; toast('Thanks. Sent to the owner.'); }
      else toast(r && r.status === 429 ? 'Too much feedback today. Try again tomorrow.' : 'Couldn’t send it. Check signal and try again.');
    }, 'ink-btn solid');
    const refresh = () => { replyRow.hidden = !page.signedIn(); };
    box.replaceChildren(chips, text, attachRow, replyRow, el('div', { className: 'row' }, send));
    refresh();
    return { refresh };
  }

  /** Owner: the open feedback, newest first, as text, with Done. */
  function ownerSection(page) {
    const { el, btn } = page;
    const sec = el('div', { className: 'stack-8' }, el('h3', { textContent: 'Feedback' }));
    const load = () => page.apiCall('GET', '/api/ops/feedback').then(page.jsonOf).then((rows) => {
      sec.replaceChildren(sec.firstChild);
      if (!Array.isArray(rows)) { sec.append(el('p', { className: 'note', textContent: 'Couldn’t load feedback.' })); return; }
      const open = rows.filter((f) => !f.done);
      if (!open.length) { sec.append(el('p', { className: 'note', textContent: 'No open feedback.' })); return; }
      for (const f of open) {
        const d = f.diag ? Object.entries(f.diag).map(([k, v]) => `${k} ${v}`).join(', ') : 'no diagnostics';
        sec.append(el('div', { className: 'stack-8', style: 'border:1px solid var(--rule);padding:10px' },
          el('b', { textContent: `${f.kind} · ${f.app} · ${f.created_at}${f.handle ? ` · @${f.handle}` : ''}` }),
          el('p', { className: 'note', textContent: f.message, style: 'white-space:pre-wrap' }),
          el('p', { className: 'note', textContent: d }),
          btn('Done', async () => { await page.apiCall('POST', `/api/ops/feedback/${f.id}/done`); load(); }, 'linkbtn')));
      }
    }).catch(() => sec.append(el('p', { className: 'note', textContent: 'Couldn’t load feedback.' })));
    load();
    return sec;
  }

  const api = { diagnostics, payload, mount, ownerSection, MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexFeedback = api;
})(typeof window !== 'undefined' ? window : globalThis);
