"""The agent instruction files and the philosophy say what is actually built (red team TE-01, TE-05, PH-02, 2026-11-10).

CLAUDE.md, AGENTS.md and .cursorrules are one text: whichever file an agent's tool loads, it gets the same mission and
rules. The old manifesto's framing (countermeasures, zero-snitch, Octane, the Halda binnacle) must not come back.
"""
import os

ROOT = os.path.join(os.path.dirname(__file__), "..")


def read(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8-sig") as f:
        return f.read()


def test_agent_files_are_one_text():
    claude = read("CLAUDE.md")
    assert read("AGENTS.md") == claude
    assert read(".cursorrules") == claude


def test_mission_names_only_what_is_built():
    claude = read("CLAUDE.md")
    mission = claude[claude.index("## 1."):claude.index("## 3.")]
    assert "Not built" in mission                                    # the unbuilt parts are listed as not built
    for ghost in ("Android Auto", "/core/cpp", "/android-shell", "Kalman", "FFT"):
        for line in mission.splitlines():
            if ghost in line:
                assert line.startswith("- **Not built"), (ghost, line)
    assert "zero-subscription" not in claude and "free-forever" not in claude


def test_built_list_matches_the_repo():
    for path in ("core", "web", "ApexKit", "CarPlay", "backend", "ApexNavApp.swift"):
        assert os.path.exists(os.path.join(ROOT, path)), path
    for ghost in (("core", "cpp"), ("android-shell",)):
        assert not os.path.exists(os.path.join(ROOT, *ghost)), ghost  # built after all: move it out of "Not built"


def test_philosophy_drops_the_old_manifesto():
    p = read("docs", "PHILOSOPHY.md").lower()
    principles = p[:p.index("## 6.")]                                 # section 6 names what was dropped, on purpose
    for word in ("countermeasure", "zero-snitch", "stealth", "low heat", "octane", "halda", "singer", "group b", "vdo"):
        assert word not in principles, word
