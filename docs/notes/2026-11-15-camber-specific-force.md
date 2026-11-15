# STATE

## Live camber reads the bank again: specific force, not userAcceleration (camber v3, 2026-11-15)
- Found from members' road data in prod D1: of 907 camber bins, 135 read 7° or more, and 92 of those sat on straight
  motorways (average 9.7°). A motorway's cross slope is about 1° to 2°.
- Root cause: the live pipeline (core/live_pipeline.py, web/live_pipeline.js, ApexKit IMUPipeline) solved
  a_y = v·ω·cos φ − g·sin φ on CoreMotion's userAcceleration, which has gravity removed. The car leans with the bank, so
  the −g·sin φ term was never there, and camber read about 0 on a real bank. What it did read was the attitude filter
  leaning toward the apparent vertical in long turns, about +8° on a flat motorway bend. The offline reference
  (core/kinematics.py) was right all along, since it uses −(gravity + userAcceleration). The fixture hid the bug by
  feeding a −g·sin φ term with flat gravity, which no phone produces.
- Fix, in all three ports: camber uses `lat_sf`, the lateral specific force (accel − G·gravity, the raw accelerometer).
  Without gravity there is no camber (unknown). The mount's slow trim pauses while cornering
  (|v·yaw| > CAMBER_GATE_MPS2), so a long bank isn't trimmed away. The G-ball's lat_acc is unchanged.
- The fixture (tools/make_live_fixture.py) now gives what CoreMotion gives on a 4° bank: kinematic acceleration, gravity
  tilted with the car, and the yaw on −Y and +Z. On it the old code reads 0.0° and the new code reads 4.0°.
  New tests: a flat bend with the attitude filter leaning 8° stays flat (the old code read +8°), and no gravity means no
  camber.
- The camber version is now 3 everywhere: ApexKit `camberVersion`, sensors.js `CAMBER_V`, contributor.js and
  recording.js `CAM_V`, backend contribute.ts `CAM_V`, and live_pipeline `CAMBER_VERSION`. The server keeps camber only
  from v3 uploads, and v2 drives on phones are no longer shared. tests/test_road_upload_payload.py holds all the twins
  to one number.
- Not run here: `swift test` (no Swift toolchain in this container). The CI apexkit-linux job runs it against the new
  fixture, and LiveFixtureTests now passes gravity to the hold test and checks that no gravity gives nil.
- Next:
  - Clear the v2 camber already in prod road_bins (camber_mean, camber_m2 and camber_n set to null/0). This needs
    Nate's go in the Roam A thread.
  - Hear "banked" and "off-camber" from a v3 TestFlight build on a road Nate knows.
  - The roughness scale is a separate open issue, owned by the analysis thread.

# CALL SHEET

## Camber v3: old camber is dropped, not corrected (2026-11-15)
- What: the server and the phone ignore camber marked 2, both new uploads and drives already on phones.
- Why: v2 camber is attitude drift, so nothing in it can be rescued.
- How to undo: set CAM_V back to 2 in contribute.ts and contributor.js. Don't do that.

## The mount stops trimming in a corner (2026-11-15)
- What: the 30 s trim that follows the road on average pauses while |v·yaw| is over the camber gate.
- Why: on a long bank it would tilt the chassis frame onto the bank and erase the camber being measured.
- How to undo: remove the `cornering` condition in `_track_gravity` (and in the JS and Swift twins), then regenerate the
  fixture.
