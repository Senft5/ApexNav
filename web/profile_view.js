// A friend's profile (IDEAS S-15, GET /api/friends/:id/profile): what they already show you, as text. Cars they show friends,
// crews you share, the stages they publish to you with their best Vetta Score and days this month. Never times.
// REVIEW_PEOPLE P-04: the profile is the person, so it opens on what you can do with them (On the map, Share a route,
// Invite to a drive) and keeps Unfriend, Report and Block at its foot. lines() is pure (tests/test_profile_view.py);
// show() draws it in the Friends pop-up.
(function (root) {
  'use strict';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  /** P-24: a car by what it is, its make and model, or its nickname, and only then the bare year ("A 2023 car"). */
  const car = (c) => {
    const what = [c.make, c.model, c.trim].filter(Boolean).join(' ');
    if (what) return [c.year, what].filter(Boolean).join(' ') + (c.nickname ? ` "${c.nickname}"` : '');
    if (c.nickname) return `"${c.nickname}"${c.year ? ` · ${c.year}` : ''}`;
    return c.year ? `A ${c.year} car` : 'A car';
  };
  /** P-24: "friends since August" this year, "since August 2025" before it; a date that can't be read says nothing. */
  function since(iso, now = Date.now()) {
    const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
    if (!m || +m[2] < 1 || +m[2] > 12) return null;
    return `friends since ${MONTHS[+m[2] - 1]}${+m[1] === new Date(now).getFullYear() ? '' : ` ${m[1]}`}`;
  }

  /** { title, sub, sections: [{ head, rows: [string] }] } */
  function lines(p, now = Date.now()) {
    const sections = [];
    const t = p.totals || {};
    sections.push({ head: 'This month', rows: [t.stages ? `${t.stages} stage${t.stages === 1 ? '' : 's'} shared · ${t.days_month} day${t.days_month === 1 ? '' : 's'} driven${t.best != null ? ` · best Vetta Score ${t.best}` : ''}`
      : 'No scores shared with you yet.'] });
    if ((p.stages || []).length) sections.push({ head: 'Favourite roads', rows: p.stages.map((s) => `${s.stage} · best ${s.best}${s.days_month ? ` · ${s.days_month} day${s.days_month === 1 ? '' : 's'} this month` : ''}`) });
    if ((p.cars || []).length) sections.push({ head: 'Garage', rows: p.cars.map((c) => car(c) + (c.is_primary ? ' · daily' : '')) });
    if ((p.crews || []).length) sections.push({ head: 'Crews you share', rows: p.crews.slice() });
    return { title: `@${p.handle || '?'}`, sub: [p.name, since(p.friends_since, now)].filter(Boolean).join(' · '), sections };
  }

  /** Draws the profile into `box` (replacing what's there); `back` returns to the list. `keys` ([label, run] pairs) are
   *  the things to do with them, first; `foot` ([label, run, className] triples) the ways to end it, last. `avatar` (a node)
   *  and `status` ({ text, live }) put the person at the top. */
  function show(box, p, { el, btn, back, keys = [], more = [], extra = [], foot = [], partial = false, avatar = null, status = null, retry = null }) {
    const v = lines(p);
    // Nate 2026-11-12 (as easy as a big social app): the person first, their photo, who they are and what they are doing now
    // (status: the friend list's own line, "On the road · Cherohala Skyway" or "Seen 15 min ago"), then what to do with them
    const said = [...(v.sub ? [el('p', { className: 'note', textContent: v.sub })] : []),
      ...(status && status.text ? [el('small', { className: status.live ? 'live' : '', textContent: status.text })] : [])];
    const H = root.ApexProfileHead, t = p.totals || {};
    // Garage as a profile (Nate 2026-11-16): a friend's page has the same head as yours: their face (ringed while driving),
    // their month in numbers, their handle, what they're doing, the car they drive. Partial (no signal): nothing guessed.
    const head = H && avatar ? H.draw({ el, btn,
      face: root.ApexAvatar ? root.ApexAvatar.ring(avatar, status && status.live ? 'live' : null) : avatar,
      title: v.title, sub: [status && status.text, v.sub].filter(Boolean).join(' · '), live: !!(status && status.live), car: partial ? null : H.carName(p.cars),
      counts: [{ n: partial ? null : t.days_month, label: 'Days' }, { n: partial ? null : t.stages, label: 'Stages' }, { n: partial ? null : t.best, label: 'Best' }] }) : null;
    const who = head ? [head] : avatar ? [el('div', { className: 'profile-who' }, avatar, el('div', {}, ...said))] : said;
    // with the head, its numbers are This month and its car is the Garage line: the rest below says what they don't
    const sections = head ? v.sections.filter((x) => x.head !== 'This month' && !(x.head === 'Garage' && (p.cars || []).length < 2)) : v.sections;
    // partial: the profile didn't load (no signal): the person and what you can do with them, nothing guessed about the rest
    box.replaceChildren(el('div', { className: 'side-pop-head' }, ...(head ? [el('span')] : [el('h3', { textContent: v.title })]), btn('‹ Friends', back, 'linkbtn')),
      ...who,
      // up to three keys, then ··· for the rest (screen inventory 2026-11-16: Message, Drive with, Challenge, and ··· for the
      // rarer things and Unfriend / Report / Block, the destructive one last), as Instagram's profile keys
      ...(keys.length || more.length ? [el('div', { className: 'row profile-keys' + (more.length ? ' with-more' : '') },
        ...keys.map(([label, run], i) => btn(label, run, i ? 'ink-btn' : 'ink-btn solid')),
        ...(more.length ? [moreKey(el, btn, v.title, more)] : []))] : []),
      ...extra,
      ...(!partial && p.dna && p.dna.theirs && root.ApexDnaCard ? [dnaSection(p, el, btn)] : []),
      ...(partial ? [el('div', { className: 'stack-8 pv-lost' }, el('p', { className: 'note', textContent: 'Couldn’t load the rest. Check signal.' }), ...(retry ? [btn('Try again', retry, 'ink-btn')] : []))]
        : [...sections.map((s) => el('div', { className: 'stack-8' }, el('b', { textContent: s.head }), ...s.rows.map((r) => el('p', { className: 'note', textContent: r }))))]),   // what they share with you, so no line saying so
      ...(foot.length ? [el('div', { className: 'row profile-foot' }, ...foot.map(([label, run, cls]) => btn(label, run, cls || 'linkbtn')))] : []));
  }

  /** ··· on a profile: a sheet of the rarer things to do, a Cancel under them. */
  function moreKey(el, btn, title, more) {
    const k = btn('···', () => {
      const d = root.document, ov = el('div', { className: 'overlay dim show pv-menu' });
      ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', title);
      const close = () => ov.remove();
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      ov.append(el('div', { className: 'card-sheet' }, el('h3', { textContent: title }),
        ...more.map(([label, run, cls]) => btn(label, () => { close(); run(); }, cls || 'ink-btn')), btn('Cancel', close, 'linkbtn')));
      d.body.append(ov);
    }, 'ink-btn pv-more');
    k.setAttribute('aria-label', `More for ${title}`);
    return k;
  }

  /** Their driving DNA beside yours (dna_card.js): the two hexagons, theirs filled and yours outlined, and a line or two. */
  function dnaSection(p, el, btn) {
    const D = root.ApexDnaCard, who = `@${p.handle || '?'}`;
    // Share us: me against them as one picture (yours filled, theirs outlined), once both of you have all six skills
    const canShare = btn && D.vsLines(p.dna.mine, p.dna.theirs, p.handle).length && root.ApexDriveCard;
    const share = canShare ? btn('Share us', async (e) => {
      const b = e && e.currentTarget, css = getComputedStyle(root.document.documentElement), v = (k) => css.getPropertyValue(k).trim();
      const cv = D.drawDnaVs(root.document.createElement('canvas'), p.dna.mine, p.dna.theirs, p.handle,
        { panel: v('--panel'), panelInk: v('--panel-ink'), panelDim: v('--panel-dim'), accent: v('--accent'), fontNum: v('--font-num'), fontUi: v('--font-ui') });
      if (!cv) return;
      const out = await root.ApexDriveCard.shareCard(cv, `dna-me-vs-${String(p.handle || 'friend').replace(/[^A-Za-z0-9_-]+/g, '')}.png`);
      if (b && out === 'saved') { b.textContent = 'Card saved'; setTimeout(() => { b.textContent = 'Share us'; }, 2000); }
    }, 'ink-btn') : null;
    return el('div', { className: 'stack-8 profile-dna' }, el('div', { className: 'row profile-dna-head' }, el('b', { textContent: 'Driving DNA' }), ...(share ? [share] : [])),
      D.compareSvg(root.document, p.dna.theirs, p.dna.mine),
      el('p', { className: 'note dna-key', textContent: p.dna.mine ? `${who} filled · you outlined` : `${who}` }),
      ...D.compareLines(p.dna.theirs, p.dna.mine, p.handle).map((t) => el('p', { className: 'note', textContent: t })));
  }

  const api = { lines, show, since, car, dnaSection, moreKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexProfileView = api;
})(typeof window !== 'undefined' ? window : globalThis);
