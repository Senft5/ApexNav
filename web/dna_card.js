// Your driving DNA (the coordinator's follow-on to ghost duels, 2026-11-14): Your driving's six skills as
// one picture to share, the shape of how you take a corner (the six in the corner's own order, into it, through it, out of
// it), your style in three short words, the kind of corner you are cleanest in, and what has come up since you started.
// Never pace, a speed or a time: it is how you drive, not how fast (the drive card's guardrail). Only a whole picture: all
// six skills measured, or no card (a hexagon with a corner guessed at 0 would draw what was never measured).
// dnaModel() is pure (tests/test_dna_card.py); drawDna() paints it 9:16 in the app's look; the drive card's share sheet sends it.
(function (root) {
  'use strict';
  const W = 1080, H = 1920;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const SKILLS = ['squeeze', 'brake', 'arc', 'entry', 'line', 'exit'];
  // short names for the picture (Your driving's own names, cut to fit round a hexagon)
  const SHORT = { squeeze: 'One braking', brake: 'Brakes done', arc: 'One arc', entry: 'Entry speed', line: 'Patient apex', exit: 'Back to power' };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const SIZE_GAP = 8;   // points between your cleanest and least clean kind of corner before the card names one

  /** How you drive, in up to three words of fact (styleLines' facts, short): braking, where the slowest point is, letting go. */
  function styleWords(st, touch) {
    const out = [];
    if (st && finite(st.trail_share)) out.push(st.trail_share >= 0.5 ? 'Trail-braker' : st.trail_share <= 0.2 ? 'Brakes before turning' : 'Some trail-braking');
    if (st && finite(st.slow_m)) out.push(Math.abs(st.slow_m) < 2.5 ? 'Slowest at the apex' : st.slow_m > 0 ? 'Late apex' : 'Early apex');
    if (touch && finite(touch.release)) out.push(touch.release <= 0.7 ? 'Gentle off the brakes' : touch.release >= 1.3 ? 'Sharp off the brakes' : 'Even on the brakes');
    return out;
  }

  /** The kind of corner you drive cleanest, from Your driving's left/right by size cells: { best, worst } by their mean
   *  measured level, or null when fewer than two kinds are known or they are within SIZE_GAP of each other. */
  function bySize(matrix) {
    const sum = {}, n = {};
    for (const c of matrix || []) {
      if (!c || !c.levels) continue;
      for (const k of SKILLS) if (finite(c.levels[k])) { sum[c.size] = (sum[c.size] || 0) + c.levels[k]; n[c.size] = (n[c.size] || 0) + 1; }
    }
    const kinds = ['tight', 'medium', 'fast'].filter((z) => n[z]).map((z) => [z, sum[z] / n[z]]);
    if (kinds.length < 2) return null;
    kinds.sort((a, b) => b[1] - a[1]);
    const [best, worst] = [kinds[0], kinds[kinds.length - 1]];
    return best[1] - worst[1] >= SIZE_GAP ? { best: best[0], worst: worst[0], best_level: Math.round(best[1]), worst_level: Math.round(worst[1]) } : null;
  }

  const monthName = (m) => (typeof m === 'string' && /^\d{4}-\d{2}/.test(m) ? `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}` : null);

  /** The months read: "Nov 2026", "Sep – Nov 2026", "Dec 2025 – Feb 2026"; null when unknown. */
  function spanText(sp) {
    const [a, b] = Array.isArray(sp) ? sp.map(monthName) : [];
    if (!a || !b) return null;
    if (a === b) return a;
    return a.slice(-4) === b.slice(-4) ? `${a.slice(0, 3)} – ${b}` : `${a} – ${b}`;
  }

  /** Everything the card shows, from Your driving's profile (driver_profile.js profile). null until all six skills are known. */
  function dnaModel(p) {
    if (!p || !p.skills || !SKILLS.every((k) => p.skills[k] && finite(p.skills[k].level))) return null;
    const skills = SKILLS.map((k) => {
      const ch = p.change && p.change[k];
      return { key: k, name: SHORT[k], level: p.skills[k].level, trend: ch && ch.sure ? (ch.delta > 0 ? 'up' : 'down') : null, delta: ch && ch.sure ? ch.delta : null };
    });
    const best = p.strongest && SKILLS.includes(p.strongest) ? p.strongest : skills.reduce((a, b) => (b.level > a.level ? b : a)).key;
    // what came up most since the first month read (a sure change only), at most two
    const ups = skills.filter((s) => s.trend === 'up').sort((a, b) => b.delta - a.delta).slice(0, 2);
    const from = ups.length && p.change[ups[0].key] ? monthName(p.change[ups[0].key].from) : null;
    const span = spanText(p.span);
    return {
      skills, best: { key: best, name: SHORT[best], level: p.skills[best].level },
      style: styleWords(p.style, p.touch), size: bySize(p.matrix),
      ups: ups.map((s) => ({ name: s.name, delta: s.delta })), since: from,
      corners: finite(p.corners) ? p.corners : null, drives: finite(p.drives) ? p.drives : null,
      span,
    };
  }

  /** What a friend sees (PUT /api/me/dna, backend dna.ts): the six levels, the style words and the kind of corner, no more. */
  function wireOf(m) {
    if (!m) return null;
    const skills = {};
    for (const s of m.skills) skills[s.key] = s.level;
    return { skills, style: m.style.slice(0, 3), size: m.size ? m.size.best : null, corners: m.corners, drives: m.drives };
  }

  /** A friend's DNA beside yours (both as wireOf sends them; yours may be null), in words: their style, where they lead
   *  you most and where you lead them most (a skill 5 points apart or more). */
  function compareLines(theirs, mine, who) {
    if (!theirs || !theirs.skills) return [];
    const name = `@${String(who || 'them').replace(/^@/, '')}`, out = [];
    if ((theirs.style || []).length) out.push(`${name}: ${theirs.style.join(' · ')}`);
    if (mine && mine.skills) {
      const gaps = SKILLS.map((k) => [k, theirs.skills[k] - mine.skills[k]]).filter(([, g]) => finite(g));
      const lead = gaps.filter(([, g]) => g >= 5).sort((a, b) => b[1] - a[1])[0], you = gaps.filter(([, g]) => g <= -5).sort((a, b) => a[1] - b[1])[0];
      if (lead) out.push(`${name} leads at ${SHORT[lead[0]]}: ${theirs.skills[lead[0]]} to your ${mine.skills[lead[0]]}`);
      if (you) out.push(`You lead at ${SHORT[you[0]]}: ${mine.skills[you[0]]} to ${theirs.skills[you[0]]}`);
      if (!lead && !you) out.push('Within 5 points of each other at every skill');
    } else out.push('Yours shows here once all six of your skills are measured');
    return out;
  }

  /** The two hexagons as an SVG element (a friend's filled, yours outlined), sized by CSS; doc: the document. */
  function compareSvg(doc, theirs, mine) {
    const NS = 'http://www.w3.org/2000/svg', w = 350, h = 260, c = w / 2, cy = h / 2, R = 92;   // room round it for the skills' names
    const node = (tag, attrs) => { const n = doc.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; };
    const pts = (lv) => SKILLS.map((k, i) => hexPoint(c, cy, R, i, lv(k)).map((x) => x.toFixed(1)).join(',')).join(' ');
    const svg = node('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: 'img', class: 'dna-cmp' });
    for (const ring of [50, 100]) svg.append(node('polygon', { points: pts(() => ring), fill: 'none', stroke: 'currentColor', 'stroke-opacity': 0.25 }));
    svg.append(node('polygon', { points: pts((k) => theirs.skills[k]), class: 'dna-them' }));
    if (mine && mine.skills) svg.append(node('polygon', { points: pts((k) => mine.skills[k]), class: 'dna-you' }));
    SKILLS.forEach((k, i) => {
      const [x, y] = hexPoint(c, cy, R + 12, i, 100), t = node('text', { x: x.toFixed(1), y: (y + (i === 0 ? -4 : i === 3 ? 12 : 4)).toFixed(1),
        'text-anchor': i === 0 || i === 3 ? 'middle' : x > c ? 'start' : 'end', class: 'dna-name' });
      t.textContent = SHORT[k]; svg.append(t);
    });
    svg.setAttribute('aria-label', SKILLS.map((k) => `${SHORT[k]} ${theirs.skills[k]}${mine && mine.skills ? `, you ${mine.skills[k]}` : ''}`).join('; '));
    return svg;
  }

  /** The lines under the hexagon, in order (pure, so the test reads what the picture says). */
  function dnaLines(m) {
    if (!m) return [];
    const out = [`Best: ${m.best.name} ${m.best.level}`];
    if (m.size) out.push(`Cleanest in ${m.size.best} corners`);
    if (m.ups.length) out.push(`Up since ${m.since ? m.since.split(' ')[0] : 'you started'}: ${m.ups.map((u) => `${u.name} +${u.delta}`).join(', ')}`);
    return out;
  }
  /** The line under the title: "212 clean corners · 14 drives · Sep – Nov 2026". */
  function scopeText(m) {
    if (!m) return '';
    return [finite(m.corners) ? `${m.corners} clean corners` : null, finite(m.drives) ? `${m.drives} drive${m.drives === 1 ? '' : 's'}` : null, m.span].filter(Boolean).join(' · ');
  }

  /** The hexagon's corners: skill i at angle -90° + 60° i (the first at the top, then round clockwise), radius by level. */
  function hexPoint(cx, cy, r, i, level) {
    const a = (-90 + 60 * i) * Math.PI / 180, k = Math.max(0, Math.min(100, level)) / 100;
    return [cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k];
  }

  function drawDna(canvas, m, C = {}) {
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    const font = (w, px, fam = C.fontUi || 'system-ui, sans-serif') => `${w} ${px}px ${fam}`;
    const ink = C.panelInk || '#fff', dim = C.panelDim || '#999', accent = C.accent || '#f60';
    g.fillStyle = C.panel || '#111'; g.fillRect(0, 0, W, H);
    g.textBaseline = 'top';
    g.fillStyle = ink; g.font = font(800, 84, C.fontNum); g.fillText('MY DRIVING DNA', 90, 120);
    g.fillStyle = dim; g.font = font(500, 40); g.fillText(scopeText(m), 90, 224);
    // the hexagon: rings at 25/50/75/100, an axis a skill, your shape filled in the accent
    const cx = W / 2, cy = 800, R = 290;
    g.strokeStyle = dim; g.lineWidth = 2; g.globalAlpha = 0.35;
    for (const ring of [25, 50, 75, 100]) {
      g.beginPath();
      for (let i = 0; i < 6; i++) { const [x, y] = hexPoint(cx, cy, R, i, ring); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.closePath(); g.stroke();
    }
    for (let i = 0; i < 6; i++) { const [x, y] = hexPoint(cx, cy, R, i, 100); g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke(); }
    g.globalAlpha = 1;
    g.beginPath();
    m.skills.forEach((s, i) => { const [x, y] = hexPoint(cx, cy, R, i, s.level); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.closePath();
    g.globalAlpha = 0.3; g.fillStyle = accent; g.fill(); g.globalAlpha = 1;
    g.strokeStyle = accent; g.lineWidth = 8; g.lineJoin = 'round'; g.stroke();
    // each skill's name and level outside its corner of the hexagon
    m.skills.forEach((s, i) => {
      // centred on its corner, pushed out past it: above the top one, below the bottom one, beside the four others
      const [hx, y] = hexPoint(cx, cy, R + 60, i, 100), x = i % 3 ? cx + Math.sign(hx - cx) * (R * 0.866 + 130) : hx, top = i === 0 ? y - 100 : i === 3 ? y - 4 : y - 48;
      g.textAlign = 'center';
      g.fillStyle = dim; g.font = font(600, 32); g.fillText(s.name, x, top);
      g.fillStyle = ink; g.font = font(800, 56, C.fontNum);
      g.fillText(`${s.level}${s.trend === 'up' ? ' \u25B4' : s.trend === 'down' ? ' \u25BE' : ''}`, x, top + 40);
    });
    g.textAlign = 'left';
    // style: the three words, then the lines
    const y1 = 1300;
    g.fillStyle = ink; g.fillRect(90, y1, W - 180, 4);
    g.font = font(800, 54, C.fontNum); g.fillStyle = accent;
    g.fillText(m.style.join(' · ') || ' ', 90, y1 + 40, W - 180);
    g.font = font(600, 40); g.fillStyle = ink;
    dnaLines(m).forEach((line, i) => g.fillText(line, 90, y1 + 140 + i * 62, W - 180));
    g.fillStyle = dim; g.font = font(500, 34); g.fillText('How I take a corner, not how fast', 90, H - 170);
    g.fillStyle = accent; g.font = font(800, 40, C.fontNum); g.textAlign = 'right'; g.fillText('VETTA', W - 90, H - 172);
    g.fillStyle = dim; g.font = font(600, 26); g.fillText(root.ApexDriveCard ? root.ApexDriveCard.SITE : 'vettadrive.com', W - 90, H - 132); g.textAlign = 'left';
    return canvas;
  }

  const api = { dnaModel, wireOf, compareLines, compareSvg, spanText, dnaLines, scopeText, styleWords, bySize, hexPoint, drawDna, SKILLS, SHORT, W, H };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexDnaCard = api;
})(typeof window !== 'undefined' ? window : globalThis);
