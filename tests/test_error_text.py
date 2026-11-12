"""A failed request never shows the browser's own words ("Load failed", "Failed to fetch") in a toast."""
import json
import re
import subprocess
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"
COCKPIT = (WEB / "cockpit.js").read_text(encoding="utf-8")


def _err_text(cases):
    i = COCKPIT.index("function errText")
    fn = COCKPIT[i:COCKPIT.index("\n    }\n", i) + 6]
    js = fn + "\nconst out = [];\nfor (const [name, msg] of " + json.dumps(cases) + ") {\n" \
        "  const e = name === null ? null : Object.assign(new Error(msg), { name });\n  out.push(errText(e));\n}\n" \
        "console.log(JSON.stringify(out));"
    return json.loads(subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout)


def test_no_raw_error_message_toasts():
    for f in WEB.glob("*.js"):
        src = f.read_text(encoding="utf-8")
        assert not re.search(r"toast\((e|err)\.message\)", src), f"{f.name}: use toast(errText(err))"


def test_network_errors_read_plainly():
    off = "No connection. Try again when you have signal."
    got = _err_text([
        ["TypeError", "Load failed"],
        ["TypeError", "Failed to fetch"],
        ["TypeError", "NetworkError when attempting to fetch resource."],
        ["SyntaxError", "Unexpected token '<'"],
        ["Error", "Couldn't find that place. Try another."],
        [None, ""],
    ])
    assert got[:3] == [off] * 3
    assert got[3].startswith("Something went wrong on our side")
    assert got[4] == "Couldn't find that place. Try another."
    assert got[5] == "Something went wrong. Try again."
