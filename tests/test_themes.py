import shutil
import subprocess
from pathlib import Path

import pytest


NODE = shutil.which("node")
ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_roadbook_only_and_day_night():
    runner = r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const properties = new Map();
const element = {
  dataset: {},
  style: { setProperty: (key, value) => properties.set(key, value) }
};
const browser = { window: {}, document: { documentElement: element } };
vm.runInNewContext(fs.readFileSync(process.argv[1], 'utf8'), browser);
const themes = browser.window.ApexThemes;
assert.deepEqual(Object.keys(themes.THEMES), ['roadbook']);
const ids = [undefined, null, '', 'roadbook', 'stage', 'instrument', 'telemetry',
  'unknown', '__proto__', 'constructor', 'toString', 'hasOwnProperty'];
for (const id of ids) {
  assert.equal(themes.get(id), themes.THEMES.roadbook);
  for (const night of [false, true]) {
    const result = themes.apply(id, night);
    const mode = night ? 'night' : 'day';
    assert.equal(result.theme.id, 'roadbook');
    assert.equal(result.theme.notes, 'roadbook');
    assert.equal(result.colors, themes.THEMES.roadbook[mode]);
    assert.equal(result.map, themes.THEMES.roadbook.map[mode]);
    assert.equal(element.dataset.theme, 'roadbook');
    assert.equal(element.dataset.mode, mode);
    assert.equal(properties.get('--panel-ink'), result.colors.panelInk);
    assert.equal(properties.get('--font-ui'), result.theme.fonts.ui);
  }
}
"""
    subprocess.run(
        [NODE, "-e", runner, str(ROOT / "web" / "themes.js")],
        check=True, capture_output=True, text=True,
    )
