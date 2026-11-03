"""Private themes (migration 0044 theme_grants, backend/src/private_themes.json, web/themes.js grant()): the Tiburon and
the FR-S keep the same theme contract as Roadbook, Tapedeck and Billet, day and night; they are not in the public theme
files; the app takes them only from /api/me, checked against the contract, and drops them when /api/me stops sending them.

Each is that car (docs/design/CAR_THEMES.md has the sources): its own cluster as data (instruments.js carGauge draws it;
the code knows no car), its outline from above as the arrow on the map and the car map, its paint, needles, chrome and
finish, its key and pre-call sounds. What the car's gauges read that Vetta can't measure (engine speed, fuel, coolant) is
drawn and left at rest; never a made-up reading."""
import json
import os
import re
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IDS = ("tiburon", "frs")
PALETTE_KEYS = {"bg", "water", "waterLine", "land", "wood", "road", "roadMinor", "casing", "label", "halo", "boundary", "shadow",
                "highlight", "accentShade", "route", "plate", "plateInk", "accent"}
MEASURED = {"speed", "latG", "brakeG", "bank", "grip"}


def read(*p):
    return open(os.path.join(ROOT, *p), encoding="utf-8").read()


def private():
    return json.loads(read("backend", "src", "private_themes.json"))


RUNNER = r"""
const R = process.argv[1], fs = require('fs'), mem = {};
global.window = { localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } },
  document: { documentElement: { style: { setProperty() {} }, dataset: {} } } };
global.document = window.document;
require(R + '/web/themes.js');
const T = window.ApexThemes, K = require(R + '/web/theme_contract.js'), CP = require(R + '/web/carplay.js'), S = require(R + '/web/theme_sounds.js');
const I = require(R + '/web/instruments.js');
const P = JSON.parse(fs.readFileSync(R + '/backend/src/private_themes.json', 'utf8')), defs = Object.values(P);
const out = { before: Object.keys(T.THEMES) };
out.changed = T.grant(defs, K);
out.after = Object.keys(T.THEMES);
out.check = Object.fromEntries(defs.map((d) => [d.id, K.check(T.THEMES[d.id])]));
out.raw = Object.fromEntries(defs.map((d) => [d.id, K.check(d)]));
out.looks = Object.fromEntries(defs.map((d) => [d.id, CP.lookMessage(T.THEMES[d.id], true, 'imperial')]));
out.roadbookLook = CP.lookMessage(T.THEMES.roadbook, true, 'imperial');
out.sounds = Object.fromEntries(defs.map((d) => { const s = T.THEMES[d.id].sounds; return [d.id, [S.recipe(d.id, 'key', s), S.recipe(d.id, 'pre', s), S.recipe(d.id, 'hazard', s), S.recipe(d.id, 'wake', s)]]; }));
out.roadbookSounds = [S.recipe('roadbook', 'key'), S.recipe('roadbook', 'pre'), S.recipe('roadbook', 'hazard'), S.recipe('roadbook', 'wake')];
out.flags = Object.fromEntries(defs.map((d) => [d.id, { granted: T.THEMES[d.id].granted, pro: T.THEMES[d.id].pro, voice: T.THEMES[d.id].voice && T.THEMES[d.id].voice.id }]));
// the car as the app keeps it: cleaned, nothing lost from the server's own data
out.cars = Object.fromEntries(defs.map((d) => [d.id, T.THEMES[d.id].car]));
out.svg = Object.fromEntries(defs.map((d) => [d.id, T.carSVG(T.THEMES[d.id], '#111111', 34, 34)]));
out.noSvg = T.carSVG(T.THEMES.roadbook, '#111111', 34, 34);
// what Vetta measures moves a needle; what it can't (the engine) never does
const frame = { speedMph: 54, latG: 0.3, lonG: -0.2, camberDeg: 2.4 };
out.reads = Object.fromEntries(I.CAR_READS.map((r) => [r, I.carReading(r, frame, false)]));
out.readsEmpty = Object.fromEntries(I.CAR_READS.map((r) => [r, I.carReading(r, {}, false)]));
// what carFrom refuses: markup in a word, an unknown part, a read that isn't one, a point off the box, a loud sound
const tb = P.tiburon, bad = JSON.parse(JSON.stringify(tb.car));
bad.dial.parts.push({ k: 'text', x: 1, y: 1, t: '<script>' }, { k: 'image', href: 'x' }, { k: 'scale', reads: 'oilPressure', min: 0, max: 1, major: 1, a0: 0, a1: 90 });
bad.silhouette.body = bad.silhouette.body.concat([[500, 1]]);
bad.sounds.key = [{ type: 'sine', f: 440, at: 0, dur: 0.1, gain: 0.9 }];
bad.paint.hex = 'blue';
const cleaned = T.carFrom(bad);
out.refusedCar = { parts: cleaned.dial.parts.length, want: tb.car.dial.parts.length, text: cleaned.dial.parts.some((p) => p.t === '<script>'),
  silhouette: cleaned.silhouette, key: cleaned.sounds.key, paint: cleaned.paint, svg: T.carSVG({ car: cleaned }, '#111111', 34, 34) };
out.cached = JSON.parse(mem[T.GRANT_KEY] || '[]').map((d) => d.id);
out.same = T.grant(defs, K);
// what grant() refuses: a built-in id, a bad colour, a theme that breaks the contract (route in the warning's red)
out.refused = [T.fromGrant({ ...tb, id: 'billet' }), T.fromGrant({ ...tb, day: { ...tb.day, ink: 'red' } }), T.fromGrant({ ...tb, id: 'Bad-Id' })];
T.grant([{ ...tb, night: { ...tb.night, route: tb.night.signal } }], K);
out.redRoute = Object.keys(T.THEMES);
// the contract on a car's own: a red needle is the car's to have (the owner, 2026-11-03); a needle lost on its face, an
// LCD's ink lost on the LCD, a car cluster without its speed numeral or its Bank are not
const t0 = T.fromGrant(tb);
out.redNeedle = K.check({ ...t0, car: { ...t0.car, needle: { day: t0.day.signal, night: t0.night.signal } } });
out.faintNeedle = K.check({ ...t0, car: { ...t0.car, needle: { day: t0.day.face, night: t0.night.face } } });
out.faintLcd = K.check({ ...t0, car: { ...t0.car, lcdInk: { day: t0.car.lcd.day, night: t0.car.lcd.night } } });
out.alarm = K.ALARM;
out.noDigital = K.check({ ...t0, car: { ...t0.car, dial: { parts: t0.car.dial.parts.filter((p) => p.k !== 'digital') } } });
out.noBank = K.check({ ...t0, car: { ...t0.car, meter: { parts: t0.car.meter.parts.filter((p) => p.k !== 'bank') } } });
out.noCar = K.check({ ...t0, car: null });
// a grant taken away: gone, and the phone forgets it
out.gone = T.grant([], K);
out.empty = [Object.keys(T.THEMES), mem[T.GRANT_KEY] === undefined, T.get('tiburon').id];
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_both_keep_the_contract_day_and_night(out):
    assert set(out["check"]) == set(IDS)
    for tid in IDS:
        assert out["check"][tid] == [] and out["raw"][tid] == [], (tid, out["check"][tid], out["raw"][tid])


def test_the_contract_holds_a_car_to_it(out):
    assert out["redNeedle"] == [], "a car's red needles are allowed: the warning keeps its shape, word and plate"
    assert any("needle on the face" in m for m in out["faintNeedle"])
    assert any("LCD's ink" in m for m in out["faintLcd"])
    assert out["alarm"]["channels"] == ["colour", "shape", "word"]
    assert any("without the speed numeral" in m for m in out["noDigital"])
    assert any("without the Bank readout" in m for m in out["noBank"])
    assert any("car without the car's dial" in m for m in out["noCar"])


def test_the_app_shows_them_only_once_granted_and_forgets_them_when_the_grant_goes(out):
    assert not set(IDS) & set(out["before"]), "a private theme is in the public theme file"
    assert out["changed"] is True and set(out["after"]) == set(out["before"]) | set(IDS)
    assert set(out["cached"]) == set(IDS) and out["same"] is False
    for tid in IDS:
        assert out["flags"][tid]["granted"] is True and out["flags"][tid]["pro"] is False
    assert out["refused"] == [None, None, None]
    assert out["redRoute"] == out["before"], "a theme that breaks the contract is never shown"
    assert out["gone"] is False                                       # the red-route list had already emptied it
    assert out["empty"] == [out["before"], True, "roadbook"]


def test_the_car_is_kept_whole_and_cleaned(out):
    """The server's data passes carFrom unchanged; markup, unknown parts and readings, points off the box, a loud sound and
    a colour that isn't one are dropped, never guessed."""
    P = private()
    for tid in IDS:
        car, src = out["cars"][tid], P[tid]["car"]
        assert len(car["dial"]["parts"]) == len(src["dial"]["parts"]) and len(car["meter"]["parts"]) == len(src["meter"]["parts"]), tid
        assert car["silhouette"]["body"] == src["silhouette"]["body"] and car["paint"] == src["paint"], tid
        assert car["sounds"] == src["sounds"], tid
    r = out["refusedCar"]
    assert r["parts"] == r["want"] and r["text"] is False
    assert r["silhouette"] is None and r["svg"] == "" and r["paint"] is None and r["key"] == []


def test_each_cluster_is_that_car(out):
    """The Tiburon (the co-developer's photos): black dials, the 160 MPH speedometer (km/h 0 to 260 inside), the
    tachometer's face (0 to 8, red from 6.5) reading grip, the twin small gauges reading Turn and Brake, Bank in the LCD;
    the FR-S: the 9,000 r/min tachometer, red from 7,500, the speed in digits, the REV lamp, the right dial's two gauges."""
    P = private()
    tib, frs = P["tiburon"]["car"], P["frs"]["car"]
    speedo = next(p for p in tib["dial"]["parts"] if p["k"] == "scale" and p["reads"] == "speed")
    assert speedo["mph"]["max"] == 160 and speedo["kmh"]["max"] == 260 and (speedo["a0"], speedo["a1"]) == (-135, 135)
    inner = next(p for p in tib["dial"]["parts"] if p["k"] == "scale" and p["reads"] == "speedAlt")
    assert inner["kmh"]["max"] == 260 and inner["mph"]["max"] == 160 and "needle" not in inner
    meter = [p for p in tib["meter"]["parts"] if p["k"] == "scale"]
    assert [p["reads"] for p in meter] == ["latG", "brakeG", "grip"] and not any(p["k"] == "pod" for p in tib["meter"]["parts"])
    grip = meter[2]
    assert (grip["min"], grip["max"], grip["labelDiv"], grip["red"]) == (0, 0.8, 0.1, [0.65, 0.8])
    assert any(p["k"] == "text" and p["t"] == "x0.1 g" for p in tib["meter"]["parts"]), "the face says what it reads"
    assert any(p["k"] == "box" and p.get("lcd") for p in tib["meter"]["parts"]) and any(p["k"] == "bank" and p.get("lcd") for p in tib["meter"]["parts"])
    assert P["tiburon"]["day"]["face"] == "#0B0C0D" and P["tiburon"]["night"]["faceInk"] == "#FF6A4C", "black faces, red at night"
    tach = next(p for p in frs["dial"]["parts"] if p["k"] == "scale")
    assert tach["reads"] == "rpm" and (tach["min"], tach["max"]) == (0, 9) and tach["red"] == [7.5, 9]
    assert {p["k"] for p in frs["dial"]["parts"]} >= {"digital", "lamp", "mid"} and frs["dial"]["explain"] == "tach"
    assert [p["reads"] for p in frs["meter"]["parts"] if p["k"] == "scale"] == ["latG", "brakeG"]
    assert tib["paint"]["name"] == "Silver" and frs["paint"]["name"] == "Ultramarine Pearl"
    assert tib["finish"] == "cloth" and frs["finish"] == "carbon"
    for car in (tib, frs):
        assert any(p["k"] == "digital" for p in car["dial"]["parts"]) and any(p["k"] == "bank" for p in car["meter"]["parts"])


def test_nothing_unmeasured_moves_a_needle(out):
    """Only speed, Turn, Brake and Bank move a needle; the engine's gauges (r/min, fuel, coolant, torque, volts, mpg) and
    the inner unit ring never read anything, and with no frame nothing reads at all."""
    for r, v in out["reads"].items():
        assert (v is not None) == (r in MEASURED), (r, v)
    assert out["reads"]["latG"] == 0.3 and out["reads"]["brakeG"] == 0.2 and out["reads"]["bank"] == 2.4 and out["reads"]["speed"] == 54
    assert all(v is None for v in out["readsEmpty"].values())
    for tid, t in private().items():
        for slot in ("dial", "meter"):
            for p in t["car"][slot]["parts"]:
                if p["k"] == "scale" and p["reads"] not in MEASURED:
                    assert p["reads"] in ("rpm", "speedAlt"), (tid, p["reads"])


def test_the_car_gets_their_palettes_their_outline_and_their_own_sounds(out):
    assert "puck" not in out["roadbookLook"] and out["noSvg"] == ""
    for tid in IDS:
        msg = out["looks"][tid]
        assert msg["theme"] == tid and re.fullmatch(r"[a-z]{1,20}", tid)   # ApexCarPlay.swift takes ^[a-z]{1,20}$
        for mode in ("day", "night"):
            p = msg["palette"][mode]
            assert PALETTE_KEYS <= set(p) and all(re.fullmatch(r"#[0-9A-Fa-f]{6}", p[k]) for k in PALETTE_KEYS), (tid, mode)
        # the native car map's arrow: the car's outline in its 34-point box, in its paint (ApexCarMap.swift ApexCarPuckShape)
        pk = msg["puck"]
        assert pk["paint"] == private()[tid]["car"]["paint"]["hex"] and len(pk["body"]) >= 20
        assert all(0 <= x <= 34 and 0 <= y <= 34 for x, y in pk["body"] + pk["glass_shape"] + pk["roof"])
        svg = out["svg"][tid]
        assert svg.startswith("<svg") and private()[tid]["car"]["paint"]["hex"] in svg and 'stroke="#111111"' in svg
        key, pre, hazard, wake = out["sounds"][tid]
        assert key and pre and [key, pre] != out["roadbookSounds"][:2], tid
        assert hazard == out["roadbookSounds"][2] and wake == out["roadbookSounds"][3], "the hazard and the mode chimes are the same in every theme"
        assert out["flags"][tid]["voice"] in ("marguerite", "kit", "hale"), "a voice pack the app has"


def test_their_looks_are_not_in_the_public_files():
    """Names, paints, outlines, clusters and sounds are the server's; the public files hold only the code that draws them."""
    P = private()
    public = {f: read("web", f) for f in os.listdir(os.path.join(ROOT, "web")) if f.endswith((".js", ".html", ".css")) and f != "car_lookup.js"}
    for f, text in public.items():
        assert "Tiburon" not in text and "FR-S" not in text, f
        assert "Sterling Metallic" not in text and "Ultramarine" not in text, f
        for tid in IDS:
            assert f"id: '{tid}'" not in text and f'data-theme="{tid}"' not in text, (f, tid)
            assert P[tid]["car"]["paint"]["hex"] not in text, (f, tid)
            body = P[tid]["car"]["silhouette"]["body"]
            assert f"{body[3][0]}, {body[3][1]}" not in text and f"{body[3][0]},{body[3][1]}" not in text, (f, tid)
    sounds = read("web", "theme_sounds.js")
    assert "tiburon" not in sounds and "frs" not in sounds


def test_the_native_car_map_draws_the_car():
    swift, car = read("CarPlay", "ApexCarMap.swift"), read("CarPlay", "ApexCarPlay.swift")
    assert "struct ApexCarPuckShape" in swift and "x >= 0, x <= 34, y >= 0, y <= 34" in swift and "guard body.count >= 3 else { return nil }" in swift
    assert "func setPuck(_ s: ApexCarPuckShape?)" in swift and "disc.fillColor = (car?.paint ?? panel).cgColor" in swift
    assert 'l.puck = ApexCarPuckShape(dict["puck"] as? [String: Any])' in car and "native.setPuck(ApexCar.shared.look.puck)" in car


def test_the_grant_is_the_servers():
    sql = read("backend", "migrations", "0044_theme_grants.sql")
    assert "CREATE TABLE theme_grants" in sql and "PRIMARY KEY (user_id, theme)" in sql and "ON DELETE CASCADE" in sql
    assert "INSERT" not in sql.upper(), "the real grants are written by hand, not here"
    idx = read("backend", "src", "index.ts")
    me = idx[idx.index('on("GET", "/api/me",'):idx.index('on("POST", "/api/invites/redeem"')]
    assert "grantedThemes(env, v.id)" in me and me.index("if (!v) return json({ signed_in: false })") < me.index("grantedThemes")
    js = read("web", "cockpit.js")
    assert "applyThemeGrants(me)" in js and "Themes.grant(me.signed_in && Array.isArray(me.themes) ? me.themes : [], window.ApexThemeContract)" in js


def test_no_account_ids_in_the_code():
    """The two accounts' ids go in the commit message and the integrator's SQL, never in the code."""
    uuid = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
    for f in ("backend/migrations/0044_theme_grants.sql", "backend/src/themes.ts", "backend/src/private_themes.json", "web/themes.js"):
        assert not uuid.search(read(*f.split("/"))), f


def test_the_server_file_stays_small():
    """/api/me carries the looks on every sign-in check: both cars together stay under 24 kB."""
    assert len(json.dumps(private(), separators=(",", ":"))) < 24000
