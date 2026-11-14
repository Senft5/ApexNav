"""The App ID's capabilities through the App Store Connect API (.github/workflows/app-id-capabilities.yml), so the owner
doesn't tick them in the developer portal. Lists what com.senft.ApexNav has, then switches on WANT that it lacks.

The API knows 28 capability types (no CarPlay, Time Sensitive Notifications, WeatherKit or App Attest): those come from
the entitlements in project.yml, which the TestFlight job's cloud signing (-allowProvisioningUpdates) puts on the App ID
and the profile. Prints capability names only (the repository's Actions logs are public).
  ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID set; python tools/asc_capabilities.py [--dry-run]
"""
import json, os, sys, time, urllib.error, urllib.request

import jwt   # PyJWT[crypto]

API = "https://api.appstoreconnect.apple.com/v1"
BUNDLE = "com.senft.ApexNav"
# Data protection at the class iOS already gives an app's files by default: "complete" would lock the drive log and the
# offline map away from the CarPlay drive while the phone sits locked in its mount.
WANT = {
    "PUSH_NOTIFICATIONS": None,
    "SIRIKIT": None,
    "ASSOCIATED_DOMAINS": None,
    "DATA_PROTECTION": [{"key": "DATA_PROTECTION_PERMISSION_LEVEL", "options": [{"key": "PROTECTED_UNTIL_FIRST_USER_AUTH"}]}],
}


def token():
    key = open(os.environ["ASC_KEY_PATH"]).read()
    now = int(time.time())
    return jwt.encode({"iss": os.environ["ASC_ISSUER_ID"], "iat": now, "exp": now + 1000, "aud": "appstoreconnect-v1"},
                      key, algorithm="ES256", headers={"kid": os.environ["ASC_KEY_ID"], "typ": "JWT"})


def call(method, path, tok, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        try:
            detail = [x.get("detail") or x.get("title") for x in json.load(e).get("errors", [])]
        except Exception:
            detail = []
        return e.code, {"errors": detail}


def main(dry):
    tok = token()
    st, ids = call("GET", f"/bundleIds?filter[identifier]={BUNDLE}&limit=5", tok)
    rows = [x for x in ids.get("data", []) if x["attributes"]["identifier"] == BUNDLE] if st == 200 else []
    if not rows:
        print(f"::error::bundle id {BUNDLE} not found (HTTP {st} {ids.get('errors')})")
        return 1
    bid = rows[0]["id"]
    st, caps = call("GET", f"/bundleIds/{bid}/bundleIdCapabilities?limit=200", tok)
    have = sorted(c["attributes"]["capabilityType"] for c in caps.get("data", [])) if st == 200 else []
    print(f"{BUNDLE} has: {', '.join(have) or '(none)'}")
    failed = 0
    for cap, settings in WANT.items():
        if cap in have:
            print(f"  {cap}: already on")
            continue
        if dry:
            print(f"  {cap}: would switch on")
            continue
        attrs = {"capabilityType": cap}
        if settings:
            attrs["settings"] = settings
        st, out = call("POST", "/bundleIdCapabilities", tok, {"data": {"type": "bundleIdCapabilities", "attributes": attrs,
                       "relationships": {"bundleId": {"data": {"type": "bundleIds", "id": bid}}}}})
        ok = st in (200, 201)
        failed += not ok
        print(f"  {cap}: switched on" if ok else f"  {cap}: refused (HTTP {st}: {out.get('errors')})")
    with open(os.environ.get("GITHUB_STEP_SUMMARY", os.devnull), "a") as f:
        f.write(f"App ID {BUNDLE}: had {len(have)} capabilities; {len(WANT)} wanted; {failed} refused\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main("--dry-run" in sys.argv))
