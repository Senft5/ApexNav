"""The phone page's source as the tests read it: web/index.html's markup plus the scripts that were its inline script
(REVIEW_FEEL F-03 moved it out to web/cockpit.js). Tests that look for a function or a wiring line in "the page" read this."""
import pathlib

WEB = pathlib.Path(__file__).resolve().parent.parent / "web"
# index.html, then its own scripts, in load order
FILES = ("index.html", "cockpit.js", "lazy.js")


def cockpit_source():
    return "\n".join((WEB / f).read_text(encoding="utf-8") for f in FILES if (WEB / f).exists())

