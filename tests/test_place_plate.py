"""The place plate on the idle map (web/place_plate.js, docs/design/REVIEW.md 1.2): the town, the sky in one word and the
temperature, each only when known."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const P = require(process.argv[1] + '/web/place_plate.js');
console.log(JSON.stringify({
  skies: [0, 3, 45, 53, 63, 81, 73, 86, 95, 100, null].map(P.sky),
  towns: [P.town({ address: { town: 'Tellico Plains', county: 'Monroe' } }), P.town({ address: { county: 'Graham County' } }), P.town({}), P.town(null)],
  full: P.text({ place: 'Tellico Plains', code: 1, tempC: 16 }, false),
  metric: P.text({ place: 'Tellico Plains', code: 61, tempC: 16 }, true),
  noWeather: P.text({ place: 'Tellico Plains', code: null, tempC: null }, false),
  nothing: P.text({}, false),
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_sky_words(out):
    assert out["skies"] == ["Dry", "Dry", "Fog", "Drizzle", "Rain", "Rain", "Snow", "Snow", "Storm", None, None]


def test_town_from_reverse_geocode(out):
    assert out["towns"] == ["Tellico Plains", "Graham County", None, None]


def test_text_leaves_out_what_is_unknown(out):
    assert out["full"] == "Tellico Plains · Dry · 61°"
    assert out["metric"] == "Tellico Plains · Rain · 16°"
    assert out["noWeather"] == "Tellico Plains" and out["nothing"] == ""
