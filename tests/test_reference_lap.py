"""Archetype orderings: the scores must rank roads the way a driver would."""
import numpy as np
import pytest

from core import reference_lap as rl
from core import road_dna as rd
from tests.synthetic import path_from_legs

ROADS = {
    "esses": [("straight", 100.0)] + [("arc", 60.0, 60.0 * (-1) ** i) for i in range(16)] + [("straight", 100.0)],
    "switchbacks": [("straight", 100.0)] + sum([[("arc", 15.0, 180.0 * (-1) ** i), ("straight", 120.0)]
                                                for i in range(8)], []),
    "sweepers": [("straight", 100.0)] + sum([[("arc", 200.0, 45.0 * (-1) ** i), ("straight", 60.0)]
                                             for i in range(10)], []),
    "straight": [("straight", 3000.0)],
    "one_hairpin": [("straight", 1400.0), ("arc", 15.0, 180.0), ("straight", 1400.0)],
}


def _drive(legs, elev_fn=None, car=rl.DEFAULT_CAR):
    lat, lon = path_from_legs(legs)
    kappa, ds = rd.compute_curvature(lat, lon)
    n = len(lat)
    z = elev_fn(np.arange(n) * 5.0) if elev_fn else None
    sight = rd.sight_distance_m(lat, lon, z)
    corners = rd.detect_corners(kappa, ds)
    lap = rl.simulate(kappa, ds, sight, elevation_m=z, car=car)
    f = rl.window_features(lap, corners, sight, 0, n)
    return f, rl.axis_scores(f), rl.archetype(f), lap


@pytest.fixture(scope="module")
def scored():
    out = {name: _drive(legs) for name, legs in ROADS.items()}
    out["switchbacks"] = _drive(ROADS["switchbacks"], lambda s: 0.08 * s)   # 8 % climb
    out["rollercoaster"] = _drive([("straight", 3000.0)], lambda s: 8.0 * np.sin(2 * np.pi * s / 220.0))
    return out


def test_archetypes_are_recognised(scored):
    expected = {"esses": "Esses", "switchbacks": "Switchbacks", "sweepers": "Flowing sweepers",
                "straight": "Connector", "one_hairpin": "Connector", "rollercoaster": "Rollercoaster"}
    assert {k: scored[k][2] for k in expected} == expected


def test_flow_and_tech_orderings(scored):
    tech = {k: v[1]["tech"] for k, v in scored.items()}
    flow = {k: v[1]["flow"] for k, v in scored.items()}
    assert flow["esses"] > flow["sweepers"] > flow["one_hairpin"]
    assert flow["esses"] > flow["switchbacks"] > flow["straight"]
    assert tech["switchbacks"] > tech["sweepers"] > tech["straight"]
    assert tech["esses"] > tech["one_hairpin"] > tech["straight"]
    assert min(tech.values()) == tech["straight"] == 0


def test_time_not_distance(scored):
    f = scored["switchbacks"][0]
    assert f["hairpins_pm"] > 3.0                       # ~4.5 hairpins per minute at sim pace
    assert scored["straight"][0]["dead_time"] == pytest.approx(1.0)


def test_car_profile_changes_the_drive():
    legs = ROADS["switchbacks"]
    weak = rl.CarProfile(mass_kg=1100.0, power_kw=60.0)
    strong = rl.CarProfile(mass_kg=1500.0, power_kw=400.0)
    t_weak = float(np.sum(_drive(legs, car=weak)[3]["dt"]))
    t_strong = float(np.sum(_drive(legs, car=strong)[3]["dt"]))
    assert t_strong < t_weak, "more power must shorten the straights between hairpins"


def test_reference_lap_respects_envelope_and_acceleration():
    _, _, _, lap = _drive(ROADS["one_hairpin"])
    assert np.all(lap["v"] <= lap["envelope"] + 1e-9)
    dv2 = np.diff(lap["v"] ** 2) / 2.0 / 5.0
    assert dv2.max() <= rl.DEFAULT_CAR.mu_lon * rd.G_STD + 1e-6
