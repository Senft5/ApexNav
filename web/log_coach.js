// The Log's coach (Nate 2026-11-16: "it should feel more like it's coaching you, not just listing data"): the one or two
// things worth knowing from your drives, said before you go looking. A headline (the news: a best drive, a drive clearly
// cleaner or rougher than your usual, a part of your driving at its best yet), why (the measured part behind it, beside
// your usual), the trend over your recent drives, and the one thing to work on next (the driver profile's focus).
// Honest by construction (PHILOSOPHY.md, Nate 2026-11-15: never sycophantic): praise only where a drive measured above
// every earlier one, "rougher" said as plainly as "cleaner", a trend only beyond the drive-to-drive spread, and nothing
// at all from too few drives (each field null; the Log says "drive a few more roads"). Technique only, as the Score.
// Pure (tests/test_log_coach.py); the Log draws it (analysis_page.js, #logCoach).
(function (root) {
  'use strict';
  const MIN_DRIVES = 3;        // scored drives before anything is said about "your usual"
  const CLEAR_BY = 40;         // Score points a drive must sit from your usual to be called cleaner or rougher
  const PART_BY = 0.08;        // a Score part (0..1) this far from your usual is the reason
  const TREND_N = 3;           // the last few drives against the few before them
  const TREND_BY = 30;         // points between those medians to say up or down
  const RECENT_DAYS = 14;      // a latest drive older than this is not news
  const PARTS = {              // the Score's technique parts (pace is the Score's own business, never a headline)
    smoothness: { name: 'Smoothness', tip: 'build cornering load gently: squeeze the wheel in, don’t snap it' },
    braking: { name: 'Braking', tip: 'finish braking before you turn in, nothing hard after the apex' },
    consistency: { name: 'Rhythm', tip: 'commit evenly from corner to corner rather than in bursts' },
  };
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const median = (xs) => { const s = xs.slice().sort((a, b) => a - b), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
  const round10 = (x) => Math.round(x / 10) * 10;
  const pct = (x) => Math.round(x * 100);
  const of100 = (now, usual) => `${pct(now)} out of 100 (usually ${pct(usual)})`;
  const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const lc = (t) => t.charAt(0).toLowerCase() + t.slice(1);

  /** The part of drive d furthest from your usual (the median of the drives before it), when it is PART_BY or more:
   *  { k, now, usual, by } (by > 0: better than usual), or null. sign: +1 the best gain, -1 the worst drop. */
  function partMoved(d, before, sign) {
    let pick = null;
    for (const k of Object.keys(PARTS)) {
      const now = d.ds.components && d.ds.components[k];
      const was = before.map((x) => x.ds.components && x.ds.components[k]).filter(finite);
      if (!finite(now) || was.length < MIN_DRIVES) continue;
      // beyond the part's own drive-to-drive spread too (rhythm swings far more than braking): 1.5 median deviations
      const usual = median(was), by = now - usual, spread = 1.5 * median(was.map((x) => Math.abs(x - usual)));
      if (sign * by >= Math.max(PART_BY, spread) && (!pick || sign * by > sign * pick.by)) pick = { k, now, usual, by };
    }
    return pick;
  }

  /** The Score over the recent drives: { dir: 'up' | 'down' | 'steady', from, to, n } or null under TREND_N * 2 drives
   *  (steady from MIN_DRIVES). from/to: rounded to tens, as a trend is not a Score. */
  function trendOf(scored) {
    if (scored.length >= TREND_N * 2) {
      const last = scored.slice(-TREND_N).map((d) => d.ds.score), prev = scored.slice(-TREND_N * 2, -TREND_N).map((d) => d.ds.score);
      const a = median(prev), b = median(last);
      if (Math.abs(b - a) >= TREND_BY) return { dir: b > a ? 'up' : 'down', from: round10(a), to: round10(b), n: TREND_N * 2 };
      return { dir: 'steady', from: round10(a), to: round10(b), n: TREND_N * 2 };
    }
    if (scored.length >= MIN_DRIVES) { const m = median(scored.map((d) => d.ds.score)); return { dir: 'steady', from: round10(m), to: round10(m), n: scored.length }; }
    return null;
  }
  function trendLine(t) {
    if (!t) return null;
    if (t.dir === 'up') return `Your Score is climbing: about ${t.from} to about ${t.to} over your last ${t.n} drives.`;
    if (t.dir === 'down') return `Your Score has slipped: about ${t.from} to about ${t.to} over your last ${t.n} drives.`;
    return `Your Score has held around ${t.to} over your last ${t.n} drives.`;
  }

  /** What to work on next: the driver profile's focus (its skill and tip, and where it shows most), else the weakest
   *  Score part across your recent drives. { skill | part, text } or null. */
  function nextOf(scored, profile, words) {
    const f = profile && profile.focus, W = words && f && words[f.skill];
    if (W && W.tip) {
      const where = f.where && f.where.worse && !['rest', 'later', 'before'].includes(f.where.worse) && words.sideWords ? ` It shows most ${words.sideWords(f.where.split, f.where.worse)}.` : '';
      return { skill: f.skill, text: `Next drive, work on ${lc(W.name)}: ${lc(W.tip)}${where}` };
    }
    const recent = scored.slice(-5).filter((d) => d.ds.components);
    if (recent.length < 2) return null;
    let low = null;
    for (const k of Object.keys(PARTS)) {
      const xs = recent.map((d) => d.ds.components[k]).filter(finite);
      if (xs.length < 2) continue;
      const m = median(xs);
      if (!low || m < low.m) low = { k, m };
    }
    return low && low.m < 0.9 ? { part: low.k, text: `Next drive, work on ${lc(PARTS[low.k].name)}: ${PARTS[low.k].tip}.` } : null;
  }

  /**
   * The brief. drives: the Log's drives ({ id, date, ds: { score, components } }), any order; profile: the driver
   * profile (driver_profile.js profile, or null); words: { [skill]: { name, tip }, sideWords(split, x) } (its WORDS);
   * now: ms; news: the latest scored drive's corner news ({ id, bests: [{ k, by_s, name }] }, analysis_client.js
   * cornerNews, names in the driver's words), or null. { headline, why, next, trend, go, kind } with headline/why/next/
   * trend null where too little is known; go: the drive id the headline is about, { drive, cornerIndex } for a corner,
   * null for none.
   */
  function brief(drives, profile = null, words = null, now = Date.now(), news = null) {
    const scored = (drives || []).filter((d) => d && d.id && d.ds && finite(d.ds.score))
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const out = { headline: null, why: null, next: null, trend: null, go: null, kind: null };
    if (scored.length < MIN_DRIVES) return out;
    const t = trendOf(scored), nx = nextOf(scored, profile, words);
    out.trend = t && t.dir !== 'steady' ? trendLine(t) : null;     // a steady trend is the headline's "usual", not said twice
    out.next = nx ? nx.text : null;
    const last = scored[scored.length - 1], before = scored.slice(0, -1);   // its Score and day sit above the brief (the Log's card)
    const fresh = !finite(Date.parse(last.date)) || now - Date.parse(last.date) <= RECENT_DAYS * 864e5;
    if (fresh) {
      const prevBest = Math.max(...before.map((d) => d.ds.score)), usual = median(before.map((d) => d.ds.score));
      const up = partMoved(last, before, +1), down = partMoved(last, before, -1);
      if (last.ds.score > prevBest) {
        out.kind = 'best'; out.go = last.id;
        out.headline = 'Your best drive yet';
        out.why = `${last.ds.score - prevBest} above your previous best.${up ? ` ${PARTS[up.k].name} carried it: ${of100(up.now, up.usual)}.` : ''}`;
      } else if (last.ds.score - usual >= CLEAR_BY) {
        out.kind = 'cleaner'; out.go = last.id;
        out.headline = `Your latest drive was one of your cleanest`;
        out.why = `Well above your usual ${round10(usual)}.${up ? ` ${PARTS[up.k].name} made the difference: ${of100(up.now, up.usual)}.` : ''}`;
      } else if (usual - last.ds.score >= CLEAR_BY) {
        out.kind = 'rougher'; out.go = last.id;
        out.headline = `Your latest drive was rougher than usual`;
        out.why = `Well under your usual ${round10(usual)}.${down ? ` ${PARTS[down.k].name} is where it went: ${of100(down.now, down.usual)}.` : ''}`;
      } else {
        // a part of the latest drive above every earlier drive's (MIN_DRIVES of them at least): news even on a usual Score
        for (const k of Object.keys(PARTS)) {
          const now = last.ds.components && last.ds.components[k], was = before.map((d) => d.ds.components && d.ds.components[k]).filter(finite);
          if (!finite(now) || was.length < MIN_DRIVES || !(now > Math.max(...was)) || now - median(was) < PART_BY) continue;
          out.kind = 'part_best'; out.go = last.id;
          out.headline = `Your ${lc(PARTS[k].name)} was the best it has been`;
          out.why = `${of100(now, median(was))}.`;
          break;
        }
        // corners this drive took quicker than every earlier pass of them (drive_view.js newBests: 0.2 s or more, inside the
        // sane limit), news on a usual Score: the count, and the biggest by name
        const bests = news && news.id === last.id && Array.isArray(news.bests) ? news.bests.filter((w) => w && Number.isInteger(w.k) && finite(w.by_s)) : [];
        if (!out.headline && bests.length) {
          const top = bests.reduce((m, w) => (w.by_s > m.by_s ? w : m));
          out.kind = 'corners'; out.go = { drive: last.id, cornerIndex: top.k };
          out.headline = bests.length === 1 ? 'A corner quicker than ever' : `${ONES[bests.length] || bests.length} corners quicker than ever`;
          out.why = `${bests.length === 1 ? 'Corner' : 'Most at corner'} ${top.k + 1}${top.name ? ` (${top.name})` : ''}: ${top.by_s.toFixed(1)} s under your best pass before.`;
        }
        if (!out.headline) {                                           // a usual drive, said as one: what you want to know first
          const moved = down || up;
          out.kind = 'usual'; out.go = last.id;
          out.headline = 'A typical drive for you';
          out.why = `Close to your usual ${round10(usual)}.${moved ? ` ${PARTS[moved.k].name} ${moved.by < 0 ? 'dipped' : 'was up'} to ${of100(moved.now, moved.usual)}.` : ''}`;
        }
      }
    }
    if (!out.headline && t && t.dir !== 'steady') {                  // no news from the latest drive: the trend is the news
      out.kind = 'trend';
      out.headline = t.dir === 'up' ? 'Your driving is getting cleaner' : 'Your driving has been rougher lately';
      out.why = out.trend; out.trend = null;
    }
    return out;
  }

  /** The drive the brief's news is about: the newest scored drive's id, or null (the page asks its corner news first). */
  function latestScored(drives) {
    const s = (drives || []).filter((d) => d && d.id && d.ds && finite(d.ds.score)).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    return s.length ? s[s.length - 1].id : null;
  }

  const api = { brief, latestScored, trendOf, trendLine, partMoved, nextOf, PARTS, MIN_DRIVES, CLEAR_BY, PART_BY, TREND_BY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexLogCoach = api;
})(typeof window !== 'undefined' ? window : globalThis);
