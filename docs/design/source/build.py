import os, sys
sys.path.insert(0, os.path.dirname(__file__))
import pages_a, pages_b, pages_c

OUT = os.path.join(os.path.dirname(__file__), "..")
os.makedirs(OUT, exist_ok=True)

PAGES = [
    ("01-cockpit-idle.html", "Cockpit at idle (Roadbook)", pages_a.cockpit_idle),
    ("02-plan-basic.html", "Plan: the basic sheet", pages_a.plan_basic),
    ("03-plan-more.html", "Plan: more options (power user)", pages_a.plan_advanced),
    ("04-route-card.html", "Route card", pages_a.route_card),
    ("05-drive-roadbook.html", "Driving, Roadbook day", lambda: pages_b.drive_roadbook(False)),
    ("06-drive-roadbook-night.html", "Driving, Roadbook night", lambda: pages_b.drive_roadbook(True)),
    ("07-drive-tapedeck.html", "Driving, Tapedeck (Pro)", pages_b.drive_tapedeck),
    ("08-drive-billet.html", "Driving, Billet (Pro)", pages_b.drive_billet),
    ("09-crew-page.html", "Crew page with livery", pages_c.crew_page),
    ("10-build-thread.html", "Build thread", pages_c.build_thread),
    ("11-theme-picker.html", "Theme picker (Look and voice)", pages_c.theme_picker),
    ("12-friends-map.html", "Friends on the map", pages_c.friends_map),
]

for fname, title, fn in PAGES:
    with open(os.path.join(OUT, fname), "w") as f:
        f.write(fn())

items = "\n".join(
    f'<li><a href="{fname}">{title}</a><span>{fname}</span><a class="png" href="png/{fname[:-5]}.png">png</a></li>' for fname, title, _ in PAGES
)
index = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vetta design mockups</title>
<style>
*{{box-sizing:border-box}}body{{margin:0;background:#EDE4D3;color:#1C1A17;font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;padding:32px 24px}}
h1{{font-size:28px;margin:0 0 4px}}p{{color:#6A6255;max-width:640px;line-height:1.4}}
ol{{list-style:none;padding:0;margin:24px 0 0;max-width:720px;border-top:2px solid #1C1A17}}
li{{display:flex;align-items:center;gap:16px;padding:12px 0;border-bottom:1px solid #CFC4AE;font-size:16px}}
li a{{color:#1C1A17;font-weight:600}}li span{{color:#6A6255;font-size:13px;margin-left:auto}}li .png{{font-size:13px;font-weight:500;color:#C8102E}}
.grid{{display:flex;flex-wrap:wrap;gap:16px;margin-top:32px}}
.grid a{{display:block;width:195px}}.grid img{{width:195px;height:422px;display:block;border:1px solid #CFC4AE;background:#fff}}
.grid b{{display:block;font-size:12px;margin-top:4px;font-weight:600}}
</style></head><body>
<h1>Vetta: design direction mockups</h1>
<p>Twelve iPhone-size (390 x 844) screens built from <a href="REVIEW.md">REVIEW.md</a>. Each file is self-contained HTML (inline CSS and SVG, system fonts). Open any file and view it at 100%.</p>
<ol>{items}</ol>
<div class="grid">{"".join(f'<a href="{fname}"><img src="png/{fname[:-5]}.png" alt="{title}"><b>{title}</b></a>' for fname, title, _ in PAGES)}</div>
</body></html>"""
with open(os.path.join(OUT, "index.html"), "w") as f:
    f.write(index)
print("wrote", len(PAGES), "pages")
