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
  // 2026-11-04 near Cincinnati: overcast code, 0 mm this quarter hour, rain in the hours before, the station saying light rain
  owner: P.text({ place: 'Colerain', code: 3, mmNow: 0, mm3h: 2.2, obs: { ageMin: 20, weather: ['light rain', 'Light Rain'] }, tempC: 17 }, true),
  staleObs: P.weather({ code: 3, mmNow: 0, mm3h: 2.2, obs: { ageMin: 200, weather: ['light rain'] } }),
  wetAfter: P.weather({ code: 1, mmNow: 0, mm3h: 0.6, obs: { ageMin: 10, weather: [] } }),
  rainingNow: P.weather({ code: 2, mmNow: 0.3, mm3h: 0 }),
  dryKnown: P.weather({ code: 0, mmNow: 0, mm3h: 0 }),
  dryUnknown: P.weather({ code: 0 }),
  obsSnow: P.weather({ code: 3, mm3h: 0, obs: { ageMin: 5, weather: ['heavy snow'] } }),
  past: P.pastMm({ hourly: { time: ['2026-11-04T17:00', '2026-11-04T18:00', '2026-11-04T19:00', '2026-11-04T20:00'], precipitation: [3.4, 0.2, 0.5, 1.5] } }, Date.parse('2026-11-04T20:45Z')),
  noPast: P.pastMm({}),
  obs: P.obsOf({ timestamp: '2026-11-04T20:15:00+00:00', presentWeather: [{ intensity: 'light', weather: 'rain' }], textDescription: 'Light Rain' }, Date.parse('2026-11-04T20:45Z')),
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
    assert out["full"] == "Tellico Plains · 61°"   # a clear code alone doesn't say the road is dry
    assert out["metric"] == "Tellico Plains · Rain · 16°"
    assert out["noWeather"] == "Tellico Plains" and out["nothing"] == ""


def test_rain_the_forecast_code_misses(out):
    """The owner's afternoon: overcast code, 0 mm this quarter hour, the station saying rain."""
    assert out["owner"] == "Colerain · Rain · 17°"
    assert out["staleObs"] == "Wet roads"
    assert out["wetAfter"] == "Wet roads"
    assert out["rainingNow"] == "Rain"
    assert out["obsSnow"] == "Snow"


def test_dry_only_when_known_dry(out):
    assert out["dryKnown"] == "Dry"
    assert out["dryUnknown"] is None


def test_past_rain_and_observation(out):
    assert abs(out["past"] - 2.2) < 1e-9
    assert out["noPast"] is None
    assert round(out["obs"]["ageMin"]) == 30 and out["obs"]["weather"] == ["light rain", "Light Rain"]
