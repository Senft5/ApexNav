// The Log page's own script (was analysis.html's inline <script>, moved as is on 2026-11-12 so the page's CSP needs no hash
// and PRs on the Log stop conflicting on it). It runs where the tag stands, after every module above it.
  (() => {
    'use strict';
    const Core = window.ApexCore, Inst = window.ApexInstruments;
    let MPH = window.ApexUnits ? ApexUnits.speed(1) : Core.MPS_TO_MPH;   // mph or km/h per m/s (U-22); the map page can change it (F-15)
    const $ = (id) => document.getElementById(id);
    const UNK = '<i class="unk">--</i>';   // a score we don't know: "--" in the numeral font, in pencil, never two black bars (REVIEW2.md U-34)
    for (const id of ['segDrive', 'selA', 'selB']) ApexRowSelect.enhance($(id));   // the app's row list, not the browser's select (REVIEW2.md U-18)
    let prefs = { theme: 'roadbook', toggles: { night: false } };
    try { prefs = Object.assign(prefs, JSON.parse(localStorage.getItem('apex.prefs') || 'null') || {}); if (prefs.themeV !== 2) prefs.theme = 'roadbook'; } catch (_) {}
    const params = new URLSearchParams(location.search);
    // night as the map page last showed it (auto night follows the sun there, which a saved toggle can lag)
    const lastLook = window.ApexThemes.last && window.ApexThemes.last();
    let look = window.ApexThemes.apply(params.get('theme') || prefs.theme, params.has('night') ? params.get('night') === '1' : lastLook ? lastLook.night : !!(prefs.toggles && prefs.toggles.night));
    window.ApexFormat.applyTypeScale(document);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) window.ApexFormat.applyTypeScale(document); });   // text size changed in Settings
    let C = look.colors;

    // ---------------------------------------------------------------------
    // Drive library: the person's recordings in IndexedDB
    // ---------------------------------------------------------------------
    function finish(d) {
      const scored = ApexRecording.scoreOf(Core, d);                     // U-91: the end card's score, the same way
      d.corners = scored.corners;
      d.km = d.dist[d.dist.length - 1] / 1000;
      d.ds = scored.ds;                                                    // unknown shows as --, never NaN
      return d;
    }

    // Recordings live in IndexedDB, shared with the cockpit (web/recording.js). F-06 (REVIEW_FEEL): the Log lists their
    // summaries (a few hundred bytes a drive: name, date, length, score, corners, box), read and built in the analysis
    // worker (analysis_client.js); a drive's rows are read only when its page, the stage marker or a compare draws them
    // (full). With 25 drives of 57 km the list was 1.65 MB of rows a drive and every drive matched against every other.
    // A list drive's `dist` is the one distance it knows, its length (year_review.js and week_digest.js read only the last).
    const listDrive = (s) => ({ ...s, name: ApexFormat.driveName(s.name), km: (s.len_m || 0) / 1000, dist: [s.len_m || 0],
      corners: (s.corners || []).map(([start, end, apex]) => ({ start, end, apex })) });
    let drives = [], drivesLoaded = false, libKey = null;
    /** Reads the summaries; true when the library changed since the last read. */
    async function loadDrives() {
      // the summaries are read here (a few KB); only drives without one yet (saved before v3) wait for the worker to build theirs
      let list = await ApexRecording.summaries(null);
      if (list.missing) list = (await ApexAnalysis.job('summaries')).list;
      const key = JSON.stringify(list.map((s) => [s.id, s.n, s.date, s.name, s.ds && s.ds.score, s.tags, s.note, s.contributed]));
      const changed = key !== libKey;
      libKey = key;
      if (changed) drives = list.map(listDrive).sort((a, b) => (a.date < b.date ? -1 : 1));
      return changed;
    }
    // A drive's whole record, finished as the list's are (repaired, named, scored), the last few kept
    const fullCache = new Map();
    function full(id) {
      if (!fullCache.has(id)) {
        fullCache.set(id, ApexRecording.get(id).then((raw) => (raw ? finish({ ...ApexRecording.repair(Core, raw), name: ApexFormat.driveName(raw.name) }) : null)));
        while (fullCache.size > 3) fullCache.delete(fullCache.keys().next().value);
      }
      return fullCache.get(id);
    }
    const summaryOf = (id) => drives.find((x) => x.id === id) || null;

    // ---------------------------------------------------------------------
    // Shared helpers
    // ---------------------------------------------------------------------
    // to a tenth, as the drive page (drive_view.js fmtD): a phone's GPS times a corner no finer than that
    const fmtS = (s) => (s == null ? '--' : `${s >= 0.05 ? '+' : s <= -0.05 ? '\u2212' : ''}${Math.abs(s).toFixed(1)} s`);
    const slower = (s) => (Math.abs(s) < 0.05 ? 'level' : `${Math.abs(s).toFixed(1)} s ${s > 0 ? 'slower' : 'quicker'}`);
    const cls = (s) => (s == null || Math.abs(s) < 0.05 ? '' : s < 0 ? 'gain' : 'loss');
    const mph = (v) => (v == null ? '--' : Math.round(v * MPH));
    const ft = (m) => (m == null ? '--' : `${Math.round(m * (ApexUnits.metric() ? 1 : 3.28084))}`);   // feet or metres (U-22)
    // an import with no date in it (date_known false) carries the time it was imported, not when it was driven: the index
    // already stamps it "--"; its page, the hero and a road's runs say so too, never "Today, 2:53 PM" (walkthrough 2026-11-12)
    const dateLabel = (d) => (ApexAnalysis.monthOf(d) === null ? 'Date unknown' : ApexFormat.dateTime(d.date));
    // Pickers and buttons: a name that already carries its date ("Drive 10/27/2026 8:00 AM") does not repeat it
    const driveLabel = (d) => (/^Drive \d/.test(d.name) ? d.name : `${d.name} · ${dateLabel(d)}`);
    const escH = (s) => String(s == null ? '' : s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
    let tagFilter = [];
    const mmss = (s) => { const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
    function bars(comp) {
      if (!comp) return '<span class="note">no clean corners</span>';
      const b = (k, label) => `<div class="bar">${label} ${Math.round(comp[k] * 100)}<i><u style="width:${Math.round(comp[k] * 100)}%"></u></i></div>`;
      return `<div class="bars">${b('pace', 'Pace')}${b('smoothness', 'Smooth')}${b('braking', 'Brakes')}${b('consistency', 'Rhythm')}</div>`;
    }

    // ---------------------------------------------------------------------
    // HISTORY
    // ---------------------------------------------------------------------
    // Friends' activity (IDEAS S-03): who drove your stages lately and where you stand. Set as text: handles and stage names are people's words.
    const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
    async function renderFriends() {
      const panel = $('friendsPanel'), box = $('friendsList');
      if (!window.ApexSync || !(await ApexSync.member())) { panel.hidden = true; return; }
      const rows = await ApexSync.activity();
      panel.hidden = !rows.length;
      box.replaceChildren(...rows.map((r) => {
        // a feed row: who drove what and the score, then the day and where you stand, Kudos on the right (not wrapped into the sentence)
        const p = document.createElement('div'); p.className = 'friend-act';
        // the handle is the friend: a tap opens their profile on People (the map page; ApexReturn keeps it in the frame)
        const who = document.createElement(r.handle ? 'a' : 'b'); who.textContent = '@' + (r.handle || 'someone');
        if (r.handle) { who.className = 'friend-link'; who.href = 'index.html?view=friends&friend=' + encodeURIComponent(r.handle); }
        const day = new Date(r.driven_on + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        const you = r.you && r.you.rank ? ` · you're ${ordinal(r.you.rank)} of ${r.you.of}` : r.you ? ' · no score from you yet' : '';
        const line = document.createElement('p'); line.append(who, ` drove ${r.stage} · ${r.driver_score}`);
        const sub = document.createElement('small'); sub.textContent = day + you;
        const text = document.createElement('div'); text.append(line, sub);
        p.append(text);
        // Kudos (IDEAS S-07): a tap of thanks, no text; the count is everyone's, the pressed state yours
        const k = document.createElement('button'); k.className = 'btn kudos-btn';
        const paint = () => { k.textContent = `Kudos${r.kudos ? ' ' + r.kudos : ''}`; k.classList.toggle('on', !!r.my_kudos); k.setAttribute('aria-pressed', String(!!r.my_kudos)); };
        k.setAttribute('aria-label', `Kudos to @${r.handle || 'someone'} for ${r.stage}`);
        k.addEventListener('click', async () => {
          if (k.disabled) return;
          const on = !r.my_kudos;
          k.disabled = true;                                         // one request at a time: a double tap isn't two kudos
          try { if (!(await ApexSync.kudos(r, on))) return; r.my_kudos = on; r.kudos = Math.max(0, (r.kudos || 0) + (on ? 1 : -1)); paint(); }
          finally { k.disabled = false; }
        });
        paint(); p.append(k);
        return p;
      }));
      // Kudos on your runs: who, which stage, which day (text)
      const got = await ApexSync.kudosReceived();
      $('kudosPanel').hidden = !got.length;
      $('kudosSum').textContent = `Kudos for you: ${got.length}`;
      $('kudosList').replaceChildren(...got.map((g) => {
        // the feed's shape: who on the line, the stage and the day under it
        const p = document.createElement('div'); p.className = 'friend-act';
        const day = new Date(g.driven_on + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        const who = document.createElement('b'); who.textContent = '@' + (g.from_handle || 'someone');
        const line = document.createElement('p'); line.append(who, ' gave you kudos');
        const sub = document.createElement('small'); sub.textContent = `${g.stage || 'a stage'} · ${day}`;
        const text = document.createElement('div'); text.append(line, sub);
        p.append(text);
        return p;
      }));
    }
    // Your year on the road (IDEAS D-24; web/year_review.js): this calendar year's drives with a known date. Set as text.
    let yearText = '';
    // This month's challenges (challenges.js, IDEAS S-11): text and a bar each; shown once this month has a dated drive.
    // Your notes (recce.js, IDEAS V-09): keep a drive's calls as yours, edit them, forget them.
    function renderRecce(d) {
      const t = { lat: d.lat, lon: d.lon, events: d.events || [] }, notes = ApexRecce.load(localStorage), mine = ApexRecce.onTrack(notes, t);
      const b = (label, fn, cls = 'btn') => { const n = document.createElement('button'); n.className = cls; n.textContent = label; n.addEventListener('click', fn); return n; };
      const corners = (d.events || []).filter((e) => e.type === 'corner').length;
      $('dvRecce').hidden = !corners;
      $('dvRecceActs').replaceChildren(
        b(mine.length ? 'Update from this drive' : 'Keep these notes as mine', () => { ApexRecce.save(localStorage, ApexRecce.keep(ApexRecce.load(localStorage), t)); renderRecce(d); }, 'btn solid'),
        ...(mine.length ? [b('Forget them', async () => { if (await ApexConfirm.ask('Forget your notes for these corners? The map\u2019s notes are read again.', 'Forget them')) { ApexRecce.save(localStorage, ApexRecce.forget(ApexRecce.load(localStorage), t)); renderRecce(d); } })] : []));
      $('dvRecceList').replaceChildren(...mine.map(({ note }, k) => {
        const row = document.createElement('label'); row.className = 'recce-row';
        const num = document.createElement('span'); num.textContent = String(k + 1);
        const inp = document.createElement('input'); inp.value = note.call; inp.maxLength = 60; inp.setAttribute('aria-label', `Call ${k + 1}`);
        inp.addEventListener('change', () => { ApexRecce.save(localStorage, ApexRecce.edit(ApexRecce.load(localStorage), note, inp.value)); $('dvRecceNote').textContent = 'Saved. Read at this corner from now on.'; });
        row.append(num, inp);
        return row;
      }));
    }
    // Which route was better? (road_votes.js, IDEAS S-17): one question per drive, this route against the last other one, each
    // with a small map of it so you remember which it was (the owner's note 10; route_thumb.js).
    function renderVote(d) {
      const panel = $('dvVote'), st = ApexRoadVotes.load(localStorage), q = ApexRoadVotes.question(drives, d, st);
      panel.hidden = !q;
      if (!q) return;
      const pick = async (winner) => {
        ApexRoadVotes.save(localStorage, winner ? ApexRoadVotes.vote(st, q, winner) : ApexRoadVotes.skip(st, q));
        panel.hidden = true; renderRoads();
        // what each road is like, kept with the answer so your taste can be learned (taste.js, IDEAS R-33)
        if (winner && window.ApexTaste) try {
          const o = drives.filter((x) => x.name === q.b && x.date <= d.date).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
          const other = o ? await full(o.id) : null;                   // its rows, only now
          const fa = ApexTaste.featuresOf(Core, d), fb = other ? ApexTaste.featuresOf(Core, other) : null;
          if (fa && fb) ApexTaste.save(localStorage, winner === q.a ? ApexTaste.record(ApexTaste.load(localStorage), fa, fb) : ApexTaste.record(ApexTaste.load(localStorage), fb, fa));
          renderRoads();
        } catch (_) { /* a drive too short to read: the vote still counts for the ranking */ }
      };
      const b = (label, fn, cls = 'btn') => { const n = document.createElement('button'); n.className = cls; n.textContent = label; n.addEventListener('click', fn); return n; };
      const thumb = (r) => (r ? ApexRouteThumb.svg(r.lat, r.lon, { w: 320, h: 200, line: C.panelInk, hi: C.accent, width: 3, label: `Map of ${r.name}` }) : null) || '';
      const route = (name, r) => {
        const n = b('', () => pick(name), 'btn vote-pick'), m = document.createElement('span');
        m.className = 'vote-map'; m.innerHTML = thumb(r);
        n.append(m, Object.assign(document.createElement('span'), { textContent: name }));
        return n;
      };
      const other = drives.filter((x) => x.name === q.b && x.date <= d.date).sort((x, y) => String(y.date).localeCompare(String(x.date)))[0];
      const bBtn = route(q.b, null);
      $('dvVoteBtns').replaceChildren(route(q.a, d), bBtn, b('Skip', () => pick(null), 'btn ghost'));
      // the other route's map needs that drive's rows: read them only once the question is in view, after the drive's own
      // page has drawn (REVIEW_FEEL F-06: opening a drive reads that drive only)
      if (other) setTimeout(() => {
        if (!bBtn.isConnected) return;
        const load = () => full(other.id).then((r) => { if (r && bBtn.isConnected) bBtn.querySelector('.vote-map').innerHTML = thumb(r); }).catch(() => {});
        if (!window.IntersectionObserver) { load(); return; }
        const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); load(); } });
        io.observe(panel);
      }, 1500);
    }
    // Your roads, corner by corner (driver_profile.js roadBook, the worker's roadBook job): roads driven three or more times
    // under one name; a road's corners in road order, each with your cleanest pass and a link to the drive it came on.
    let bookPick = null;
    function renderBook() {
      const roads = window.ApexYourRoads ? ApexYourRoads.roads(drives, 50).filter((r) => r.runs >= 3) : [];
      $('bookPanel').hidden = !roads.length;
      if (!roads.length) return;
      if (!roads.some((r) => r.name === bookPick)) bookPick = null;
      $('bookRoads').replaceChildren(...roads.map((r) => {
        const b = document.createElement('button'), on = r.name === bookPick;
        b.className = 'btn' + (on ? ' on' : ''); b.textContent = `${r.name}, ${r.runs} drives`; b.setAttribute('aria-pressed', String(on));
        b.addEventListener('click', () => { bookPick = r.name; renderBook(); showBook(r); });
        return b;
      }));
      if (!bookPick) { $('bookHead').textContent = 'Pick a road to see each corner\'s cleanest pass.'; $('bookList').replaceChildren(); $('bookPractice').hidden = true; }
      bookWork();
    }
    // every road's book (the worker's roadBooks job), read once for each library: [{ name, book }], shared by the line
    // below and Your driving's Work on
    const bookSeen = { key: null, list: null };
    function roadBookList() {
      const roads = window.ApexYourRoads ? ApexYourRoads.roads(drives, 50).filter((r) => r.runs >= 3) : [];
      const key = `${libKey}#${roads.map((r) => r.id).join(',')}`;
      if (bookSeen.key !== key) {
        bookSeen.key = key;
        bookSeen.list = !roads.length ? Promise.resolve([]) : ApexAnalysis.job('roadBooks', { ids: roads.map((r) => r.id) })
          .then((x) => roads.map((r) => ({ name: r.name, book: (x.books || {})[r.id] || null })), () => []);
      }
      return bookSeen.list;
    }
    // the roads where your passes differ most (driver_profile.js roadsToWork)
    async function bookWork() {
      const key = bookSeen.key, list = await roadBookList();
      if (key !== null && bookSeen.key !== key) return;
      const line = ApexDriverProfile.roadsToWork(list);
      $('bookWork').textContent = line || ''; $('bookWork').hidden = !line;
    }
    async function showBook(r) {
      $('bookHead').textContent = 'Reading its drives…'; $('bookList').replaceChildren(); $('bookPractice').hidden = true;
      let book = null;
      // a practice kept to this road: since it began, which uneven corners have evened out (driver_profile.js roadBook since)
      const plan = ApexDriverProfile.loadPlan(localStorage), since = plan && plan.where && plan.where.road && ApexDriverProfile.onPlanRoad(plan, r.name) ? plan.since : null;
      try { book = (await ApexAnalysis.job('roadBook', { id: r.id, since })).book; } catch (_) { book = null; }
      if (bookPick !== r.name) return;
      const w = ApexDriverProfile.roadBookRows(book, (at) => ApexFormat.dateTime(at.slice(0, 10)));
      if (!w) { $('bookHead').textContent = 'No corner of it driven cleanly three times yet: only corners with every technique credit measured count.'; return; }
      $('bookHead').textContent = [w.head, w.work, ApexDriverProfile.roadEvenedLine(book)].filter(Boolean).join(' ');
      showBookPractice(ApexDriverProfile.roadBookFocus(book), r.name);
      $('bookList').replaceChildren(...w.rows.map((x) => {
        const li = document.createElement('li'), n = document.createElement('span'), t = document.createElement('span'), v = document.createElement('b'), by = document.createElement('button');
        n.className = 'bk-n'; n.textContent = String(x.n); t.textContent = x.what; v.textContent = String(x.record);
        by.type = 'button'; by.className = 'bk-by'; by.textContent = `${x.on ? `On ${x.on}` : 'On a drive of unknown date'}, of ${x.passes} passes${x.uneven ? `; your least clean ${x.low}${x.why ? `, mostly ${x.why}` : ''}` : ''}`;
        if (x.uneven) li.classList.add('uneven');
        by.addEventListener('click', () => openDrive(x.by));
        li.setAttribute('aria-label', `Corner ${x.n}, ${x.what}: your cleanest pass ${x.record}`);
        li.append(n, t, v, by);
        return li;
      }));
    }
    // IDEAS D-27 from the road book: the technique its uneven corners differ by most, as the skill to practise next
    // the plan keeps to this road (where: { road, name }): only its drives count, before and after (driver_profile.js practice)
    function showBookPractice(f, road) {
      const box = $('bookPractice'), line = ApexDriverProfile.roadBookFocusLine(f);
      box.hidden = !line;
      if (!line) { box.replaceChildren(); return; }
      const name = ApexDriverProfile.WORDS[f.skill].name.toLowerCase(), plan = ApexDriverProfile.loadPlan(localStorage);
      if (plan && plan.skill === f.skill && ApexDriverProfile.onPlanRoad(plan, road)) { box.textContent = `${line} Practicing it.`; return; }
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'linkbtn'; b.id = 'bookPracticeGo'; b.textContent = `Practice ${name} on my next drives here`;
      b.addEventListener('click', () => {
        ApexDriverProfile.savePlan(localStorage, { skill: f.skill, where: { road: String(road || '').trim().toLowerCase(), name: road }, since: ApexDriverProfile.localStamp() });
        box.textContent = `${line} Practicing it here.`;
        box.tabIndex = -1; box.focus({ preventScroll: true });
      });
      box.replaceChildren(document.createTextNode(`${line} `), b);
    }
    function renderRoads() {
      renderBook();
      const list = ApexRoadVotes.ranking(ApexRoadVotes.load(localStorage)).slice(0, 10);
      $('roadsPanel').hidden = list.length < 2;
      $('roadsList').replaceChildren(...list.map((r, i) => { const p = document.createElement('p'); p.className = 'friend-act'; p.textContent = `${i + 1}. ${r.name}`; return p; }));
      const taste = window.ApexTaste ? ApexTaste.fit(ApexTaste.load(localStorage)) : null;   // IDEAS R-33
      if (taste) { const p = document.createElement('p'); p.className = 'note'; p.textContent = ApexTaste.describe(taste) + ' Fun routes lean that way a little.'; $('roadsList').append(p); }
    }
    // Your week (week_digest.js, IDEAS D-20): the last 7 days, set as text.
    function renderWeek() {
      const w = ApexWeekDigest.digest(drives.map((d) => ({ ...d, dateKnown: monthOf(d) !== null })));
      $('weekPanel').hidden = !w;
      if (!w) return;
      const [first, ...rest] = ApexWeekDigest.lines(w);
      $('weekSum').textContent = `Your week: ${first}`;
      $('weekLines').replaceChildren(...rest.map((t) => { const p = document.createElement('p'); p.className = 'friend-act'; p.textContent = t; return p; }));
    }
    let challengeServer;   // undefined: not asked yet; null: unknown (signed out, offline)
    function renderChallenges() {
      const now = new Date(), month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const list = drives.map((d) => ({ ...d, dateKnown: monthOf(d) !== null }));
      $('challengePanel').hidden = !list.some((d) => d.dateKnown && d.date.startsWith(month + '-'));
      if ($('challengePanel').hidden) { summaryParts.ch = ''; paintSummary(); }
      // the km you were first to map this month comes from the server (signed in): drawn once it answers
      if (challengeServer === undefined && window.ApexSync && ApexSync.points) {
        challengeServer = null;
        ApexSync.points().then((p) => { challengeServer = p && p.month ? p.month : null; if (challengeServer) renderChallenges(); }).catch(() => {});
      }
      const kmText = (km) => (window.ApexUnits ? ApexUnits.long(km * 1000, ApexUnits.metric() ? 0 : 1) : `${km} km`);
      $('challengeList').replaceChildren(...ApexChallenges.progress(list, month, challengeServer || null, kmText).map((c) => {
        const row = document.createElement('div'), t = document.createElement('p'), bar = document.createElement('div'), fill = document.createElement('i');
        t.className = 'friend-act'; t.textContent = `${c.complete ? '\u2713 ' : ''}${c.title} · ${c.unit === 'km' ? `${kmText(c.done)} of ${kmText(c.goal)}` : `${c.done} of ${c.goal}`}`;
        bar.className = 'ch-bar'; bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', c.title);
        bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', String(c.goal)); bar.setAttribute('aria-valuenow', String(c.done));
        fill.style.width = `${Math.round(100 * c.done / c.goal)}%`; bar.append(fill); row.append(t, bar);
        return row;
      }));
      // one line until opened (REVIEW.md roadmap 13)
      const all = ApexChallenges.progress(list, month, challengeServer || null, kmText), done = all.filter((c) => c.complete).length;
      $('challengeSum').textContent = `This month: ${done} of ${all.length} challenge${all.length === 1 ? '' : 's'} done`;
      summaryParts.ch = $('challengePanel').hidden ? '' : `${done} of ${all.length} challenge${all.length === 1 ? '' : 's'}`; paintSummary();
    }
    // the Log's one summary row: "2026 · 35 mi · 4 drives · 1 of 3 challenges" (REVIEW2.md U-32)
    const summaryParts = { year: '', ch: '' };
    function paintSummary() {
      const t = [summaryParts.year, summaryParts.ch].filter(Boolean).join(' · ');
      $('yearPanel').hidden = !t; $('yearTitle').textContent = t || '--';
    }
    function renderYear() {
      const year = new Date().getFullYear();
      const s = window.ApexYearReview ? ApexYearReview.summary(drives.map((d) => ({ ...d, dateKnown: monthOf(d) !== null })), year) : null;
      $('yearLines').hidden = $('yearShareRow').hidden = !s;
      if (!s) { summaryParts.year = ''; paintSummary(); return; }
      summaryParts.year = `${year} · ${ApexFormat.distance(s.m)} · ${s.drives} drive${s.drives === 1 ? '' : 's'}`; paintSummary();   // the rest when opened
      // the year's cleanest corners come with Your driving's profile (the profile job), once it has answered
      const paint = () => {
        const ls = ApexYearReview.lines({ ...s, crews: (() => { try { return ApexYearReview.crewYear(localStorage, year); } catch (_) { return []; } })(), bestCorners: (driving.best || []).filter((b) => String(b.at).startsWith(`${year}-`)) });
        $('yearLines').replaceChildren(...ls.map((t) => Object.assign(document.createElement('p'), { textContent: t })));
        yearText = [`My ${year} on the road with Vetta`, ...ls].join('\n');
      };
      paint();
      if (drives.some((d) => d.corners.length)) drivingProfile(() => paint());
    }
    $('yearShare').addEventListener('click', async () => {
      if (!yearText) return;
      const how = await ApexSaveFile.shareLink({ title: 'My year on Vetta', text: yearText });   // the real share sheet (feedback 07)
      if (how === 'copied') { $('yearShare').textContent = 'Copied'; setTimeout(() => { $('yearShare').textContent = 'Share'; }, 1500); }
    });
    function renderHistory() {
      const scored = drives.filter(d => d.ds.score != null);
      const best = scored.reduce((m, d) => (!m || d.ds.score > m.ds.score ? d : m), null);
      const avg = scored.length ? Math.round(scored.reduce((s, d) => s + d.ds.score, 0) / scored.length) : null;
      const totalKm = drives.reduce((s, d) => s + d.km, 0);
      const latest = scored[scored.length - 1];
      $('historyEmpty').hidden = !drivesLoaded || drives.length > 0;   // never claim "no drives" before the store has answered
      $('historyCards').hidden = $('historyPanel').hidden = !drives.length;
      // the hero (REVIEW.md roadmap 13): your latest Vetta Score, big, with its road; the best one quietly under it
      $('historyCards').innerHTML = `<div class="hero-score"><b>${latest ? latest.ds.score : UNK}</b><small>/1000</small></div>`
        + `<p class="hero-what">Latest Vetta Score${latest ? ` · <span></span>${ApexAnalysis.monthOf(latest) === null ? '' : ` · ${dateLabel(latest).replace(/, \d{1,2}:\d{2}(\s?[AP]M)?$/i, '')}`}` : ''}</p>`   // the day, not the minute: one line; an undated import none
        + (best && best !== latest ? `<p class="hero-best">Best ${best.ds.score} · <span></span></p>` : '');
      if (latest) $('historyCards').querySelector('.hero-what span').textContent = latest.name;   // names are user text
      if (best && best !== latest) $('historyCards').querySelector('.hero-best span').textContent = best.name;
      $('trendPanel').hidden = scored.length < 3;
      renderYear();
      renderChallenges();
      renderWeek();
      renderRoads();

      // trend
      const W = Math.max(300, Math.round($('trend').clientWidth || 760)), H = 180, L = 40, R = 22, T = 12, B = 26;   // drawn at the real width so labels stay readable
      const pts = scored.map((d, i) => [L + (scored.length < 2 ? 0.5 : i / (scored.length - 1)) * (W - L - R), T + (1 - d.ds.score / 1000) * (H - T - B), d]);
      const grid = [0, 250, 500, 750, 1000].map(v => { const y = T + (1 - v / 1000) * (H - T - B); return `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="${C.rule}"/><text x="${L - 6}" y="${y + 3}" text-anchor="end" font-size="10" fill="${C.panelDim}">${v}</text>`; }).join('');
      const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
      const dots = pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="5" fill="${C.accent}"/><text x="${p[0]}" y="${H - 8}" text-anchor="middle" font-size="10" fill="${C.panelDim}">${ApexFormat.dayShort(p[2].date)}</text>`).join('');
      if (!scored.length) { $('trend').innerHTML = '<p class="note">No scored drives yet. Start a drive on the map, or import a recording in Garage, Your data; a drive needs a few clean corners to get a Score.</p>'; }
      else $('trend').innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score over time">${grid}<path d="${line}" fill="none" stroke="${C.accent}" stroke-width="2"/>${dots}</svg>`;

      // filter by tag (drive_tags.js, IDEAS D-23): chips for the tags in use; a chip toggles; a drive must carry every one picked
      const tagsUsed = ApexDriveTags.used(drives);
      tagFilter = tagFilter.filter((f) => tagsUsed.some((u) => u.tag.toLowerCase() === f.toLowerCase()));
      const hf = $('historyFilter'); hf.hidden = !tagsUsed.length; hf.replaceChildren(...tagsUsed.map(({ tag, count }) => {
        const on = tagFilter.includes(tag), b = document.createElement('button');
        b.className = 'btn' + (on ? ' on' : ''); b.textContent = `${tag} ${count}`; b.setAttribute('aria-pressed', String(on));
        b.addEventListener('click', () => { tagFilter = ApexDriveTags.toggle(tagFilter, tag); renderHistory(); });
        return b;
      }));
      const shown = drives.filter((d) => ApexDriveTags.matches(d, tagFilter));
      // the drive list as a road-book index (REVIEW.md roadmap 13): the date stamped, the road, the distance and the score.
      // TestFlight 2026-11-12 (note 3, "cluttered"): no corner ticks, no "--" for a drive with no Score (its page says so), and
      // a street address shows without its house number ("To Pebble Ridge Ln"); the drive's own name is unchanged
      const listName = (n) => String(n || '').replace(/^To \d+[A-Za-z]?(-\d+)? (?=.*\b(St|Street|Rd|Road|Ln|Lane|Dr|Drive|Ave|Avenue|Blvd|Ct|Court|Way|Pl|Place|Pike|Hwy|Cir|Circle|Ter|Trl|Trail|Pkwy|Run|Loop)\.?$)/, 'To ');
      const stamp = (d) => { const m = monthOf(d) ? new Date(d.date.slice(0, 10) + 'T12:00:00') : null;
        return m ? `<span class="stamp-d"><b>${m.getDate()}</b>${m.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</span>` : '<span class="stamp-d"><b>--</b></span>'; };
      const rows = shown.slice().reverse().map(d => `<tr class="row-link" data-drive="${d.id}" tabindex="0" role="link" aria-label="Open ${escH(d.name)}">
        <td class="ix-date">${stamp(d)}</td>
        <td class="l ix-road"><b>${escH(listName(d.name))}</b><span class="sub">${ApexFormat.factsLine(d, ['distance', 'corners'])}${ApexDriveTags.normalize(d.tags).length ? ` · <span class="tagline">${escH(ApexDriveTags.normalize(d.tags).join(', '))}</span>` : ''}</span></td>
        <td class="ix-score">${d.ds.score != null ? `<span class="score">${d.ds.score}</span>` : ''}</td></tr>`).join('');
      $('historyTable').innerHTML = !drives.length ? '<tr><td class="l" colspan="3"><span class="note">No drives yet.</span></td></tr>' : !shown.length ? '<tr><td class="l" colspan="3"><span class="note">No drives with those tags.</span></td></tr>' : rows;
      setTimeout(renderRecords, 0);
      setTimeout(renderSteadiness, 0);                                  // the coach runs per road: after the Log has painted
      setTimeout(renderDrivingCard, 0);
    }

    // Your records (IDEAS D-08): the best Score on each road you have driven twice or more (roads by name), and this month's
    // smoothest drive and best braking, and your cleanest corner of each kind (tight, medium, fast: technique credits, as Your
    // driving reads them). No speed, time or pace record of its own.
    // A drive whose date is unknown never counts for "this month".
    function renderRecords(list = drives) {
      const roads = new Map();
      for (const d of list) { const r = roads.get(d.name) || []; r.push(d); roads.set(d.name, r); }
      const when = (d) => monthOf(d) ? d.date : '';                    // an unknown date is never "latest" and never wins a tie
      const rows = [...roads.entries()].map(([name, all]) => {
        const ds = all.filter(d => d.ds.score != null);
        if (ds.length < 2) return null;
        const best = ds.reduce((m, d) => (d.ds.score > m.ds.score || (d.ds.score === m.ds.score && when(d) && (!when(m) || when(d) < when(m))) ? d : m));
        const dated = all.filter(when), last = dated.length ? dated.reduce((m, d) => (when(d) > when(m) ? d : m)) : null;
        return { name, best, n: ds.length, fresh: last === best, last };
      }).filter(Boolean).sort((p, q) => (q.last ? when(q.last) : '').localeCompare(p.last ? when(p.last) : '')).slice(0, 6);
      const month = new Date(), key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
      const mine = list.filter(d => d.ds.score != null && monthOf(d) === key && d.ds.components);
      const of = (k) => mine.filter(d => finiteNum(d.ds.components[k]));
      const top = (k) => { const c = of(k); return c.length >= 2 ? c.reduce((m, d) => (d.ds.components[k] > m.ds.components[k] ? d : m)) : null; };
      const smooth = top('smoothness'), brake = top('braking');
      // by kind of corner (D-08 per archetype): your cleanest tight, medium and fast corner, from Your driving's kept observations
      const byId = new Map(list.map((d) => [d.id, d]));
      const kinds = ['tight', 'medium', 'fast'].map((z) => { const r = driving.records && driving.records[z]; return r && byId.has(r.id) ? { z, r, d: byId.get(r.id) } : null; }).filter(Boolean);
      // this month's best run of clean corners in a row (IDEAS D-30, the summary's run): a drive whose run is unknown never counts
      const runs = list.filter(d => monthOf(d) === key && d.run && d.run.corners >= 1);
      const run = runs.length ? runs.reduce((m, d) => (d.run.corners > m.run.corners ? d : m)) : null;
      $('recordsPanel').hidden = !rows.length && !smooth && !brake && !kinds.length && !run;
      if ($('recordsPanel').hidden) return;
      const pct = (v) => `${Math.round(v * 100)}%`;
      const day = (d) => `<span class="nw">${monthOf(d) ? ApexFormat.dateTime(d.date.slice(0, 10)) : 'date unknown'}</span>`;   // "30 Oct", as the list's stamps read; never 2026-10-30
      const line = (what, d, value, sub) => `<tr class="row-link" data-drive="${d.id}" tabindex="0" role="link"><td class="l"><b></b><span class="sub">${what} · ${sub}</span></td><td><span class="score">${value}</span></td></tr>`;
      const out = [], names = [];
      for (const r of rows) { out.push(line(`Best Score on this road, of ${r.n} scored drives`, r.best, r.best.ds.score, r.fresh ? `${day(r.best)}, your latest here: a new best` : day(r.best))); names.push(r.name); }
      if (smooth) { out.push(line(`Smoothest drive this month, of ${of('smoothness').length}`, smooth, pct(smooth.ds.components.smoothness), day(smooth))); names.push(smooth.name); }
      if (brake) { out.push(line(`Best braking this month, of ${of('braking').length}`, brake, pct(brake.ds.components.braking), day(brake))); names.push(brake.name); }
      if (run) { out.push(line(`Best run this month: corners in a row, smooth and settled${Number.isFinite(run.run.len_m) && run.run.len_m > 0 ? `, over ${ApexUnits.long(run.run.len_m, 1)}` : ''}`, run, run.run.corners, day(run))); names.push(run.name); }
      const way = (dir) => (dir === 'L' ? ' left' : dir === 'R' ? ' right' : ' corner');
      for (const { z, r, d } of kinds) { out.push(line(`Cleanest ${z}${way(r.dir)}, of ${r.n} ${z} corners`, d, r.level, day(d))); names.push(d.name); }
      $('recordsTable').innerHTML = out.join('');
      $('recordsTable').querySelectorAll('tr td.l b').forEach((b, i) => { b.textContent = names[i]; });   // names are user text
    }
    const finiteNum = (v) => typeof v === 'number' && Number.isFinite(v);
    window.apexLogDebug = { steadyLines: (m) => steadyLines(m), loaded: () => drivesLoaded, records: (ds) => renderRecords(ds), driving: () => driving.p };   // e2e/smoke.js seeds the panel (the library itself is untouched)

    // Braking consistency by month (IDEAS D-07 trend): how widely your braking point spread inside each month on corners you
    // drove five or more times that month (analysis_client.js steadiness: every drive's coach against the others, in the
    // analysis worker since F-06; it read every drive's rows on this page, one road per step). Drives whose date is
    // unknown (an import without a stamp) are left out.
    const STEADY_MIN_CORNERS = 3, STEADY_CLAIM_M = 5, STEADY_CLAIM_CORNERS = 5;
    const steady = { key: null, months: [], run: 0, pending: null, wait: [] };
    const monthOf = ApexAnalysis.monthOf;
    function steadinessByMonth(done) {
      const key = drives.map(o => o.id).join(',');
      if (steady.key === key) { done(steady.months); return; }
      steady.wait = steady.pending === key ? steady.wait.concat([done]) : [done];
      if (steady.pending === key) return;                                // already being worked out: told when it is
      const run = ++steady.run;
      steady.pending = key;
      ApexAnalysis.job('steadiness', { minCorners: STEADY_MIN_CORNERS }).then((r) => {
        if (run !== steady.run) return;                                   // the library changed: a newer run took over
        steady.key = key; steady.pending = null; steady.months = r.months || []; steady.wait.forEach((f) => f(steady.months));
      }).catch(() => { if (run === steady.run) steady.pending = null; });
    }
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthLabel = (m) => `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
    // the speed at those corners' slowest point, the same way: how steadily you carried speed through them (a spread, never a target)
    const STEADY_CLAIM_MPS = 0.45;                                       // 1 mph
    // the panel's words: a labelled row a measure, the latest month and, when it is clear, against the first (TestFlight
    // 2026-11-12, "walls of text": the method and the GPS floor were a paragraph under the chart)
    function steadyLines(months) {
      const out = [], a = months[0], z = months[months.length - 1];
      if (!z) return out;
      const about = (v) => (v < 3 ? `under ${ApexUnits.fine(3)}` : `about ${ApexUnits.fine(v)}`);           // below the GPS floor, no finer figure
      const claim = months.length > 1 && Math.abs(z.sd_m - a.sd_m) >= STEADY_CLAIM_M && a.corners >= STEADY_CLAIM_CORNERS && z.corners >= STEADY_CLAIM_CORNERS;
      out.push(`Braking point in ${monthLabel(z.month)}: varies ${about(z.sd_m)}, over ${z.corners} corners${claim ? ` · ${z.sd_m < a.sd_m ? 'steadier' : 'less steady'} than ${monthLabel(a.month)}, ${about(a.sd_m)}` : ''}`);
      const vs = months.filter((w) => finiteNum(w.speed_sd_mps));
      if (vs.length) {
        const spd = (v) => `${Math.max(1, Math.round(ApexUnits.speed(v)))} ${ApexUnits.speedU()}`;
        const b = vs[0], y = vs[vs.length - 1], diff = y.speed_sd_mps - b.speed_sd_mps;
        const sure = vs.length > 1 && Math.abs(diff) >= STEADY_CLAIM_MPS && b.speed_corners >= STEADY_CLAIM_CORNERS && y.speed_corners >= STEADY_CLAIM_CORNERS;
        out.push(`Speed at the slowest point in ${monthLabel(y.month)}: varies about ${spd(y.speed_sd_mps)}${sure ? ` · ${diff < 0 ? 'steadier' : 'less steady'} than ${monthLabel(b.month)}, ${spd(b.speed_sd_mps)}` : ''}`);
      }
      return out;
    }
    function renderSteadiness() {
      const panel = $('steadyPanel'); if (!panel) return;
      steadinessByMonth((months) => {
        panel.hidden = months.length < 2;
        if (panel.hidden) return;
        const idx = (m) => +m.slice(0, 4) * 12 + +m.slice(5, 7), i0 = idx(months[0].month), span = Math.max(1, idx(months[months.length - 1].month) - i0);
        const W = Math.max(300, Math.round($('steadyChart').clientWidth || 760)), H = 160, L = 40, R = 22, T = 12, B = 26;
        const top = Math.max(10, Math.ceil(Math.max(...months.map(w => w.sd_m)) / 5) * 5);
        const X = (m) => L + (idx(m) - i0) / span * (W - L - R), Y = (v) => T + (v / top) * (H - T - B);   // steadier is higher
        const grid = [0, top / 2, top].map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C.rule}"/><text x="${L - 6}" y="${Y(v) + 3}" text-anchor="end" font-size="10" fill="${C.panelDim}">${ApexUnits.fine(v)}</text>`).join('');
        const line = months.map((w, i) => `${i ? 'L' : 'M'}${X(w.month).toFixed(1)} ${Y(w.sd_m).toFixed(1)}`).join('');
        const dots = months.map((w) => `<circle cx="${X(w.month).toFixed(1)}" cy="${Y(w.sd_m).toFixed(1)}" r="${Math.min(8, 3 + Math.sqrt(w.corners))}" fill="${C.accent}"><title>${monthLabel(w.month)}: ${ApexUnits.fine(w.sd_m)} over ${w.corners} corners</title></circle><text x="${X(w.month).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="${C.panelDim}">${monthLabel(w.month)}</text>`).join('');
        $('steadyChart').innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Braking consistency by month, steadier higher">${grid}<text x="${W - R}" y="${Y(0) - 3}" text-anchor="end" font-size="10" fill="${C.panelDim}">steadier \u2191</text><path d="${line}" fill="none" stroke="${C.accent}" stroke-width="2"/>${dots}</svg>`;
        $('steadyNote').replaceChildren(...steadyLines(months).map((t) => { const n = document.createElement('p'); n.className = 'note'; n.textContent = t; return n; }));
      });
    }

    // Your driving (driver_profile.js): the profile over every drive, worked out in the analysis worker (the profile job
    // keeps each drive's observations, so only new drives are read) and asked again only when the library changes.
    const driving = { key: null, p: null, pending: null, wait: [], best: null, records: null };
    // IDEAS D-27: the skill being practiced (driver_profile.js loadPlan), read again with each run; its level before the
    // practice is kept in the plan from each run, so the end card on the map can set a drive against it
    const planNow = () => ApexDriverProfile.loadPlan(localStorage);
    const planKey = (pl) => (pl ? `${pl.skill}|${pl.since}|${pl.where ? `${pl.where.split}|${pl.where.worse}|${pl.where.road || ''}` : ''}` : '');
    function drivingProfile(done) {
      const plan = planNow(), key = `${libKey}#${planKey(plan)}`;
      if (driving.key === key) { done(driving.p, driving.pr); return; }
      driving.wait = driving.pending === key ? driving.wait.concat([done]) : [done];
      if (driving.pending === key) return;
      driving.pending = key;
      ApexAnalysis.job('profile', { plan }).then((r) => {
        if (driving.pending !== key) return;                             // the library changed meanwhile: a newer run answers
        driving.key = key; driving.pending = null; driving.p = r.profile || null; driving.pr = r.practice || null; driving.best = r.best || null; driving.records = r.records || null;
        renderRecords();                                                  // records by kind of corner come from the same kept observations
        if (plan && driving.pr) ApexDriverProfile.savePlan(localStorage, { ...plan, before: driving.pr.before });
        driving.wait.forEach((f) => f(driving.p, driving.pr));
      }).catch(() => { if (driving.pending === key) driving.pending = null; });
    }
    function renderDrivingCard() {
      const card = $('drivingCard'); if (!card) return;
      if (!drives.some((d) => d.corners.length)) { card.hidden = true; return; }
      drivingProfile((p, pr) => {
        const line = p ? ApexDriverProfile.cardLine(p, pr) : null;
        card.hidden = !line;
        if (!line) return;
        const b = document.createElement('button');
        b.className = 'dp-card'; b.id = 'drivingOpen';
        b.append(Object.assign(document.createElement('b'), { textContent: 'Your driving' }), Object.assign(document.createElement('i'), { textContent: '›' }), Object.assign(document.createElement('span'), { textContent: line }));
        b.querySelector('i').setAttribute('aria-hidden', 'true');
        b.addEventListener('click', () => { showTab('driving'); toTop(); });
        ApexDriverProfile.render(document.createElement('div'), null);   // its styles, before the card shows
        card.replaceChildren(b);
      });
    }
    function renderDriving() {
      ApexDriverProfile.render($('drivingRoot'), drives.length ? null : { corners: 0 });
      if (drives.length) drivingProfile((p, pr) => {
        if (view !== 'driving') return;
        ApexDriverProfile.render($('drivingRoot'), p || { corners: 0 }, { plan: pr ? planNow() : null, practice: pr, onPlan: (plan) => {
          ApexDriverProfile.savePlan(localStorage, plan);
          driving.moved = true; renderDriving();                         // the Practicing box in the Work on box's place
        } });
        // the road where the skill to work on shows most (driver_profile.js skillRoadLine), under its tip
        const skill = (pr && planNow()) ? planNow().skill : p && p.focus ? p.focus.skill : null, shown = $('drivingRoot').querySelector('.dp-focus');
        if (skill && shown) roadBookList().then((list) => {
          const line = ApexDriverProfile.skillRoadLine(list, skill), box = $('drivingRoot').querySelector('.dp-focus'), pl = planNow();
          if (!line || box !== shown || box.querySelector('.dp-where')) return;
          if (pl && pl.skill === skill && pl.where && pl.where.road) return;   // the practice already keeps to a road: it says which
          const say = document.createElement('p'); say.className = 'dp-say dp-where'; say.textContent = line;
          const tip = [...box.querySelectorAll('.dp-say')].pop();
          if (tip) tip.after(say); else box.append(say);
          // ...and a practice kept to that road (driver_profile.js practice, where.road), unless the practice already keeps to one
          const road = ApexDriverProfile.skillRoad(list, skill).name;
          const go = document.createElement('button');
          go.type = 'button'; go.className = 'linkbtn'; go.id = 'drivingRoadGo'; go.textContent = `Practice it on ${road} alone`;
          go.addEventListener('click', () => {
            ApexDriverProfile.savePlan(localStorage, { skill, where: { road: String(road).trim().toLowerCase(), name: road }, since: ApexDriverProfile.localStamp() });
            driving.moved = true; renderDriving();
          });
          say.append(' ', go);
        });
        const box = driving.moved && $('drivingRoot').querySelector('.dp-focus');   // the pressed key is gone: focus its box
        if (box) { box.tabIndex = -1; box.focus({ preventScroll: true }); }
        driving.moved = false;
      });
    }

    for (const id of ['historyTable', 'recordsTable']) {
      $(id).addEventListener('click', (e) => { const r = e.target.closest('tr[data-drive]'); if (r) openDrive(r.dataset.drive); });
      $(id).addEventListener('keydown', (e) => { const r = e.target.closest('tr[data-drive]'); if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDrive(r.dataset.drive); } });
    }
    // ---------------------------------------------------------------------
    // SEGMENTS (custom stretches, stored locally; ranked by Score)
    // ---------------------------------------------------------------------
    const loadSegs = () => { try { return JSON.parse(localStorage.getItem('apex.segments') || '[]'); } catch (_) { return []; } };
    const saveSegs = (s) => { try { localStorage.setItem('apex.segments', JSON.stringify(s)); } catch (_) {} };
    let segs = loadSegs(), activeSeg = null, sel = null, boardFilter = 'friends';   // the list first; a tapped stage opens its board
    const crewMembersCache = new Map();

    // The marker (the owner's note 09): the picked drive on a map with the stage drawn bold and circled, the roads it was
    // on as keys (each whole, from where you joined it to where you left it: road_runs.js), and Start and Finish
    // sliders for any other stretch. Its rows are read when it is picked (F-06).
    let stripRun = 0, selLabel = '';
    const roadRunsCache = new Map();                                    // drive id -> Promise<runs[] | null>
    const ROADS_KEY = 'apex.driveRoads';
    function driveRoads(d) {
      if (!roadRunsCache.has(d.id)) roadRunsCache.set(d.id, (async () => {
        let kept = {};
        try { kept = JSON.parse(localStorage.getItem(ROADS_KEY) || '{}') || {}; } catch (_) {}
        if (Array.isArray(kept[d.id])) return kept[d.id];               // matched once: the track isn't sent again
        const names = await ApexRoadRuns.fetchNames(d, ApexContributor.matchDrive);
        const list = ApexRoadRuns.runs(names).map((r) => ({ ...r, label: ApexRoadRuns.label(r, d.elev) }));
        kept[d.id] = list;
        const ids = Object.keys(kept); for (const k of ids.slice(0, Math.max(0, ids.length - 30))) delete kept[k];
        try { localStorage.setItem(ROADS_KEY, JSON.stringify(kept)); } catch (_) {}
        return list;
      })().catch(() => { roadRunsCache.delete(d.id); return null; }));   // offline: asked again next time
      return roadRunsCache.get(d.id);
    }
    const segNote = (text) => Object.assign(document.createElement('span'), { className: 'note', textContent: text });
    async function renderSegStrip() {
      const id = $('segDrive').value, run = ++stripRun;
      if (!summaryOf(id)) return;
      const d = await full(id);
      if (!d || run !== stripRun || $('segDrive').value !== id) return;
      const n = d.lat.length;
      for (const k of ['segFrom', 'segTo']) $(k).max = String(n - 1);
      $('segFrom').value = '0'; $('segTo').value = String(n - 1);
      drawSel();
      $('segRoads').replaceChildren(segNote('Finding the roads on this drive…'));
      const list = await driveRoads(d);
      if (run !== stripRun || $('segDrive').value !== id) return;
      if (!list || !list.length) {
        $('segRoads').replaceChildren(segNote(list ? 'No whole road long enough to name on this drive. Slide Start and Finish instead.' : 'Couldn’t name the roads (offline?). Slide Start and Finish instead.'));
        return;
      }
      $('segRoads').replaceChildren(...list.map((r) => {
        const b = document.createElement('button'); b.className = 'btn'; b.dataset.a = r.a; b.dataset.b = r.b;
        b.textContent = `${r.label} · ${ApexUnits.long(r.length_m, 1)}`;
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => { sel = [r.a, r.b]; selLabel = r.label; $('segFrom').value = String(r.a); $('segTo').value = String(r.b); drawSel(); });
        return b;
      }));
      drawSel();
    }
    async function drawSel() {
      const id = $('segDrive').value, d = summaryOf(id) ? await full(id) : null;
      if (!d || $('segDrive').value !== id) return;
      const [a, b] = sel ? (sel[0] < sel[1] ? sel : [sel[1], sel[0]]) : [0, -1];
      $('segMap').innerHTML = ApexRouteThumb.svg(d.lat, d.lon, { w: 360, h: 220, line: C.panelDim, hi: C.accent, ring: C.panelInk, width: 3,
        range: sel ? [a, b] : null, label: sel ? `This drive, the stage circled: ${ApexUnits.long((b - a) * 5, 2)}` : 'This drive' }) || '';
      for (const k of $('segRoads').querySelectorAll('button[data-a]')) k.setAttribute('aria-pressed', String(!!sel && +k.dataset.a === a && +k.dataset.b === b));
      if (!sel) { $('segInfo').textContent = ''; return; }
      const corners = d.corners.filter(c => c.start >= a && c.end <= b).length, dz = ApexRoadRuns.climb(d.elev, a, b);
      $('segInfo').textContent = `${ApexUnits.long((b - a) * 5, 2)} · ${corners} corner${corners === 1 ? '' : 's'}${dz != null && Math.abs(dz) >= 15 ? ` · ${dz > 0 ? 'up' : 'down'} ${ApexUnits.fine(Math.abs(dz))}` : ''}`;
    }
    for (const k of ['segFrom', 'segTo']) $(k).addEventListener('input', () => { sel = [+$('segFrom').value, +$('segTo').value]; selLabel = ''; drawSel(); });
    $('segDrive').addEventListener('change', () => { sel = null; selLabel = ''; renderSegStrip(); });
    $('segSave').addEventListener('click', async () => {
      const d = summaryOf($('segDrive').value) ? await full($('segDrive').value) : null;
      if (!d || !sel) { $('segInfo').textContent = 'Pick a road, or slide Start and Finish, first.'; return; }
      const [a, b] = sel[0] < sel[1] ? sel : [sel[1], sel[0]];
      if (b - a < 40) { $('segInfo').textContent = `Make it at least ${ApexUnits.size(200)} long.`; return; }
      const seg = { id: ApexSync.newSegmentId(), name: $('segName').value.trim() || selLabel || `${d.name} ${ApexUnits.longN(a * 5).toFixed(1)}-${ApexUnits.long(b * 5)}`,
                    lat0: d.lat[a], lon0: d.lon[a], lat1: d.lat[b], lon1: d.lon[b], length_m: (b - a) * 5, from: d.id,
                    geom: JSON.stringify(Array.from({ length: Math.min(60, b - a + 1) }, (_, k) => { const i = a + Math.round(k * (b - a) / (Math.min(60, b - a + 1) - 1)); return [+d.lat[i].toFixed(6), +d.lon[i].toFixed(6)]; })) };
      segs.push(seg); saveSegs(segs); activeSeg = seg.id; sel = null; selLabel = ''; $('segName').value = '';
      renderSegments().then(syncSegments);
    });

    // Optional server sync (sync.js): segments upload when signed in; friends' shared segments can be adopted; the active one can be shared.
    async function syncSegments() {
      const panel = $('segSyncPanel');
      if (!window.ApexSync || !(await ApexSync.member())) { panel.hidden = true; return; }
      panel.hidden = false;
      const sent = await ApexSync.pushSegments(segs); saveSegs(segs);
      $('segSyncNote').textContent = sent ? `Backed up ${sent} stage${sent === 1 ? '' : 's'}.` : '';   // nothing to say when nothing new went up
      const box = $('segShared'); box.innerHTML = '';
      const have = new Set(segs.map(s => s.origin || s.id));
      for (const r of (await ApexSync.sharedWithMe()).filter(r => !have.has(r.origin || r.id))) {
        const b = document.createElement('button'); b.className = 'btn';
        b.textContent = `Add “${r.name}” from @${r.from_handle}`;
        b.onclick = async () => { b.disabled = true; const a = await ApexSync.adopt(r); if (a) { segs.push(a); saveSegs(segs); renderSegments().then(syncSegments); } else b.disabled = false; };
        box.appendChild(b);
      }
      // publish my best run on each synced segment (reaches only friends/crews I granted), then show the friends board for the active one
      await stagePasses();
      for (const s of segs.filter(x => x.synced)) {
        const best = passesFor(s).filter(x => x.p.score != null && /^\d{4}-\d{2}-\d{2}/.test(x.d.date)).sort((p, q) => q.p.score - p.p.score)[0];
        if (best) await ApexSync.publishScore(s.id, best.p.score, best.p.time_s, best.d.date.slice(0, 10), best.p.components ? best.p.components.smoothness : null);
        // each recent day's best too, once, so the board can count days for its local legend (IDEAS S-08)
        let sent = {};
        try { sent = JSON.parse(localStorage.getItem('apex.publishedDays') || '{}') || {}; } catch (_) {}
        for (const b of ApexLegends.toPublish(s.id, ApexLegends.dayBests(passesFor(s)), sent)) {
          if (await ApexSync.publishScore(s.id, b.score, b.time_s, b.day, b.smoothness)) sent[`${s.id}|${b.day}`] = b.score;
        }
        try { localStorage.setItem('apex.publishedDays', JSON.stringify(sent)); } catch (_) {}
      }
      // the weekly time attack: your quickest run this week on each circuit you entered (the server keeps only weeks you entered)
      if (window.ApexTimeAttack) {
        // your place on the week's loop after this sync, said once under the board (SOCIAL 2.9)
        const ta = await ApexTimeAttack.sendRuns(ApexSync, segs, passesFor);
        const line = ta.places.map(ApexTimeAttack.placeLine).filter(Boolean).join(' ');
        if (line) $('segSyncNote').textContent += ` Time attack, ${line}`;
      }
      const act = segs.find(s => s.id === activeSeg), bt = $('segBoard'), bf = $('segBoardFilter');
      const [fr, crewList, rows] = await Promise.all([
        ApexSync.friends(),
        ApexSync.crews ? ApexSync.crews() : Promise.resolve([]),
        act && act.synced ? ApexSync.board(act.origin || act.id) : Promise.resolve([]),
      ]);
      if (boardFilter !== 'friends' && !crewList.some(c => 'crew:' + c.id === boardFilter)) boardFilter = 'friends';
      const drawBoard = async () => {
        bf.innerHTML = ''; $('segLegend').textContent = '';
        const chips = [{ key: 'friends', label: 'Friends' }, ...crewList.map(c => ({ key: 'crew:' + c.id, label: c.name }))];
        for (const ch of chips) {
          const b = document.createElement('button');
          b.className = 'btn' + (boardFilter === ch.key ? ' on' : '');
          b.setAttribute('aria-pressed', String(boardFilter === ch.key));
          b.textContent = ch.label;
          b.onclick = () => { boardFilter = ch.key; drawBoard(); };
          bf.appendChild(b);
        }
        if (!act || !act.synced) { bt.innerHTML = ''; return; }
        let filtered = rows;
        if (boardFilter === 'friends') {
          if (fr.length || crewList.length) {
            const fIds = new Set(fr.map(f => f.id).filter(Boolean));
            const fHandles = new Set(fr.map(f => (f.handle || '').toLowerCase()).filter(Boolean));
            filtered = rows.filter(r => r.mine || (r.user_id && fIds.has(r.user_id)) || (r.handle && fHandles.has(String(r.handle).toLowerCase())));
          }
          if (!filtered.some(r => !r.mine) && filtered.length < 2) {
            // TestFlight 2026-11-05 ("bad text spacing"): an empty board is a sentence that wraps, not one cut in a table cell
            bt.innerHTML = ''; $('segLegend').textContent = 'No friends on this stage yet.';
            return;
          }
        } else {
          const crew = crewList.find(c => 'crew:' + c.id === boardFilter);
          let mems = crew && (Array.isArray(crew.member_list) ? crew.member_list : Array.isArray(crew.members) ? crew.members : null);
          if (!mems && crew) {
            if (!crewMembersCache.has(crew.id)) crewMembersCache.set(crew.id, ApexSync.crewMembers ? await ApexSync.crewMembers(crew.id) : []);
            mems = crewMembersCache.get(crew.id) || [];
          }
          const handles = new Set(), ids = new Set();
          for (const m of mems || []) {
            if (typeof m === 'string') handles.add(m.replace(/^@/, '').toLowerCase());
            else if (m && typeof m === 'object') {
              if (m.handle) handles.add(String(m.handle).replace(/^@/, '').toLowerCase());
              if (m.user_id || m.id) ids.add(m.user_id || m.id);
            }
          }
          filtered = rows.filter(r => (r.handle && handles.has(String(r.handle).toLowerCase())) || (r.user_id && ids.has(r.user_id)) || (r.mine && (mems || []).some(m => m && m.mine)));
          if (!filtered.some(r => !r.mine)) {
            bt.innerHTML = ''; $('segLegend').textContent = 'No runs from this crew on this stage yet.';
            return;
          }
        }
        $('segLegend').textContent = ApexLegends.legendText(ApexLegends.legend(filtered));
        bt.innerHTML = '<tr><th class="l">#</th><th class="l">Driver</th><th>Score</th><th>Time</th></tr>' + filtered.map((r, i) =>
          `<tr class="${r.mine ? 'best' : ''}"><td class="l">${i + 1}</td><td class="l"><b></b></td><td><span class="score">${r.driver_score}</span></td><td>${r.time_s == null ? '--' : mmss(r.time_s)}</td></tr>`).join('');
        bt.querySelectorAll('tr b').forEach((b, i) => { b.textContent = filtered[i].mine ? 'You' : '@' + (filtered[i].handle || '?'); });
      };
      await drawBoard();
      const row = $('segShareRow'); row.innerHTML = '';
      const seg = segs.find(s => s.id === activeSeg);
      if (seg && seg.synced) {
        if (fr.length) {
          // a friend who hasn't picked a handle yet was "@null" here (TestFlight 2026-11-05)
          const sel2 = document.createElement('select'); fr.forEach(f => sel2.add(new Option(f.handle ? '@' + f.handle : 'A friend with no handle yet', f.id)));
          const go = document.createElement('button'); go.className = 'btn'; go.textContent = 'Share stage';
          row.append(Object.assign(document.createElement('p'), { className: 'note share-with', textContent: 'Share this stage with a friend' }));
          go.onclick = async () => { go.textContent = (await ApexSync.shareSegment(seg.id, 'friend', sel2.value)) ? 'Shared' : 'Failed. Try again'; };
          sel2.setAttribute('aria-label', 'Share with'); row.append(sel2, go); ApexRowSelect.enhance(sel2);
        }
      }
    }

    // Road-data contribution: bins of banking, roughness and crests per road, never your path, speed or time (docs/BACKEND.md section 3).
    async function renderContribute() {
      const panel = $('contribPanel'), list = $('contribList'); list.innerHTML = '';
      if (!window.ApexSync || !window.ApexContributor || !(await ApexSync.member())) { panel.hidden = true; return; }
      // eligible: recent, with roughness and curvature (the summary's `feel`); the rows are read only for the one shared
      const ready = drives.filter(d => d.source !== 'profiled' && d.feel && ApexContributor.eligible({ rough: true, kappa: true, date: d.date }) && !d.contributed);
      panel.hidden = false;
      const on = await ApexSync.contributionEnabled();
      $('contribNote').textContent = !on ? 'Off. Turn on Share road feel in the Garage to take part. First to map a road earns 3×, second 2×, then 1×.'
        : ready.length ? 'Recent drives you can share. The first and last kilometre of each drive and small residential roads are left out.' : 'No recent drives to share (drives must be under two weeks old and recorded with the phone app).';
      if (!on) return;
      for (const d of ready) {
        const b = document.createElement('button'); b.className = 'btn'; b.textContent = `Share ${driveLabel(d)}`;
        b.onclick = async () => {
          b.disabled = true; b.textContent = 'Matching roads…';
          try {
            const r = await ApexContributor.contributeDrive(await full(d.id), ApexSync.contribute);
            if (r.sent) { d.contributed = true; await ApexAnalysis.job('patch', { id: d.id, fields: { contributed: true } }); }
            b.textContent = r.skipped ? r.skipped : r.sent ? `Shared ${r.sent} road${r.sent === 1 ? '' : 's'}` : r.built ? 'Nothing new to share' : 'No usable roads. They were too short, private or unmatched.';
          } catch (err) { b.disabled = false; b.textContent = 'Couldn\'t share. Tap to try again.'; b.title = err.message; }
        };
        list.appendChild(b);
      }
    }

    // Every drive's pass over each stage, from the analysis worker (F-06), kept until the drives or the stages change
    const passMemo = { key: null, by: {}, run: null };
    function stagePasses() {
      const key = libKey + '|' + JSON.stringify(segs.map((x) => [x.id, x.lat0, x.lon0, x.lat1, x.lon1, x.length_m]));
      if (passMemo.key !== key) {
        passMemo.key = key;
        passMemo.run = ApexAnalysis.job('passes', { segs: segs.map(({ id, lat0, lon0, lat1, lon1, length_m }) => ({ id, lat0, lon0, lat1, lon1, length_m })) })
          .then((r) => { if (passMemo.key === key) passMemo.by = r.passes || {}; }).catch(() => {});
      }
      return passMemo.run;
    }
    function passesFor(seg) {
      return (passMemo.by[seg.id] || []).map(({ id, p }) => ({ d: summaryOf(id), p })).filter((x) => x.d);
    }
    async function renderSegments() {
      await stagePasses();
      $('segDrive').innerHTML = '';
      drives.forEach(d => $('segDrive').add(new Option(driveLabel(d), d.id)));
      renderSegStrip();
      const list = $('segList');
      // Nothing to mark a stage on until there is a drive: say so instead of showing an empty picker.
      // a stage is marked from a drive (its page's Mark a stage opens the marker here), not started from an empty tab
      $('newStage').hidden = !$('newStage').dataset.fromDrive; $('shareOlder').hidden = !drives.length;   // first visit: open the marker once
      // no stages yet: a stretch of road between its start and finish boards, drawn, then what a stage is and the one way to make one
      list.innerHTML = segs.length ? '' : `<div class="first-page">
        <svg class="fp-mark" viewBox="0 0 320 56" preserveAspectRatio="none" aria-hidden="true"><path d="M4 44 C 50 44, 60 14, 104 16 S 170 46, 214 34 S 280 10, 316 12" stroke-dasharray="3 4"/><path class="ink" d="M104 16 C 140 18, 170 46, 214 34"/><line class="ink" x1="104" y1="6" x2="104" y2="26"/><line class="ink" x1="214" y1="24" x2="214" y2="44"/><circle cx="104" cy="16" r="3.5"/></svg>
        <h2 class="fp-head">No stages yet.</h2>
        <p class="fp-line">A stretch you drive often, each pass timed against your best.</p>
        ${drives.length ? '<button type="button" class="btn solid fp-go" id="segMarkGo">Mark a stage</button>' : '<a class="btn solid fp-go" href="index.html">Start a drive</a><p class="fp-line" style="margin:10px 0 0;text-align:center">Mark one from a drive\u2019s page.</p>'}</div>`;
      // 2026-11-12 (free roamer B): the key opens the marker here on your latest drive (it used to send you to the Drives
      // list with nothing there saying what to do next); the marker's own picker changes the drive
      const go = $('segMarkGo');
      if (go) go.addEventListener('click', () => openMarker(drives[drives.length - 1].id));
      for (const s of segs) {
        const passes = passesFor(s), best = passes.reduce((m, x) => (x.p.score != null && (m == null || x.p.score > m) ? x.p.score : m), null);
        const b = document.createElement('button');
        b.className = 'seg' + (s.id === activeSeg ? ' on' : '');
        b.innerHTML = `<b></b><span class="score" style="font-size:20px">${best ?? UNK}</span><span></span><span>best</span>`;
        b.querySelector('b').textContent = s.name;
        b.querySelectorAll('span')[1].textContent = `${ApexUnits.long(s.length_m, 1)} · ${passes.length} run${passes.length === 1 ? '' : 's'}`;   // a tenth, as everywhere else (it said 21.34 mi)
        b.onclick = () => { activeSeg = activeSeg === s.id ? null : s.id; renderSegments().then(syncSegments); };
        list.appendChild(b);
      }
      const seg = segs.find(s => s.id === activeSeg);
      $('segDetail').hidden = !seg;                                         // board and runs only for the stage you tapped
      $('segTitle').parentElement.hidden = !seg;
      if (!seg) { $('segTable').innerHTML = ''; $('segChart').innerHTML = ''; $('segTitle').textContent = 'Runs'; return; }
      $('segTitle').textContent = `Runs · ${seg.name}`;
      const passes = passesFor(seg).sort((a, b) => (b.p.score ?? -1) - (a.p.score ?? -1));
      const bestTime = Math.min(...passes.map(x => x.p.time_s));
      // TestFlight 2026-11-05 ("bad text spacing"): five columns were wider than a phone, so the table scrolled sideways (the
      // Score cut to "ore", the components' words run together). Now a run is its line (#, run, Score, time) and its four
      // components under it, the whole width; nothing scrolls sideways.
      $('segTable').className = 'runs';
      $('segTable').innerHTML = `<tr><th class="l">#</th><th class="l">Run</th><th>Score</th><th>Time</th></tr>` +
        passes.map((x, i) => `<tr class="run${i === 0 ? ' best' : ''}"><td class="l">${i + 1}</td><td class="l run-name"><b>${dateLabel(x.d)}</b><span class="sub"></span></td>
          <td><span class="score">${x.p.score ?? UNK}</span></td>
          <td>${mmss(x.p.time_s)}<span class="sub">${x.p.time_s === bestTime ? 'quickest' : '+' + (x.p.time_s - bestTime).toFixed(1) + ' s'}</span></td></tr>
          <tr class="run-parts${i === 0 ? ' best' : ''}"><td></td><td class="l" colspan="3">${bars(x.p.components)}</td></tr>`).join('') +
        (passes.length ? '' : '<tr><td class="l" colspan="4"><span class="note">No drive covers this stage in its direction yet.</span></td></tr>');
      // A run is told from the others by when it was driven, so that is its name. The drive's own name goes under it only
      // when it says something the heading doesn't: most drives are named after the road, and the list read "Dry Ridge Rd"
      // on every line under "Runs · Dry Ridge Rd".
      $('segTable').querySelectorAll('tr.run .run-name .sub').forEach((el, i) => { const n = passes[i].d.name; el.textContent = n && n !== seg.name ? n : ''; el.hidden = !el.textContent; });   // a drive's name is text
      const byDate = passes.slice().sort((a, b) => (a.d.date < b.d.date ? -1 : 1)).filter(x => x.p.score != null);
      const W = 600, H = 120, L = 34, T = 10, B = 22;
      const pts = byDate.map((x, i) => [L + (byDate.length < 2 ? 0.5 : i / (byDate.length - 1)) * (W - L - 10), T + (1 - x.p.score / 1000) * (H - T - B), x]);
      $('segChart').innerHTML = byDate.length ? `<svg viewBox="0 0 ${W} ${H}">${[0, 500, 1000].map(v => { const y = T + (1 - v / 1000) * (H - T - B); return `<line x1="${L}" x2="${W - 10}" y1="${y}" y2="${y}" stroke="${C.rule}"/><text x="${L - 5}" y="${y + 3}" text-anchor="end" font-size="10" fill="${C.panelDim}">${v}</text>`; }).join('')}
        <path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join('')}" fill="none" stroke="${C.accent}" stroke-width="2"/>${pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="4.5" fill="${C.accent}"/>`).join('')}</svg>` : '';
    }

    // ---------------------------------------------------------------------
    // COMPARE (corner by corner between two passes)
    // ---------------------------------------------------------------------
    function renderCompareSelectors() {
      for (const s of [$('selA'), $('selB')]) { const keep = s.value; s.innerHTML = ''; drives.forEach(d => s.add(new Option(driveLabel(d), d.id))); if (keep) s.value = keep; }
      if (!$('selA').value && drives[0]) $('selA').value = drives[0].id;
      if ((!$('selB').value || $('selB').value === $('selA').value) && drives[1]) $('selB').value = drives.find(d => d.id !== $('selA').value).id;
    }
    $('selA').onchange = $('selB').onchange = () => renderCompare();
    $('swapBtn').onclick = () => { const a = $('selA').value; $('selA').value = $('selB').value; $('selB').value = a; renderCompare(); };

    // corner by corner in the analysis worker (F-06); drawn on drive A's own rows
    let compareRun = 0;
    async function renderCompare() {
      const a = $('selA').value, b = $('selB').value, run = ++compareRun;
      const B = summaryOf(b);
      // 2026-11-12 (free roamer B): with nothing to compare, one line says why, and the empty Road, Gap and Corner panels
      // (and, with a single drive, the two pickers) are not drawn
      const none = () => {
        $('cards').innerHTML = `<p class="note" style="grid-column:1/-1">${drives.length < 2 ? 'Compare needs two drives. Drive this road again and it lands here.' : 'Pick two different drives.'}</p>`;
        $('cmpRoad').hidden = $('cmpCorners').hidden = true; document.querySelector('.compare-pick').hidden = drives.length < 2;
      };
      if (!summaryOf(a) || !B || a === b) { none(); return; }
      const [A, res] = await Promise.all([full(a), ApexAnalysis.job('compare', { a, b })]);
      if (run !== compareRun) return;                                    // another pair picked meanwhile
      const r = res && res.r;
      if (!A || !r) { none(); return; }
      $('cmpRoad').hidden = $('cmpCorners').hidden = document.querySelector('.compare-pick').hidden = false;
      const c = (v, label, extra, k = '') => `<div class="card"><b class="${k}">${v}</b><span>${label}</span>${extra ? `<em>${extra}</em>` : ''}</div>`;
      $('cards').innerHTML =
        c(ApexUnits.long(r.overlap_m), 'Shared road', `${A.name} ∩ ${B.name}`) +
        c(`${r.matched_corners} / ${A.corners.length}`, 'Corners compared', 'clean passes, no stops') +
        c(fmtS(r.matched_corners ? r.corner_delta_s : null), 'Gap over the corners', `${B.name} against this drive`, cls(r.corner_delta_s));
      // plan
      const { x, y } = Core.localXY(A.lat, A.lon);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < x.length; i++) { x0 = Math.min(x0, x[i]); x1 = Math.max(x1, x[i]); y0 = Math.min(y0, y[i]); y1 = Math.max(y1, y[i]); }
      const W = 400, pad = 14, s = (W - 2 * pad) / Math.max(x1 - x0, y1 - y0, 1), H = Math.round((y1 - y0) * s + 2 * pad);
      const P = (i) => [pad + (x[i] - x0) * s, H - pad - (y[i] - y0) * s];
      const step = Math.max(1, Math.floor(x.length / 900));
      let dpath = '';
      for (let i = 0; i < x.length; i += step) dpath += (i ? 'L' : 'M') + P(i).map(v => v.toFixed(1)).join(' ');
      const placed = [];   // a corner number only where it clears every drawn number by 18 px, else a dot
      const marks = r.corners.map((cc, k) => { const [px, py] = P(cc.apex); const col = cc.stopped || cc.delta_s == null ? C.panelDim : cc.delta_s < 0 ? C.gain : C.signal;
        if (placed.some(([qx, qy]) => Math.hypot(qx - px, qy - py) < 18)) return `<circle cx="${px}" cy="${py}" r="2" fill="${col}"/>`; placed.push([px, py]);
        return `<circle cx="${px}" cy="${py}" r="7" fill="${C.panel}" stroke="${col}" stroke-width="2"/><text x="${px}" y="${py + 3.5}" text-anchor="middle" font-size="9" font-weight="700" fill="${C.panelInk}">${k + 1}</text>`; }).join('');
      $('plan').innerHTML = `<svg viewBox="0 0 ${W} ${H}"><path d="${dpath}" fill="none" stroke="${C.route}" stroke-width="2.5" stroke-linejoin="round"/>${marks}</svg>`;
      // delta chart
      const CW = 760, CH = 260, CL = 46, CR = 10, CT = 12, mid = 150, bottom = CH - 22, total = (A.lat.length - 1) * 5;
      const X = (m) => CL + (m / total) * (CW - CL - CR);
      const vals = r.delta_curve.filter(p => p[1] != null).map(p => p[1]);
      const lim = Math.max(2, ...vals.map(Math.abs));
      const Yd = (v) => CT + (mid - CT) / 2 - (v / lim) * ((mid - CT) / 2 - 4);
      let path = '', pen = false;
      for (const [m, v] of r.delta_curve) { if (v == null) { pen = false; continue; } path += (pen ? 'L' : 'M') + X(m).toFixed(1) + ' ' + Yd(v).toFixed(1); pen = true; }
      const vmax = Math.max(...A.speed_mps) * MPH, Ys = (v) => bottom - (v * MPH / vmax) * (bottom - mid - 10);
      let sp = '';
      const st = Math.max(1, Math.floor(A.speed_mps.length / 700));
      for (let i = 0; i < A.speed_mps.length; i += st) sp += (i ? 'L' : 'M') + X(i * 5).toFixed(1) + ' ' + Ys(A.speed_mps[i]).toFixed(1);
      const bands = r.corners.map((cc, k) => { const a = A.corners[k]; return `<rect x="${X(a.start * 5)}" y="${CT}" width="${Math.max(1.5, X(a.end * 5) - X(a.start * 5))}" height="${bottom - CT}" fill="${C.accent}" opacity="0.13"/>`; }).join('');
      $('chart').innerHTML = `<svg viewBox="0 0 ${CW} ${CH}">${bands}<line x1="${CL}" x2="${CW - CR}" y1="${Yd(0)}" y2="${Yd(0)}" stroke="${C.panelDim}" stroke-width="0.8"/>
        <text x="${CL - 6}" y="${Yd(lim) + 4}" text-anchor="end" font-size="10" fill="${C.panelDim}">+${lim.toFixed(0)}s</text><text x="${CL - 6}" y="${Yd(-lim) + 4}" text-anchor="end" font-size="10" fill="${C.panelDim}">−${lim.toFixed(0)}s</text>
        <path d="${path}" fill="none" stroke="${C.accent}" stroke-width="2"/><line x1="${CL}" x2="${CW - CR}" y1="${mid}" y2="${mid}" stroke="${C.rule}"/>
        <path d="${sp}" fill="none" stroke="${C.panelInk}" stroke-width="1.2" opacity="0.8"/></svg>`;
      // table
      const head = '<tr><th>#</th><th class="l">Corner</th><th>Time A</th><th>Time B</th><th>Δ B−A</th><th>Entry A/B</th><th>Min A/B</th><th>Exit A/B</th><th>Brake ' + (ApexUnits.metric() ? 'm' : 'ft') + ' A/B</th><th>Peak lat g</th><th>Envelope use</th></tr>';
      $('table').innerHTML = head + r.corners.map((cc, k) => {
        const a = cc.a, b = cc.b, n = A.corners[k];
        const tul = Inst.tulipSVG({ type: 'corner', dir: n.dir, severity: n.severity, turnRad: n.turn_rad, mods: n.mods }, C.panelInk, C.accent).replace('class="tulip"', 'class="tul"');
        const pair = (fa, fb) => `${fa}<span class="sub">${b ? fb : '--'}</span>`;
        return `<tr class="${cc.stopped ? 'stopped' : ''}"><td>${k + 1}</td><td class="l">${tul} <b>${cc.code}</b> <span class="sub">${cc.call}${cc.stopped ? ' · stop' : ''}</span></td>
          <td>${a.time_s.toFixed(1)}</td><td>${b ? b.time_s.toFixed(1) : '--'}</td><td class="${cc.stopped ? '' : cls(cc.delta_s)}">${fmtS(cc.delta_s)}</td>
          <td>${pair(mph(a.entry_mps), b && mph(b.entry_mps))}</td><td>${pair(mph(a.min_mps), b && mph(b.min_mps))}</td><td>${pair(mph(a.exit_mps), b && mph(b.exit_mps))}</td>
          <td>${pair(ft(a.brake_m), b && ft(b.brake_m))}</td><td>${pair(a.peak_lat_g.toFixed(2), b && b.peak_lat_g.toFixed(2))}</td>
          <td>${pair(Math.round(a.envelope_use * 100) + '%', b && Math.round(b.envelope_use * 100) + '%')}</td></tr>`;
      }).join('');
    }

    // ---------------------------------------------------------------------
    // DRIVE tab: the newest drive by default, any drive from the picker.
    let dvView = null, dvRun = 0, dvInfo = null, wantDrive = null;
    // F-06: the list's summary names the page at once; the drive's rows (one IndexedDB read) and what it is measured against
    // (the reference, the corner coach, the road's history: analysis_client.js drive, in the worker) fill it as they land
    async function renderDrive() {
      const pick = $('dvPick'), keep = wantDrive || pick.value; pick.innerHTML = ''; wantDrive = null;
      const list = drives.slice().reverse();
      list.forEach(d => pick.add(new Option(driveLabel(d), d.id)));
      const actions = document.querySelector('#tab-drive .actions'); actions.hidden = !list.length;
      if (!list.length) { $('dvTitle').textContent = 'No drives yet'; $('dvNote').textContent = ''; $('dvRoot').innerHTML = '<p class="note">Start a drive on the map, or import a recording in Garage, Your data.</p>'; return; }
      pick.value = list.some(d => d.id === keep) ? keep : list[0].id;
      const id = pick.value, s = summaryOf(id), run = ++dvRun;
      if (dvCurrent && dvCurrent.id !== id) {                            // another drive: nothing of the last one stays on its page
        $('tab-drive').insertBefore(dvActs, $('dvRoot'));
        if (dvView) dvView.destroy();
        dvView = null; dvCurrent = null; dvInfo = null;
        $('dvRoot').replaceChildren(); $('dvDashcam').replaceChildren();
        for (const k of ['dvRoad', 'dvVote', 'dvRecce', 'dvFlyby', 'dvTouch', 'dvBest']) $(k).hidden = true;
      }
      // The drive's name is the page title (you arrive from the Log list); the picker stays only as this view's state.
      $('dvTitle').textContent = s.name;
      $('dvAgain').hidden = !(Number.isFinite(s.len_m) && s.len_m >= 1000);   // panel D-1: a road to drive again, not an errand
      // Round 3 (drive_keep.js): a drive that ended itself, or was recovered after the app closed, says so
      const ended = window.ApexDriveKeep ? ApexDriveKeep.endNote(s) : null;
      $('dvNote').textContent = [dateLabel(s), s.source === 'web-gps' ? 'Recorded on this phone' : s.source === 'imported' ? 'Imported' : 'Example drive', ended].filter(Boolean).join(' · ');
      const [d, info] = await Promise.all([full(id), ApexAnalysis.job('drive', { id }).catch(() => null)]);
      if (run !== dvRun || !d) return;                                   // another drive opened meanwhile
      dvInfo = info || {};
      if (dvView) dvView.destroy();
      const reference = dvInfo.reference || null, coach = dvInfo.coach || null;
      $('tab-drive').insertBefore(dvActs, $('dvRoot'));                // out of the root before it is redrawn
      dvView = ApexDriveView.mount($('dvRoot'), d, { Core, C, MPH, reference, coach, mapPalette: () => look.map }); dvCurrent = d;
      const dvHead = $('dvRoot').querySelector('.dv-head');
      if (dvHead) dvHead.after(dvActs);                                  // the score first, then Replay
      // a video from this drive with its numbers on it (dashcam.js, IDEAS D-11)
      if (window.ApexDashcam && ApexDashcam.supported() && Array.isArray(d.speed_mps) && d.speed_mps.length > 20) {
        const mk = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
        $('dvDashcam').replaceChildren(ApexDashcam.mount({ el: mk, Core, d, fmtSpeed: (v) => `${Math.round(ApexUnits.speed(v))} ${ApexUnits.speedU()}`,
          save: (blob, name, type) => ApexSaveFile.saveFile(blob, name, type) }));
      } else $('dvDashcam').replaceChildren();
      renderRoadHistory(d, dvInfo.road || []);
      renderTouch(dvInfo.touch || null);
      loadRoadFeel(d, dvView);
      renderTags(d);
      renderVote(d);
      renderRecce(d);
      renderFlyby(d).catch(() => { $('dvFlyby').hidden = true; });
    }
    // A drive's own touch (driver_profile.js driveTouch, from the drive job), beside your usual; hidden when it has none
    function renderTouch(t) {
      const lines = window.ApexDriverProfile ? ApexDriverProfile.driveTouchLines(t) : [];
      $('dvTouchList').replaceChildren(...lines.map((x) => { const p = document.createElement('p'); p.className = 'friend-act'; p.textContent = x; return p; }));
      $('dvTouch').hidden = !lines.length;
      // the drive's corners against your records by kind (driveRecords, the same job)
      const best = window.ApexDriverProfile && t && t.records ? ApexDriverProfile.driveRecordLines(t.records, dvCurrent && dvCurrent.id, (at) => ApexFormat.dateTime(at.slice(0, 10))) : [];
      const road = window.ApexDriverProfile && ApexDriverProfile.roadRecordLine && t ? ApexDriverProfile.roadRecordLine(t.road) : null;
      if (road) best.push(road);
      const uneven = window.ApexDriverProfile && ApexDriverProfile.roadUnevenLine && t ? ApexDriverProfile.roadUnevenLine(t.road) : null;   // the road's least even corners
      if (uneven) best.push(uneven);
      // each corner driven three or more times says its cleanest pass and, when another drive holds it, links to that drive
      const P = window.ApexDriverProfile, rows = t && t.road ? (t.road.rows || t.road.held || []) : [];
      if (dvView && dvView.markRecords) dvView.markRecords(rows.map((x) => (typeof x === 'object' && P && P.roadCornerNote ? { ...x, note: P.roadCornerNote(x, (r) => (r.on ? ApexFormat.dateTime(r.on.slice(0, 10)) : null)) } : x)), openDrive);
      $('dvBestList').replaceChildren(...best.map((x) => { const p = document.createElement('p'); p.className = 'friend-act'; p.textContent = x; return p; }));
      $('dvBest').hidden = !best.length;
    }
    // Flyby (flyby.js, IDEAS S-20): friends who drove this drive's stages the same day. Members only; set as text.
    let activityRows = null;
    async function renderFlyby(d) {
      const panel = $('dvFlyby'); panel.hidden = true;
      if (monthOf(d) === null || !window.ApexSync || !(await ApexSync.member())) return;
      const canons = segs.filter((s) => s.synced && Core.segmentPass(s, d)).map((s) => s.origin || s.id);
      if (!canons.length) return;
      if (!activityRows) activityRows = await ApexSync.activity();
      if (dvCurrent !== d) return;                                      // another drive opened meanwhile (the picker can lag the view)
      const groups = ApexFlyby.flyby(activityRows, d.date.slice(0, 10), canons);
      $('dvFlybyList').replaceChildren(...ApexFlyby.lines(groups).map((t) => { const p = document.createElement('p'); p.className = 'friend-act'; p.textContent = t; return p; }));
      panel.hidden = !groups.length;
    }
    // Tags and note on a drive (drive_tags.js, IDEAS D-23): saved on its IndexedDB record, never sent anywhere.
    async function saveTags(d, tags, note) {
      d.tags = ApexDriveTags.normalize(tags); d.note = ApexDriveTags.note(note);
      const s = summaryOf(d.id); if (s) { s.tags = d.tags; s.note = d.note; }            // the list's filter chips
      // written in the worker: the record's one transaction, its summary with it (F-06)
      try { return !!(await ApexAnalysis.job('patch', { id: d.id, fields: { tags: d.tags, note: d.note } })).summary; } catch (_) { return false; }
    }
    function renderTags(d) {
      const box = $('dvTags'), current = ApexDriveTags.normalize(d.tags);
      box.replaceChildren(...ApexDriveTags.offered(drives.filter((x) => x.id !== d.id), current).map((t) => {
        const on = current.some((c) => c.toLowerCase() === t.toLowerCase()), b = document.createElement('button');
        b.className = 'btn' + (on ? ' on' : ''); b.textContent = t; b.setAttribute('aria-pressed', String(on));
        b.addEventListener('click', async () => { await saveTags(d, ApexDriveTags.toggle(d.tags, t), d.note); renderTags(d); });
        return b;
      }));
      $('dvNoteText').value = d.note || '';
    }
    let dvCurrent = null;                                              // the drive the page shows, whole
    const currentDrive = () => (dvCurrent && dvCurrent.id === $('dvPick').value ? dvCurrent : null);
    async function addTag() {
      const d = currentDrive(), inp = $('dvTagNew');
      if (!d || !inp.value.trim()) return;
      if (ApexDriveTags.normalize(d.tags).length >= ApexDriveTags.MAX_TAGS) { $('dvTagsNote').textContent = `At most ${ApexDriveTags.MAX_TAGS} tags on a drive.`; return; }
      await saveTags(d, [...ApexDriveTags.normalize(d.tags), inp.value], d.note); inp.value = ''; renderTags(d);
    }
    $('dvTagAdd').addEventListener('click', addTag);
    $('dvTagNew').addEventListener('keydown', (e) => { if (e.key === 'Enter') addTag(); });
    $('dvNoteText').addEventListener('change', async () => {
      const d = currentDrive(); if (!d) return;
      $('dvTagsNote').textContent = (await saveTags(d, d.tags, $('dvNoteText').value)) ? 'Note saved on this phone.' : 'Couldn\u2019t save the note.';
    });
    // Every scored drive that shares at least 30% of this drive's road, oldest to newest (rows from the analysis worker's
    // drive job): is the driving getting better on this road?
    function renderRoadHistory(d, same) {
      const panel = $('dvRoad');
      if (same.length < 2) { panel.hidden = true; return; }
      panel.hidden = false;
      const W = 760, H = 150, L = 40, R = 14, T = 12, B = 24, sc = same.filter(x => x.score != null);
      const X = (i) => L + (sc.length < 2 ? 0.5 : i / (sc.length - 1)) * (W - L - R), Y = (v) => T + (1 - v / 1000) * (H - T - B);
      const grid = [0, 500, 1000].map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C.rule}"/><text x="${L - 6}" y="${Y(v) + 3}" text-anchor="end" font-size="10" fill="${C.panelDim}">${v}</text>`).join('');
      const line = sc.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(x.score).toFixed(1)}`).join('');
      const dots = sc.map((x, i) => `<circle cx="${X(i)}" cy="${Y(x.score)}" r="${x.self ? 7 : 4.5}" fill="${x.self ? C.accent : C.panel}" stroke="${C.accent}" stroke-width="2"/><text x="${X(i)}" y="${H - 7}" text-anchor="middle" font-size="10" fill="${C.panelDim}">${ApexFormat.dayShort(String(x.date || ''))}</text>`).join('');
      $('dvRoadChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Score on this road over time">${grid}<path d="${line}" fill="none" stroke="${C.accent}" stroke-width="2"/>${dots}</svg>`;
      const last = sc[sc.length - 1];   // the latest and the best, never a "trend" from the first drive to the last (two drives)
      $('dvRoadTable').innerHTML = '<tr><th class="l">Drive</th><th>Score</th><th>Corners</th><th class="l">vs this drive</th></tr>' + same.map(o =>
        `<tr class="${o.self ? 'best' : ''}"><td class="l"><b></b><span class="sub">${o.dateLabel}</span></td><td><span class="score">${o.score ?? UNK}</span></td><td>${o.corners ?? UNK}</td><td class="l">${o.self ? 'this drive' : o.matched ? `${o.delta_s == null ? '--' : slower(o.delta_s)} on ${o.matched} corner${o.matched === 1 ? '' : 's'}` : '--'}</td></tr>`
      ).join('') + `<tr><td class="l" colspan="4"><span class="note">${sc.length > 1 ? `Latest ${last.score} \u00b7 best ${Math.max(...sc.map((x) => x.score))} \u00b7 ${sc.length} scored drives here` : ''}</span></td></tr>`;
      $('dvRoadTable').querySelectorAll('tr td.l b').forEach((b, i) => { if (same[i]) b.textContent = same[i].name; });
    }

    // Road feel from members (banking, roughness) along the drive; members only, silent offline. Cached per drive for the session.
    const feelCache = new Map();
    async function loadRoadFeel(d, view) {
      if (!window.ApexSync || !window.ApexContributor || !d.lat || d.lat.length < 40 || !(await ApexSync.member())) return;
      if (!feelCache.has(d.id)) {
        feelCache.set(d.id, ApexContributor.measuredSeries(d, async (ids) => { const r = await ApexSync.apiFetch(`/api/roads?ways=${ids.join(',')}`); return r.ok ? r.json() : null; }).catch(() => null));
      }
      const s = await feelCache.get(d.id);
      if (s && dvView === view) view.setRoadFeel(s);
    }
    $('dvPick').addEventListener('change', renderDrive);
    // F-06: one view drawn at a time, the one asked for; the others when they are first shown after the drives (or the theme,
    // or the units) changed. The network panels (stages backed up, road feel to share, friends) after the view is up.
    const VIEWS = ['drive', 'history', 'segments', 'compare', 'driving'], dirty = new Set(VIEWS);
    let drawnWidth = 0;
    function renderView(t) {
      if (!drivesLoaded) return;
      dirty.delete(t); drawnWidth = document.documentElement.clientWidth;
      if (t === 'history') renderHistory();
      else if (t === 'drive') renderDrive();
      else if (t === 'segments') renderSegments();
      else if (t === 'compare') { renderCompareSelectors(); renderCompare(); }
      else if (t === 'driving') renderDriving();
    }
    function renderAll() { VIEWS.forEach((v) => dirty.add(v)); renderView(view); }
    const later = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 300));
    function renderPanels() { later(() => { syncSegments(); renderContribute(); renderFriends().catch(() => {}); }); }
    $('newStage').addEventListener('toggle', () => { if ($('newStage').open) renderSegStrip(); });
    // One view at a time: drives list (default), drive detail, stages, compare. No inner tab row.
    let view = 'history';
    function showTab(t) {
      view = t;
      for (const v of VIEWS) $(`tab-${v}`).hidden = v !== t;
      // Stages are part of the Log (REVIEW.md roadmap 9): one tab, a Drives / Stages switch
      $('navLog').classList.add('on'); $('navLog').setAttribute('aria-current', 'page');
      document.querySelectorAll('[data-seg]').forEach(b => { const on = b.dataset.seg === (t === 'segments' ? 'segments' : 'history'); b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
      if (dirty.has(t) || t === 'history') renderView(t);
      else if (t === 'segments') renderSegStrip();
    }
    document.querySelectorAll('a.back').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); showTab(a.dataset.to); toTop(); }));
    const TAB_ALIAS = { log: 'history', stages: 'segments' };
    const dvActs = $('dvActs');
    document.querySelectorAll('[data-seg]').forEach(b => b.addEventListener('click', () => { showTab(b.dataset.seg); toTop(); }));
    // The page scrolls inside <body> (the iOS shell turns off the web view's own scrolling), so reset both.
    function toTop() { document.body.scrollTop = 0; window.scrollTo(0, 0); }
    // iOS ignores user-scalable=no: cancel Safari's page-zoom gesture (charts and maps use their own touch handling).
    document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
    // the focus ring is for the keyboard: it shows once a key has been pressed to move focus, never after a tap or a sheet's own focus()
    document.addEventListener('keydown', (e) => { if (e.key === 'Tab' || e.key.startsWith('Arrow')) document.documentElement.classList.add('kbd'); }, true);
    document.addEventListener('pointerdown', () => document.documentElement.classList.remove('kbd'), true);
    function openDrive(id) { wantDrive = id; dirty.add('drive'); showTab('drive'); toTop(); }
    $('dvReplay').addEventListener('click', () => {
      const id = $('dvPick').value;
      if (id) ApexReturn.open('index.html?drive=' + encodeURIComponent(id) + '&play=1');   // the map page, also from inside its Log frame
    });
    // panel D-1: Drive it again plans this drive's route on the map (cockpit.js driveAgain), from here to its start and along it
    $('dvAgain').addEventListener('click', () => {
      const id = $('dvPick').value;
      if (id) ApexReturn.open('index.html?again=' + encodeURIComponent(id));
    });
    // DA-4 / RA-4 (panel round 2): send the road, not the drive (VI vetoed a public drive link). The link carries the road's
    // line and its name when a road named it (road_link.js), never the score, the time, the date, the drive's ends or who drove
    // it. It opens the road as a route card in Vetta, or on the website. The old link was this drive's id, which opened
    // nothing on anyone else's phone.
    $('dvShare').addEventListener('click', async () => {
      const d = currentDrive(), b = $('dvShare');
      if (!d || !window.ApexRoadLink) return;
      const say = (t) => { b.textContent = t; setTimeout(() => { b.textContent = 'Send the road'; }, 2500); };
      const pts = ApexRoadLink.roadPoints(d.lat, d.lon, d.dist);
      if (!pts) { say('Too short to send'); return; }                 // what is left once its ends stay on the phone
      const name = window.ApexYourRoads && ApexYourRoads.isRoadName(d.name) ? d.name : '';
      const token = ApexRoadLink.encode(pts, name);
      if (!token) { say('Couldn’t send'); return; }
      const url = ApexRoadLink.url(ApexSync.inApp ? ApexSync.apiBase : location.origin, token);
      const text = name ? name + ' · a road to drive' : 'A road to drive';
      const how = await ApexSaveFile.shareLink({ title: name || 'A road on Vetta', text, url });
      if (how === 'copied' || how === 'failed') say(how === 'copied' ? 'Link copied' : 'Couldn’t share');
    });
    // A picture of the drive to share (drive_card.js, IDEAS D-09): the road's outline, score and corner mix, no times or speeds.
    $('dvCard').addEventListener('click', async () => {
      const d = currentDrive();
      if (!d) return;
      const css = getComputedStyle(document.documentElement);
      const cv = ApexDriveCard.drawCard(document.createElement('canvas'), ApexDriveCard.cardModel(d),
        { ...C, fontNum: css.getPropertyValue('--font-num').trim(), fontUi: css.getPropertyValue('--font-ui').trim() });
      const out = await ApexDriveCard.shareCard(cv, `${(d.name || 'drive').replace(/[^A-Za-z0-9 _-]+/g, '').trim() || 'drive'}.png`);
      const b = $('dvCard');
      if (out === 'saved') { b.textContent = 'Card saved'; setTimeout(() => { b.textContent = 'Share card'; }, 2000); }
    });
    // Compare with…: this drive against the best other drive on the same road (the drive job's reference), else any other
    const bestOther = (d) => summaryOf(dvInfo && dvInfo.bestOther) || drives.find((x) => x.id !== d.id) || null;
    // the drive's More menu (⋯) closes on a tap outside it or Escape, like any app's menu
    document.addEventListener('click', (e) => { const m = document.querySelector('.dv-more[open]'); if (m && !m.contains(e.target)) m.open = false; });
    document.addEventListener('keydown', (e) => { const m = document.querySelector('.dv-more[open]'); if (m && e.key === 'Escape') { m.open = false; m.querySelector('summary').focus(); } });
    $('dvStage').addEventListener('click', () => { const id = $('dvPick').value; if (id) location.href = `analysis.html?tab=segments&drive=${encodeURIComponent(id)}`; });
    $('dvCompare').addEventListener('click', () => {
      const id = $('dvPick').value, d = summaryOf(id);
      if (!d) return;
      renderCompareSelectors(); dirty.delete('compare');
      $('selA').value = id;
      const o = bestOther(d);
      if (o) $('selB').value = o.id;
      renderCompare(); showTab('compare'); toTop();
    });
    /** The new-stage marker open on this drive (from the drive-ended card, a drive's page or the empty Stages page). */
    function openMarker(id, scroll = true) {
      const box = $('newStage');
      box.dataset.fromDrive = '1'; box.hidden = false; $('segDrive').value = id; $('segDrive').dispatchEvent(new Event('change')); box.open = true;
      if (scroll) box.scrollIntoView({ block: 'start' });
    }
    // The page a Log URL asks for: ?tab= (log, stages, drive, compare) and a drive (?drive=), here or from the map page
    async function route(search) {
      const p = new URLSearchParams(search), q = p.get('tab'), t = TAB_ALIAS[q] || q, want = p.get('drive');
      const tab = VIEWS.includes(t) ? t : 'history';
      if (!(want && drives.some((x) => x.id === want))) { showTab(tab); return; }
      // Mark a stage from the drive-ended card: this drive picked in the new-stage marker, the marker open
      if (tab === 'segments' && $('segDrive')) {
        showTab('segments');
        if (dirty.has('segments') || !$('segDrive').options.length) await renderSegments();
        openMarker(want, false);
      } else openDrive(want);
    }
    {
      const q = params.get('tab'), t = TAB_ALIAS[q] || q;
      showTab(VIEWS.includes(t) && !params.get('drive') ? t : 'history');
    }
    loadDrives().then(async () => { drivesLoaded = true; await route(location.search); if (dirty.has(view)) renderView(view); renderPanels(); })
      .finally(() => requestAnimationFrame(() => ApexBoot.done()));   // drawn with its drives: lift the cover

    // F-15 (REVIEW_FEEL): the map page keeps this page in its frame, loaded once (hidden, while the map is idle) and never
    // again: it says which page of the Log to show and what changed (index.html openLog, ApexLogHost.changed).
    window.ApexLogFrame = {
      open(url) {
        let u; try { u = new URL(url, location.href); } catch (_) { return; }
        try { history.replaceState(null, '', u.pathname.replace(/^.*\//, '') + u.search); } catch (_) {}
        if (drivesLoaded) route(u.search);
        toTop();
      },
      // 'drives': read the summaries again (redrawn only if they changed); 'theme' / 'units': as the map page now has them
      async changed(what) {
        if (what === 'theme') {
          try { prefs = Object.assign(prefs, JSON.parse(localStorage.getItem('apex.prefs') || 'null') || {}); } catch (_) {}
          const last = window.ApexThemes.last && window.ApexThemes.last();
          look = window.ApexThemes.apply(prefs.themeV === 2 ? prefs.theme : 'roadbook', last ? last.night : !!(prefs.toggles && prefs.toggles.night));
          C = look.colors;
          renderAll(); return;
        }
        if (what === 'units') {
          try { const u = localStorage.getItem('apex.units'); if (u) ApexUnits.set(u); } catch (_) {}
          MPH = ApexUnits.speed(1);
          renderAll(); return;
        }
        if (what === 'drives' && drivesLoaded && (await loadDrives())) { fullCache.clear(); renderAll(); }
      },
      // a view drawn while the frame was hidden has the hidden frame's width: drawn again at the phone's
      shown() { if (drivesLoaded && drawnWidth !== document.documentElement.clientWidth) renderView(view); },
      hidden() {},
    };
  })();
  