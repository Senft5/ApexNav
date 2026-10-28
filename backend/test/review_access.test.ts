// App Review access (IDEAS O-12, guideline 2.1): one long-lived review code (only its hash is in the code) makes a fresh
// account a member, any number of times, with no inviter and no friendship; a banned account still can't get in.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, makeUser } from "./helpers";

beforeEach(freshDb);
const CODE = "test-review-code-1234";   // wrangler.test.jsonc holds its sha256 as REVIEW_INVITE_HASH
const member = async (id: string) => env.DB.prepare("SELECT invited_by FROM members WHERE user_id = ?").bind(id).first<{ invited_by: string | null }>();

describe("App Review code", () => {
  it("lets any number of fresh accounts in, with no inviter or friendship", async () => {
    const a = await makeUser("reviewer1", false), b = await makeUser("reviewer2", false);
    expect((await api(a, "POST", "/api/invites/redeem", { token: CODE })).status).toBe(204);
    expect((await api(b, "POST", "/api/invites/redeem", { token: CODE })).status).toBe(204);
    expect(await member(a.id)).toEqual({ invited_by: null });
    expect(await member(b.id)).toEqual({ invited_by: null });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM friendships").first<{ n: number }>())!.n).toBe(0);
  });

  it("a banned account can't use it; a wrong code is just an invalid invite", async () => {
    const banned = await makeUser("banned", false), other = await makeUser("other", false);
    await env.DB.prepare("INSERT INTO bans (google_sub) VALUES ('sub-banned')").run();
    expect((await api(banned, "POST", "/api/invites/redeem", { token: CODE })).status).toBe(403);
    expect((await api(other, "POST", "/api/invites/redeem", { token: CODE + "x" })).status).toBe(400);
    expect(await member(banned.id)).toBeNull();
  });
});
