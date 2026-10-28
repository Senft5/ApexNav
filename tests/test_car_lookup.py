"""Garage car lookup (web/car_lookup.js, IDEAS S-21): VIN decode via NHTSA vPIC, typical specs, and a merge that keeps
what only the owner knows. Unknown stays blank."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const L = require(process.argv[1] + '/web/car_lookup.js');
const out = {};
// A real vPIC row for a 2022 MX-5 (no transmission given, check-digit warning)
const row = { ModelYear: '2022', Make: 'MAZDA', Model: 'MX-5', Trim: 'Grand Touring', DriveType: 'RWD/Rear-Wheel Drive', TransmissionStyle: '', EngineHP: '181' };
out.vin = L.fromVin(row);
out.vinBlank = L.fromVin({ ModelYear: '', Make: 'BMW', Model: 'M3', Trim: 'Not Applicable', DriveType: '', EngineHP: '' });
out.vinNone = L.fromVin({ Make: '', Model: '' });
out.drive = ['AWD/All-Wheel Drive', '4WD/4-Wheel Drive/4x4', 'FWD/Front-Wheel Drive', '', null].map(L.driveOf);
out.box = ['Manual/Standard', 'Automatic', 'Dual-Clutch Transmission (DCT)', 'Continuously Variable Transmission (CVT)', ''].map(L.gearboxOf);
out.spec = [L.specFor({ year: 2022, make: 'mazda', model: 'MX-5 Miata', trim: '' }),
            L.specFor({ year: 2019, make: 'Honda', model: 'Civic', trim: 'Type R' }),
            L.specFor({ year: 2019, make: 'Honda', model: 'Civic', trim: 'Sport' }),
            L.specFor({ year: 1985, make: 'Mazda', model: 'MX-5' }),
            L.specFor({ year: 2022, make: '', model: 'MX-5' })];
out.merged = L.merge({ year: '', make: 'Mazda', model: 'MX-5', trim: '', nickname: 'Zoom', color: 'Soul Red', mods: 'coilovers', power_hp: '', weight_kg: null },
                     { year: 2022, make: 'Mazda', model: 'MX-5', trim: 'Grand Touring', power_hp: 181, weight_kg: null, drivetrain: 'rwd', transmission: null });
out.vinRe = ['JM1NDAD75N0500000', 'JM1NDAD75N050000', 'JM1NDAD75N050000O'].map(v => L.VIN_RE.test(v));
(async () => {
  out.badVin = await L.decodeVin('123', () => { throw new Error('no fetch'); });
  out.offline = await L.decodeVin('JM1NDAD75N0500000', async () => { throw new Error('down'); });
  out.decoded = await L.decodeVin('jm1ndad75n0500000', async () => ({ ok: true, json: async () => ({ Results: [row] }) }));
  out.models = await L.models('Mazda', 2022, async () => ({ ok: true, json: async () => ({ Results: [{ Model_Name: 'MX-5' }, { Model_Name: 'CX-5' }, { Model_Name: 'MX-5' }] }) }));
  console.log(JSON.stringify(out));
})();
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_vin_row(out):
    assert out["vin"] == {"year": 2022, "make": "Mazda", "model": "MX-5", "trim": "Grand Touring", "power_hp": 181, "drivetrain": "rwd", "transmission": None}
    assert out["vinBlank"] == {"year": None, "make": "BMW", "model": "M3", "trim": None, "power_hp": None, "drivetrain": None, "transmission": None}
    assert out["vinNone"] is None


def test_drive_and_gearbox_words(out):
    assert out["drive"] == ["awd", "awd", "fwd", None, None]
    assert out["box"] == ["manual", "auto", "dct", "auto", None]


def test_typical_specs(out):
    mx5, ctr, civic, old, nomake = out["spec"]
    assert mx5["power_hp"] == 181 and mx5["typical"] is True     # 'MX-5 Miata' matches the 'MX-5' row
    assert ctr["power_hp"] == 306                                  # trim-specific row
    assert civic is None and old is None and nomake is None        # no guessing outside the table


def test_merge_keeps_what_only_the_owner_knows(out):
    m = out["merged"]
    assert (m["nickname"], m["color"], m["mods"]) == ("Zoom", "Soul Red", "coilovers")
    assert (m["year"], m["trim"], m["power_hp"], m["drivetrain"]) == (2022, "Grand Touring", 181, "rwd")
    assert m["weight_kg"] is None                                  # not found: stays blank


def test_decode_flow(out):
    assert out["vinRe"] == [True, False, False]
    assert out["badVin"] == {"error": "bad_vin"} and out["offline"] == {"error": "offline"}
    d = out["decoded"]
    assert d["typical"] is True and d["car"]["weight_kg"] == 1060 and d["car"]["transmission"] == "manual"   # table fills what vPIC lacked
    assert out["models"] == ["CX-5", "MX-5"]
