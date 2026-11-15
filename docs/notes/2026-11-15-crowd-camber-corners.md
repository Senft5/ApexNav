# STATE

## Members' camber in a planned route's corner notes (Q-04, the road-feel mission, 2026-11-15)
- `contributor.js` `camFrom(cam, cn, csd)`: per sample, the camber that two or more passes measured and agree on (their
  SD within `AGREE.camber_deg`, 1.5°), kept only where it is 3° or more either way. Values are degrees relative to the
  turn. Everywhere else it is null. `measuredAlong` returns it as `crowdCam`.
- `cockpit.js` `applyCrowdCurvature` (still never mid-drive) now works out the corners again when there is members'
  camber, even if no curvature was replaced. It passes `camberRad` to `detectCorners`, so a corner gets the
  `off-camber` ("slopes away") or `banked` mod, and to `brakingEnvelopeMps`, so apex speeds follow the real lean.
  `t.crowdCamber` holds the metres that had members' camber. No core math changed.
- `route_feel.js`: saved routes keep it as `cam` runs (tenths of a degree), for use with no signal.
- Tests:
  - `tests/test_contributor.py` (`camFrom`)
  - `tests/test_route_feel.py`
  - e2e "a saved route keeps its road feel": a bend members measured at -5° is called with "off-camber", and Save
    keeps it.
- Next:
  - Check against a real drive's measured camber, to see how often a 3° bin shows up on public roads.
  - The route card could say "camber from members' drives on X km" if that helps.
