"""TestFlight crash reports, from App Store Connect (betaFeedbackCrashSubmissions), for CI (.github/workflows/crash-logs.yml).

Prints each report's build, time, exception and the crashed thread's frames: never the tester's email, device name or
comment, because the repository's Actions logs are public.
"""
import json, os, re, sys, time, urllib.request

import jwt   # PyJWT[crypto]

API = "https://api.appstoreconnect.apple.com/v1"


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


def main():
    tok = token()
    apps = get("/apps?filter[bundleId]=com.senft.ApexNav", tok)["data"]
    if not apps:
        sys.exit("no app with bundle id com.senft.ApexNav")
    subs = get(f"/apps/{apps[0]['id']}/betaFeedbackCrashSubmissions?limit=5&sort=-createdDate", tok).get("data", [])
    print(f"{len(subs)} crash report(s) shared from TestFlight")
    for s in subs:
        a = s.get("attributes", {})
        print("=" * 80)
        print("shared", a.get("createdDate"), "· build", a.get("appBuild") or a.get("buildNumber") or "?", "· iOS", a.get("osVersion"))
        try:
            log = get(f"/betaFeedbackCrashSubmissions/{s['id']}/crashLog", tok)
            print(crashed_part(log.get("data", {}).get("attributes", {}).get("logText", "")))
        except Exception as e:   # the log can lag the submission
            print("no crash log yet:", e)


if __name__ == "__main__":
    main()
