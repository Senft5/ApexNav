"""Route context, the phone's time (web/route_ctx/ios_context.js, ApexNavApp.swift ApexContext): "My free time" sizes a loop
to end before the next calendar event, "This album" to the rest of the album playing; asked only on a tap, only the start
time (calendar) or a length (music) reaches the page, and the web says it's app-only. Swift can't compile here, so its
shape is read as text."""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
SWIFT = (ROOT / "ApexNavApp.swift").read_text(encoding="utf-8")
YML = (ROOT / "project.yml").read_text(encoding="utf-8")

PRE = f"const I = require({json.dumps(str(ROOT / 'web' / 'route_ctx' / 'ios_context.js'))});\n" \
      "const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v instanceof Float32Array || v instanceof Float64Array ? Array.from(v, (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : 'NaN')) : v)));\n"


def run(js: str):
    p = subprocess.run([NODE, "-e", PRE + f"(async () => {{ const out = await ({js}); console.log(JSON.stringify(clean(out))); }})();"],
                       capture_output=True, text=True, timeout=30)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


@pytest.mark.skipif(NODE is None, reason="needs node")
def test_minutes_free_and_of_music():
    now = 1_700_000_000_000
    out = run(f"[I.minutesFree({now} + 130 * 60000, {now}), I.minutesFree({now} + 30 * 60000, {now}), I.minutesFree({now} + 9 * 3600000, {now}), I.minutesFree(NaN),"
              " I.minutesOfMusic(52 * 60), I.minutesOfMusic(4 * 60), I.minutesOfMusic(null)]")
    assert out == [105, None, 240, None, 45, None, None]           # 130 min - 15 min buffer = 115 -> 105 in 15 min steps


@pytest.mark.skipif(NODE is None, reason="needs node")
def test_plan_says_why_and_never_invents():
    now = 1_700_000_000_000
    out = run(f"""[I.plan('calendar', {{ unavailable: true }}), I.plan('calendar', {{ granted: false }}), I.plan('calendar', {{ granted: true }}, {{ now: {now} }}),
      I.plan('calendar', {{ granted: true, next: {now} + 100 * 60000 }}, {{ now: {now}, fmtTime: () => '3:40 PM' }}),
      I.plan('music', {{ granted: true }}), I.plan('music', {{ granted: true, remainingS: 3000, scope: 'album', album: 'Kind of Blue' }}, {{ now: {now} }}),
      I.plan('music', {{ granted: false, remainingS: 200, scope: 'song' }}), I.plan('music', {{ granted: true, remainingS: 1500, scope: 'song' }}),
      I.plan('calendar', {{ timeout: true }})]""")
    assert out[0]["minutes"] is None and "Only in the Vetta app" in out[0]["text"]
    assert out[1]["minutes"] is None and "Settings" in out[1]["text"]
    assert out[2]["minutes"] == 240
    assert out[3]["minutes"] == 75 and "3:40 PM" in out[3]["text"]
    assert out[4]["minutes"] is None and "Nothing is playing" in out[4]["text"]
    assert out[5]["minutes"] == 45 and "Kind of Blue" in out[5]["text"] and out[5]["endsAt"] == now + 3000 * 1000
    assert out[6]["minutes"] is None and "Media library access is off" in out[6]["text"]
    assert out[7]["minutes"] == 30 and "doesn’t share the rest of the queue" in out[7]["text"]   # honest about what iOS allows
    assert out[8]["minutes"] is None


@pytest.mark.skipif(NODE is None, reason="needs node")
def test_bridge_round_trip_and_web():
    js = """(async () => {
      const sent = [];
      const p = I.ask('calendar', { post: (m) => { sent.push(m); setTimeout(() => I.receive({ type: 'context', op: 'calendar', id: m.id, granted: true, next: 5 }), 5); } });
      const web = await I.ask('music');
      return { reply: await p, sent, web, stray: I.receive({ type: 'context', id: 999 }), timeout: await I.ask('music', { post: () => {}, timeoutMs: 20 }) };
    })()"""
    out = run(js)
    assert out["sent"] == [{"cmd": "context", "op": "calendar", "id": 1}] and out["reply"]["next"] == 5
    assert out["web"] == {"unavailable": True, "why": "web"} and out["stray"] is False and out["timeout"] == {"timeout": True}


@pytest.mark.skipif(NODE is None, reason="needs node")
def test_provider_marks_routes_past_the_free_time_and_the_album_end():
    js = """(async () => {
      const n = 100, t = { id: 'c1', lat: new Float64Array(n), lon: new Float64Array(n), distM: new Float64Array(n).map((_, i) => i * 25), etaAt: new Float64Array(n).map((_, i) => 1e12 + i * 60000) };
      const quiet = await I.provider.fetch([t], {});
      const st = { nextEventAt: 1e12 + 75 * 60000, albumEndsAt: 1e12 + 40 * 60000 };
      const r = (await I.provider.fetch([t], { state: st })).c1;
      return { quiet: quiet.c1.status, free: [r.channels.free_min[0], r.channels.free_min[99]], spans: r.spans, points: r.points };
    })()"""
    out = run(js)
    assert out["quiet"] == "unavailable"                             # never asked: nothing
    assert out["free"] == [60, -39]
    assert out["spans"][0]["kind"] == "past_next_event" and out["spans"][0]["fromM"] == 61 * 25 and out["spans"][0]["value"] == 39
    assert out["points"] == [{"atM": 1000, "kind": "album_ends", "label": "The album ends here"}]


def test_swift_bridge_asks_only_on_the_tap_and_sends_only_a_start_time():
    assert 'if cmd == "context", let dict = body as? [String: Any] {\n            ApexContext.handle(dict, shell: shell)' in SWIFT
    m = re.search(r"enum ApexContext \{(.*?)\n\}\n", SWIFT, re.S)
    assert m, "ApexContext missing"
    body = m.group(1)
    assert "@MainActor\nenum ApexContext" in SWIFT
    assert "import EventKit" in SWIFT and "import MediaPlayer" in SWIFT
    assert "requestFullAccessToEvents()" in body and "MPMediaLibrary.requestAuthorization" in body
    assert "MPMusicPlayerController.systemMusicPlayer" in body and "nowPlayingItem" in body
    # the calendar reply carries the start only: never a title, place, notes or attendees
    for leak in (".title", ".location", ".notes", ".attendees", ".calendar.title", ".structuredLocation"):
        assert leak not in body, leak
    assert 'reply["next"] = start.timeIntervalSince1970 * 1000' in body
    assert 'shell?.sendToPage(reply)' in body and body.count('"type": "context"') == 2
    # nothing in the launch path asks for calendar or media access
    launch = SWIFT.split("enum ApexContext")[0]
    assert "requestFullAccessToEvents" not in launch and "MPMediaLibrary.requestAuthorization" not in launch


def test_usage_strings_say_what_and_when():
    for key in ("NSCalendarsFullAccessUsageDescription", "NSCalendarsUsageDescription", "NSAppleMusicUsageDescription"):
        m = re.search(rf'{key}: "([^"]+)"', YML)
        assert m, key
        assert "When you tap" in m.group(1) and "this phone" in m.group(1)


def test_app_review_and_privacy_name_it():
    review = (ROOT / "docs" / "APP_REVIEW.md").read_text(encoding="utf-8")
    privacy = (ROOT / "web" / "privacy.html").read_text(encoding="utf-8")
    assert "My free time" in review and "This album" in review and "NSCalendarsFullAccessUsageDescription" in review
    assert "My free time" in privacy and "This album" in privacy
