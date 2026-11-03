"""Private themes (migration 0044 theme_grants, backend/src/private_themes.json, web/themes.js grant()): the Tiburon and
the FR-S keep the same theme contract as Roadbook, Tapedeck and Billet, day and night; they are not in the public theme
file; the app takes them only from /api/me, checked against the contract, and drops them when /api/me stops sending them."""
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


def read(*p):
    return open(os.path.join(ROOT, *p), encoding="utf-8").read()


RUNNER = r"""
const R = process.argv[1], fs = require('fs'), mem = {};
global.window = { localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } },
  document: { documentElement: { style: { setProperty() {} }, dataset: {} } } };
global.document = window.document;
require(R + '/web/themes.js');
const T = window.ApexThemes, K = require(R + '/web/theme_contract.js'), CP = require(R + '/web/carplay.js'), S = require(R + '/web/theme_sounds.js');
const P = JSON.parse(fs.readFileSync(R + '/backend/src/private_themes.json', 'utf8')), defs = Object.values(P);
const out = { before: Object.keys(T.THEMES) };
out.changed = T.grant(defs, K);
out.after = Object.keys(T.THEMES);
out.check = Object.fromEntries(defs.map((d) => [d.id, K.check(T.THEMES[d.id])]));
out.raw = Object.fromEntries(defs.map((d) => [d.id, K.check(d)]));
out.looks = Object.fromEntries(defs.map((d) => [d.id, CP.lookMessage(T.THEMES[d.id], true, 'imperial')]));
out.sounds = Object.fromEntries(defs.map((d) => [d.id, [S.recipe(d.id, 'key'), S.recipe(d.id, 'pre'), S.recipe(d.id, 'hazard')]]));
out.roadbookSounds = [S.recipe('roadbook', 'key'), S.recipe('roadbook', 'pre'), S.recipe('roadbook', 'hazard')];
out.flags = Object.fromEntries(defs.map((d) => [d.id, { granted: T.THEMES[d.id].granted, pro: T.THEMES[d.id].pro, voice: T.THEMES[d.id].voice && T.THEMES[d.id].voice.id }]));
out.cached = JSON.parse(mem[T.GRANT_KEY] || '[]').map((d) => d.id);
out.same = T.grant(defs, K);
// what grant() refuses: a built-in id, a bad colour, a theme that breaks the contract (route in the warning's red)
const tb = P.tiburon;
out.refused = [T.fromGrant({ ...tb, id: 'billet' }), T.fromGrant({ ...tb, day: { ...tb.day, ink: 'red' } }), T.fromGrant({ ...tb, id: 'Bad-Id' })];
T.grant([{ ...tb, night: { ...tb.night, route: tb.night.signal } }], K);
out.redRoute = Object.keys(T.THEMES);
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


def test_the_car_gets_their_palettes_and_their_own_sounds(out):
    for tid in IDS:
        msg = out["looks"][tid]
        assert msg["theme"] == tid and re.fullmatch(r"[a-z]{1,20}", tid)   # ApexCarPlay.swift takes ^[a-z]{1,20}$
        for mode in ("day", "night"):
            p = msg["palette"][mode]
            assert PALETTE_KEYS <= set(p) and all(re.fullmatch(r"#[0-9A-Fa-f]{6}", p[k]) for k in PALETTE_KEYS), (tid, mode)
        key, pre, hazard = out["sounds"][tid]
        assert key and pre and [key, pre] != out["roadbookSounds"][:2], tid
        assert hazard == out["roadbookSounds"][2], "the hazard two-tone is the same in every theme"
        assert out["flags"][tid]["voice"] in ("marguerite", "kit", "hale"), "a voice pack the app has"


def test_their_looks_are_not_in_the_public_files():
    themes = read("web", "themes.js")
    for tid in IDS:
        assert f"id: '{tid}'" not in themes
    assert "Tiburon" not in themes and "FR-S" not in themes


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
