"""Members' "Road closed" reports reach our own router (graph_router.js CLOSED_X) for every plan, and loops get the same
avoid lists as a trip (police reports, cameras, closures round the start). Before 2026-11-12 closures only went to
Valhalla (Quick), and loops searched with none of the lists, so Avoid police and Avoid cameras did nothing for a loop."""
import math
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = open(os.path.join(ROOT, "web", "cockpit.js"), encoding="utf-8").read()


def body(name):
    i = SRC.index(f"async function {name}(")
    return SRC[i:SRC.index("\n    }\n", i)]


def test_every_plan_carries_the_closures_even_with_no_avoid_switch_on():
    b = body("avoidForTrip")
    first = b.split("\n")[1]
    assert "closedForTrip(points)" in first, "asked before the no-switch shortcut"
    assert "closed.length ? { ...avoid, closed } : avoid" in b
    assert "out.closed = closed" in b


def test_closures_are_members_only_and_never_hold_a_plan_long():
    b = body("closedForTrip")
    assert "memberNow()" in b and "return [];" in b
    assert "hazardsCover(points)" in b and "RouteLoading.optional(closuresAround(points), POLICE_WAIT_MS)" in b


def test_loops_search_with_the_lists_round_their_start():
    b = body("buildLoop")
    assert "L.avoid = ownOn() ? await avoidForTrip(loopAvoidPoints(c, targetKm))" in b
    assert re.search(r"ApexOwnRouting\.loops\(ownRouter\(\), .*avoid: L\.avoid, \.\.\.devTuneReq\(\) \}\)", b)
    built = SRC[SRC.index("async function loopBuilt("):SRC.index("async function loopScored(")]
    assert "FunRoute.unavoided(L.avoid || avoid, r)" in built and "L.avoid || avoid);" in built


def test_the_loop_box_stays_inside_the_camera_maps_limit():
    i = SRC.index("function loopAvoidPoints(")
    b = SRC[i:SRC.index("\n    }\n", i)]
    assert "Math.min(35, km / 3)" in b
    # 35 km each way at 50 degrees north: under FunRoute.CAMERA_BOX_DEG (1.0) in latitude and longitude
    assert 2 * 35 / 110.54 < 1.0 and 2 * 35 / (111.32 * math.cos(math.radians(50))) < 1.0


def test_the_card_says_when_a_route_still_passes_a_reported_closure():
    i = SRC.index("function closedOnCard(")
    b = SRC[i:SRC.index("\n    }\n", i)]
    assert "ApexHazardReports.closuresFor(list, ends)" in b and "passesNear(" in b and ", pts, 40)" in b
    assert "t.id === 'route_dest' || /^loop_/.test(t.id || '')" in b
    assert "const closed = closedOnCard(t) ? 'Passes a reported road closure · ' : '';" in SRC
    assert "${closed}${missed}" in SRC
    # a slow hazards answer paints the card again for everyone, not only with Avoid police on
    assert "if (plannedRoute && !driveActive && typeof renderRouteCard === 'function')" in SRC
