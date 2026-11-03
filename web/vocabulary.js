// The vocabulary contract (panel round 2, SO-1): one word, one meaning, one place. Every user-facing term the app
// teaches is defined here once: its label, its one-line meaning, where it is shown, where it is set (a setting has one
// home), and how its number is written. The UI reads the meanings from here (the tap-to-learn captions); the words in the
// examples (the theme cards, the plain-words example) are generated from the real call grammar, never typed in.
// tests/test_vocabulary.py holds the app to it: a setting with a second home, a label used for two actions, "Fun" as a
// number or a count of corners taken from the Score all fail the build.
(function (root) {
  'use strict';

  /**
   * kind: 'reading' (a number the app shows), 'score', 'count', 'setting' (a choice the driver makes), 'action' (a key).
   * shown: where it appears; set: the one place a setting is changed, with `control` the attribute its switch carries
   * (and `homes`, the number of places that switch may appear, when one choice is offered at two steps of one flow).
   */
  const TERMS = {
    sight: { label: 'Sight', kind: 'reading',
      meaning: 'The speed you could stop from within what you can see ahead.',
      format: 'In 5 mph (10 km/h) steps, rounded down; Open when nothing limits you; -- when unknown or under 5 mph.',
      shown: ['the tag under the arrow (phone and car)', 'the Sight cell in the binnacle'],
      source: 'One held value (carplay.js sightFilter) for the tag and the cell. The corner’s pace is its own mark on the speed dial.' },
    score: { label: 'Vetta Score', short: 'Score', kind: 'score',
      meaning: 'A drive’s score out of 1000, from its clean corners: Pace, Smooth, Brakes and Rhythm.',
      format: 'A whole number out of 1000; -- with too few clean corners.',
      shown: ['the end card', 'the Log', 'the drive page', 'the share card', 'the binnacle while recording'] },
    pace: { label: 'Pace', kind: 'score', meaning: 'How close to the road’s grip you drove the corners, part of the Score.' },
    smooth: { label: 'Smooth', kind: 'score', meaning: 'How gently you steered through the corners, part of the Score.' },
    brakes: { label: 'Brakes', kind: 'score', meaning: 'Whether your braking was done by the middle of each corner, part of the Score.' },
    rhythm: { label: 'Rhythm', kind: 'score', meaning: 'How evenly you drove from corner to corner, part of the Score.' },
    bank: { label: 'Bank', kind: 'reading',
      meaning: 'How much the road leans into the corner (+) or away from it (−), as your phone measured it.',
      format: 'Degrees with a sign, one decimal; -- until the phone’s mount is known.' },
    twist: { label: 'Twist', kind: 'reading', meaning: 'How much of the route is corners, and how tight, from the map. 0 to 100.',
      shown: ['the route card'] },
    flow: { label: 'Flow', kind: 'reading', meaning: 'How much of the route is corners that run into one another, from the map. 0 to 100.',
      shown: ['the route card'] },
    surface: { label: 'Surface', kind: 'reading', meaning: 'How smooth the pavement is, measured by drivers’ phones. 0 to 100; -- until measured.',
      shown: ['the route card'] },
    corners: { label: 'corners', kind: 'count',
      meaning: 'Every corner a drive or a route found.',
      format: '"3 corners" (format.js cornerCount), the same count on the end card, the drive page and the Log row.' },
    cleanCorners: { label: 'clean corners', kind: 'count',
      meaning: 'The corners the Score counts: driven without a stop, with the phone’s g measured.' },
    goodCorners: { label: 'good corners', kind: 'count',
      meaning: 'Corners worth driving: neither a hairpin nor nearly straight (severity 2 to 5).',
      shown: ['the deck’s suggestion', 'the route options', 'the car’s route choices'] },
    distance: { label: 'distance', kind: 'reading',
      meaning: 'How far a drive or a route goes.',
      format: 'One decimal under 10 (1.3 mi), whole from 10 (71 mi), in your units (format.js distance), on every surface and total.' },
    fun: { label: 'Fun', kind: 'setting',
      meaning: 'A route style: how much of the long way a route takes. Quick, Fun or Max fun. Never a number.',
      values: ['Quick', 'Fun', 'Max fun'], set: 'the plan sheet’s Roads switch, and the route card’s for the route on it', control: 'data-fun', homes: 2 },
    notes: { label: 'Notes', kind: 'setting',
      meaning: 'How much the co-driver calls: Quiet (bumps and cameras only), Auto (the twisty bits), Full (every corner).',
      values: ['Quiet', 'Auto', 'Full'], set: 'the map’s Layers, where a drive reaches it', control: 'data-notes', homes: 1 },
    voice: { label: 'Voice', kind: 'setting', meaning: 'Whether the co-driver speaks.',
      set: 'the map’s Layers', control: 'data-toggle="voice"', homes: 1 },
    music: { label: 'While Vetta speaks', kind: 'setting',
      meaning: 'What your music does while the co-driver speaks: Lower music (it dips) or Pause music (it stops, then plays on).',
      values: ['Lower music', 'Pause music'], set: 'the map’s Layers, under Voice (in the app)', control: 'data-music', homes: 1 },
    words: { label: 'The words', kind: 'setting',
      meaning: 'How the calls are said: Plain words ("Careful, medium right") or Rally notes ("Right 3, care").',
      values: ['Plain words', 'Rally notes'], set: 'the Garage', control: 'data-words', homes: 1 },
    night: { label: 'Night', kind: 'setting', meaning: 'The night look: Auto (after sunset), Day or Night.',
      values: ['Auto', 'Day', 'Night'], set: 'the Garage', control: 'data-night', homes: 1 },
    start: { label: 'Start', kind: 'action', meaning: 'Start recording a drive now.', ids: ['startDrive'] },
    driveIt: { label: 'Drive it', kind: 'action', meaning: 'Start the route on the card, with its notes.', ids: ['routeDriveBtn'] },
  };

  /**
   * Labels that sit on more than one control, each with why that is one meaning, not two. Anything else on two controls
   * fails tests/test_vocabulary.py. KNOWN is a break already found and owned elsewhere, so a new one still fails.
   */
  const SHARED = {
    Cancel: 'closes the sheet it is on, changing nothing', Done: 'closes the card it is on', Save: 'keeps what the sheet holds',
    Share: 'opens the share sheet for what the page holds', Auto: 'a setting’s middle stop: the app decides',
    Cameras: 'the plate cameras: avoided by a plan, or shown as a layer', 'Measured roads': 'roads drivers have measured: preferred by a plan, or shown as a layer',
    Friends: 'your friends: shown on the map, or listed in People', 'Open in the Log': 'one action drawn as a key or a link (the end card)',
    'Share card': 'one action drawn as a key or a link (the end card)', 'Watch a replay': 'the same demo replay, from the welcome or a theme trial',
    '★': 'a rating’s stars',
  };
  const KNOWN = { Start: 'the welcome’s key also reads Start (SO-2, next round): it closes the welcome, the map’s records a drive' };

  // ---- the words in the examples: generated, never typed (HE-3, SO-1) ---------------------------------------------------
  // One sample from the call grammar: a medium right that goes on, with "careful", and an easy left 400 m after it. The
  // plain call, the rally call, the strip's head and the theme card's quote are all rendered from it.
  const SAMPLE = [
    { type: 'corner', dir: 'R', severity: 3, grade: '', caution: 1, mods: ['long'], link: '400', turnRad: 1.9 },
    { type: 'corner', dir: 'L', severity: 5, grade: '', caution: 0, mods: [], turnRad: 0.6 },
  ];
  const SAMPLE_DIST_M = 150;                                          // the strip's distance to the sample corner

  /**
   * The sample call in `words` ('plain' | 'rally'), as the drive says it. deps: { plain: ApexPlainNotes, units: ApexUnits,
   * paceNoteText: Core.paceNoteText, card: Hale's delivery }. Plain words: plainChain, the call the phone says; rally
   * notes: the note's own call and its distance, as cockpit.js chainedCall joins them. null without what it needs.
   */
  function sampleCall(words, deps = {}) {
    const [a, b] = SAMPLE;
    if (words === 'plain') return deps.plain ? deps.plain.plainChain([a], deps.units, { next: b, card: !!deps.card }) : null;
    if (typeof deps.paceNoteText !== 'function') return null;
    return `${deps.paceNoteText(a).call}, ${a.link}`;
  }

  /**
   * The strip's head for the sample, in `words`: { note, head, tail: [{ text, warn }], dist: { n, u } }, from the same
   * functions the strip uses (plainCall or the rally call, instruments.js lockup, units.js short). null without them.
   */
  function sampleStrip(words, deps = {}) {
    const a = SAMPLE[0];
    if (!deps.lockup || !deps.units) return null;
    const call = words === 'plain' ? (deps.plain ? deps.plain.plainCall(a) : null) : (typeof deps.paceNoteText === 'function' ? deps.paceNoteText(a).call : null);
    if (!call) return null;
    const lk = deps.lockup(call, a.mods);
    return { note: a, head: lk.head, tail: lk.tail, dist: deps.units.short(SAMPLE_DIST_M) };
  }

  /**
   * A theme card's quote (HE-3): the sample call as this pack's driver hears it in `words`, then the pack's last
   * sign-off ("That's the last corner. Lovely road."), a line from its own bank. deps as sampleCall, plus voiceLines
   * (ApexVoiceLines) and pack (its PACKS entry decides Hale's card delivery). { call, signOff, token, text } or null.
   */
  function sampleQuote(packId, words, deps = {}) {
    const V = deps.voiceLines;
    if (!V) return null;
    const offs = V.signOffs(packId), token = offs.length ? offs[offs.length - 1] : null, signOff = token ? V.packLine(packId, token) : null;
    const pack = V.PACKS && V.PACKS[packId];
    const call = sampleCall(words, { ...deps, card: !!(pack && pack.card) });
    if (!call || !signOff) return null;
    return { call, signOff, token, text: `${call}. ${signOff}` };
  }

  /** The Garage's example under Plain words / Rally notes: the same sample, in the chosen words. */
  function wordsExample(words, deps = {}) {
    const call = sampleCall(words, deps);
    if (!call) return '';
    return words === 'plain' ? `For example "${call}".` : `Rally pace notes, 1 tightest to 6: "${call}".`;
  }

  const api = { TERMS, SHARED, KNOWN, SAMPLE, sampleCall, sampleStrip, sampleQuote, wordsExample };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexVocabulary = api;
})(typeof window !== 'undefined' ? window : globalThis);
