"""Shared pieces for the Vetta mockups. Every output file is self-contained HTML."""

SANS = "-apple-system, 'SF Pro Text', 'Helvetica Neue', Inter, Arial, sans-serif"
COND = "'SF Pro Display', 'Avenir Next Condensed', 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif"
MONO = "ui-monospace, 'SF Mono', Menlo, 'DejaVu Sans Mono', monospace"

THEMES = {
    # Roadbook: paper and ink, one red pen.
    "roadbook": dict(
        paper="#EDE4D3", paper2="#F3ECDD", ink="#1C1A17", pencil="#6A6255", hair="#CFC4AE",
        rule="#1C1A17", red="#C8102E", amber="#8A5810", gain="#2E6B3F",
        map_bg="#F1EADB", map_contour="#C9B99A", map_road="#FFFFFF", map_road_edge="#1C1A17",
        map_water="#BFD3D4", map_label="#5D5547", route="#C8102E",
    ),
    "roadbook_night": dict(
        paper="#1A1814", paper2="#211E19", ink="#EDE4D3", pencil="#8C8373", hair="#2E2A23",
        rule="#EDE4D3", red="#E65252", amber="#D9A24A", gain="#6FBF7F",
        map_bg="#14120F", map_contour="#2E2A23", map_road="#3A3530", map_road_edge="#EDE4D3",
        map_water="#1C2628", map_label="#8C8373", route="#E65252",
    ),
    # Tapedeck: late-90s head unit. Blue-green VFD glow on near-black, amber for secondaries.
    "tapedeck": dict(
        paper="#0B0F12", paper2="#11171B", ink="#7DF5DE", pencil="#2F8F84", hair="#17333A",
        rule="#7DF5DE", red="#FF8A3D", amber="#FFB347", gain="#7DF5DE",
        map_bg="#070A0C", map_contour="#132226", map_road="#0E2A2E", map_road_edge="#49C9B6",
        map_water="#0A1A20", map_label="#3FA79A", route="#FFB347",
    ),
    # Billet: machined metal, red glow.
    "billet": dict(
        paper="#1A1B1D", paper2="#232527", ink="#E6E3DC", pencil="#8A8B8E", hair="#34373B",
        rule="#9A9DA3", red="#FF2A2A", amber="#FFB000", gain="#7FD0A0",
        map_bg="#121314", map_contour="#232527", map_road="#2C2E31", map_road_edge="#C9CBD0",
        map_water="#161A1E", map_label="#8A8B8E", route="#FF2A2A",
    ),
}

# The one thing no theme may change: the hazard plate. Black plate, signal orange edge and glyph, white text.
HAZARD_CSS = """
.hazard{position:absolute;left:12px;display:flex;align-items:center;gap:10px;background:#111111;border:2px solid #FF7A1A;
  color:#FFFFFF;padding:8px 12px 8px 10px;font-family:%s;font-weight:800;font-size:20px;letter-spacing:.02em;line-height:1;
  box-shadow:0 2px 0 rgba(0,0,0,.35)}
.hazard .glyph{width:26px;height:26px;flex:none}
.hazard small{display:block;font-family:%s;font-weight:600;font-size:12px;letter-spacing:0;color:#FFB27A;margin-top:3px}
""" % (COND, SANS)

HAZARD_TRIANGLE = """<svg class="glyph" viewBox="0 0 26 26"><path d="M13 2.5 24.5 23H1.5Z" fill="#FF7A1A"/><path d="M13 9v7.5" stroke="#111" stroke-width="2.6" stroke-linecap="round"/><circle cx="13" cy="19.6" r="1.5" fill="#111"/></svg>"""


def base_css(t, extra=""):
    return f"""
*{{box-sizing:border-box;margin:0;padding:0}}
html,body{{height:100%}}
body{{background:#3A3A3A;font-family:{SANS};color:{t['ink']};-webkit-font-smoothing:antialiased;display:flex;align-items:flex-start;justify-content:center;padding:24px 0}}
.phone{{position:relative;width:390px;height:844px;background:{t['paper']};overflow:hidden;color:{t['ink']};box-shadow:0 20px 60px rgba(0,0,0,.5)}}
.status{{position:absolute;top:0;left:0;right:0;height:47px;display:flex;justify-content:space-between;align-items:flex-end;padding:0 28px 8px;font-size:15px;font-weight:600;z-index:30;pointer-events:none}}
.status .cell{{display:flex;gap:5px;align-items:center}}
.cond{{font-family:{COND};font-weight:800;font-variant-numeric:tabular-nums}}
.mono{{font-family:{MONO}}}
.tabs{{position:absolute;left:0;right:0;bottom:0;height:82px;background:{t['paper']};border-top:2px solid {t['rule']};display:flex;padding:8px 6px 0;z-index:20}}
.tab{{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:11px;font-weight:600;color:{t['pencil']};position:relative}}
.tab svg{{width:26px;height:26px;stroke:currentColor;fill:none;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}}
.tab.on{{color:{t['red']}}}
.tab.on::before{{content:"";position:absolute;top:-10px;left:22px;right:22px;height:3px;background:{t['red']}}}
.home{{position:absolute;bottom:8px;left:125px;width:140px;height:5px;border-radius:3px;background:{t['ink']};opacity:.8;z-index:31}}
.rule{{border-top:1px solid {t['hair']}}}
.btn{{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:48px;padding:0 18px;font-size:15px;font-weight:600;border:1.5px solid {t['ink']};color:{t['ink']};background:transparent;font-family:{SANS}}}
.btn.primary{{background:{t['ink']};color:{t['paper']};border-color:{t['ink']}}}
.btn.record{{background:{t['red']};color:#FFFFFF;border-color:{t['red']};height:52px;font-size:16px;font-weight:700;box-shadow:inset 0 -3px 0 rgba(0,0,0,.28)}}
.btn.record .dot{{width:12px;height:12px;border-radius:50%;background:#FFFFFF}}
.btn.text{{border:none;text-decoration:underline;text-underline-offset:3px;padding:0 6px}}
.label{{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:{t['pencil']}}}
.pencil{{color:{t['pencil']}}}
.red{{color:{t['red']}}}
{HAZARD_CSS}
{extra}
"""


def status_bar(dark=False):
    c = "#FFFFFF" if dark else "inherit"
    return f"""<div class="status" style="color:{c}"><div class="cell">9:41</div><div class="cell">
<svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" fill="currentColor"/><rect x="5" y="5.5" width="3" height="6.5" fill="currentColor"/><rect x="10" y="3" width="3" height="9" fill="currentColor"/><rect x="15" y="0" width="3" height="12" fill="currentColor"/></svg>
<svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="22" height="12" rx="3" fill="none" stroke="currentColor" opacity=".5"/><rect x="2" y="2" width="16" height="9" rx="1.5" fill="currentColor"/><path d="M24 4.5v4a2 2 0 0 0 0-4Z" fill="currentColor" opacity=".5"/></svg></div></div>"""


ICONS = {
    "map": '<svg viewBox="0 0 26 26"><path d="M13 3.5 4.5 22l8.5-4 8.5 4Z"/></svg>',
    "log": '<svg viewBox="0 0 26 26"><path d="M4 7h18M4 13h18M4 19h11"/></svg>',
    "crew": '<svg viewBox="0 0 26 26"><circle cx="9.5" cy="9" r="3.5"/><circle cx="17.5" cy="10.5" r="3"/><path d="M3.5 21c0-4 2.7-6.5 6-6.5s6 2.5 6 6.5M15.5 20.5c.4-3 2.3-5 5-5 1.2 0 2.5.5 3 1.5"/></svg>',
    "garage": '<svg viewBox="0 0 26 26"><path d="M3.5 11.5 13 4.5l9.5 7V22h-19Z"/><path d="M7.5 22v-7h11v7M7.5 18h11"/></svg>',
}


def tabs(active):
    out = ['<nav class="tabs">']
    for key, name in (("map", "Map"), ("log", "Log"), ("crew", "Crew"), ("garage", "Garage")):
        out.append(f'<a class="tab{" on" if key == active else ""}">{ICONS[key]}<span>{name}</span></a>')
    out.append('</nav><div class="home"></div>')
    return "".join(out)


def topo_map(t, w=390, h=844, route=None, puck=(195, 520), heading=-20, extra="", three_d=False, dim=False):
    """A plausible stretch of the Tellico River valley. Pure SVG, no tiles."""
    contours = []
    for i in range(14):
        y = 120 + i * 48
        d = f"M-20 {y} C 80 {y-30-i*2}, 140 {y+40}, 220 {y+10} S 330 {y-25}, 420 {y+20}"
        contours.append(f'<path d="{d}" fill="none" stroke="{t["map_contour"]}" stroke-width="1"/>')
    for i in range(9):
        y = 560 + i * 34
        d = f"M-20 {y} C 60 {y+20}, 120 {y-30-i*3}, 230 {y-10} S 340 {y+30}, 420 {y-5}"
        contours.append(f'<path d="{d}" fill="none" stroke="{t["map_contour"]}" stroke-width="1"/>')
    river = f'<path d="M-10 265 C 80 290, 170 230, 250 262 S 360 320, 410 300" fill="none" stroke="{t["map_water"]}" stroke-width="14" stroke-linecap="round"/>'
    road_main = "M-10 365 C 90 352, 180 372, 280 356 S 360 350, 410 362"
    road_side = "M186 362 C 190 420, 182 500, 200 560 C 214 610, 196 660, 230 720"
    road_cross = "M70 520 C 130 505, 180 530, 240 515 S 330 490, 410 505"
    road_hill = "M300 120 C 320 180, 260 220, 290 300"
    roads = ""
    for d, wdt in ((road_main, 9), (road_side, 7), (road_cross, 6), (road_hill, 5)):
        roads += f'<path d="{d}" fill="none" stroke="{t["map_road_edge"]}" stroke-width="{wdt+2.5}" stroke-linecap="round"/>'
    for d, wdt in ((road_main, 9), (road_side, 7), (road_cross, 6), (road_hill, 5)):
        roads += f'<path d="{d}" fill="none" stroke="{t["map_road"]}" stroke-width="{wdt}" stroke-linecap="round"/>'
    labels = (
        f'<text x="118" y="258" font-size="11" font-style="italic" fill="{t["map_label"]}" font-family="Georgia, serif" transform="rotate(-8 118 258)">Tellico River</text>'
        f'<text x="316" y="347" font-size="10" fill="{t["map_label"]}" font-family="{SANS}">SR 165</text>'
        f'<text x="40" y="208" font-size="9" fill="{t["map_label"]}" font-family="{SANS}" transform="rotate(-10 40 208)">850 ft</text>'
        f'<text x="300" y="640" font-size="9" fill="{t["map_label"]}" font-family="{SANS}" transform="rotate(12 300 640)">1,000 ft</text>'
        f'<text x="60" y="720" font-size="9" fill="{t["map_label"]}" font-family="{SANS}" transform="rotate(-70 60 720)">1,100 ft</text>'
    )
    route_svg = ""
    if route:
        route_svg = f'<path d="{route}" fill="none" stroke="{t["route"]}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>'
    px, py = puck
    puck_svg = f'''<g transform="translate({px} {py}) rotate({heading})"><circle r="15" fill="{t['paper']}" stroke="{t['ink']}" stroke-width="2.5"/><path d="M0 -9 L7 7 L0 3 L-7 7Z" fill="{t['red']}"/></g>'''
    shade = f'<rect width="{w}" height="{h}" fill="#000" opacity=".45"/>' if dim else ""
    persp = 'style="transform:perspective(900px) rotateX(38deg) scale(1.35);transform-origin:50% 70%"' if three_d else ""
    return f'''<svg {persp} width="{w}" height="{h}" viewBox="0 0 {w} {h}" style="position:absolute;top:0;left:0;background:{t['map_bg']}">{"".join(contours)}{river}{roads}{labels}{route_svg}{extra}{puck_svg}{shade}</svg>'''


def tulip(kind="left4", size=44, ink="#1C1A17", red="#C8102E"):
    """Road-book tulip glyphs: entry dot, road line, exit arrow, red apex dot."""
    s = size
    if kind == "left4":
        return f'<svg width="{s}" height="{s}" viewBox="0 0 44 44"><path d="M22 40 V26 C22 16, 16 12, 8 10" fill="none" stroke="{ink}" stroke-width="3" stroke-linecap="round"/><path d="M14 6 l-7 4 5 6" fill="none" stroke="{ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="22" cy="40" r="3.2" fill="{ink}"/><circle cx="18.5" cy="16" r="2.6" fill="{red}"/></svg>'
    if kind == "right3":
        return f'<svg width="{s}" height="{s}" viewBox="0 0 44 44"><path d="M22 40 V24 C22 14, 28 10, 38 8" fill="none" stroke="{ink}" stroke-width="3" stroke-linecap="round"/><path d="M32 4 l7 4 -5 6" fill="none" stroke="{ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="22" cy="40" r="3.2" fill="{ink}"/><circle cx="26" cy="15" r="2.6" fill="{red}"/></svg>'
    if kind == "crest":
        return f'<svg width="{s}" height="{s}" viewBox="0 0 44 44"><path d="M22 40 V8" fill="none" stroke="{ink}" stroke-width="3" stroke-linecap="round"/><path d="M12 20 l10-10 10 10" fill="none" stroke="{ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="22" cy="40" r="3.2" fill="{ink}"/></svg>'
    if kind == "straight":
        return f'<svg width="{s}" height="{s}" viewBox="0 0 44 44"><path d="M22 40 V10" fill="none" stroke="{ink}" stroke-width="3" stroke-linecap="round"/><path d="M15 15 l7-8 7 8" fill="none" stroke="{ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="22" cy="40" r="3.2" fill="{ink}"/></svg>'
    return ""


def page(title, t, body, extra_css="", dark_status=False, description=""):
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<meta name="description" content="{description}">
<style>{base_css(t, extra_css)}</style></head>
<body><div class="phone">{status_bar(dark_status)}{body}</div></body></html>"""
