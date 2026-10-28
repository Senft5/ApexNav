import json
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


def _luminance(hex_color):
    channels = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def _contrast(a, b):
    hi, lo = sorted((_luminance(a), _luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_text_tokens_meet_wcag_aa_contrast():
    """Every token used for text reads at 4.5:1 (WCAG AA) on the panel and the stage, day and night,
    and the button label on an accent fill does too (Start drive). Sunlight in a car makes this the floor."""
    out = subprocess.run(
        [NODE, "-e", "const vm=require('node:vm'),fs=require('node:fs');const w={};"
         "vm.runInNewContext(fs.readFileSync(process.argv[1],'utf8'),{window:w});"
         "console.log(JSON.stringify(w.ApexThemes.THEMES.roadbook))",
         str(ROOT / "web" / "themes.js")],
        check=True, capture_output=True, text=True,
    ).stdout
    theme = json.loads(out)
    failures = []
    for mode in ("day", "night"):
        c = theme[mode]
        for fg in ("ink", "dim", "panelInk", "panelDim", "accent", "signal", "amber"):
            for bg in ("panel", "stage"):
                ratio = _contrast(c[fg], c[bg])
                if ratio < 4.5:
                    failures.append(f"{mode} {fg} on {bg}: {ratio:.2f}")
        ratio = _contrast(c["stage"] if mode == "night" else c["panel"], c["accent"])
        if ratio < 4.5:
            failures.append(f"{mode} label on accent: {ratio:.2f}")
    assert not failures, failures
