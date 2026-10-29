from common import THEMES, page, tabs, topo_map, tulip, SANS, COND, MONO
from pages_b import fox_matrix, seven_seg

T = THEMES["roadbook"]

PAGE_CSS = f"""
.scroll{{position:absolute;top:0;left:0;right:0;bottom:82px;overflow:hidden}}
.bar{{height:92px;display:flex;align-items:flex-end;justify-content:space-between;padding:0 16px 10px;border-bottom:2px solid {T['rule']}}}
.bar h1{{font-family:{COND};font-weight:800;font-size:26px;line-height:1}}
.bar .back{{font-size:15px;font-weight:600}}
.bar .act{{font-size:14px;font-weight:600;text-decoration:underline;text-underline-offset:3px}}
section{{padding:14px 16px 0}}
h2{{font-family:{COND};font-weight:800;font-size:20px;display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px}}
h2 a{{font-family:{SANS};font-size:13px;font-weight:600;text-decoration:underline;text-underline-offset:3px;color:{T['ink']}}}
.hr{{border-top:1px solid {T['hair']};margin-top:14px}}
.photo{{background:{T['hair']};position:relative;overflow:hidden}}
.photo svg{{display:block;width:100%;height:100%}}
.cap{{position:absolute;right:8px;bottom:16px;font-size:10px;font-weight:600;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.6)}}
.avatar{{width:40px;height:40px;border-radius:50%;background:{T['hair']};border:1.5px solid {T['ink']};flex:none;display:flex;align-items:center;justify-content:center;font-family:{COND};font-weight:800;font-size:16px}}
.small{{font-size:13px;color:{T['pencil']}}}
"""


def scene(w, h, sky="#D8CDB4", hill="#8A8373", road=T["paper"], seed=0):
    """A placeholder photograph: a mountain road, drawn, labelled as a photo slot."""
    return f'''<svg viewBox="0 0 {w} {h}" preserveAspectRatio="xMidYMid slice"><rect width="{w}" height="{h}" fill="{sky}"/>
<path d="M0 {h*0.55} C {w*0.2} {h*0.35}, {w*0.35} {h*0.6}, {w*0.55} {h*0.4} S {w*0.85} {h*0.3}, {w} {h*0.5} V{h} H0Z" fill="{hill}"/>
<path d="M0 {h*0.7} C {w*0.25} {h*0.6}, {w*0.4} {h*0.8}, {w*0.65} {h*0.62} S {w*0.9} {h*0.6}, {w} {h*0.72} V{h} H0Z" fill="#5E584C"/>
<path d="M{w*0.1+seed} {h} C {w*0.3} {h*0.85}, {w*0.5} {h*0.95}, {w*0.6} {h*0.78} S {w*0.8} {h*0.7}, {w*0.95} {h*0.66}" fill="none" stroke="{road}" stroke-width="{h*0.07}" stroke-linecap="round"/>
<path d="M{w*0.1+seed} {h} C {w*0.3} {h*0.85}, {w*0.5} {h*0.95}, {w*0.6} {h*0.78} S {w*0.8} {h*0.7}, {w*0.95} {h*0.66}" fill="none" stroke="#C9A24A" stroke-width="1" stroke-dasharray="6 6"/></svg>'''


def car_svg(w=120, h=52, body="#C8102E"):
    return f'''<svg viewBox="0 0 120 52" width="{w}" height="{h}"><path d="M8 38 L14 24 C 24 12, 44 8, 62 10 L 84 14 C 96 16, 104 24, 110 32 L 112 38 Z" fill="{body}"/><path d="M30 24 C 38 16, 52 14, 64 15 L 78 18 L 82 24 Z" fill="#1C1A17" opacity=".75"/><circle cx="30" cy="40" r="9" fill="#1C1A17"/><circle cx="30" cy="40" r="4" fill="#8A8373"/><circle cx="92" cy="40" r="9" fill="#1C1A17"/><circle cx="92" cy="40" r="4" fill="#8A8373"/><rect x="6" y="36" width="108" height="3" fill="#1C1A17" opacity=".3"/></svg>'''


# ---------------------------------------------------------------- Crew page

def crew_page():
    css = PAGE_CSS + f"""
.hero{{height:150px;position:relative}}
.hero .photo{{position:absolute;inset:0}}
.hero .stripe{{position:absolute;left:0;right:0;bottom:0;height:10px;background:repeating-linear-gradient(90deg,#1C1A17 0 60px,#C8102E 60px 80px,#EDE4D3 80px 92px)}}
.crest{{position:absolute;left:16px;bottom:-26px;width:72px;height:72px;background:{T['paper']};border:2px solid {T['ink']};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 0 rgba(0,0,0,.2)}}
.ident{{padding:34px 16px 0;display:flex;align-items:flex-start;justify-content:space-between}}
.ident h1{{font-family:{COND};font-weight:800;font-size:28px;line-height:1}}
.ident .motto{{font-size:13px;color:{T['pencil']};margin-top:4px;font-style:italic}}
.ident .meta{{font-size:13px;margin-top:6px;font-weight:600}}
.livery{{margin:12px 16px 0;border:1.5px solid {T['ink']};padding:10px 12px;display:grid;grid-template-columns:1fr auto;gap:8px 12px;align-items:center;background:{T['paper2']}}}
.livery .track{{grid-column:1/-1}}
.livery .tier{{font-family:{COND};font-weight:800;font-size:20px;line-height:1}}
.livery .tier small{{display:block;font-family:{SANS};font-size:12px;font-weight:500;color:{T['pencil']};margin-top:3px}}
.livery .track{{flex:1;height:8px;border:1.5px solid {T['ink']};position:relative;background:{T['paper']}}}
.livery .track i{{position:absolute;left:0;top:0;bottom:0;width:70%;background:{T['ink']}}}
.livery .track em{{position:absolute;top:-4px;width:1.5px;height:14px;background:{T['ink']}}}
.decals{{display:flex;gap:4px}}
.decal{{width:22px;height:22px;border:1.5px solid {T['ink']};transform:rotate(-6deg);background:{T['paper']};display:flex;align-items:center;justify-content:center}}
.decal.red{{background:{T['red']};border-color:{T['red']}}}
.event{{border:1.5px solid {T['ink']};display:flex}}
.event .date{{width:64px;border-right:1.5px solid {T['ink']};display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px 0;background:{T['ink']};color:{T['paper']}}}
.event .date b{{font-family:{COND};font-size:28px;font-weight:800;line-height:1}}
.event .date span{{font-size:11px;font-weight:600;letter-spacing:.08em}}
.event .body{{flex:1;padding:8px 12px}}
.event .body b{{display:block;font-size:16px}}
.event .body div{{font-size:13px;color:{T['pencil']};margin-top:2px}}
.event .going{{display:flex;align-items:center;gap:8px;margin-top:8px}}
.event .going .avatar{{width:26px;height:26px;font-size:11px;margin-right:-12px}}
.event .going .btn{{margin-left:auto;height:34px;padding:0 12px;font-size:13px}}
.board{{width:100%;border-collapse:collapse;font-size:14px}}
.board td{{padding:6px 0;border-top:1px solid {T['hair']}}}
.board td:first-child{{width:26px;font-family:{COND};font-weight:800;font-size:16px;color:{T['pencil']}}}
.board td:last-child{{text-align:right;font-family:{COND};font-weight:800;font-size:20px}}
.board .car{{font-size:12px;color:{T['pencil']}}}
.builds{{display:flex;gap:10px;overflow:hidden}}
.build{{width:150px;flex:none;border:1.5px solid {T['ink']}}}
.build .photo{{height:84px}}
.build .t{{padding:6px 8px 8px}}
.build b{{display:block;font-size:13px}}
.build span{{font-size:11px;color:{T['pencil']}}}
.chatline{{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid {T['hair']};font-size:14px}}
.chatline .avatar{{width:28px;height:28px;font-size:11px}}
.chatline b{{font-weight:700}}
.chatline span{{color:{T['pencil']};font-size:12px;margin-left:6px}}
"""
    body = f"""
<div class="scroll">
  <div class="hero"><div class="photo">{scene(390,150,'#B9AE95','#6E6757',seed=20)}<span class="cap">Cherohala Skyway, Oct 12 · by @sam</span></div><div class="stripe"></div>
    <div class="crest"><svg width="48" height="48" viewBox="0 0 48 48"><path d="M24 4 42 12v12c0 10-8 17-18 20C14 41 6 34 6 24V12Z" fill="none" stroke="{T['ink']}" stroke-width="2.5"/><path d="M14 30 C 18 20, 26 26, 34 16" fill="none" stroke="{T['ink']}" stroke-width="2.5" stroke-linecap="round"/><circle cx="26" cy="23" r="2.6" fill="{T['red']}"/></svg></div>
    <span style="position:absolute;right:16px;top:54px;background:{T['paper']};padding:4px 8px;font-size:13px;font-weight:600;border:1.5px solid {T['ink']}">Edit livery</span>
  </div>
  <div class="ident"><div><h1>Ridge Runners</h1><div class="motto">Slow in, smooth out. Dawn runs, no heroes.</div><div class="meta">6 members · Public · Tellico Plains, TN</div></div><button class="btn" style="height:38px;padding:0 12px;font-size:13px">Invite</button></div>
  <div class="livery">
    <div class="tier">Works livery<small>14 Decals from 5 supporters · Factory at 20</small></div>
    <div class="track"><i></i><em style="left:25%"></em><em style="left:50%"></em><em style="left:75%"></em></div>
    <div class="decals"><span class="decal red"></span><span class="decal"></span><span class="decal red"></span></div>
  </div>

  <section>
    <h2>Next drive <a>All drives</a></h2>
    <div class="event"><div class="date"><b>2</b><span>NOV</span></div><div class="body"><b>Dawn run: Skyway and back</b><div>6:30 AM · Meet at Tellico Plains Hardee's · 84 mi · Fun</div>
      <div class="going"><span class="avatar">S</span><span class="avatar">J</span><span class="avatar">N</span><span class="avatar" style="font-size:10px">+1</span><span class="small" style="margin-left:18px">4 going</span><button class="btn primary">Going</button></div></div></div>
  </section>

  <section>
    <h2>Vetta Score board <a>This month</a></h2>
    <table class="board">
      <tr><td>1</td><td>@sam <span class="car">NB Miata</span></td><td>811</td></tr>
      <tr><td>2</td><td>@jules <span class="car">GR86</span></td><td>764</td></tr>
      <tr><td>3</td><td>@nate <span class="car">NB Miata</span></td><td>702</td></tr>
      <tr><td>4</td><td>@dee <span class="car">E46 330i</span></td><td>--</td></tr>
    </table>
    <div class="small" style="margin-top:4px">Best Score this month, only from people who share Scores with the crew.</div>
  </section>

  <section>
    <h2>Builds <a>All 4</a></h2>
    <div class="builds">
      <div class="build"><div class="photo">{scene(150,84,'#C9C0A8','#7A6F5C',seed=5)}</div><div class="t"><b>Nate's NB: coilovers in</b><span>Stage 4 · 2 d ago · 6 replies</span></div></div>
      <div class="build"><div class="photo">{scene(150,84,'#CFC6AE','#6E6757',seed=30)}</div><div class="t"><b>Jules' GR86: brake ducts</b><span>Stage 2 · 1 w ago · 11 replies</span></div></div>
      <div class="build"><div class="photo">{scene(150,84,'#D8CDB4','#8A8373',seed=12)}</div><div class="t"><b>Dee's 330i: the start</b><span>Stage 1 · 3 w ago</span></div></div>
    </div>
  </section>

  <section>
    <h2>Chat <a>Open</a></h2>
    <div class="chatline"><span class="avatar">S</span><div><b>@sam</b><span>8:12 PM</span><div>Skyway was clean all the way up today. One gravel patch past the overlook, reported it.</div></div></div>
    <div class="chatline"><span class="avatar">J</span><div><b>@jules</b><span>8:40 PM</span><div>Bringing the thermos Sunday. Who has the regroup point?</div></div></div>
  </section>
</div>
{tabs('crew')}"""
    return page("Crew page", T, body, css, description="A crew page with livery customisation")


# ---------------------------------------------------------------- Build thread

def build_thread():
    css = PAGE_CSS + f"""
.carhead{{padding:12px 16px 0;display:flex;gap:12px;align-items:center}}
.carhead h1{{font-family:{COND};font-weight:800;font-size:24px;line-height:1}}
.carhead .spec{{font-size:12px;color:{T['pencil']};margin-top:4px}}
.carhead .own{{font-size:13px;font-weight:600;margin-top:4px}}
.cover{{height:150px;margin-top:10px}}
.stages{{display:flex;gap:6px;padding:12px 16px 0;align-items:center}}
.stages .st{{flex:1;height:6px;background:{T['ink']}}}
.stages .st.todo{{background:{T['hair']}}}
.stages span{{font-size:11px;font-weight:600;color:{T['pencil']};margin-left:6px;white-space:nowrap}}
.post{{padding:14px 16px 0;position:relative}}
.post::before{{content:"";position:absolute;left:31px;top:46px;bottom:-14px;width:1.5px;background:{T['hair']}}}
.post .ph{{display:flex;gap:10px;align-items:center}}
.post .ph .dot{{width:32px;height:32px;border-radius:50%;border:2px solid {T['ink']};background:{T['paper']};display:flex;align-items:center;justify-content:center;font-family:{COND};font-weight:800;font-size:14px;z-index:1}}
.post .ph b{{display:block;font-size:16px}}
.post .ph span{{font-size:12px;color:{T['pencil']}}}
.post .txt{{margin:8px 0 0 42px;font-size:14px;line-height:1.4}}
.post .pics{{margin:8px 0 0 42px;display:grid;grid-template-columns:1fr 1fr;gap:6px}}
.post .pics .photo{{height:90px}}
.post .parts{{margin:8px 0 0 42px;font-size:12px;color:{T['pencil']};display:flex;flex-wrap:wrap;gap:6px}}
.post .parts span{{border:1px solid {T['hair']};padding:2px 6px}}
.react{{margin:10px 0 0 42px;display:flex;gap:16px;font-size:13px;font-weight:600}}
.react span{{display:inline-flex;align-items:center;gap:6px}}
.react svg{{width:16px;height:16px;stroke:{T['ink']};fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}}
.sugg{{margin:10px 0 0 42px;border-left:3px solid {T['red']};padding:8px 10px;background:{T['paper2']};font-size:13px}}
.sugg b{{font-weight:700}}
.sugg .tag{{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:{T['red']};margin-right:6px}}
.compose{{position:absolute;left:0;right:0;bottom:82px;border-top:2px solid {T['rule']};background:{T['paper']};padding:10px 16px;display:flex;gap:8px;align-items:center}}
.compose .in{{flex:1;height:44px;border:1.5px solid {T['ink']};display:flex;align-items:center;padding:0 12px;color:{T['pencil']};font-size:14px;background:{T['paper2']}}}
.compose .btn{{height:44px;padding:0 12px;font-size:13px}}
"""
    body = f"""
<div class="scroll">
  <div class="bar" style="height:84px"><span class="back">‹ Garage</span><span class="act">Follow</span></div>
  <div class="carhead">{car_svg(110, 48, T['red'])}<div><h1>Nate's NB Miata</h1><div class="spec">2004 · Mazdaspeed · 1.8 turbo · 178 hp on the stock dyno sheet</div><div class="own">@nate · Ridge Runners · 23 followers</div></div></div>
  <div class="photo cover">{scene(390,150,'#C4B899','#6E6757',seed=8)}<span class="cap">After the alignment, Oct 27</span></div>
  <div class="stages"><i class="st"></i><i class="st"></i><i class="st"></i><i class="st"></i><i class="st todo"></i><i class="st todo"></i><span>Stage 4 of 6 · Suspension</span></div>

  <div class="post">
    <div class="ph"><span class="dot">4</span><div><b>Coilovers in, and a first alignment</b><span>Oct 27 · 2 days ago</span></div></div>
    <div class="txt">Finally. Ohlins Road and Track, 7k/5k. Set it at -2.2 front, -1.8 rear, a little toe out up front. First run up the Skyway felt planted but the rear is busier than I want over the crests near the top. My Score went from the 640s to 702 on the same road, so something is working.</div>
    <div class="pics"><div class="photo">{scene(170,90,'#9A927E','#55503F',seed=3)}<span class="cap">Front, ride height</span></div><div class="photo">{scene(170,90,'#8E8674','#4E4A3C',seed=40)}<span class="cap">Alignment sheet</span></div></div>
    <div class="parts"><span>Ohlins DFV R&T</span><span>7k / 5k springs</span><span>-2.2 / -1.8 camber</span></div>
    <div class="react"><span><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M20 4v5h-5"/></svg>6 replies</span><span><svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/></svg>14</span><span><svg viewBox="0 0 24 24"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2Z"/></svg>2 suggestions</span></div>
    <div class="sugg"><span class="tag">Suggestion</span><b>@jules</b> Rear busy over crests at 5k usually means rebound is a click or two too soft for that spring. Try +2 rear, drive the same stretch, compare the Smooth trace.</div>
    <div class="sugg" style="border-color:{T['ink']}"><span class="tag" style="color:{T['pencil']}">Reply</span><b>@sam</b> Looks great. Same road Sunday, let's compare runs on the Skyway stage.</div>
  </div>

  <div class="post">
    <div class="ph"><span class="dot">3</span><div><b>Brakes and fluid, before the suspension</b><span>Sep 30 · 9 replies · 3 suggestions</span></div></div>
    <div class="txt">Pads, rotors, braided lines, RBF600. Boring but the pedal is a different car now.</div>
  </div>
</div>
<div class="compose"><div class="in">Reply, or suggest something</div><button class="btn">Photo</button><button class="btn primary">Post</button></div>
{tabs('garage')}"""
    return page("Build thread", T, body, css, description="A car's build log over time, with feedback and suggestions")


# ---------------------------------------------------------------- Theme picker

def theme_picker():
    R, D, B = THEMES["roadbook"], THEMES["tapedeck"], THEMES["billet"]
    css = PAGE_CSS + f"""
.intro{{padding:12px 16px 0;font-size:14px;line-height:1.4}}
.card{{margin:14px 16px 0;border:1.5px solid {T['ink']};position:relative}}
.card.on{{border-width:2.5px}}
.card .prev{{height:124px;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:space-between;padding:0 14px}}
.card .meta{{padding:10px 12px 12px;display:flex;gap:10px;align-items:flex-start}}
.card .meta h3{{font-family:{COND};font-weight:800;font-size:22px;line-height:1}}
.card .meta p{{font-size:13px;color:{T['pencil']};margin-top:4px;line-height:1.35}}
.card .meta .voice{{font-size:12px;margin-top:6px}}
.card .meta .voice b{{font-weight:700}}
.card .meta .btn{{height:36px;padding:0 12px;font-size:13px;margin-left:auto;flex:none}}
.pro{{position:absolute;top:8px;right:8px;background:{T['ink']};color:{T['paper']};font-size:10px;font-weight:700;letter-spacing:.1em;padding:3px 7px}}
.tick{{position:absolute;top:8px;left:8px;background:{T['red']};color:#fff;font-size:10px;font-weight:700;letter-spacing:.1em;padding:3px 7px}}
.hz{{margin:16px 16px 0;border:1.5px solid {T['ink']};padding:10px 12px;display:flex;gap:12px;align-items:center;font-size:13px}}
.hz .hazard{{position:static;font-size:16px;padding:6px 10px 6px 8px}}
.playbtn{{width:34px;height:34px;border:1.5px solid currentColor;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex:none}}
.playbtn svg{{width:14px;height:14px;fill:currentColor}}
"""
    play = '<span class="playbtn"><svg viewBox="0 0 14 14"><path d="M3 2l9 5-9 5Z"/></svg></span>'
    mini_roadbook = f'''<div class="prev" style="background:{R['paper']}"><div style="display:flex;align-items:center;gap:10px">{tulip('left4', 44, R['ink'], R['red'])}<div style="font-family:{COND};font-weight:800;font-size:22px;line-height:1;color:{R['ink']}">LEFT 4<br>TIGHTENS</div></div><div style="font-family:{COND};font-weight:800;font-size:44px;color:{R['ink']}">42<span style="font-size:11px;font-family:{SANS};margin-left:4px;color:{R['pencil']}">MPH</span></div></div>'''
    mini_tapedeck = f'''<div class="prev" style="background:linear-gradient(#0E1418,#080C0F)"><div style="display:flex;align-items:center;gap:10px">{fox_matrix(D['ink'], D['amber'], '#123033', cell=5)}<div style="font-family:{MONO};font-weight:700;font-size:15px;letter-spacing:.08em;color:{D['ink']};text-shadow:0 0 8px rgba(125,245,222,.75)">LEFT 4<br><span style="color:{D['amber']}">TIGHTENS</span></div></div>{seven_seg(' 42', D['ink'], '#123033', h=56)}</div>'''
    mini_billet = f'''<div class="prev" style="background:repeating-linear-gradient(90deg,rgba(255,255,255,.035) 0 1px,transparent 1px 3px),linear-gradient(180deg,#3A3C40,#1F2124)"><div style="display:flex;align-items:center;gap:10px">{tulip('left4', 44, '#F2F0EA', B['red'])}<div style="font-family:{COND};font-weight:800;font-size:22px;line-height:1;color:#F2F0EA">LEFT 4<br><span style="color:{B['red']};text-shadow:0 0 10px rgba(255,42,42,.8)">TIGHTENS</span></div></div><div style="font-family:{COND};font-weight:800;font-size:44px;color:{B['red']};text-shadow:0 0 10px rgba(255,42,42,.8)">42<span style="font-size:11px;font-family:{SANS};margin-left:4px;color:{B['pencil']};text-shadow:none">MPH</span></div></div>'''
    body = f"""
<div class="scroll">
  <div class="bar" style="height:84px"><span class="back">‹ Garage</span><h1>Look and voice</h1><span></span></div>
  <div class="intro">A theme changes the type, colours, gauges, map style, motion and the co-driver's voice. The calls, the hazards and where things sit never change.</div>

  <div class="card on"><span class="tick">IN USE</span>{mini_roadbook}
    <div class="meta"><div><h3>Roadbook</h3><p>Paper, ink and one red pen. Reads in direct sun. Night turns the page over after sunset.</p><div class="voice"><b>Voice: Marguerite.</b> Calm, exact, a step ahead. "Left four, tightens. Long. Care."</div></div><span class="btn">{play}Hear</span></div></div>

  <div class="card"><span class="pro">PRO</span>{mini_tapedeck}
    <div class="meta"><div><h3>Tapedeck</h3><p>A late-90s head unit: blue-green VFD, seven-segment speed, spectrum bars that show the road surface, and Kit, who leans into every corner.</p><div class="voice"><b>Voice: Kit.</b> Quick, dry, a little cheeky, never silly. "Left four, tightens. Easy in, late out."</div></div><span class="btn">{play}Hear</span></div></div>

  <div class="card"><span class="pro">PRO</span>{mini_billet}
    <div class="meta"><div><h3>Billet</h3><p>Machined aluminium, knurled bezels, red glow numerals. The quiet precision of a good toolroom.</p><div class="voice"><b>Voice: Hale.</b> Low, even, zero drama. "Left four. Tightens. Long."</div></div><span class="btn">{play}Hear</span></div></div>

  <div class="hz"><div class="hazard"><svg class="glyph" viewBox="0 0 26 26"><path d="M13 2.5 24.5 23H1.5Z" fill="#FF7A1A"/><path d="M13 9v7.5" stroke="#111" stroke-width="2.6" stroke-linecap="round"/><circle cx="13" cy="19.6" r="1.5" fill="#111"/></svg><div>Gravel</div></div><div>Hazards look like this in every theme, in the same place, with the same tone before the voice speaks.</div></div>
  <div class="intro" style="padding-bottom:16px">Pro themes come with Vetta Pro, which also pays for the servers and the road-feel map. <span style="text-decoration:underline;text-underline-offset:3px;font-weight:600">See Pro</span></div>
</div>
{tabs('garage')}"""
    return page("Theme picker", T, body, css, description="Look and voice: the three themes, Pro marked")


# ---------------------------------------------------------------- Friends on the map

def friends_map():
    css = f"""
.sheet{{position:absolute;left:0;right:0;bottom:82px;background:{T['paper']};border-top:2px solid {T['rule']};padding:10px 16px 14px;z-index:10}}
.grab{{width:36px;height:4px;background:{T['hair']};margin:0 auto 10px}}
.sheet h2{{font-family:{COND};font-weight:800;font-size:22px;display:flex;justify-content:space-between;align-items:baseline}}
.sheet h2 span{{font-family:{SANS};font-size:13px;font-weight:600;text-decoration:underline;text-underline-offset:3px}}
.row{{display:flex;align-items:center;justify-content:space-between;height:42px;border-top:1px solid {T['hair']};font-size:15px;font-weight:600}}
.row:first-of-type{{border-top:none}}
.row .val{{font-weight:500;color:{T['pencil']}}}
.sw{{width:52px;height:30px;border:1.5px solid {T['ink']};position:relative;background:{T['paper2']}}}
.sw i{{position:absolute;top:3px;left:3px;width:22px;height:22px;background:{T['pencil']}}}
.sw.on i{{left:auto;right:3px;background:{T['red']}}}
.sw.on{{border-color:{T['red']}}}
.seg{{display:flex;border:1.5px solid {T['ink']};height:32px}}
.seg span{{padding:0 10px;display:flex;align-items:center;font-size:12px;font-weight:600;border-right:1.5px solid {T['ink']}}}
.seg span:last-child{{border-right:none}}
.seg span.on{{background:{T['ink']};color:{T['paper']}}}
.note{{font-size:12px;color:{T['pencil']};margin-top:6px;line-height:1.35}}
.friend{{position:absolute;display:flex;align-items:center;gap:6px;z-index:4}}
.friend .pk{{width:26px;height:26px;border-radius:50%;background:{T['paper']};border:2px solid {T['ink']};display:flex;align-items:center;justify-content:center;font-family:{COND};font-weight:800;font-size:12px}}
.friend .tag{{background:{T['paper']};border:1.5px solid {T['ink']};padding:3px 7px;font-size:12px;font-weight:600;line-height:1.1}}
.friend .tag small{{display:block;font-size:10px;color:{T['pencil']};font-weight:500}}
.fuzz{{position:absolute;border-radius:50%;border:1.5px dashed {T['ink']};opacity:.5;z-index:3}}
.homezone{{position:absolute;width:120px;height:120px;border-radius:50%;background:repeating-linear-gradient(45deg,rgba(28,26,23,.14) 0 3px,transparent 3px 8px);border:1.5px solid {T['ink']};z-index:3;display:flex;align-items:flex-end;justify-content:center;padding-bottom:6px;font-size:10px;font-weight:600}}
"""
    body = topo_map(T, h=600) + f"""
<div class="homezone" style="left:250px;top:64px">Home zone: hidden</div>
<div class="fuzz" style="left:40px;top:235px;width:110px;height:110px"></div>
<div class="friend" style="left:84px;top:274px"><span class="pk">S</span><span class="tag">@sam<small>about 10 min ago · within a mile</small></span></div>
<div class="fuzz" style="left:200px;top:300px;width:90px;height:90px"></div>
<div class="friend" style="left:234px;top:330px"><span class="pk">J</span><span class="tag">@jules<small>Driving · Skyway</small></span></div>
<div class="sheet">
  <div class="grab"></div>
  <h2>Friends on the map <span>Done</span></h2>
  <div class="row"><span>Show friends</span><span class="sw on"><i></i></span></div>
  <div class="row"><span>Show me to</span><div class="seg"><span>Nobody</span><span class="on">Crew</span><span>Friends</span></div></div>
  <div class="row"><span>Delay</span><div class="seg"><span>Live</span><span class="on">10 min</span><span>1 h</span></div></div>
  <div class="row"><span>Position shown as</span><div class="seg"><span>Exact</span><span class="on">Within a mile</span></div></div>
  <div class="row"><span>Only while driving</span><span class="sw on"><i></i></span></div>
  <div class="row"><span>Home zones</span><span class="val">2 zones · always hidden</span></div>
  <div class="note">Off by default. Your position is held 10 minutes and shown within a mile unless you choose otherwise. Inside a home zone, nobody sees you, convoy included. Nothing is kept after you turn it off.</div>
</div>
{tabs('map')}"""
    return page("Friends on the map", T, body, css, description="The opt-in friends layer with its privacy defaults")
