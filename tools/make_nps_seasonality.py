"""National park seasons for web/route_ctx/hazards_live.js PARKS: each month's recreation visits against the park's average
month, from NPS IRMA Visitor Use Statistics (public domain). Prints the `m: [...]` arrays to paste; nothing else changes.

    python3 tools/make_nps_seasonality.py [first_year] [last_year]

Blue Ridge Parkway: use 2023 only until a full year after Hurricane Helene (closed from late September 2024).
"""
import re
import sys
import urllib.request

UNITS = ["GRSM", "BLRI", "SHEN", "NERI", "CUVA", "MACA"]
URL = "https://irmaservices.nps.gov/v3/rest/stats/visitation?unitCodes={u}&startMonth=1&startYear={a}&endMonth=12&endYear={b}"
ROW = re.compile(r"<Month>(\d+)</Month>.*?<RecreationVisitors>(\d+)</RecreationVisitors>.*?<Year>(\d+)</Year>", re.S)


def ratios(xml):
    """Monthly visits averaged over the years given, each as a share of the average month (2 decimals)."""
    by = {}
    for m, v, _y in ROW.findall(xml):
        by.setdefault(int(m), []).append(int(v))
    if len(by) != 12:
        raise ValueError("not 12 months")
    mean = [sum(by[m]) / len(by[m]) for m in range(1, 13)]
    avg = sum(mean) / 12
    return [round(x / avg, 2) for x in mean]


if __name__ == "__main__":
    a = int(sys.argv[1]) if len(sys.argv) > 1 else 2023
    b = int(sys.argv[2]) if len(sys.argv) > 2 else 2024
    for u in UNITS:
        yb = 2023 if u == "BLRI" and b == 2024 else b
        with urllib.request.urlopen(URL.format(u=u, a=a, b=yb), timeout=60) as r:
            print(u, "m:", ratios(r.read().decode("utf-8")))
