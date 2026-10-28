// Input checks found in the production-readiness audit: a missing or odd field is a 400, never a silent default.
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, makeUser, ok } from "./helpers";

beforeEach(freshDb);

describe("input validation", () => {
  it("crew discovery without lat or lon is a 400, not a search around 0,0", async () => {
    const a = await makeUser("alice");
    expect((await api(a, "GET", "/api/crews/discover")).status).toBe(400);
    expect((await api(a, "GET", "/api/crews/discover?lat=35.3")).status).toBe(400);
    expect((await api(a, "GET", "/api/crews/discover?lat=35.3&lon=")).status).toBe(400);
    expect((await api(a, "GET", "/api/crews/discover?lat=35.3&lon=-83.8")).status).toBe(200);
  });

  it("a client segment id must be URL-safe so it can be deleted again", async () => {
    const a = await makeUser("alice");
    const seg = { name: "Dry Ridge climb", length_m: 2500, geom: "_p~iF~ps|U_ulLnnqC", start_lat: 39.25, start_lon: -84.6, end_lat: 39.27, end_lon: -84.58 };
    expect((await api(a, "POST", "/api/segments", { ...seg, id: "a/b" })).status).toBe(400);
    expect((await api(a, "POST", "/api/segments", { ...seg, id: 42 })).status).toBe(400);
    await ok(api(a, "POST", "/api/segments", { ...seg, id: "seg_1793155749527" }));
    expect((await api(a, "DELETE", "/api/segments/seg_1793155749527")).status).toBe(204);
  });
});
