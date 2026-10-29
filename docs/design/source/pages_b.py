import math
from common import THEMES, page, topo_map, tulip, SANS, COND, MONO, HAZARD_TRIANGLE

ROUTE = "M186 900 C 150 780, 240 700, 200 620 C 170 560, 230 520, 196 470 C 170 430, 150 400, 186 362 C 220 320, 300 300, 300 120"
HAZ_TOP = 146  # the hazard plate sits here in every theme


def hazard(text, sub):
    return f'<div class="hazard" style="top:{HAZ_TOP}px">{HAZARD_TRIANGLE}<div>{text}<small>{sub}</small></div></div>'


def seven_seg(num_str, color, dim, h=64):
    """Seven-segment digits as SVG. Each digit is 36 wide at h=64."""
    segs = {  # a b c d e f g
        "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg", "-": "g", " ": "",
    }
    shapes = {
        "a": "M6 2 L30 2 L26 7 L10 7Z", "b": "M31 3 L31 30 L27 27 L27 8Z", "c": "M31 34 L31 61 L27 56 L27 37Z",
        "d": "M6 62 L30 62 L26 57 L10 57Z", "e": "M5 34 L5 61 L9 56 L9 37Z", "f": "M5 3 L5 30 L9 27 L9 8Z", "g": "M7 32 L10 29 L26 29 L29 32 L26 35 L10 35Z",
    }
    w = 36 * len(num_str)
    out = [f'<svg viewBox="0 0 {w} 64" width="{w*h/64:.0f}" height="{h}" style="filter:drop-shadow(0 0 6px {color})">']
    for i, ch in enumerate(num_str):
        on = segs.get(ch, "")
        out.append(f'<g transform="translate({i*36} 0) skewX(-4)">')
        for s, d in shapes.items():
            out.append(f'<path d="{d}" fill="{color if s in on else dim}"/>')
        out.append("</g>")
    out.append("</svg>")
    return "".join(out)


FOX = [  # 14 x 12 dot-matrix fox, leaning into a left-hander. 1 = lit, 2 = eye (amber)
    "00100000000100",
    "01110000001110",
    "01111111111110",
    "01112111121110",
    "00111111111100",
    "00011101110000",
    "00001111100000",
    "00000111000000",
    "11100111001110",
    "01111111111100",
    "00111111111000",
    "00011000110000",
]


def fox_matrix(color, amber, dim, cell=6):
    w, h = 14 * cell, 12 * cell
    out = [f'<svg viewBox="0 0 {w} {h}" width="{w}" height="{h}">']
    for y, row in enumerate(FOX):
        for x, c in enumerate(row):
            fill = dim if c == "0" else (amber if c == "2" else color)
            out.append(f'<circle cx="{x*cell+cell/2}" cy="{y*cell+cell/2}" r="{cell*0.36}" fill="{fill}"/>')
    out.append("</svg>")
    return "".join(out)


def bars(values, color, dim, w=120, h=44, n=10):
    out = [f'<svg viewBox="0 0 {w} {h}" width="{w}" height="{h}">']
    bw = w / len(values)
    for i, v in enumerate(values):
        for k in range(n):
            lit = k < v
            y = h - (k + 1) * (h / n)
            out.append(f'<rect x="{i*bw+1.5:.1f}" y="{y+1:.1f}" width="{bw-3:.1f}" height="{h/n-2:.1f}" fill="{color if lit else dim}"/>')
    out.append("</svg>")
    return "".join(out)


# ---------------------------------------------------------------- Roadbook

def drive_roadbook(night=False):
    T = THEMES["roadbook_night" if night else "roadbook"]
    css = f"""
.notes{{position:absolute;top:0;left:0;right:0;height:132px;background:{T['paper']};border-bottom:2px solid {T['rule']};display:flex;align-items:center;padding:44px 12px 0;z-index:10}}
.dist{{width:64px;text-align:center}}
.dist b{{display:block;font-family:{COND};font-size:40px;font-weight:800;line-height:.9}}
.dist span{{font-size:11px;font-weight:600;letter-spacing:.08em;color:{T['pencil']}}}
.call{{flex:1;font-family:{COND};font-size:21px;font-weight:800;letter-spacing:.01em;line-height:1.05;padding-left:8px;text-transform:uppercase}}
.call em{{font-style:normal;color:{T['red']}}}
.call small{{display:block;font-size:15px;letter-spacing:.06em;color:{T['pencil']};margin-top:3px}}
.next{{border-left:1.5px solid {T['ink']};padding-left:8px;display:flex;align-items:center;gap:4px;color:{T['pencil']};font-family:{COND};font-weight:800;font-size:17px;text-transform:uppercase;white-space:nowrap}}
.next b{{display:block;font-size:20px;color:{T['ink']};line-height:1}}
.next small{{font-size:10px;font-family:{SANS};font-weight:600;letter-spacing:.06em}}
.bin{{position:absolute;left:0;right:0;bottom:0;height:290px;background:{T['paper']};border-top:2px solid {T['rule']};z-index:10;padding:10px 14px 0}}
.statusrow{{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:600}}
.statusrow .rec{{display:inline-flex;align-items:center;gap:6px;color:{T['red']}}}
.statusrow .rec i{{width:10px;height:10px;border-radius:50%;background:{T['red']}}}
.statusrow .sp{{flex:1;color:{T['pencil']};font-weight:500}}
.statusrow .btn{{height:40px;padding:0 14px;font-size:14px}}
.cluster{{display:grid;grid-template-columns:150px 1fr 100px;gap:8px;margin-top:10px;align-items:center}}
.speed{{position:relative;height:150px}}
.speed svg{{width:150px;height:150px;display:block}}
.speed .num{{position:absolute;left:0;right:0;bottom:22px;text-align:center;font-family:{COND};font-size:40px;font-weight:800;line-height:1}}
.speed .unit{{position:absolute;left:0;right:0;bottom:10px;text-align:center;font-size:10px;font-weight:600;letter-spacing:.1em;color:{T['pencil']}}}
.mid{{display:flex;flex-direction:column;align-items:center;gap:8px}}
.limit{{width:56px;height:68px;border:2.5px solid {T['ink']};background:#FFFFFF;color:#111;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:{SANS};font-weight:700;line-height:1;border-radius:4px}}
.limit small{{font-size:9px;letter-spacing:.04em}}
.limit b{{font-size:26px;margin-top:2px}}
.drum{{display:flex;gap:2px;align-items:center}}
.drum span{{width:20px;height:28px;background:#FFFFFF;border:1.5px solid {T['ink']};color:#111;display:flex;align-items:center;justify-content:center;font-family:{COND};font-weight:800;font-size:20px;box-shadow:inset 0 6px 6px -6px rgba(0,0,0,.6), inset 0 -6px 6px -6px rgba(0,0,0,.6)}}
.drum span.tenth{{background:{T['ink']};color:{T['paper']}}}
.drum i{{font-style:normal;font-weight:800;margin:0 1px}}
.mid .lbl{{font-size:11px;color:{T['pencil']};font-weight:600}}
.smooth{{text-align:center}}
.smooth svg{{width:96px;height:96px;display:block;margin:0 auto}}
.smooth b{{display:block;font-family:{COND};font-size:22px;font-weight:800;line-height:1}}
.smooth span{{font-size:10px;font-weight:600;letter-spacing:.08em;color:{T['pencil']}}}
"""
    def dial():
        ink, red = T["ink"], T["red"]
        ticks = []
        for i in range(0, 15):
            a = math.radians(-210 + i * 240 / 14)
            r1, r2 = (60, 50) if i % 2 == 0 else (60, 55)
            ticks.append(f'<line x1="{75+r1*math.cos(a):.1f}" y1="{75+r1*math.sin(a):.1f}" x2="{75+r2*math.cos(a):.1f}" y2="{75+r2*math.sin(a):.1f}" stroke="{ink}" stroke-width="2"/>')
            if i % 2 == 0:
                ticks.append(f'<text x="{75+40*math.cos(a):.1f}" y="{75+40*math.sin(a)+4:.1f}" font-size="10" font-weight="700" text-anchor="middle" fill="{ink}" font-family="{COND}">{i*10}</text>')
        a = math.radians(-210 + 4.2 * 240 / 14)
        return f'''<svg viewBox="0 0 150 150"><circle cx="75" cy="75" r="68" fill="{T['paper2']}" stroke="{ink}" stroke-width="2.5"/>{"".join(ticks)}
        <path d="M{75+62*math.cos(math.radians(-210+2.7*240/14)):.1f} {75+62*math.sin(math.radians(-210+2.7*240/14)):.1f} A62 62 0 0 1 {75+62*math.cos(math.radians(-210+5.1*240/14)):.1f} {75+62*math.sin(math.radians(-210+5.1*240/14)):.1f}" fill="none" stroke="{T['amber']}" stroke-width="4"/>
        <line x1="75" y1="75" x2="{75+58*math.cos(a):.1f}" y2="{75+58*math.sin(a):.1f}" stroke="{red}" stroke-width="3" stroke-linecap="round"/><circle cx="75" cy="75" r="5" fill="{ink}"/></svg>'''

    def gball():
        ink, red, hair = T["ink"], T["red"], T["hair"]
        return f'''<svg viewBox="0 0 96 96"><circle cx="48" cy="48" r="44" fill="{T['paper2']}" stroke="{ink}" stroke-width="2"/><circle cx="48" cy="48" r="29" fill="none" stroke="{hair}" stroke-width="1"/><circle cx="48" cy="48" r="14" fill="none" stroke="{hair}" stroke-width="1"/><path d="M48 6v84M6 48h84" stroke="{hair}" stroke-width="1"/>
        <path d="M48 48 Q 40 44 36 40 T 30 36" fill="none" stroke="{red}" stroke-width="2" opacity=".5"/><circle cx="30" cy="36" r="5" fill="{red}"/>
        <text x="48" y="22" font-size="8" text-anchor="middle" fill="{T['pencil']}" font-family="{SANS}" font-weight="600" letter-spacing="1">BRAKE</text></svg>'''

    body = topo_map(T, route=ROUTE, puck=(196, 470), heading=-12) + f"""
<div class="notes">
  <div class="dist"><b>300</b><span>FT</span></div>
  {tulip('left4', 46, T['ink'], T['red'])}
  <div class="call">Left 4 <em>tightens</em><small>long · care</small></div>
  <div class="next">{tulip('right3', 34, T['pencil'], T['red'])}<div><small>900 FT</small><b>Right 3</b></div></div>
</div>
{hazard('Gravel', 'in 0.4 mi · reported by @sam, 2 h ago')}
<div class="bin">
  <div class="statusrow"><span class="rec"><i></i>Rec</span><span class="sp">12.4 of 70.1 mi · 2:21 left · arrive 5:14</span><button class="btn">Report</button><button class="btn primary">End</button></div>
  <div class="cluster">
    <div class="speed">{dial()}<div class="num">42</div><div class="unit">MPH</div></div>
    <div class="mid">
      <div class="limit"><small>SPEED<br>LIMIT</small><b>--</b></div>
      <div class="drum"><span>0</span><span>1</span><span>2</span><i>.</i><span class="tenth">4</span></div>
      <span class="lbl">Trip mi</span>
    </div>
    <div class="smooth">{gball()}<b>82</b><span>SCORE</span></div>
  </div>
</div>"""
    return page("Driving, Roadbook" + (" night" if night else ""), T, body, css, dark_status=night, description="Driving in the Roadbook theme")


# ---------------------------------------------------------------- Tapedeck

def drive_tapedeck():
    T = THEMES["tapedeck"]
    vfd, amber, dim = T["ink"], T["amber"], "#123033"
    css = f"""
.notes{{position:absolute;top:0;left:0;right:0;height:132px;background:linear-gradient(#0E1418,#080C0F);border-bottom:2px solid #1E3A40;display:flex;align-items:center;padding:44px 12px 0;z-index:10;box-shadow:inset 0 -1px 0 rgba(125,245,222,.25)}}
.glow{{color:{vfd};text-shadow:0 0 8px rgba(125,245,222,.75),0 0 2px rgba(125,245,222,.9)}}
.amberglow{{color:{amber};text-shadow:0 0 8px rgba(255,179,71,.7)}}
.dist{{width:112px;display:flex;flex-direction:column;align-items:center}}
.dist span{{font-family:{MONO};font-size:10px;letter-spacing:.2em;color:{T['pencil']};margin-top:2px}}
.call{{flex:1;font-family:{MONO};font-size:19px;font-weight:700;letter-spacing:.08em;line-height:1.25;padding-left:10px;text-transform:uppercase}}
.call em{{font-style:normal}}
.next{{border-left:1px solid #1E3A40;padding-left:10px;font-family:{MONO};font-size:12px;letter-spacing:.1em;color:{T['pencil']};text-transform:uppercase;line-height:1.5}}
.next b{{display:block;font-size:14px;color:{vfd}}}
.bin{{position:absolute;left:0;right:0;bottom:0;height:300px;background:linear-gradient(#0D1316,#070A0C 60%,#0B1013);border-top:2px solid #1E3A40;z-index:10;padding:10px 14px 0}}
.bin::before{{content:"";position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(255,255,255,.025) 0 1px,transparent 1px 3px);pointer-events:none}}
.statusrow{{display:flex;align-items:center;gap:10px;font-family:{MONO};font-size:11px;letter-spacing:.06em;text-transform:uppercase}}
.statusrow .rec{{display:inline-flex;align-items:center;gap:6px;color:{T['red']};text-shadow:0 0 6px rgba(255,138,61,.7)}}
.statusrow .rec i{{width:8px;height:8px;border-radius:50%;background:{T['red']};box-shadow:0 0 6px {T['red']}}}
.statusrow .sp{{flex:1;color:{T['pencil']};white-space:nowrap;overflow:hidden}}
.key{{height:36px;padding:0 12px;border:1px solid #2A4A50;border-bottom-width:3px;background:linear-gradient(#1A2428,#0D1417);color:{vfd};font-family:{MONO};font-size:12px;letter-spacing:.1em;text-transform:uppercase;display:inline-flex;align-items:center}}
.key.end{{color:{amber};border-color:#4A3A1A}}
.cluster{{display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;margin-top:10px;align-items:start}}
.speedbox{{display:flex;flex-direction:column;align-items:flex-start}}
.speedbox .u{{font-family:{MONO};font-size:10px;letter-spacing:.2em;color:{T['pencil']};margin-top:2px}}
.panel{{display:flex;align-items:flex-end;gap:12px}}
.panel .lbl{{font-family:{MONO};font-size:9px;letter-spacing:.2em;color:{T['pencil']};display:block;margin-bottom:3px}}
.limit{{display:inline-flex;flex-direction:column;align-items:center;font-family:{MONO};color:{vfd};border:1px solid #2A4A50;padding:4px 8px}}
.limit small{{font-size:8px;letter-spacing:.15em;color:{T['pencil']}}}
.limit b{{font-size:20px;font-weight:700}}
.trip{{font-family:{MONO};font-size:22px;letter-spacing:.06em}}
.matrixrow{{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;border-top:1px solid #15282C;padding-top:8px;margin-top:2px}}
.mascot{{display:flex;align-items:center;gap:10px}}
.mascot .say{{font-family:{MONO};font-size:11px;letter-spacing:.1em;color:{T['pencil']};text-transform:uppercase;line-height:1.5;white-space:nowrap}}
.mascot .say b{{color:{vfd};display:block}}
.tape{{position:absolute;right:14px;top:8px;width:7px;height:7px;border-radius:50%;background:{amber};box-shadow:0 0 6px {amber}}}
"""
    body = topo_map(T, route=ROUTE, puck=(196, 470), heading=-12) + f"""
<div class="notes">
  <div class="dist">{seven_seg('300', vfd, dim, h=50)}<span>FEET</span></div>
  <div class="call glow">LEFT 4 <em class="amberglow">TIGHTENS</em><br>LONG · CARE</div>
  <div class="next">900 FT<b>RIGHT 3</b></div>
</div>
{hazard('Gravel', 'in 0.4 mi · reported by @sam, 2 h ago')}
<div class="bin">
  <span class="tape"></span>
  <div class="statusrow"><span class="rec"><i></i>Rec</span><span class="sp">12.4/70.1 MI · 2:21 LEFT</span><span class="key">Report</span><span class="key end">End</span></div>
  <div class="cluster">
    <div class="speedbox">{seven_seg(' 42', vfd, dim, h=72)}<span class="u">MPH</span></div>
    <div class="panel">
      <div><span class="lbl">LIMIT</span><div class="limit"><small>MAX</small><b>--</b></div></div>
      <div><span class="lbl">SURFACE · LIVE</span>{bars([3,4,3,5,6,4,3,2,3,4], vfd, dim, w=110, h=40)}</div>
    </div>
    <div class="panel"><div><span class="lbl">TRIP MI</span><div class="trip glow">012.4</div></div><div><span class="lbl">SCORE</span><div class="trip glow">82</div></div></div>
    <div class="panel" style="justify-content:flex-end;align-self:end"><div><span class="lbl">BRAKE / TURN</span>{bars([0,0,2,5,8,6,2,0,0,0], amber, dim, w=110, h=40)}</div></div>
    <div class="matrixrow">
      <div class="mascot">{fox_matrix(vfd, amber, dim)}<div class="say">KIT SAYS<b>EASY IN, LATE OUT</b></div></div>
      <div style="font-family:{MONO};font-size:10px;letter-spacing:.15em;color:{T['pencil']}">TRK 03 · SKYWAY</div>
    </div>
  </div>
</div>"""
    return page("Driving, Tapedeck", T, body, css, dark_status=True, description="Driving in the Tapedeck theme, a late-90s head unit")


# ---------------------------------------------------------------- Billet

def drive_billet():
    T = THEMES["billet"]
    red = T["red"]
    css = f"""
.metal{{background:
  repeating-linear-gradient(90deg,rgba(255,255,255,.035) 0 1px,transparent 1px 3px),
  linear-gradient(180deg,#3A3C40 0%,#2A2C30 35%,#1F2124 60%,#2B2D31 100%)}}
.notes{{position:absolute;top:0;left:0;right:0;height:132px;border-bottom:3px solid #0A0A0B;display:flex;align-items:center;padding:44px 12px 0;z-index:10;box-shadow:inset 0 -1px 0 rgba(255,255,255,.12)}}
.led{{color:{red};text-shadow:0 0 10px rgba(255,42,42,.8),0 0 2px rgba(255,120,120,.9)}}
.dist{{width:72px;text-align:center}}
.dist b{{display:block;font-family:{COND};font-size:40px;font-weight:800;line-height:.9}}
.dist span{{font-size:10px;font-weight:700;letter-spacing:.14em;color:{T['pencil']}}}
.call{{flex:1;font-family:{COND};font-size:21px;font-weight:800;letter-spacing:.01em;line-height:1.05;padding-left:8px;text-transform:uppercase;color:#F2F0EA}}
.call small{{display:block;font-size:15px;letter-spacing:.06em;color:{T['pencil']};margin-top:3px}}
.next{{border-left:1px solid #4A4D52;padding-left:8px;font-family:{COND};font-weight:800;font-size:17px;text-transform:uppercase;color:{T['pencil']};line-height:1.1;white-space:nowrap}}
.next small{{display:block;font-family:{SANS};font-size:10px;font-weight:700;letter-spacing:.1em}}
.next b{{color:#F2F0EA}}
.bin{{position:absolute;left:0;right:0;bottom:0;height:290px;border-top:3px solid #0A0A0B;z-index:10;padding:10px 14px 0;box-shadow:inset 0 1px 0 rgba(255,255,255,.14)}}
.screws{{position:absolute;width:10px;height:10px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#8A8D93,#2A2C30 70%);box-shadow:0 1px 0 rgba(255,255,255,.15)}}
.screws::after{{content:"";position:absolute;left:1.5px;right:1.5px;top:4px;height:2px;background:#101113;transform:rotate(30deg)}}
.statusrow{{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:600;color:#D8D6D0}}
.statusrow .rec{{display:inline-flex;align-items:center;gap:6px}}
.statusrow .rec i{{width:10px;height:10px;border-radius:50%;background:{red};box-shadow:0 0 8px {red}}}
.statusrow .sp{{flex:1;color:{T['pencil']}}}
.key{{height:38px;padding:0 14px;border-radius:3px;background:linear-gradient(#4A4D52,#2A2C30);border:1px solid #0E0F10;box-shadow:inset 0 1px 0 rgba(255,255,255,.25),0 2px 0 #0A0A0B;color:#ECEAE4;font-size:13px;font-weight:700;display:inline-flex;align-items:center;letter-spacing:.02em}}
.key.end{{color:{red};text-shadow:0 0 6px rgba(255,42,42,.6)}}
.cluster{{display:grid;grid-template-columns:160px 1fr 96px;gap:8px;margin-top:10px;align-items:center}}
.gauge{{position:relative}}
.gauge svg{{display:block}}
.gauge .num{{position:absolute;left:0;right:0;text-align:center;font-family:{COND};font-weight:800;line-height:1}}
.mid{{display:flex;flex-direction:column;align-items:center;gap:8px}}
.limit{{width:56px;height:68px;border:2.5px solid #F2F0EA;background:#FFFFFF;color:#111;display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:700;line-height:1;border-radius:4px}}
.limit small{{font-size:9px}}
.limit b{{font-size:26px;margin-top:2px}}
.readout{{background:#0A0B0C;border:1px solid #0A0A0B;box-shadow:inset 0 2px 6px rgba(0,0,0,.9),0 1px 0 rgba(255,255,255,.12);padding:4px 10px;font-family:{COND};font-size:24px;font-weight:800;letter-spacing:.06em;min-width:96px;text-align:center}}
.lbl{{font-size:10px;font-weight:700;letter-spacing:.14em;color:{T['pencil']}}}
"""
    def bezel(r, cx, cy):
        return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="url(#knurl)" stroke-width="9"/><circle cx="{cx}" cy="{cy}" r="{r-5}" fill="#0B0C0D" stroke="#0A0A0B" stroke-width="1"/>'
    defs = '''<defs><pattern id="knurl" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="#5A5D63"/><rect width="2" height="4" fill="#8A8D93"/></pattern></defs>'''
    def speed_gauge():
        ticks = []
        for i in range(0, 15):
            a = math.radians(-210 + i * 240 / 14)
            r1, r2 = (64, 54) if i % 2 == 0 else (64, 59)
            ticks.append(f'<line x1="{80+r1*math.cos(a):.1f}" y1="{80+r1*math.sin(a):.1f}" x2="{80+r2*math.cos(a):.1f}" y2="{80+r2*math.sin(a):.1f}" stroke="#E6E3DC" stroke-width="2"/>')
            if i % 2 == 0:
                ticks.append(f'<text x="{80+44*math.cos(a):.1f}" y="{80+44*math.sin(a)+4:.1f}" font-size="11" font-weight="700" text-anchor="middle" fill="#E6E3DC" font-family="{COND}">{i*10}</text>')
        a = math.radians(-210 + 4.2 * 240 / 14)
        return f'''<svg viewBox="0 0 160 160" width="160" height="160">{defs}{bezel(74, 80, 80)}{"".join(ticks)}
        <path d="M{80+66*math.cos(math.radians(-210+2.7*240/14)):.1f} {80+66*math.sin(math.radians(-210+2.7*240/14)):.1f} A66 66 0 0 1 {80+66*math.cos(math.radians(-210+5.1*240/14)):.1f} {80+66*math.sin(math.radians(-210+5.1*240/14)):.1f}" fill="none" stroke="{T['amber']}" stroke-width="3" opacity=".9"/>
        <line x1="80" y1="80" x2="{80+62*math.cos(a):.1f}" y2="{80+62*math.sin(a):.1f}" stroke="{red}" stroke-width="3.5" stroke-linecap="round" style="filter:drop-shadow(0 0 5px {red})"/><circle cx="80" cy="80" r="7" fill="#2A2C30" stroke="#8A8D93"/></svg>'''
    def gball():
        return f'''<svg viewBox="0 0 96 96" width="96" height="96">{defs}{bezel(44, 48, 48)}<circle cx="48" cy="48" r="26" fill="none" stroke="#34373B"/><circle cx="48" cy="48" r="13" fill="none" stroke="#34373B"/><path d="M48 10v76M10 48h76" stroke="#34373B"/>
        <circle cx="31" cy="37" r="5" fill="{red}" style="filter:drop-shadow(0 0 6px {red})"/></svg>'''
    body = topo_map(T, route=ROUTE, puck=(196, 470), heading=-12) + f"""
<div class="notes metal">
  <div class="dist"><b class="led">300</b><span>FT</span></div>
  {tulip('left4', 46, '#F2F0EA', red)}
  <div class="call">Left 4 <span class="led">tightens</span><small>long · care</small></div>
  <div class="next"><small>900 FT</small><b>Right 3</b></div>
</div>
{hazard('Gravel', 'in 0.4 mi · reported by @sam, 2 h ago')}
<div class="bin metal">
  <span class="screws" style="left:8px;top:8px"></span><span class="screws" style="right:8px;top:8px"></span>
  <div class="statusrow" style="padding:0 14px"><span class="rec"><i></i>Rec</span><span class="sp">12.4 of 70.1 mi · 2:21 left · 5:14</span><span class="key">Report</span><span class="key end">End</span></div>
  <div class="cluster">
    <div class="gauge">{speed_gauge()}<div class="num led" style="bottom:30px;font-size:36px">42</div><div class="lbl" style="position:absolute;left:0;right:0;bottom:18px;text-align:center">MPH</div></div>
    <div class="mid">
      <div class="limit"><small>SPEED<br>LIMIT</small><b>--</b></div>
      <div class="readout led">012.4</div><span class="lbl">TRIP MI</span>
    </div>
    <div style="text-align:center">{gball()}<div class="led" style="font-family:{COND};font-size:24px;font-weight:800;line-height:1;margin-top:4px">82</div><span class="lbl">SCORE</span></div>
  </div>
</div>"""
    return page("Driving, Billet", T, body, css, dark_status=True, description="Driving in the Billet theme, machined metal and red glow")
