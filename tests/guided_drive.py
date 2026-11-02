"""The guided drive's corners (review recording 7, docs/design/panel/round-2/ma.md), for the tests that replay its notes.

Each corner is the one a line in `guided-drive/transcript.txt` called, in its order, with its words' kind (tight, hairpin,
square...), its caution, modifiers and the link the call said. The road between them is laid out from the transcript's
clock at the speeds the video's dial read: about 22 m/s on Dry Ridge, 20 m/s after 08:20 and 12.5 m/s (28 mph) through
the Harrison grid from 13:30. That is enough to replay when each call, aside and mode change falls; the real route's
geometry is not in the repo, and this is not presented as it.

`replay(mode, pack)` runs SIM with node: a 10 Hz loop of the same decisions web/cockpit.js updateNotes makes, through the
same pure functions (web/note_timing.js wakeCorner / keepsAwake / leadM / lastCallM / asideWindow, web/voice_lines.js
createAsides / quietLine, web/plain_notes.js plainChain), and returns what was said and when.
"""
import json
import os
import shutil
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")

# (seconds after Start the call was said, the corner)
_CALLS = [
    (19, {"dir": "R", "severity": 2, "caution": 1}),
    (79, {"dir": "L", "severity": "HP", "shape": "hairpin", "mods": ["long"]}),
    (197, {"dir": "L", "severity": 5, "link": "122"}),
    (211, {"dir": "R", "severity": 5}),
    (264, {"dir": "R", "severity": 3}),
    (306, {"dir": "L", "severity": 4}),
    (332, {"dir": "L", "severity": 2, "shape": "square", "caution": 1}),
    (585, {"dir": "R", "severity": 2, "shape": "square", "caution": 1}),
    (626, {"dir": "R", "severity": 4}),
    (666, {"dir": "L", "severity": 3, "link": "400"}),
    (707, {"dir": "R", "severity": 4, "mods": ["long"]}),
    (817, {"dir": "L", "severity": 4, "link": "61"}),
    (827, {"dir": "R", "severity": 3, "link": "76"}),
    (839, {"dir": "L", "severity": 2, "link": "400"}),
    (888, {"dir": "L", "severity": 2, "shape": "square", "caution": 1, "link": "400"}),
    (933, {"dir": "R", "severity": 5, "link": "107"}),
    (947, {"dir": "L", "severity": 5, "mods": ["long"], "link": "400"}),
    (981, {"dir": "L", "severity": 2, "shape": "square", "caution": 1, "link": "400"}),
    (1024, {"dir": "R", "severity": 3}),
]
SEGMENTS = [(0, 22.0), (500, 20.0), (800, 12.5)]   # (from seconds after Start, road speed m/s)
_APEX = {"HP": 7.0, 2: 12.0, 3: 15.0, 4: 18.0, 5: 22.0}


def _speed_at_s(t):
    return [v for (t0, v) in SEGMENTS if t >= t0][-1]


def _pos_at_s(t):
    m, s = 0.0, 0.0
    while s < t:
        dt = min(1.0, t - s)
        m += _speed_at_s(s) * dt
        s += dt
    return m


def corners():
    """The corners as route events: entry metre m (six seconds past where the call was said), apex speed, fields."""
    out = []
    for i, (t, c) in enumerate(_CALLS):
        apex = 8.0 if c.get("shape") == "square" else _APEX[c["severity"]]
        out.append({"type": "corner", "index": i, "mods": [], "caution": 0, "link": None, **c,
                    "m": round(_pos_at_s(t) + 6 * _speed_at_s(t), 1), "apexMps": apex})
    return out


# The speed at a route metre, from SEGMENTS laid out along the road.
SIM = r"""
const R = process.argv[1], arg = JSON.parse(process.argv[2]);
globalThis.localStorage = { getItem: () => 'imperial', setItem() {} };
const T = require(R + '/web/note_timing.js'), L = require(R + '/web/voice_lines.js'), P = require(R + '/web/plain_notes.js');
const U = require(R + '/web/units.js'); U._reset();
const ev = arg.corners, segs = arg.segments, mode = arg.mode, pack = arg.pack;
const cs = ev.map((e) => ({ m: e.m, severity: e.severity, apexMps: e.apexMps, text: P.plainCall(e), e }));
const asides = L.createAsides(), run = T.createCareRun(), W = T.createWakeVoice();
const log = [], spoken = new Set();
let cursor = 0, t = 0, spiritedAt = -Infinity, segT = 0;
const speedAt = (s) => segs.filter(([t0]) => s >= t0).pop()[1];
const end = ev[ev.length - 1].m + 800;
for (; cursor < end; t += 0.1) {
  const v = speedAt(t), now = t * 1000, at = { cursorM: cursor, vMps: v };
  const awake = () => mode === 'full' || now - spiritedAt < 30000;
  if (mode === 'auto' && (T.wakeCorner(cs, at) || (awake() && (arg.oldSleep ? null : T.keepsAwake(cs, at))))) spiritedAt = now;
  const spirited = awake();
  if (mode === 'auto') {
    const tr = W.update(spirited, now);
    if (tr === 'off') { run.reset(); log.push({ t, kind: 'quiet', text: L.quietLine(pack, T.quietSpan(T.quietM(cs, at), U)) }); }
    if (tr === 'on') log.push({ t, kind: 'wake' });
  }
  for (const c of cs) {
    const e = c.e, d = c.m - cursor;
    if (d > T.MAX_M) break;
    if (spoken.has(e.index) || d < 10) continue;
    const own = P.plainCall(e);
    if (d < T.lastCallM({ vMps: v, text: own })) { spoken.add(e.index); continue; }
    const reach = T.chainReachM(v), carried = e.link != null && Number(e.link) <= reach;
    const next = carried ? ev[e.index + 1] : null;
    const voiced = [{ ...e, link: carried ? e.link : null }];
    const text = P.plainChain(voiced, U, { next, reachM: reach });
    let win = null;
    const fits = ({ text: aside, kind }) => {
      win = T.asideWindow({ dM: d, atM: c.m, vMps: v, apexMps: c.apexMps, callText: text, text: aside, kind });
      return win.fits && d <= win.leadM;
    };
    const aside = spirited ? asides.pick(pack, voiced, now, () => true, fits) : null;
    if (!aside && d > T.leadM({ vMps: v, apexMps: c.apexMps, text })) continue;
    spoken.add(e.index);
    if (!spirited) continue;
    run.at(c.m, 'guided');
    const said = P.plainChain([run.spend({ ...voiced[0] })], U, { next: next && run.spend(next), reachM: reach, advice: aside && aside.kind === 'advice' ? aside.text : null });
    const callS = T.speakS(said);
    log.push({ t, kind: 'call', text: said, corner: e.index, dM: d, v });
    if (aside) {
      // where the whole line ends: advice with the call, colour after the call and its cue
      const lineS = aside.kind === 'advice' ? callS : T.speakS(said) + 0.3 + T.speakS(aside.text);
      const brake = c.apexMps < v ? (v * v - c.apexMps * c.apexMps) / (2 * T.DECEL_MPS2) : 0;
      log.push({ t, kind: 'aside', aside: aside.kind, text: aside.text, corner: e.index, v,
                 endsBeforeEntryM: d - v * lineS, brakeM: brake, startsBeforeEntryS: aside.kind === 'advice' ? d / v : (d - v * (T.speakS(said) + 0.3)) / v });
    }
  }
  cursor += v * 0.1;
}
console.log(JSON.stringify(log));
"""


def replay(mode="auto", pack="marguerite", old_sleep=False):
    arg = {"corners": corners(), "segments": SEGMENTS, "mode": mode, "pack": pack, "oldSleep": old_sleep}
    r = subprocess.run([NODE, "-e", SIM, ROOT, json.dumps(arg)], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)
