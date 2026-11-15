"""The made-up sample for the road insights viewer and API docs (web/insights-sample.geojson, backend/src/road_insights.ts).

Real public road lines (OpenStreetMap, through our own relay /api/ctx/osm, six 0.05 degree tiles of north-east Cincinnati)
with MADE-UP values in the API's fields, so anyone can try the format and the viewer without seeing a single measurement.
Nothing from Vetta's road data goes in it. Run from the repo root:

    python tools/insights_sample.py
"""
import collections
import hashlib
import json
import pathlib
import urllib.request

OUT = pathlib.Path(__file__).resolve().parent.parent / "web" / "insights-sample.geojson"
TILES = [(i, j) for i in (784, 785) for j in (-1688, -1687, -1686)]
RELAY = "https://vettadrive.app/api/ctx/osm?bbox="


def tiles():
    for i, j in TILES:
        box = ",".join("%.2f" % v for v in (i * 0.05, j * 0.05, (i + 1) * 0.05, (j + 1) * 0.05))
        req = urllib.request.Request(RELAY + box, headers={"user-agent": "Vetta-insights-sample/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            yield json.load(r)
def u(s):
    return int(hashlib.sha256(s.encode()).hexdigest()[:12],16)/16**12
ways={}
for t in tiles():
    for el in t['elements']:
        if el.get('type')!='way' or 'geometry' not in el: continue
        t=el.get('tags',{}); h=t.get('highway','')
        if h not in('primary','secondary','tertiary'): continue
        nm=t.get('name') or t.get('ref')
        if not nm: continue
        ways[el['id']]=(h,nm,[(round(p['lon'],4),round(p['lat'],4)) for p in el['geometry']])
groups=collections.defaultdict(list)
for wid,(h,nm,pts) in ways.items(): groups[(h,nm)].append([wid,pts])
merged={}
for (h,nm),ls in groups.items():
    ls=[[w,list(p)] for w,p in ls]
    changed=True
    while changed:
        changed=False
        for a in ls:
            for b in ls:
                if a is b or not a[1] or not b[1]: continue
                if a[1][-1]==b[1][0]: a[1]+=b[1][1:]
                elif a[1][-1]==b[1][-1]: a[1]+=b[1][::-1][1:]
                else: continue
                b[1]=[]; changed=True
        ls=[x for x in ls if x[1]]
    for w,p in ls:
        if len(p)>=4: merged[w]=(h,nm,p)
ways=merged
feats=[]
bands=['fair','good','high']
for wid,(h,nm,pts) in sorted(ways.items()):
    if len(pts)<2: continue
    step=max(1,-(-len(pts)//40)); line=pts[::step]
    if line[-1]!=pts[-1]: line.append(pts[-1])
    b=u(nm); v=lambda k,lo,hi: round(lo+(hi-lo)*(0.7*u(nm+k)+0.3*u(str(wid)+k)),3)
    feats.append({"type":"Feature","geometry":{"type":"LineString","coordinates":[list(p) for p in line]},
      "properties":{"way":wid,"dir":0,"cls":h,"name":nm,"confidence":bands[int(u(str(wid)+'c')*3)],"last_month":"2026-10",
        "rough_g":v('r',0.03,0.22),"banked":round(v('b',0,0.6),2),"off_camber":round(v('o',0,0.25),2),
        "crests_per_km":round(v('k',0,4),2),"flow":round(v('f',0.35,0.95),2),"hard_brake":round(v('h',0,0.15),2)}})
fc={"type":"FeatureCollection","sample":True,
 "note":"SAMPLE: every value here is made up, to show the format. The road lines are real public OpenStreetMap ways (north-east Cincinnati); no Vetta measurement is in this file.",
 "attribution":"Road lines © OpenStreetMap contributors (ODbL).","method_version":"2026-10","k":10,"epsilon":1,"features":feats}
OUT.write_text(json.dumps(fc, separators=(',', ':')))
print(len(feats), 'features ->', OUT)
