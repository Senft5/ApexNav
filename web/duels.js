// Duels (docs/SOCIAL.md 2.7; backend/src/duels.ts): you challenge a friend on one of your stages for 3, 7 or 14 days, and
// the higher Vetta Score on it wins: the Score is how well the corners were driven, so a duel is won by driving better.
// Each side's quickest time there and the gap are shown beside it where that side shares times with the other (the
// owner, 2026-11-10: share stage times and gaps). A duel reads only the Scores each of you already shows the
// other, and its card says plainly when one side's don't reach the other yet. card() and daysLeft() are pure
// (tests/test_duels.py); mount() draws the cards on People → Friends and the Challenge sheet.
(function (root) {
  'use strict';
  const DAYS = [3, 7, 14];
  const dayMs = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };

  /** Days left in a duel, counting today (the last day is 1), or null. */
  function daysLeft(d) {
    const a = dayMs(d && d.today), b = dayMs(d && d.ends_on);
    return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) + 1 : null;
  }
  /** 184 → "3:04". */
  function clock(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '--';
    const x = Math.round(sec), h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), s = String(x % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }
  const quick = (sec) => (sec < 60 ? `${Math.round(sec)} s` : clock(sec));
  /** "Times: you 3:04, @sam 3:10 · you're 6 s quicker" from what each side shares; '' when neither shares a time. */
  function timesLine(who, a, b) {
    const ta = a && a.time_s != null ? a.time_s : null, tb = b && b.time_s != null ? b.time_s : null;
    if (ta == null && tb == null) return '';
    const parts = [ta != null ? `you ${clock(ta)}` : '', tb != null ? `${who} ${clock(tb)}` : ''].filter(Boolean).join(', ');
    const g = ta != null && tb != null ? (ta === tb ? ' \u00b7 the same time' : ta < tb ? ` \u00b7 you're ${quick(tb - ta)} quicker` : ` \u00b7 ${who} is ${quick(ta - tb)} quicker`) : '';
    return `Times: ${parts}${g}`;
  }
  /** In a time duel, the Scores beside the times: "Scores: you 845, @sam 812". */
  function scoresLine(who, a, b) {
    const sa = a && a.score != null ? a.score : null, sb = b && b.score != null ? b.score : null;
    if (sa == null && sb == null) return '';
    return `Scores: ${[sa != null ? `you ${sa}` : '', sb != null ? `${who} ${sb}` : ''].filter(Boolean).join(', ')}`;
  }
  const left = (n) => (n == null ? '' : n <= 1 ? 'last day' : `${n} days left`);

  /**
   * What a duel's card says. d: a row of GET /api/duels. → { kind, head, line, note, keys: ['accept'|'decline'|'withdraw'|'share'|'rematch'|'drive'] }.
   * kind: 'ask' (waiting on you), 'sent' (waiting on them), 'on', 'won', 'lost', 'draw', 'none' (nobody scored), 'closed'.
   */
  function card(d) {
    const who = `@${d.with || '?'}`, timed = d.kind === 'time';
    const rule = timed ? 'The quicker time on it wins.' : 'The higher Vetta Score on it wins.';
    if (d.status === 'pending') return d.challenger
      ? { kind: 'sent', head: `You challenged ${who}${timed ? ' to a time duel' : ''}`, line: `${d.stage} · ${d.days} days, from when they say yes`, note: '', keys: ['withdraw'] }
      : { kind: 'ask', head: `${who} challenged you${timed ? ' to a time duel' : ''}`, line: `${d.stage} · ${d.days} days. ${rule}`, note: timed ? 'Your times reach them only if you share times with them.' : '', keys: ['accept', 'decline'] };
    if (d.status === 'declined' || d.status === 'withdrawn') {
      const by = d.status === 'declined' ? (d.challenger ? `${who} said no thanks` : 'You said no thanks') : 'Taken back';
      return { kind: 'closed', head: `${d.stage} with ${who}`, line: by, note: '', keys: [] };
    }
    // what decides: a Score (higher wins) or a time (lower wins); null when that side has none that reaches the other
    const val = (x) => (!x ? null : timed ? (x.time_s != null ? x.time_s : null) : x.score);
    const you = val(d.you), them = val(d.them);
    const show = (v) => (v == null ? '--' : timed ? clock(v) : String(v));
    const by = (n) => (timed ? quick(n) : String(n));
    const ahead = (x, y) => (timed ? x < y : x > y);
    const score = `You ${show(you)} · ${who} ${show(them)}`;
    // what may be missing: yours not shown to them, theirs not to you
    const what = timed ? 'times' : 'Scores';
    const gaps = [];
    if (!d.you_share) gaps.push(`Your ${what} don't reach ${who} yet, so they can't see yours.`);
    if (!d.they_share) gaps.push(`${who}'s ${what} don't reach you yet; theirs show once they share them with you.`);
    // a Score duel shows times beside it; a time duel shows the Scores beside it
    const aside = timed ? scoresLine(who, d.you, d.them) : timesLine(who, d.you, d.them);
    if (d.status === 'on') {
      const n = daysLeft(d), lead = you != null && them != null ? (ahead(you, them) ? `You lead by ${by(Math.abs(you - them))}` : ahead(them, you) ? `${who} leads by ${by(Math.abs(you - them))}` : 'Level') : you == null && them == null ? 'No runs yet' : you == null ? `${who} has a run in` : 'You have a run in';
      return { kind: 'on', head: `${d.stage} · ${who}`, line: `${score} · ${lead} · ${left(n)}`, note: [aside, ...gaps].filter(Boolean).join(' '), keys: [...(d.you_share ? [] : ['share']), ...(d.have_stage ? ['drive'] : []), 'withdraw'] };
    }
    // over
    const kind = you == null && them == null ? 'none' : them == null || (you != null && ahead(you, them)) ? 'won' : you == null || ahead(them, you) ? 'lost' : 'draw';
    const diff = you != null && them != null ? ` by ${by(Math.abs(you - them))}` : '';
    const line = { won: `You won${diff}`, lost: `${who} won${diff}`, draw: `A draw at ${show(you)}`, none: 'Neither of you drove it' }[kind];
    return { kind, head: `${d.stage} · ${who}`, line: `${line} · ${score}`, note: aside, keys: ['rematch'] };
  }

  /** Cards worth a place on People: anything waiting or on, and a result for 3 days after it ends. Asks first. */
  function shown(list) {
    const order = { ask: 0, on: 1, sent: 2, won: 3, lost: 3, draw: 3, none: 3 };
    return (Array.isArray(list) ? list : []).map((d) => ({ d, c: card(d) }))
      .filter(({ d, c }) => c.kind !== 'closed' && (d.status !== 'over' || (daysLeft(d) ?? -99) >= -2))
      .sort((a, b) => order[a.c.kind] - order[b.c.kind]);
  }

  const STYLE = `
    .duel-cards { display: grid; gap: 10px; }
    .duel-card { border: 1.5px solid var(--panel-ink); padding: 12px; display: grid; gap: 6px; }
    .duel-card.ask { border-color: var(--accent); } .duel-card.won .duel-line { color: var(--accent); font-weight: 700; }
    .duel-card p { margin: 0; } .duel-head { font-size: 16px; font-weight: 700; } .duel-line { font-size: 14px; font-variant-numeric: tabular-nums; }
    .duel-kicker { font-size: 11px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--panel-dim); }
    .duel-pick { display: grid; gap: 8px; }
  `;
  const KICK = { ask: 'Duel', sent: 'Duel sent', on: 'Duel on', won: 'Duel won', lost: 'Duel lost', draw: 'Duel drawn', none: 'Duel over' };

  /**
   * page: el, btn, toast, apiCall, jsonOf, openStage(canonId, name) (plans the stage), redo() (People redraws).
   */
  function mount(page) {
    const { el, btn, toast, apiCall, jsonOf } = page;
    if (root.document && !root.document.getElementById('duelsStyle')) root.document.head.append(el('style', { id: 'duelsStyle', textContent: STYLE }));
    // a sheet over People, like its own (cockpit.js popSheet): slides up, Done closes it, the scrim's tap closes it too
    const sheet = (title) => {
      const p = el('aside', { className: 'side-pop duel-pop' }); p.setAttribute('aria-label', title);
      const close = () => { p.classList.remove('open'); setTimeout(() => p.remove(), 300); };
      p.append(el('div', { className: 'side-pop-head' }, el('h3', { textContent: title }), btn('Done', close, 'linkbtn')));
      root.document.body.append(p);
      root.requestAnimationFrame(() => p.classList.add('open'));
      return { pop: p, close };
    };
    const call = async (method, path, body) => { try { const r = await apiCall(method, path, body); return { ok: r.ok, status: r.status, data: await jsonOf(r) }; } catch (_) { return { ok: false, status: 0, data: null }; } };

    /** The cards for People → Friends, filled when the list arrives; hidden while there is none. */
    function cards() {
      const box = el('div', { className: 'duel-cards' }); box.hidden = true;
      call('GET', '/api/duels').then((r) => {
        const list = r.ok ? shown(r.data) : [];
        box.replaceChildren(...list.map(({ d, c }) => one(d, c)));
        box.hidden = !list.length;
      });
      return box;
    }
    function one(d, c) {
      const keys = el('div', { className: 'row', style: 'flex-wrap:wrap' });
      const act = (label, fn, cls) => keys.append(btn(label, async (e) => { e.target.disabled = true; await fn(); e.target.disabled = false; }, cls));
      for (const k of c.keys) {
        if (k === 'accept') act('Accept', async () => {
          const r = await call('POST', `/api/duels/${encodeURIComponent(d.id)}/accept`);
          if (!r.ok) { toast('Couldn’t accept. It may have been taken back.'); page.redo(); return; }
          toast(`On. ${d.stage} is in your Stages${r.data && r.data.stage_added ? ' now' : ''}: your ${d.kind === 'time' ? 'quickest time' : 'best Score'} on it in ${d.days} days counts.`);
          page.redo();
        }, 'ink-btn solid');
        if (k === 'decline') act('No thanks', async () => { await call('DELETE', `/api/duels/${encodeURIComponent(d.id)}`); toast(`Declined. @${d.with} sees "no thanks".`); page.redo(); }, 'linkbtn');
        if (k === 'withdraw') act(d.status === 'pending' ? 'Take back' : 'Call it off', async () => {
          if (d.status === 'on' && root.ApexConfirm && !(await root.ApexConfirm.ask(`Call off the duel on ${d.stage} with @${d.with}?`, 'Call it off'))) return;
          await call('DELETE', `/api/duels/${encodeURIComponent(d.id)}`); page.redo();
        }, 'linkbtn');
        if (k === 'share') act(d.kind === 'time' ? `Share my times with @${d.with}` : `Show my Scores to @${d.with}`, async () => {
          const timed = d.kind === 'time';
          const r = await call('PUT', '/api/grants', { audience_type: 'friend', audience_id: d.with_id, share_scores: true, share_times: timed });
          toast(!r.ok ? 'Couldn’t change that. Try again.' : timed ? `@${d.with} sees your Scores and times now. Change it in their profile.` : `@${d.with} sees your Scores now (not your times). Change it in their profile.`);
          page.redo();
        }, 'ink-btn');
        if (k === 'drive') act('Drive it', async () => page.openStage(d.canon_id, d.stage), 'ink-btn solid');
        if (k === 'rematch') act('Rematch', async () => {
          const r = await call('GET', '/api/segments'), mine = Array.isArray(r.data) ? r.data.find((s) => (s.origin_id || s.id) === d.canon_id) : null;
          if (!mine) { toast('That stage isn’t in your Stages any more.'); return; }
          await send(d.with, mine.id, d.days, d.stage, d.kind);
        }, 'ink-btn');
      }
      const box = el('div', { className: `duel-card ${c.kind}` }, el('p', { className: 'duel-kicker', textContent: KICK[c.kind] || 'Duel' }),
        el('p', { className: 'duel-head', textContent: c.head }), el('p', { className: 'duel-line', textContent: c.line }));
      if (c.note) box.append(el('p', { className: 'note', textContent: c.note }));
      if (keys.children.length) box.append(keys);
      return box;
    }

    async function send(handle, segmentId, days, stage, kind = 'score') {
      const r = await call('POST', '/api/duels', { handle, segment_id: segmentId, days, kind });
      if (!r.ok) {
        toast(r.status === 409 ? `You and @${handle} already have a duel on ${stage}.` : r.status === 429 ? 'That’s enough duels for now.' : r.status === 404 ? `@${handle} isn’t your friend any more, or the stage is gone.` : 'Couldn’t send it. Try again.');
        return false;
      }
      toast(`Sent. @${handle} has ${days} days on ${stage} once they say yes.`);
      page.redo();
      return true;
    }

    /** The Challenge sheet for one friend: one of your stages, how many days, Send. */
    async function challenge(f) {
      const s = sheet(`Challenge @${f.handle}`);
      const bodyEl = el('div', { className: 'stack-12 duel-pick' }, el('p', { className: 'note', textContent: 'Loading your stages…' }));
      s.pop.append(bodyEl);
      const r = await call('GET', '/api/segments');
      const stages = Array.isArray(r.data) ? r.data : [];
      if (!stages.length) { bodyEl.replaceChildren(el('p', { className: 'people-lead', textContent: 'A duel is on one of your stages. Mark a stretch you love as a stage on a drive’s page in the Log, then come back.' })); return; }
      let pick = stages[0].id, days = 7, kind = 'score';
      const chips = (list, get, set, label) => {
        const row = el('div', { className: 'row', style: 'flex-wrap:wrap' }); row.setAttribute('role', 'group'); row.setAttribute('aria-label', label);
        const paint = () => row.querySelectorAll('button').forEach((b) => { const on = b.dataset.v === String(get()); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
        for (const [v, t] of list) { const b = btn(t, () => { set(v); paint(); }, 'chip'); b.dataset.v = String(v); row.append(b); }
        paint();
        return row;
      };
      const send1 = btn(`Send to @${f.handle}`, async () => {
        send1.disabled = true;
        const st = stages.find((x) => x.id === pick);
        if (await send(f.handle, pick, days, st ? st.name : 'the stage', kind)) s.close();
        send1.disabled = false;
      }, 'ink-btn solid');
      bodyEl.replaceChildren(
        el('p', { className: 'people-lead', textContent: 'Pick a stage. You both drive it as often as you like in the days you choose; your best counts.' }),
        el('b', { textContent: 'Won by' }), chips([['score', 'Vetta Score'], ['time', 'Time']], () => kind, (v) => { kind = v; }, 'Won by'),
        el('b', { textContent: 'Stage' }), chips(stages.slice(0, 30).map((x) => [x.id, x.name]), () => pick, (v) => { pick = v; }, 'Stage'),
        el('b', { textContent: 'For' }), chips(DAYS.map((n) => [n, `${n} days`]), () => days, (v) => { days = v; }, 'How long'),
        el('p', { className: 'note', textContent: `@${f.handle} gets the stage in their Stages when they accept. A duel counts only what each of you shares with the other: Scores, and times for a time duel. Drive within the law.` }),
        el('div', { className: 'row' }, send1));
    }

    return { cards, challenge };
  }

  const api = { card, shown, daysLeft, timesLine, clock, mount, DAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexDuels = api;
})(typeof window !== 'undefined' ? window : globalThis);
