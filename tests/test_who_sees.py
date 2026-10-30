"""Who sees what (web/who_sees.js, REVIEW_PEOPLE P-09): one grid of every "what people see of me" control, each cell from
what is actually set (grants, presence, cars); unread stays "--"."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from tests.page_source import cockpit_source

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="needs node")


def run(js: str):
    src = f"const W = require({json.dumps(str(ROOT / 'web' / 'who_sees.js'))}); console.log(JSON.stringify({js}));"
    return json.loads(subprocess.run([NODE, "-e", src], capture_output=True, text=True, check=True).stdout)


DATA = """{ friends: [{ id: 'U1', handle: 'cara', status: 'accepted' }, { id: 'U2', handle: 'dan', status: 'pending' }],
  crews: [{ id: 'K1', name: 'Ridge Runners', visibility: 'private' }, { id: 'K2', name: 'Coffee & Cars', visibility: 'public' }],
  grants: [{ audience_type: 'friend', audience_id: 'U1', share_scores: 1, share_times: 0 }, { audience_type: 'crew', audience_id: 'K1', share_scores: 1, share_times: 1 }],
  presence: { audience: 'friends', delay_s: 600, fuzz: true }, cars: [{ id: 'c', shared: 1 }] }"""


def test_rows_say_what_each_audience_gets():
    rows = run(f"W.rows({DATA})")
    assert [(r["kind"], r["label"]) for r in rows] == [("friend", "@cara"), ("crew", "Ridge Runners"), ("crew", "Coffee & Cars")]   # a request is not a friend
    cara, ridge, cafe = rows
    assert cara["where"]["text"] == "10 min" and cara["where"]["on"] and cara["scores"] and not cara["times"] and cara["car"] is True
    assert ridge["where"]["text"] == "–" and ridge["scores"] and ridge["times"] and ridge["car"] is True
    assert cafe["car"] is False and not cafe["scores"]   # a public crew never sees your car
    assert run(f"W.sentence(W.rows({DATA})[0])") == "@cara sees your scores, where you are, 10 min late and your car."


def test_unread_stays_unknown():
    rows = run("W.rows({ friends: [{ id: 'U1', handle: 'cara', status: 'accepted' }], crews: [], grants: [], presence: null, cars: null })")
    assert rows[0]["where"]["text"] == "--" and rows[0]["car"] is None and rows[0]["scores"] is False
    assert run("W.sentence(W.rows({ friends: [{ id: 'U1', handle: 'cara', status: 'accepted' }], presence: { audience: 'nobody' }, cars: [] })[0])") == "@cara sees nothing of yours."


def test_crew_audience_lights_crews_not_friends():
    rows = run("W.rows({ friends: [{ id: 'U1', handle: 'cara', status: 'accepted' }], crews: [{ id: 'K1', name: 'R' }], presence: { audience: 'crew', delay_s: 0, fuzz: false }, cars: [] })")
    assert rows[0]["where"]["on"] is False and rows[1]["where"] == {"on": True, "text": "Live", "say": "sees where you are, live, exactly"}


def test_the_page_is_loaded():
    html = cockpit_source()
    assert "'who_sees.js'" in html and "ApexWhoSees.mount(" in html
