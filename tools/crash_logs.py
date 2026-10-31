"""TestFlight feedback from App Store Connect, for CI (.github/workflows/crash-logs.yml): crash reports
(betaFeedbackCrashSubmissions) and screenshot feedback (betaFeedbackScreenshotSubmissions).

Prints each crash's build, time, exception and crashed thread, and each screenshot's comment; never the tester's email
or device name, because the repository's Actions logs are public. Screenshots are saved to feedback/ for a short-lived
workflow artifact, not printed.
"""
import json, os, re, sys, time, urllib.request

import jwt   # PyJWT[crypto]

API = "https://api.appstoreconnect.apple.com/v1"
# The owner's TestFlight email, as the first 16 hex of its sha256 (the address itself is not in the repo). Screenshot
# feedback is acted on only when it is the owner's; another tester's comment is counted, never printed or followed.
OWNER = "90e41480b1bda2f5"


def tester(attrs):
    """The tester's fingerprint: the first 16 hex of the sha256 of their TestFlight email, or "" when there is none."""
    import hashlib
    email = (attrs.get("email") or "").strip().lower()
    return hashlib.sha256(email.encode()).hexdigest()[:16] if email else ""


def is_owner(attrs):
    return tester(attrs) == OWNER


def token():
    key = open(os.environ["ASC_KEY_PATH"]).read()
    now = int(time.time())
    return jwt.encode({"iss": os.environ["ASC_ISSUER_ID"], "iat": now, "exp": now + 1000, "aud": "appstoreconnect-v1"},
                      key, algorithm="ES256", headers={"kid": os.environ["ASC_KEY_ID"], "typ": "JWT"})


def get(path, tok):
    req = urllib.request.Request(path if path.startswith("http") else API + path, headers={"Authorization": "Bearer " + tok})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def crashed_part(text):
    """The header lines that say what crashed, and the crashed thread's frames."""
    keep, lines = [], text.splitlines()
    for l in lines:
        if re.match(r"^(Version|Exception Type|Exception Codes|Exception Subtype|Termination Reason|Triggered by Thread|Crashed Thread|Application Specific Information)", l):
            keep.append(l)
    m = next((i for i, l in enumerate(lines) if re.match(r"^Thread \d+ Crashed", l)), None)
    if m is not None:
        for l in lines[m:m + 40]:
            if not l.strip():
                break
            keep.append(l)
    if "Last Exception Backtrace" in text:
        i = text.index("Last Exception Backtrace")
        keep += text[i:i + 3000].splitlines()[:40]
    return "\n".join(keep) or text[:4000]


def screenshots(app_id, tok):
    subs = get(f"/apps/{app_id}/betaFeedbackScreenshotSubmissions?limit=10&sort=-createdDate", tok).get("data", [])
    print(f"{len(subs)} screenshot feedback(s)")
    os.makedirs("feedback", exist_ok=True)
    others = 0
    for n, s in enumerate(subs, 1):
        a = s.get("attributes", {})
        if not is_owner(a):
            others += 1
            print(f"#{n} shared", a.get("createdDate"), "· from another tester", tester(a) or "(no email)", "· not shown")
            continue
        print("=" * 80)
        print(f"#{n} shared", a.get("createdDate"), "· from: owner · iOS", a.get("osVersion"), "· app", a.get("appPlatform") or "")
        print("comment:", (a.get("comment") or "(none)").strip())
        for k, shot in enumerate(a.get("screenshots") or [], 1):
            try:
                with urllib.request.urlopen(shot["url"], timeout=60) as r:
                    open(f"feedback/{n:02d}-{k}.png", "wb").write(r.read())
                print(f"  screenshot feedback/{n:02d}-{k}.png ({shot.get('width')}x{shot.get('height')})")
            except Exception as e:
                print("  screenshot not downloaded:", e)
    if others:
        print(f"{others} screenshot feedback(s) from other testers: not shown, not acted on")


def main():
    tok = token()
    apps = get("/apps?filter[bundleId]=com.senft.ApexNav", tok)["data"]
    if not apps:
        sys.exit("no app with bundle id com.senft.ApexNav")
    screenshots(apps[0]["id"], tok)
    subs = get(f"/apps/{apps[0]['id']}/betaFeedbackCrashSubmissions?limit=5&sort=-createdDate", tok).get("data", [])
    print(f"{len(subs)} crash report(s) shared from TestFlight")
    for s in subs:
        a = s.get("attributes", {})
        print("=" * 80)
        print("shared", a.get("createdDate"), "· from:", "owner" if is_owner(a) else "another tester", "· build",
              a.get("appBuild") or a.get("buildNumber") or "?", "· iOS", a.get("osVersion"), "· device", a.get("deviceModel") or "?")
        try:
            log = get(f"/betaFeedbackCrashSubmissions/{s['id']}/crashLog", tok)
            print(crashed_part(log.get("data", {}).get("attributes", {}).get("logText", "")))
        except Exception as e:   # the log can lag the submission
            print("no crash log yet:", e)


if __name__ == "__main__":
    main()
