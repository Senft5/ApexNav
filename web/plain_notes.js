// Pace notes in plain words (IDEAS V-02): the same corners, said the way someone without rally training understands them.
// Built from the note's fields (direction, severity, shape, mods, caution), never by rewriting the rally text. Pure
// (tests/test_plain_notes.py).
//
// Panel round 1, M-1 (docs/design/panel/round-1/margo.md): a call grammar. A pace note is an instruction in the order the
// driver needs it: the warning first, then the corner, then what it does, then the link. One short word per thing, and
// every word of the scale a different sound: hairpin / square / tight / medium / open / easy / slight ("tight", "sharp"
// and "very sharp" were three near-sounds at 60 mph with the window down). No similes ("like a junction", "almost back on
// itself"): "Careful, hairpin left, long", "Square left", "Open left, then careful, square left in 200 feet".
// M-3 / P-2: noteCode() is the one short notation for everything that is not the head (the strip's next cells, the car
// map's plates, the island): plain words when the driver chose them ("TIGHT R", "HAIRPIN L"), real rally notation when
// not ("L4-", "LHP", "SQ L"), never the internal "LAC" / "LSQ" / "RSQ".
(function (root) {
  'use strict';
  // McRae 1 (tightest) to 6 (nearly straight). 1 and 2 are both "tight": the grade stays in the tulip and the rally code.
  const SEVERITY = { 1: 'Tight', 2: 'Tight', 3: 'Medium', 4: 'Open', 5: 'Easy', 6: 'Slight' };
  const MODS = { tightens: 'tightens', opens: 'opens', long: 'long', 'off-camber': 'slopes away', 'over crest': 'over a crest' };
  const CAUTION = ['', 'careful', 'slow down', 'slow right down', 'very slow'];
  const lower = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  const upper = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  /**
   * A corner's kind: { dir: 'L'|'R', kind: 'hairpin'|'square'|1..6|null, grade }, from its fields, or from its rally code
   * ("LSQ", "RAC", "L4-") when a note carries only that (a saved drive's corner list, the strip's own notes). Acute folds
   * into hairpin: a driver treats them the same and no notation has a word for it. null for anything not a corner.
   */
  const CODE_RE = /^([LR])(HP|SQ|AC|([1-6])([+-]?))$/i;
  function kindOf(e) {
    if (!e || (e.type && e.type !== 'corner')) return null;
    const m = CODE_RE.exec(String(e.code || '').trim());
    const dir = e.dir === 'L' || e.dir === 'R' ? e.dir : m ? m[1].toUpperCase() : null;
    if (!dir) return null;
    const shape = e.shape || (m && /^SQ$/i.test(m[2]) ? 'square' : m && /^AC$/i.test(m[2]) ? 'acute' : null);
    if (e.severity === 'HP' || shape === 'hairpin' || shape === 'acute' || (m && /^HP$/i.test(m[2]))) return { dir, kind: 'hairpin', grade: '' };
    if (shape === 'square') return { dir, kind: 'square', grade: '' };
    const sev = e.severity != null && Number.isFinite(+e.severity) && +e.severity >= 1 && +e.severity <= 6 ? Math.round(+e.severity) : m && m[3] ? +m[3] : null;
    const grade = e.grade === '+' || e.grade === '-' ? e.grade : m && m[4] ? m[4] : '';
    return { dir, kind: sev, grade };
  }
  const wordOf = (k) => (k.kind === 'hairpin' ? 'Hairpin' : k.kind === 'square' ? 'Square' : SEVERITY[k.kind] || 'Bend');

  /** The corner's name alone ("Easy right", "Hairpin left"), for the call that names the one after it (U-109). */
  function plainHead(e) {
    if (!e) return '';
    const k = kindOf(e);
    if (!k) return e.type && e.type !== 'corner' && e.call ? String(e.call) : '';
    return `${wordOf(k)} ${k.dir === 'L' ? 'left' : 'right'}`;
  }

  /** One corner (or hazard) in plain words, warning first: "Careful, hairpin left, long". Hazards keep their own call. */
  function plainCall(e) {
    if (!e || (e.type && e.type !== 'corner')) return e ? e.call : '';
    const head = plainHead(e);
    if (!head) return e.call || '';
    const care = CAUTION[e.caution] || '';
    const parts = [care ? upper(care) : '', care ? lower(head) : head, ...(e.mods || []).map((m) => MODS[m] || m)];
    return parts.filter(Boolean).join(', ');
  }

  /** The next corner as a chain names it: its caution and its name ("careful, square left"), no modifiers. */
  function plainNamed(e) {
    if (!kindOf(e)) return lower(plainHead(e));
    const care = CAUTION[e.caution] || '';
    return (care ? `${care}, ` : '') + lower(plainHead(e));
  }

  /**
   * The short notation for a note in `words` ('plain' | 'rally'): plain "TIGHT R", "HAIRPIN L", "SQUARE L"; rally "L4-",
   * "LHP", "SQ L". null for anything not a corner (its own code stands: "CREST", "KEEP R").
   */
  function noteCode(e, words) {
    const k = kindOf(e);
    if (!k) return null;
    if (words === 'plain') return `${wordOf(k).toUpperCase()} ${k.dir}`;
    if (k.kind === 'hairpin') return `${k.dir}HP`;
    if (k.kind === 'square') return `SQ ${k.dir}`;
    return k.kind ? `${k.dir}${k.kind}${k.grade}` : null;
  }

  /**
   * The link to the next note: "then" straight after, else "then N" in the driver's units (REVIEW4 U-93): `units` is
   * ApexUnits (its spokenShort: "then 400 feet", "then a quarter mile"); without it, metres.
   */
  function plainLink(link, units) {
    if (!link) return '';
    if (link === 'into' || link === 'and') return 'then';
    const m = Number(link);
    if (!Number.isFinite(m)) return '';
    const said = units && typeof units.spokenShort === 'function' ? units.spokenShort(m) : `${m} metres`;
    return said ? `then ${said}` : '';
  }

  /**
   * A chain as the page reads it: each note in plain words, joined by "then", each caution in front of the corner it
   * belongs to ("Open left, then careful, square left"). REVIEW5 U-109: a chain whose last note links to the next by a
   * distance names that next note, in `units` (ApexUnits.spokenShort; metres without): "Easy left, then easy right in 400
   * feet". With no next note given the link is dropped ("Easy left"), never "then 400 feet" with nothing after it.
   * opts.next: the note after the chain. opts.card: Hale's delivery (REVIEW.md 4.4), every part its own sentence
   * ("Careful. Tight right. Long."); the words are the same in every pack.
   * Panel round 2 MA-2: the next note is named only while the link is within opts.reachM (note_timing.js chainReachM:
   * 150 m, or 6 s at speed; 150 m when not given). Past it the chain ends at its corner and the next gets its own call.
   * MA-3: opts.advice, the pack's advice for the corner, rides in the call as its last sentence ("Careful, hairpin left,
   * long. Brake before it, not in it.").
   */
  const NAME_NEXT_M = 150;
  function plainChain(chain, units, opts = {}) {
    const parts = [];
    chain.forEach((n, i) => {
      const call = plainCall(n).split(', ');
      if (i) call[0] = `then ${lower(call[0])}`;
      parts.push(...call);
    });
    const last = chain[chain.length - 1], next = opts.next;
    const reach = Number.isFinite(opts.reachM) ? opts.reachM : NAME_NEXT_M;
    if (last && last.link && last.link !== 'into' && last.link !== 'and' && next && Number(last.link) <= reach) {
      const m = Number(last.link);
      const said = !Number.isFinite(m) ? '' : units && typeof units.spokenShort === 'function' ? units.spokenShort(m) : `${m} metres`;
      const named = plainNamed(next);
      if (said && named) parts.push(`then ${named} in ${said}`);
    }
    const text = (opts.card ? parts.map(upper).join('. ') : parts.join(', ')).replace(/\s+/g, ' ').trim();
    return opts.advice ? `${text.replace(/[.\s]+$/, '')}. ${String(opts.advice).trim()}` : text;
  }

  // ---- the same call as clips of the voice pack (web/voice_lines.js TEXT "pl:" tokens) ---------------------------------
  // Plain words used to be spoken whole by the phone's own voice, so a drive in Plain words switched voices on every corner.
  // plainTokens() names the pack's clips for exactly the words plainChain() says (tests/test_voice_coverage.py holds them
  // together); null when a part has no clip (a recce call, a hazard the packs don't say), and the caller speaks the text.
  const KIND_KEY = (k) => (k.kind === 'hairpin' ? 'hairpin' : k.kind === 'square' ? 'square' : SEVERITY[k.kind] ? SEVERITY[k.kind].toLowerCase() : null);
  const MOD_KEY = { tightens: 'tightens', opens: 'opens', long: 'long', 'off-camber': 'off-camber', 'over crest': 'over-crest', banked: 'banked', short: 'short' };
  const MARK_KEY = { 'Stop sign': 'stop', 'Railway crossing': 'level_crossing', 'One-lane bridge': 'one_lane_bridge', 'Speed bump': 'calming',
    'Speed bumps': 'calming_many', 'Deer crossing': 'deer', 'Horse crossing': 'horse', 'Cattle crossing': 'cattle', 'Animal crossing': 'animal',
    'Horse-drawn buggies': 'buggy', 'Covered bridge': 'covered_bridge', 'Water crossing': 'ford', 'Unpaved road': 'unpaved', 'Rough road': 'rough' };
  /** The clip for a hazard's own call ("Crest", "Stop sign"), as web/voice.js codriverTokens names it, or null. */
  function hazardToken(e) {
    if (!e || e.type === 'corner') return null;
    if (e.type === 'mark') return MARK_KEY[String(e.call || '')] ? `mark:${MARK_KEY[String(e.call)]}` : null;
    return ['bump', 'crest', 'dip', 'alpr'].includes(e.type) ? `hazard:${e.type}` : null;
  }
  // one note: [head, ...mods] with "then" folded into the first ("then careful", "then hairpin left")
  function noteTokens(n, then) {
    if (!n || n.recce) return null;
    const k = kindOf(n);
    if (!k) { const h = hazardToken(n); return h ? (then ? ['pl:then', h] : [h]) : null; }
    const key = KIND_KEY(k);
    if (!key) return null;
    const head = `${key}${k.dir}`, out = [];
    if (n.caution >= 1 && n.caution <= 4) out.push(`pl:${then ? 't' : ''}c${n.caution}`, `pl:h:${head}`);
    else out.push(`pl:${then ? 'th' : 'h'}:${head}`);
    for (const m of n.mods || []) { if (!MOD_KEY[m]) return null; out.push(`pl:m:${MOD_KEY[m]}`); }
    return out;
  }
  /** The clips for plainChain(chain, units, opts) (opts.adviceToken: the advice's own clip, for opts.advice), or null. */
  function plainTokens(chain, units, opts = {}) {
    if (!Array.isArray(chain) || !chain.length) return null;
    const out = [];
    for (let i = 0; i < chain.length; i++) { const t = noteTokens(chain[i], i > 0); if (!t) return null; out.push(...t); }
    const last = chain[chain.length - 1], next = opts.next;
    const reach = Number.isFinite(opts.reachM) ? opts.reachM : NAME_NEXT_M;
    if (last && last.link && last.link !== 'into' && last.link !== 'and' && next && Number(last.link) <= reach) {
      const m = Number(last.link);
      const said = !Number.isFinite(m) ? '' : units && typeof units.spokenShort === 'function' ? units.spokenShort(m) : `${m} metres`;
      if (said && plainNamed(next)) {
        const named = noteTokens({ ...next, mods: [] }, true);
        if (!named) return null;
        out.push(...named, `pl:in:${said}`);
      }
    }
    if (opts.advice) { if (!opts.adviceToken) return null; out.push(opts.adviceToken); }
    return out;
  }

  const api = { plainTokens, hazardToken, MARK_KEY, plainCall, plainHead, plainNamed, plainLink, plainChain, noteCode, kindOf, SEVERITY, CAUTION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexPlainNotes = api;
})(typeof window !== 'undefined' ? window : globalThis);
