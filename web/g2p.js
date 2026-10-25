// ApexG2P: English text -> Kokoro (misaki) phonemes with no espeak-ng (GPL) anywhere.
//
// A JavaScript port of the dictionary path of misaki's English G2P (hexgrad/misaki, en.py, Apache-2.0)
// using misaki's own gold/silver dictionaries, plus misaki's non-espeak fallback for unknown words:
// a 1+1 layer BART (PeterReid/graphemes_to_phonemes_en_{us,gb}, Apache-2.0) run here in plain JS.
// Data lives in web/g2p/ (tools/g2p_export.py). Differences from misaki, on purpose:
//  - no spaCy part-of-speech tagger: heteronyms take the dictionary DEFAULT; "a" is the article, "in"
//    the preposition, "I" the pronoun; an ALL-CAPS word before a number ("US 129") is a proper noun
//    (spelled out), "I-40" reads "I 40";
//  - the fallback decodes up to 62 phonemes (misaki's generate() default stops at 18);
//  - only the number forms road names use (cardinals, ordinals, years, decimals); no currency.
// See docs/VOICE.md "Removing espeak-ng (GPL)" and tests/test_g2p.py.
(function (root) {
  'use strict';
  const PRIMARY = '\u02c8', SECONDARY = '\u02cc';
  const VOWELS = new Set('AIOQWYaiu\u00e6\u0251\u0252\u0254\u0259\u025b\u025c\u026a\u028a\u028c\u1d7b');
  const CONSONANTS = new Set('bdfhjklmnpstvwz\u00f0\u014b\u0261\u0279\u027e\u0283\u0292\u02a4\u02a7\u03b8');
  const DIPHTHONGS = new Set('AIOQWY\u02a4\u02a7');
  const PUNCTS = new Set(';:,.!?\u2014\u2026"\u201c\u201d');
  const NON_QUOTE_PUNCTS = new Set(';:,.!?\u2014\u2026');
  const JUNKS = new Set("',-._\u2018\u2019/");
  const US_TAUS = new Set('AIOWYiu\u00e6\u0251\u0259\u025b\u026a\u0279\u028a\u028c');
  const SYMBOLS = { '%': 'percent', '&': 'and', '+': 'plus', '@': 'at' };
  const ORDINALS = new Set(['st', 'nd', 'rd', 'th']);
  const isAlpha = (s) => s.length > 0 && /^\p{L}+$/u.test(s);
  const isAsciiWord = (s) => /^[A-Za-z'-]+$/.test(s);
  const isDigit = (s) => /^[0-9]+$/.test(s);
  const upper = (s) => s.toUpperCase(), lower = (s) => s.toLowerCase();
  const cap = (s) => s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
  const hasVowel = (ps) => [...ps].some(c => VOWELS.has(c));
  const hasStress = (ps) => ps.includes(PRIMARY) || ps.includes(SECONDARY);

  // ---- stress (misaki apply_stress) -------------------------------------------
  function restress(ps) {
    const chars = [...ps];
    const keyed = chars.map((p, i) => {
      if (p !== PRIMARY && p !== SECONDARY) return [i, p];
      let j = i; while (j < chars.length && !VOWELS.has(chars[j])) j++;
      return [j - 0.5, p];
    });
    keyed.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    return keyed.map(k => k[1]).join('');
  }
  function applyStress(ps, stress) {
    if (ps == null || stress == null) return ps;
    if (stress < -1) return ps.replaceAll(PRIMARY, '').replaceAll(SECONDARY, '');
    if (stress === -1 || ((stress === 0 || stress === -0.5) && ps.includes(PRIMARY))) return ps.replaceAll(SECONDARY, '').replaceAll(PRIMARY, SECONDARY);
    if ((stress === 0 || stress === 0.5 || stress === 1) && !hasStress(ps)) return hasVowel(ps) ? restress(SECONDARY + ps) : ps;
    if (stress >= 1 && !ps.includes(PRIMARY) && ps.includes(SECONDARY)) return ps.replaceAll(SECONDARY, PRIMARY);
    if (stress > 1 && !hasStress(ps)) return hasVowel(ps) ? restress(PRIMARY + ps) : ps;
    return ps;
  }
  const stressWeight = (ps) => ps ? [...ps].reduce((s, c) => s + (DIPHTHONGS.has(c) ? 2 : 1), 0) : 0;
  const parentTag = (t) => t == null ? t : t.startsWith('VB') ? 'VERB' : t.startsWith('NN') ? 'NOUN' : (t.startsWith('ADV') || t.startsWith('RB')) ? 'ADV' : (t.startsWith('ADJ') || t.startsWith('JJ')) ? 'ADJ' : t;

  // ---- numbers (num2words English, the forms misaki asks for) -----------------
  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const SCALES = [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
  function cardinal(n) { // words only; misaki drops "and" and splits on non-letters anyway
    if (n < 20) return [ONES[n]];
    if (n < 100) return n % 10 ? [TENS[Math.floor(n / 10)], ONES[n % 10]] : [TENS[n / 10]];
    if (n < 1000) return [ONES[Math.floor(n / 100)], 'hundred', ...(n % 100 ? cardinal(n % 100) : [])];
    for (const [v, w] of SCALES) if (n >= v) return [...cardinal(Math.floor(n / v)), w, ...(n % v ? cardinal(n % v) : [])];
    return [String(n)];
  }
  const ORD_IRREG = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
  function ordinal(n) {
    const w = cardinal(n), last = w.pop();
    return [...w, ORD_IRREG[last] || (last.endsWith('y') ? last.slice(0, -1) + 'ieth' : last + 'th')];
  }
  function year(n) {
    const high = Math.floor(n / 100), low = n % 100;
    if (high === 0 || (high % 10 === 0 && low < 10) || high >= 100) return cardinal(n);
    return [...cardinal(high), ...(low === 0 ? ['hundred'] : low < 10 ? ['oh', ...cardinal(low)] : cardinal(low))];
  }
  function isNumber(word, isHead) {
    if (![...word].some(c => c >= '0' && c <= '9')) return false;
    for (const s of ['ing', "'d", 'ed', "'s", 'st', 'nd', 'rd', 'th', 's']) if (word.endsWith(s)) { word = word.slice(0, -s.length); break; }
    return [...word].every((c, i) => (c >= '0' && c <= '9') || c === ',' || c === '.' || (isHead && i === 0 && c === '-'));
  }

  // ---- lexicon (misaki Lexicon, untagged) --------------------------------------
  class Lexicon {
    constructor(data, british, places) { this.g = data.gold; this.s = data.silver; this.british = british; this.places = places || {}; }
    // misaki grow_dictionary: "word" also answers "Word" and "Word" also answers "word"; exact keys win.
    static get(d, w) {
      if (Object.prototype.hasOwnProperty.call(d, w)) return d[w];
      if (w.length < 2) return undefined;
      if (w === lower(w) && w !== cap(w)) { const k = cap(w); if (Object.prototype.hasOwnProperty.call(d, k) && k === cap(lower(k))) return d[k]; }
      else if (w === cap(w)) { const k = lower(w); if (Object.prototype.hasOwnProperty.call(d, k) && k !== cap(k)) return d[k]; }
      return undefined;
    }
    gold(w) { return Lexicon.get(this.g, w); }
    silver(w) { return Lexicon.get(this.s, w); }
    getNNP(word) {
      const ps = [...word].filter(c => isAlpha(c)).map(c => this.gold(upper(c)));
      if (!ps.length || ps.some(p => typeof p !== 'string')) return [null, null];
      const s = applyStress(ps.join(''), 0);
      const k = s.lastIndexOf(SECONDARY);
      return [k < 0 ? s : s.slice(0, k) + PRIMARY + s.slice(k + 1), 3];
    }
    specialCase(word, tag, stress, ctx) {
      if (SYMBOLS[word]) return this.lookup(SYMBOLS[word], null, null, ctx);
      const core = word.replace(/^\.+|\.+$/g, '');
      if (core.includes('.') && isAlpha(word.replaceAll('.', '')) && Math.max(...word.split('.').map(s => s.length)) < 3) return this.getNNP(word);
      if (tag === 'NNP') return [null, null];
      if (word === 'a' || word === 'A') return ['\u0250', 4];
      if (word === 'am' || word === 'Am' || word === 'AM') {
        if (ctx.futureVowel == null || word !== 'am' || (stress && stress > 0)) return [this.gold('am'), 4];
        return ['\u0250m', 4];
      }
      if (word === 'an' || word === 'An' || word === 'AN') return ['\u0250n', 4];
      if (word === 'I') return [`${SECONDARY}I`, 4];
      if (word === 'to' || word === 'To') return [ctx.futureVowel == null ? this.gold('to') : ctx.futureVowel ? 't\u028a' : 't\u0259', 4];
      if (word === 'in' || word === 'In') return [(ctx.futureVowel == null ? PRIMARY : '') + '\u026an', 4];
      if (word === 'the' || word === 'The') return [ctx.futureVowel === true ? '\u00f0i' : '\u00f0\u0259', 4];
      if (/^vs\.?$/i.test(word)) return this.lookup('versus', null, null, ctx);
      return [null, null];
    }
    isKnown(word) {
      if (this.gold(word) !== undefined || SYMBOLS[word] || this.silver(word) !== undefined) return true;
      if (!isAlpha(word) || !/^[A-Za-z'-]+$/.test(word)) return false;
      if (word.length === 1) return true;
      if (word === upper(word) && this.gold(lower(word)) !== undefined) return true;
      return word.slice(1) === upper(word.slice(1));
    }
    lookup(word, tag, stress, ctx) {
      let isNNP = null;
      if (word === upper(word) && this.gold(word) === undefined) { word = lower(word); isNNP = tag === 'NNP'; }
      let ps = this.gold(word), rating = 4;
      if (ps === undefined) ps = null;
      if (ps == null && !isNNP) { ps = this.silver(word); rating = 3; if (ps === undefined) ps = null; }
      if (ps && typeof ps === 'object') {
        let t = tag;
        if (ctx && ctx.futureVowel == null && 'None' in ps) t = 'None';
        else if (t == null || !(t in ps)) t = parentTag(t);
        ps = (t != null && t in ps) ? ps[t] : ps.DEFAULT;
      }
      if (ps == null || (isNNP && !ps.includes(PRIMARY))) {
        const [p, r] = this.getNNP(word);
        if (p != null) return [p, r];
      }
      return [applyStress(ps, stress), rating];
    }
    _s(st) { if (!st) return null; const c = st.at(-1); return 'ptkf\u03b8'.includes(c) ? st + 's' : 'sz\u0283\u0292\u02a7\u02a4'.includes(c) ? st + (this.british ? '\u026a' : '\u1d7b') + 'z' : st + 'z'; }
    stemS(word, tag, stress, ctx) {
      if (word.length < 3 || !word.endsWith('s')) return [null, null];
      let stem;
      if (!word.endsWith('ss') && this.isKnown(word.slice(0, -1))) stem = word.slice(0, -1);
      else if ((word.endsWith("'s") || (word.length > 4 && word.endsWith('es') && !word.endsWith('ies'))) && this.isKnown(word.slice(0, -2))) stem = word.slice(0, -2);
      else if (word.length > 4 && word.endsWith('ies') && this.isKnown(word.slice(0, -3) + 'y')) stem = word.slice(0, -3) + 'y';
      else return [null, null];
      const [p, r] = this.lookup(stem, tag, stress, ctx);
      return [this._s(p), r];
    }
    _ed(st) {
      if (!st) return null;
      const c = st.at(-1);
      if ('pkf\u03b8\u0283s\u02a7'.includes(c)) return st + 't';
      if (c === 'd') return st + (this.british ? '\u026a' : '\u1d7b') + 'd';
      if (c !== 't') return st + 'd';
      if (this.british || st.length < 2) return st + '\u026ad';
      if (US_TAUS.has(st.at(-2))) return st.slice(0, -1) + '\u027e\u1d7bd';
      return st + '\u1d7bd';
    }
    stemEd(word, tag, stress, ctx) {
      if (word.length < 4 || !word.endsWith('d')) return [null, null];
      let stem;
      if (!word.endsWith('dd') && this.isKnown(word.slice(0, -1))) stem = word.slice(0, -1);
      else if (word.length > 4 && word.endsWith('ed') && !word.endsWith('eed') && this.isKnown(word.slice(0, -2))) stem = word.slice(0, -2);
      else return [null, null];
      const [p, r] = this.lookup(stem, tag, stress, ctx);
      return [this._ed(p), r];
    }
    _ing(st) {
      if (!st) return null;
      if (this.british) { if ('\u0259\u02d0'.includes(st.at(-1))) return null; }
      else if (st.length > 1 && st.at(-1) === 't' && US_TAUS.has(st.at(-2))) return st.slice(0, -1) + '\u027e\u026a\u014b';
      return st + '\u026a\u014b';
    }
    stemIng(word, tag, stress, ctx) {
      if (word.length < 5 || !word.endsWith('ing')) return [null, null];
      let stem;
      if (word.length > 5 && this.isKnown(word.slice(0, -3))) stem = word.slice(0, -3);
      else if (this.isKnown(word.slice(0, -3) + 'e')) stem = word.slice(0, -3) + 'e';
      else if (word.length > 5 && /([bcdgklmnprstvxz])\1ing$|cking$/.test(word) && this.isKnown(word.slice(0, -4))) stem = word.slice(0, -4);
      else return [null, null];
      const [p, r] = this.lookup(stem, tag, stress, ctx);
      return [this._ing(p), r];
    }
    getWord(word, tag, stress, ctx) {
      // App place-name lexicon (web/g2p/places.json): hand-written names the fallback gets wrong.
      if (Object.prototype.hasOwnProperty.call(this.places, word)) return [this.places[word], 5];
      const sc = this.specialCase(word, tag, stress, ctx);
      if (sc[0] != null) return sc;
      const wl = lower(word);
      if (word.length > 1 && isAlpha(word.replaceAll("'", '')) && word !== wl && (tag !== 'NNP' || word.length > 7) &&
          this.gold(word) === undefined && this.silver(word) === undefined && (word === upper(word) || word.slice(1) === lower(word.slice(1))) &&
          (this.gold(wl) !== undefined || this.silver(wl) !== undefined || [this.stemS, this.stemEd, this.stemIng].some(fn => fn.call(this, wl, tag, stress, ctx)[0]))) word = wl;
      if (this.isKnown(word)) return this.lookup(word, tag, stress, ctx);
      if (word.endsWith("s'") && this.isKnown(word.slice(0, -2) + "'s")) return this.lookup(word.slice(0, -2) + "'s", tag, stress, ctx);
      if (word.endsWith("'") && this.isKnown(word.slice(0, -1))) return this.lookup(word.slice(0, -1), tag, stress, ctx);
      for (const [fn, st] of [[this.stemS, stress], [this.stemEd, stress], [this.stemIng, stress == null ? 0.5 : stress]]) {
        const r = fn.call(this, word, tag, st, ctx);
        if (r[0] != null) return r;
      }
      return [null, null];
    }
    getNumber(word, isHead) {
      const m = word.match(/[a-z']+$/);
      const suffix = m ? m[0] : null;
      if (suffix) word = word.slice(0, -suffix.length);
      const out = [];
      if (word.startsWith('-')) { out.push(this.lookup('minus', null, null, null)[0]); word = word.slice(1); }
      const say = (words) => { for (const w of words) out.push(this.lookup(w, null, w === 'point' ? -2 : null, null)[0]); };
      const plain = word.replaceAll(',', '');
      if (isDigit(word) && ORDINALS.has(suffix)) say(ordinal(+word));
      else if (!out.length && word.length === 4 && isDigit(word)) say(year(+word));
      else if ((word.match(/\./g) || []).length > 1) {
        for (const part of plain.split('.')) if (part) { if (part[0] === '0' || (part.length !== 2 && [...part.slice(1)].some(c => c !== '0'))) for (const d of part) say(cardinal(+d)); else say(cardinal(+part)); }
      } else if (isDigit(plain)) say(ORDINALS.has(suffix) ? ordinal(+plain) : cardinal(+plain));
      else if (/^\d*\.\d+$/.test(plain)) {
        const [a, b] = plain.split('.');
        say([...(a ? cardinal(+a) : []), 'point', ...[...b].flatMap(d => cardinal(+d))]);
      } else return [null, null];
      if (!out.length || out.some(p => p == null)) return [null, null];
      const res = out.join(' ');
      if (suffix === 's' || suffix === "'s") return [this._s(res), 3];
      if (suffix === 'ed' || suffix === "'d") return [this._ed(res), 3];
      if (suffix === 'ing') return [this._ing(res), 3];
      return [res, 3];
    }
    // misaki Lexicon.__call__
    word(text, tag, ctx) {
      let word = text.replace(/[\u2018\u2019]/g, "'").normalize('NFKC');
      const stress = word === lower(word) ? null : word === upper(word) ? 2 : 0.5;
      const [ps] = this.getWord(word, tag, stress, ctx);
      if (ps != null) return ps;
      if (isNumber(word, true)) return this.getNumber(word, true)[0];
      return null;
    }
  }

  // ---- fallback: misaki's BART letter-to-sound model, in plain JS ---------------
  function parseSafetensors(buf) {
    const dv = new DataView(buf);
    const n = Number(dv.getBigUint64(0, true));
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, n)));
    const T = {};
    for (const [k, v] of Object.entries(header)) {
      if (k === '__metadata__') continue;
      if (v.dtype !== 'F32') throw new Error(`g2p: ${k} is ${v.dtype}`);
      T[k] = new Float32Array(buf.slice(8 + n + v.data_offsets[0], 8 + n + v.data_offsets[1]));
    }
    return T;
  }
  // erf, Numerical Recipes erfc Chebyshev fit (fractional error < 1.2e-7)
  function erf(x) {
    const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
    const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
      t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? 1 - r : r - 1;
  }
  class Bart {
    constructor(buf, meta) {
      this.W = parseSafetensors(buf);
      this.d = meta.d_model; this.maxPos = meta.max_position_embeddings;
      this.g2i = new Map([...meta.grapheme_chars].map((c, i) => [c, i]).filter(([c, i]) => i > 3));
      this.phon = [...meta.phoneme_chars];
      this.vocab = this.W['model.shared.weight'].length / this.d;
    }
    lin(x, rows, name, out, inp) { // x: rows x inp -> rows x out (torch Linear, W is out x inp)
      const W = this.W[name + '.weight'], b = this.W[name + '.bias'], y = new Float32Array(rows * out);
      for (let r = 0; r < rows; r++) for (let o = 0; o < out; o++) {
        let s = b[o]; const xo = r * inp, wo = o * inp;
        for (let i = 0; i < inp; i++) s += x[xo + i] * W[wo + i];
        y[r * out + o] = s;
      }
      return y;
    }
    ln(x, rows, name) {
      const g = this.W[name + '.weight'], b = this.W[name + '.bias'], d = this.d, y = new Float32Array(x.length);
      for (let r = 0; r < rows; r++) {
        let m = 0, v = 0;
        for (let i = 0; i < d; i++) m += x[r * d + i];
        m /= d;
        for (let i = 0; i < d; i++) { const e = x[r * d + i] - m; v += e * e; }
        const inv = 1 / Math.sqrt(v / d + 1e-5);
        for (let i = 0; i < d; i++) y[r * d + i] = (x[r * d + i] - m) * inv * g[i] + b[i];
      }
      return y;
    }
    attn(xq, nq, xkv, nkv, name, causal) {
      const d = this.d, scale = 1 / Math.sqrt(d);
      const q = this.lin(xq, nq, name + '.q_proj', d, d), k = this.lin(xkv, nkv, name + '.k_proj', d, d), v = this.lin(xkv, nkv, name + '.v_proj', d, d);
      const o = new Float32Array(nq * d), w = new Float64Array(nkv);
      for (let i = 0; i < nq; i++) {
        let mx = -Infinity; const lim = causal ? i + 1 : nkv;
        for (let j = 0; j < lim; j++) { let s = 0; for (let c = 0; c < d; c++) s += q[i * d + c] * k[j * d + c]; w[j] = s * scale; if (w[j] > mx) mx = w[j]; }
        let z = 0; for (let j = 0; j < lim; j++) { w[j] = Math.exp(w[j] - mx); z += w[j]; }
        for (let j = 0; j < lim; j++) { const a = w[j] / z; for (let c = 0; c < d; c++) o[i * d + c] += a * v[j * d + c]; }
      }
      return this.lin(o, nq, name + '.out_proj', d, d);
    }
    ffn(x, n, name) {
      const ff = this.W[name + '.fc1.bias'].length;
      const h = this.lin(x, n, name + '.fc1', ff, this.d);
      for (let i = 0; i < h.length; i++) h[i] = 0.5 * h[i] * (1 + erf(h[i] / Math.SQRT2));
      return this.lin(h, n, name + '.fc2', this.d, ff);
    }
    embed(ids, part) {
      const d = this.d, E = this.W['model.shared.weight'], P = this.W[`model.${part}.embed_positions.weight`], x = new Float32Array(ids.length * d);
      ids.forEach((id, t) => { for (let i = 0; i < d; i++) x[t * d + i] = E[id * d + i] + P[(t + 2) * d + i]; });
      return this.ln(x, ids.length, `model.${part}.layernorm_embedding`);
    }
    add(a, b) { const y = new Float32Array(a.length); for (let i = 0; i < a.length; i++) y[i] = a[i] + b[i]; return y; }
    // Greedy decode, as transformers generate() with this model's generation config, max_length 64.
    phonemize(text) {
      const ids = [1, ...[...text].map(c => this.g2i.get(c) ?? 3), 2].slice(0, this.maxPos);
      if (ids.at(-1) !== 2) ids[ids.length - 1] = 2;
      const n = ids.length, L = 'model.encoder.layers.0', D = 'model.decoder.layers.0';
      let h = this.embed(ids, 'encoder');
      h = this.ln(this.add(h, this.attn(h, n, h, n, L + '.self_attn', false)), n, L + '.self_attn_layer_norm');
      const enc = this.ln(this.add(h, this.ffn(h, n, L)), n, L + '.final_layer_norm');
      const out = [1], E = this.W['model.shared.weight'], bias = this.W.final_logits_bias, d = this.d;
      while (out.length < this.maxPos) {
        const m = out.length;
        let y = this.embed(out, 'decoder');
        y = this.ln(this.add(y, this.attn(y, m, y, m, D + '.self_attn', true)), m, D + '.self_attn_layer_norm');
        y = this.ln(this.add(y, this.attn(y, m, enc, n, D + '.encoder_attn', false)), m, D + '.encoder_attn_layer_norm');
        y = this.ln(this.add(y, this.ffn(y, m, D)), m, D + '.final_layer_norm');
        let best = 2;
        if (m < this.maxPos - 1) {
          let bv = -Infinity;
          for (let t = 0; t < this.vocab; t++) {
            let s = bias[t]; for (let i = 0; i < d; i++) s += y[(m - 1) * d + i] * E[t * d + i];
            if (s > bv) { bv = s; best = t; }
          }
        }
        out.push(best);
        if (best === 2) break;
      }
      return out.filter(t => t > 3).map(t => this.phon[t] || '').join('');
    }
  }

  // ---- text -> tokens (spaCy-free stand-in for misaki's tokenize/retokenize) -----
  const ABBREV = { Hwy: 'Highway', Pkwy: 'Parkway', Rd: 'Road', Ave: 'Avenue', Blvd: 'Boulevard', Mt: 'Mount', Ln: 'Lane', Fwy: 'Freeway', Expy: 'Expressway', Tpke: 'Turnpike' };
  function normalize(text) {
    return text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\(/g, '\u201c').replace(/\)/g, '\u201d').replace(/[\u2013]/g, '-')
      .replace(/\b(Hwy|Pkwy|Rd|Ave|Blvd|Mt|Ln|Fwy|Expy|Tpke)\b\.?/g, (_, a) => ABBREV[a])
      .replace(/\bSt\b\.?(?= [A-Z][a-z])/g, 'Saint').replace(/\bSt\b\.?/g, 'Street').replace(/\bDr\b\.?(?=\s*[,.;]|\s*$)/g, 'Drive')
      .replace(/\b([A-Z]{1,3})-(\d{1,4})\b/g, '$1 $2')
      .replace(/(?<=\d),(?=\d{3}\b)/g, '').replace(/[^\S\n]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
  }
  const SUBTOKEN = /^['\u2018\u2019]+|\p{Lu}(?=\p{Lu}\p{Ll})|(?:^-)?(?:\d?[,.]?\d)+|[-_]+|['\u2018\u2019]{2,}|\p{L}*?(?:['\u2018\u2019]\p{L})*?\p{Ll}(?=\p{Lu})|\p{L}+(?:['\u2018\u2019]\p{L})*|[^-_\p{L}'\u2018\u2019\d]|['\u2018\u2019]+$/gu;
  const subtokenize = (w) => [...w.matchAll(SUBTOKEN)].map(m => m[0]).filter(Boolean);
  const EDGE = /^[;:,.!?\u2014\u2026"\u201c\u201d]+|[;:,.!?\u2014\u2026"\u201c\u201d]+$/g;
  function tokenize(text) {
    const toks = [];
    for (const m of text.matchAll(/(\S+)(\s*)/g)) {
      const chunk = m[1], ws = m[2] ? ' ' : '';
      const lead = chunk.match(/^[;:,.!?\u2014\u2026"\u201c\u201d]+/);
      let trail = chunk.match(/[;:,.!?\u2014\u2026"\u201c\u201d]+$/);
      if (lead && lead[0] === chunk) { toks.push({ punct: true, text: chunk, ws }); continue; }
      if (chunk === '-' || chunk === '--') { toks.push({ punct: true, text: '\u2014', ws }); continue; }
      let core = chunk.replace(EDGE, '');
      // initials keep their dot ("H.", "J.F."), as spaCy does: the dot is silent there.
      if (trail && trail[0].startsWith('.') && /^(?:[A-Za-z]\.)*[A-Za-z]$/.test(core)) {
        core += '.'; trail[0] = trail[0].slice(1);
        if (!trail[0]) trail = null;
      }
      if (lead) toks.push({ punct: true, text: lead[0], ws: '' });
      toks.push({ text: core, ws: trail ? '' : ws });
      if (trail) toks.push({ punct: true, text: trail[0], ws });
    }
    // proper-noun hint for road refs: an ALL-CAPS word right before a number is spelled out ("US 129").
    toks.forEach((t, i) => {
      const nx = toks[i + 1];
      if (!t.punct && /^[A-Z]{1,4}$/.test(t.text) && nx && !nx.punct && /^\d/.test(nx.text)) t.tag = 'NNP';
    });
    return toks;
  }

  function tokenContext(ctx, ps, text) {
    let vowel = ctx.futureVowel;
    if (ps) for (const c of ps) if (VOWELS.has(c) || CONSONANTS.has(c) || NON_QUOTE_PUNCTS.has(c)) { vowel = NON_QUOTE_PUNCTS.has(c) ? null : VOWELS.has(c); break; }
    return { futureVowel: vowel, futureTo: text === 'to' || text === 'To' };
  }
  function resolveGroup(w) { // misaki G2P.resolve_tokens
    const text = w.map(t => t.text).join('');
    const kinds = new Set([...text].filter(c => !JUNKS.has(c)).map(c => isAlpha(c) ? 0 : isDigit(c) ? 1 : 2));
    const prespace = text.includes(' ') || text.includes('/') || kinds.size > 1;
    w.forEach((t, i) => {
      if (t.ps == null) {
        if (i === w.length - 1 && NON_QUOTE_PUNCTS.has(t.text)) t.ps = t.text;
        else if ([...t.text].every(c => JUNKS.has(c))) t.ps = '';
      } else if (i > 0) t.prespace = prespace;
    });
    if (prespace) return;
    let idx = w.map((t, i) => [t.ps && t.ps.includes(PRIMARY) ? 1 : 0, stressWeight(t.ps), i]).filter(([, , i]) => w[i].ps);
    if (idx.length === 2 && w[idx[0][2]].text.length === 1) { const i = idx[1][2]; w[i].ps = applyStress(w[i].ps, -0.5); return; }
    if (idx.length < 2 || idx.reduce((s, x) => s + x[0], 0) <= Math.floor((idx.length + 1) / 2)) return;
    idx = idx.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).slice(0, Math.floor(idx.length / 2));
    for (const [, , i] of idx) w[i].ps = applyStress(w[i].ps, -0.5);
  }

  function create({ lexicon, british, fallback = null, fallbackMeta = null, places = null }) {
    const acc = british ? 'gb' : 'us';
    const lex = new Lexicon(lexicon, !!british, places && Object.fromEntries(Object.entries(places.words || {}).filter(([, v]) => v[acc]).map(([k, v]) => [k, v[acc]])));
    const bart = fallback && fallbackMeta ? new Bart(fallback, fallbackMeta) : null;
    const fb = (text) => bart ? bart.phonemize(text) : null;
    // Returns { phonemes, oov: [words voiced by the fallback], unknown: [words not voiced at all] }.
    function phonemize(input) {
      const toks = tokenize(normalize(input));
      const oov = [], unknown = [];
      let ctx = { futureVowel: null, futureTo: false };
      for (let i = toks.length - 1; i >= 0; i--) {
        const tk = toks[i];
        if (tk.punct) {
          tk.ps = [...tk.text].filter(c => PUNCTS.has(c)).join('');
          ctx = tokenContext(ctx, tk.ps, tk.text);
          continue;
        }
        const w = subtokenize(tk.text).map(text => ({ text, ps: null }));
        if (w.length <= 1) {
          tk.ps = lex.word(tk.text, tk.tag || null, ctx);
          if (tk.ps == null && /\p{L}/u.test(tk.text)) { tk.ps = fb(tk.text); (tk.ps == null ? unknown : oov).push(tk.text); }
          ctx = tokenContext(ctx, tk.ps, tk.text);
          continue;
        }
        let left = 0, right = w.length, fallBack = false;
        while (left < right) {
          const span = w.slice(left, right);
          const ps = span.some(t => t.ps != null) ? null : lex.word(span.map(t => t.text).join(''), null, ctx);
          if (ps != null) {
            w[left].ps = ps;
            for (const x of w.slice(left + 1, right)) x.ps = '';
            ctx = tokenContext(ctx, ps, span.map(t => t.text).join(''));
            right = left; left = 0;
          } else if (left + 1 < right) left++;
          else {
            right--;
            const t = w[right];
            if (t.ps == null) {
              if ([...t.text].every(c => JUNKS.has(c))) t.ps = '';
              else { fallBack = true; break; }
            }
            left = 0;
          }
        }
        if (fallBack) {
          tk.ps = fb(tk.text);
          (tk.ps == null ? unknown : oov).push(tk.text);
        } else {
          resolveGroup(w);
          let ps = '';
          for (const t of w) { if (t.prespace && ps && !/\s$/.test(ps) && t.ps) ps += ' '; ps += t.ps == null ? '' : t.ps; }
          tk.ps = ps;
        }
        ctx = tokenContext(ctx, tk.ps, tk.text);
      }
      // Kokoro v1.0 tokens: flap as T, glottal stop as t (misaki, version != 2.0).
      const phonemes = toks.map(t => (t.ps || '').replaceAll('\u027e', 'T').replaceAll('\u0294', 't') + t.ws).join('').trim();
      return { phonemes, oov, unknown };
    }
    return { phonemize, word: (w) => lex.word(w, null, { futureVowel: null, futureTo: false }), fallback: fb, british: !!british };
  }

  // Browser loader: one accent per voice ('gb' for George/Daniel/Emma, 'us' for Michael/Jarvis).
  const cache = new Map();
  function load(accent, base = 'g2p/') {
    if (cache.has(accent)) return cache.get(accent);
    const p = Promise.all([
      fetch(`${base}en_${accent}_lexicon.json`).then(r => { if (!r.ok) throw new Error('g2p lexicon'); return r.json(); }),
      fetch(`${base}en_${accent}_fallback.safetensors`).then(r => { if (!r.ok) throw new Error('g2p fallback'); return r.arrayBuffer(); }),
      fetch(`${base}en_${accent}_fallback.json`).then(r => { if (!r.ok) throw new Error('g2p fallback meta'); return r.json(); }),
      fetch(`${base}places.json`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([lexicon, fallback, fallbackMeta, places]) => create({ lexicon, british: accent === 'gb', fallback, fallbackMeta, places }));
    cache.set(accent, p);
    p.catch(() => cache.delete(accent));
    return p;
  }

  const api = { create, load, applyStress, normalize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ApexG2P = api;
})(typeof window !== 'undefined' ? window : globalThis);
