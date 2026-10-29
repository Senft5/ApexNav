from common import THEMES, page, tabs, topo_map, tulip, SANS, COND

T = THEMES["roadbook"]

DECK_CSS = f"""
.deck{{position:absolute;left:0;right:0;bottom:82px;background:{T['paper']};border-top:2px solid {T['rule']};padding:10px 16px 12px;z-index:10}}
.grab{{width:36px;height:4px;background:{T['hair']};margin:0 auto 10px}}
.whereto{{display:flex;gap:10px;align-items:stretch}}
.search{{flex:1;display:flex;align-items:center;gap:10px;border:1.5px solid {T['ink']};padding:0 14px;height:52px;font-size:17px;color:{T['pencil']};background:{T['paper2']}}}
.search svg{{width:22px;height:22px;stroke:{T['ink']};fill:none;stroke-width:2;stroke-linecap:round}}
.suggest{{display:flex;align-items:center;gap:12px;margin-top:12px;padding-top:12px;border-top:1px solid {T['hair']}}}
.suggest .tulipbox{{width:44px;height:44px;flex:none;border:1.5px solid {T['ink']};display:flex;align-items:center;justify-content:center;background:{T['paper2']}}}
.suggest b{{display:block;font-size:15px;font-weight:700}}
.suggest small{{display:block;font-size:13px;color:{T['pencil']};margin-top:2px}}
.suggest .go{{margin-left:auto;font-size:13px;font-weight:600;text-decoration:underline;text-underline-offset:3px}}
.mapctl{{position:absolute;right:12px;display:flex;flex-direction:column;gap:8px;z-index:5}}
.mapctl button{{width:44px;height:44px;border:1.5px solid {T['ink']};background:{T['paper']};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 0 rgba(0,0,0,.18)}}
.mapctl svg{{width:22px;height:22px;stroke:{T['ink']};fill:none;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}}
.scale{{position:absolute;left:14px;bottom:200px;font-size:10px;color:{T['pencil']};z-index:5}}
.scale i{{display:block;width:60px;height:5px;border:1.5px solid {T['ink']};border-top:none;margin-bottom:2px}}
.plate{{position:absolute;top:58px;left:12px;background:{T['paper']};border:1.5px solid {T['ink']};padding:6px 10px;font-size:12px;font-weight:600;z-index:5;display:flex;gap:8px;align-items:center}}
.plate .sun{{width:14px;height:14px;border-radius:50%;border:2px solid {T['ink']}}}
"""

def cockpit_idle():
    body = topo_map(T) + f"""
<div class="plate"><span class="sun"></span>Tellico Plains · Dry · 61°</div>
<div class="mapctl" style="top:290px">
  <button title="Layers"><svg viewBox="0 0 24 24"><path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="M3 12l9 5 9-5M3 16l9 5 9-5"/></svg></button>
  <button title="Recenter"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg></button>
</div>
<div class="scale"><i></i>500 ft</div>
<div class="deck">
  <div class="grab"></div>
  <div class="whereto">
    <div class="search"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>Where to, or a loop from here</div>
    <button class="btn record"><span class="dot"></span>Start</button>
  </div>
  <div class="suggest">
    <div class="tulipbox">{tulip('right3', 34, T['ink'], T['red'])}</div>
    <div><b>Loop from here · 45 mi · twistiest nearby</b><small>Tellico River Rd, Skyway, Tapoco · Map only until driven</small></div>
    <span class="go">Plan</span>
  </div>
</div>
{tabs('map')}"""
    return page("Cockpit idle", T, body, DECK_CSS, description="Map at idle in the Roadbook theme")


PLAN_CSS = f"""
.sheet{{position:absolute;left:0;right:0;top:120px;bottom:82px;background:{T['paper']};border-top:2px solid {T['rule']};padding:10px 16px 0;z-index:10;overflow:hidden}}
.grab{{width:36px;height:4px;background:{T['hair']};margin:0 auto 10px}}
.search{{display:flex;align-items:center;gap:10px;border:2px solid {T['ink']};padding:0 14px;height:52px;font-size:17px;background:{T['paper2']}}}
.search svg{{width:22px;height:22px;stroke:{T['ink']};fill:none;stroke-width:2;stroke-linecap:round}}
.search .cancel{{margin-left:auto;font-size:15px;font-weight:600;text-decoration:underline;text-underline-offset:3px}}
.recent{{display:flex;gap:8px;margin:10px 0 4px;overflow:hidden}}
.chip{{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border:1.5px solid {T['hair']};font-size:13px;font-weight:600;white-space:nowrap}}
.chip svg{{width:14px;height:14px;stroke:{T['ink']};fill:none;stroke-width:2;stroke-linecap:round}}
h3.sec{{font-family:{COND};font-weight:800;font-size:22px;margin:18px 0 8px;display:flex;align-items:baseline;gap:10px}}
h3.sec small{{font-family:{SANS};font-size:13px;font-weight:500;color:{T['pencil']}}}
.dial{{display:flex;align-items:center;gap:14px}}
.dial .knob{{width:96px;height:96px;flex:none;border-radius:50%;border:2px solid {T['ink']};background:
  radial-gradient(circle at 50% 50%, {T['paper2']} 0 54%, {T['paper']} 55% 100%);position:relative;box-shadow:inset 0 0 0 6px {T['paper']}, inset 0 0 0 7.5px {T['hair']}, 0 3px 0 rgba(0,0,0,.2)}}
.dial .knob::after{{content:"";position:absolute;left:46px;top:6px;width:4px;height:26px;background:{T['red']}}}
.dial .knob b{{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:{COND};font-size:30px;font-weight:800;padding-top:10px}}
.dial .knob b small{{font-size:12px;font-family:{SANS};font-weight:600;margin-left:3px;color:{T['pencil']}}}
.detents{{flex:1;display:grid;grid-template-columns:repeat(5,1fr);gap:6px}}
.detents span{{height:40px;border:1.5px solid {T['ink']};display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;background:{T['paper2']}}}
.detents span.on{{background:{T['ink']};color:{T['paper']}}}
.dial .hint{{grid-column:1/-1;font-size:12px;color:{T['pencil']};margin-top:2px}}
.slide{{display:flex;border:1.5px solid {T['ink']};height:46px;position:relative;background:{T['paper2']}}}
.slide span{{flex:1;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:600;position:relative;z-index:1}}
.slide span.on{{color:{T['paper']}}}
.slide .thumb{{position:absolute;top:3px;bottom:3px;left:calc(33.33% + 3px);width:calc(33.33% - 6px);background:{T['ink']};box-shadow:inset 0 -3px 0 rgba(255,255,255,.18);z-index:0}}

.row{{display:flex;align-items:center;justify-content:space-between;height:48px;border-top:1px solid {T['hair']};font-size:15px;font-weight:600}}
.row .val{{font-weight:500;color:{T['pencil']}}}
.row .chev{{width:18px;height:18px;stroke:{T['ink']};fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}}
.cta{{position:absolute;left:0;right:0;bottom:0;padding:10px 16px 14px;background:{T['paper']};border-top:1px solid {T['hair']}}}
.cta .btn{{width:100%}}
.stamp{{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 10px;border:1.5px solid {T['ink']};font-size:13px;font-weight:600;background:{T['paper2']}}}
.stamp.on{{background:{T['ink']};color:{T['paper']}}}
.stamps{{display:flex;flex-wrap:wrap;gap:8px}}
.balance{{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:600;height:44px}}
.balance .track{{flex:1;height:2px;background:{T['ink']};position:relative}}
.balance .track i{{position:absolute;top:-9px;width:20px;height:20px;background:{T['paper']};border:2px solid {T['ink']};border-radius:50%;margin-left:-10px}}
.balance .track em{{position:absolute;top:-5px;width:1px;height:12px;background:{T['ink']}}}
.preset{{display:flex;gap:8px;overflow:hidden;margin-top:4px}}
"""

def plan_basic():
    body = topo_map(T, h=130) + f"""
<div class="sheet">
  <div class="grab"></div>
  <div class="search"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg><span class="pencil">Where to?</span><span class="cancel">Cancel</span></div>
  <div class="recent">
    <span class="chip"><svg viewBox="0 0 24 24"><path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/></svg>Robbinsville Gap</span>
    <span class="chip"><svg viewBox="0 0 24 24"><path d="M3 11 12 4l9 7v9H3Z"/></svg>Home</span>
    <span class="chip">Tap the map</span>
    <span class="chip">GPX</span>
  </div>

  <h3 class="sec">Or loop from here <small>back where you started</small></h3>
  <div class="dial">
    <div class="knob"><b>45<small>mi</small></b></div>
    <div class="detents">
      <span>15</span><span>30</span><span class="on">45</span><span>60</span><span>90</span>
      <span class="hint">About 1 h 40 at a Sunday pace. Turn the dial or tap a stop.</span>
    </div>
  </div>

  <h3 class="sec">Roads <small>how much of the long way</small></h3>
  <div class="slide"><span>Quick</span><span class="on">Fun</span><span>Max fun</span><div class="thumb"></div></div>
  <p class="pencil" style="font-size:13px;margin-top:8px">Fun: the twistiest roads that still get you there. Paved only.</p>

  <div style="margin-top:18px">
    <div class="row"><span>More: avoid, hairpins, surface, presets</span><svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></div>
  </div>

  <div class="cta"><button class="btn primary">Find roads</button></div>
</div>
{tabs('map')}"""
    return page("Plan a drive", T, body, PLAN_CSS, description="Plan sheet, basic level")


def plan_advanced():
    body = topo_map(T, h=130) + f"""
<div class="sheet">
  <div class="grab"></div>
  <div class="search"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg><span>Robbinsville Gap</span><span class="cancel">Cancel</span></div>
  <div class="preset">
    <span class="label" style="align-self:center">Presets</span>
    <span class="stamp on">Sunday loop</span><span class="stamp">Night run</span><span class="stamp">Gravel ok</span><span class="stamp">+ Save this</span>
  </div>

  <h3 class="sec">Roads</h3>
  <div class="slide"><span>Quick</span><span class="on">Fun</span><span>Max fun</span><div class="thumb"></div></div>

  <h3 class="sec">Avoid <small>stamped means avoided</small></h3>
  <div class="stamps">
    <span class="stamp on">Highways</span><span class="stamp">Tolls</span><span class="stamp">Ferries</span><span class="stamp on">Unpaved</span><span class="stamp">Towns</span><span class="stamp on">Cameras</span>
  </div>

  <h3 class="sec">Corner mix</h3>
  <div class="balance"><span>Fewer hairpins</span><div class="track"><em style="left:25%"></em><em style="left:50%"></em><em style="left:75%"></em><i style="left:62%"></i></div><span>More</span></div>
  <div class="balance"><span>Fewer sweepers</span><div class="track"><em style="left:25%"></em><em style="left:50%"></em><em style="left:75%"></em><i style="left:50%"></i></div><span>More</span></div>

  <h3 class="sec">Prefer</h3>
  <div class="stamps">
    <span class="stamp on">Measured roads</span><span class="stamp">New to me</span><span class="stamp">Crew favourites</span>
  </div>
  <div style="margin-top:10px;padding-bottom:80px">
    <div class="row"><span>Start and finish</span><span class="val">Here → Robbinsville Gap</span></div>
  </div>

  <div class="cta"><button class="btn primary">Find roads</button></div>
</div>
{tabs('map')}"""
    return page("Plan, more options", T, body, PLAN_CSS, description="Plan sheet with the power-user options opened")


ROUTE_CSS = f"""
.sheet{{position:absolute;left:0;right:0;top:150px;bottom:0;background:{T['paper']};border-top:2px solid {T['rule']};padding:10px 16px 0;z-index:10;overflow:hidden}}
.grab{{width:36px;height:4px;background:{T['hair']};margin:0 auto 10px}}
.head{{display:flex;align-items:flex-start;justify-content:space-between}}
.head h2{{font-family:{COND};font-weight:800;font-size:26px;line-height:1.05}}
.head .sub{{font-size:13px;color:{T['pencil']};margin-top:4px}}
.head .x{{font-size:15px;font-weight:600;text-decoration:underline;text-underline-offset:3px;padding-top:4px}}
.stats{{display:grid;grid-template-columns:1fr 1fr 1fr;margin-top:12px;border-top:2px solid {T['ink']};border-bottom:1px solid {T['hair']}}}
.stats div{{padding:8px 0 8px;border-right:1px solid {T['hair']}}}
.stats div:last-child{{border-right:none}}
.stats b{{display:block;font-family:{COND};font-size:30px;font-weight:800;line-height:1}}
.stats b small{{font-family:{SANS};font-size:12px;font-weight:600;color:{T['pencil']};margin-left:3px}}
.stats span{{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:{T['pencil']}}}
.profile{{margin-top:12px;position:relative}}
.profile svg{{width:100%;height:92px;display:block}}
.legs{{display:flex;font-size:11px;font-weight:600;color:{T['pencil']};margin-top:4px}}
.legs span{{border-left:1px solid {T['ink']};padding-left:5px}}
.feel{{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-top:14px}}
.g{{text-align:center}}
.g svg{{width:64px;height:40px;display:block;margin:0 auto}}
.g b{{display:block;font-family:{COND};font-size:22px;font-weight:800;line-height:1;margin-top:2px}}
.g span{{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:{T['pencil']}}}
.note{{font-size:13px;color:{T['pencil']};margin-top:10px;line-height:1.35}}
.facts{{display:flex;gap:14px;margin-top:10px;font-size:13px;font-weight:600;flex-wrap:wrap}}
.facts span{{display:inline-flex;align-items:center;gap:6px}}
.facts svg{{width:16px;height:16px;stroke:{T['ink']};fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}}
.opts{{display:flex;gap:8px;margin-top:14px}}
.opt{{flex:1;border:1.5px solid {T['ink']};padding:8px 10px;font-size:12px;font-weight:600;color:{T['pencil']}}}
.opt b{{display:block;font-size:15px;color:{T['ink']}}}
.opt.on{{background:{T['ink']};color:{T['hair']}}}
.opt.on b{{color:{T['paper']}}}
.actions{{display:flex;gap:10px;margin-top:14px}}
.actions .btn.record{{flex:1.5}}
.actions .btn{{flex:1}}
.more{{display:flex;gap:18px;justify-content:center;margin-top:12px;font-size:14px;font-weight:600}}
.more span{{text-decoration:underline;text-underline-offset:3px}}
"""

def gauge(val, ink, red, hair):
    """Small half-dial with a needle. val None = unknown."""
    import math
    if val is None:
        return f'<svg viewBox="0 0 64 40"><path d="M6 32 A26 26 0 0 1 58 32" fill="none" stroke="{hair}" stroke-width="3" stroke-dasharray="2 3"/></svg>'
    a = math.pi * (1 - val / 100)
    x, y = 32 + 20 * math.cos(a), 32 - 20 * math.sin(a)
    return f'<svg viewBox="0 0 64 40"><path d="M6 32 A26 26 0 0 1 58 32" fill="none" stroke="{ink}" stroke-width="3"/><path d="M6 32 A26 26 0 0 1 58 32" fill="none" stroke="{red}" stroke-width="3" stroke-dasharray="{val/100*81.7:.1f} 100"/><line x1="32" y1="32" x2="{x:.1f}" y2="{y:.1f}" stroke="{ink}" stroke-width="2.5" stroke-linecap="round"/><circle cx="32" cy="32" r="3" fill="{ink}"/></svg>'


def route_card():
    route = "M-10 820 C 60 700, 120 640, 186 600 C 220 520, 150 470, 190 420 C 230 380, 300 420, 330 330 C 360 250, 300 200, 340 120 L 360 60"
    body = topo_map(T, h=160, route="M-10 150 C 60 120, 120 100, 186 90 C 240 80, 300 110, 340 60 L 360 20", puck=(60, 112), heading=-40) + f"""
<div class="sheet">
  <div class="grab"></div>
  <div class="head"><div><h2>To Robbinsville Gap</h2><div class="sub">By way of NC 143, Cherohala Skyway, Tapoco Rd</div></div><span class="x">Cancel</span></div>
  <div class="stats">
    <div><b>70.1<small>mi</small></b><span>Distance</span></div>
    <div><b>2:48<small>h</small></b><span>+12 min for fun</span></div>
    <div><b>360</b><span>Corners</span></div>
  </div>
  <div class="profile">
    <svg viewBox="0 0 358 92" preserveAspectRatio="none">
      <path d="M0 80 C 30 70, 50 60, 80 48 S 130 20, 170 18 S 230 40, 270 60 S 330 76, 358 70 V 92 H 0Z" fill="{T['hair']}" opacity=".6"/>
      <path d="M0 80 C 30 70, 50 60, 80 48 S 130 20, 170 18 S 230 40, 270 60 S 330 76, 358 70" fill="none" stroke="{T['ink']}" stroke-width="1.5"/>
      <g stroke="{T['red']}" stroke-width="1.5">{''.join(f'<line x1="{x}" y1="84" x2="{x}" y2="{84-h}"/>' for x,h in [(8,4),(14,6),(22,5),(35,9),(41,12),(47,10),(52,14),(58,9),(66,6),(80,12),(86,15),(91,13),(97,16),(103,12),(110,15),(118,10),(126,14),(131,16),(140,12),(150,8),(160,6),(172,9),(185,13),(191,15),(197,11),(205,14),(215,9),(226,7),(240,5),(252,8),(262,11),(269,13),(277,9),(290,6),(302,4),(316,7),(328,10),(336,8),(345,5)])}</g>
      <text x="172" y="12" font-size="9" fill="{T['pencil']}" text-anchor="middle" font-family="{SANS}">5,387 ft</text>
      <text x="2" y="90" font-size="9" fill="{T['pencil']}" font-family="{SANS}">corners</text>
    </svg>
    <div class="legs"><span style="flex:25">NC 143 · 25 mi</span><span style="flex:23">Skyway · 23 mi</span><span style="flex:12">Tapoco · 12 mi</span><span style="flex:10">Gap</span></div>
  </div>
  <div class="feel">
    <div class="g">{gauge(100, T['ink'], T['red'], T['hair'])}<b>100</b><span>Twist</span></div>
    <div class="g">{gauge(97, T['ink'], T['red'], T['hair'])}<b>97</b><span>Flow</span></div>
    <div class="g">{gauge(None, T['ink'], T['red'], T['hair'])}<b>--</b><span>Surface</span></div>
    <div class="g"><svg viewBox="0 0 64 40"></svg><b>--</b><span>Cameras</span></div>
  </div>
  <p class="note">Twist and Flow come from the map. Surface and banking are measured after the first drive; nobody has driven this one with Vetta yet.</p>
  <div class="facts">
    <span><svg viewBox="0 0 24 24"><path d="M3 20 9 9l4 6 3-3 5 8Z"/></svg>9 viewpoints</span>
    <span><svg viewBox="0 0 24 24"><path d="M5 20V5h9v15M14 10h3l2 2v6M5 20h9"/></svg>No fuel for 51 mi</span>
    <span><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>Dry, 48° at the top</span>
  </div>
  <div class="opts">
    <div class="opt on"><b>Fun · 2:48</b>the one above</div>
    <div class="opt"><b>Quicker · 2:36</b>fewer corners</div>
    <div class="opt"><b>Max fun · 3:31</b>+47 corners</div>
  </div>
  <div class="actions"><button class="btn record"><span class="dot"></span>Drive it</button><button class="btn">Preview</button></div>
  <div class="more"><span>Save</span><span>Share</span><span>Share ETA</span><span>GPX</span></div>
</div>"""
    return page("Route card", T, body, ROUTE_CSS, description="A route as a road-book page")
