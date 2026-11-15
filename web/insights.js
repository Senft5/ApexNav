// The road insights viewer (web/insights.html on data.vettadrive.com; backend/src/road_insights.ts). Shows the made-up
// sample (insights-sample.geojson) until a key is pasted, then the real released roads in view. Plain map code, no math:
// every figure arrives already aggregated, floored at ten drivers and noised by the server.
(function () {
  "use strict";
  const STYLE = "https://tiles.openfreemap.org/styles/dark";
  const SAMPLE = "insights-sample.geojson";
  const API = "/api/data/v1/roads.geojson";
  const KEY_STORE = "vetta.insightsKey";
  // label, low/high words, the colour ramp's domain, and the plain-words meaning
  const METRICS = {
    rough_g: { label: "Roughness", lo: "Smooth", hi: "Rough", max: 0.25, fmt: (v) => v.toFixed(3) + " g", what: "Vertical shake, g rms. Higher is a rougher surface." },
    banked: { label: "Banking", lo: "Flat", hi: "Banked", max: 0.6, fmt: pct, what: "Share of the road banked into its turns." },
    off_camber: { label: "Off-camber", lo: "None", hi: "Lots", max: 0.25, fmt: pct, what: "Share of the road tilted away from its turns." },
    crests_per_km: { label: "Crests", lo: "Flat", hi: "Lumpy", max: 4, fmt: (v) => v.toFixed(1) + " /km", what: "Crests per km that make the car go light." },
    flow: { label: "Flow", lo: "Stop-start", hi: "Even", max: 1, fmt: pct, what: "How evenly members drive it." },
    hard_brake: { label: "Hard braking", lo: "Rare", hi: "Often", max: 0.15, fmt: pct, what: "How often members brake hard with no corner ahead." },
  };
  const RAMP = ["#2a3140", "#3f5a7a", "#f5b942", "#ff7a3d", "#ff3341"];
  function pct(v) { return Math.round(v * 100) + "%"; }
  const $ = (id) => document.getElementById(id);
  const store = {
    get() { try { return sessionStorage.getItem(KEY_STORE) || ""; } catch (e) { return ""; } },
    set(v) { try { if (v) sessionStorage.setItem(KEY_STORE, v); else sessionStorage.removeItem(KEY_STORE); } catch (e) { /* private mode */ } },
  };

  let metric = "rough_g", key = store.get(), map = null, data = { type: "FeatureCollection", features: [] }, timer = 0;

  function colorExpr() {
    const m = METRICS[metric], stops = [];
    RAMP.forEach((c, i) => { stops.push((m.max * i) / (RAMP.length - 1), c); });
    return ["case", ["==", ["get", metric], null], "#55585f", ["interpolate", ["linear"], ["get", metric], ...stops]];
  }

  function drawLegend() {
    const m = METRICS[metric];
    $("ramp").style.background = `linear-gradient(90deg, ${RAMP.join(", ")})`;
    $("lo").textContent = m.lo; $("hi").textContent = m.hi; $("what").textContent = m.what;
    for (const b of $("metrics").children) b.setAttribute("aria-pressed", String(b.dataset.m === metric));
    if (map && map.getLayer("roads")) map.setPaintProperty("roads", "line-color", colorExpr());
  }

  function buildMetrics() {
    for (const [k, m] of Object.entries(METRICS)) {
      const b = document.createElement("button");
      b.type = "button"; b.dataset.m = k; b.textContent = m.label;
      b.addEventListener("click", () => { metric = k; drawLegend(); });
      $("metrics").appendChild(b);
    }
  }

  function showRoad(p) {
    const el = $("road");
    el.textContent = "";
    const h = document.createElement("h2");
    h.textContent = p.name || `OpenStreetMap way ${p.way}`;
    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = [p.cls, p.dir === 1 ? "against the way" : "along the way", `${p.confidence} confidence`, p.last_month].filter(Boolean).join(" · ");
    el.append(h, sub);
    for (const [k, m] of Object.entries(METRICS)) {
      const v = p[k];
      const row = document.createElement("div");
      row.className = "row";
      const name = document.createElement("span"); name.textContent = m.label;
      const val = document.createElement("span"); val.className = "v"; val.textContent = v == null ? "--" : m.fmt(v);
      const bar = document.createElement("div"); bar.className = "bar" + (k === metric ? "" : " on");
      const fill = document.createElement("i"); fill.style.width = v == null ? "0" : Math.min(100, (v / m.max) * 100) + "%";
      bar.appendChild(fill);
      row.append(name, val, bar);
      el.appendChild(row);
    }
    if (!p.name) {
      const a = document.createElement("a");
      a.href = `https://www.openstreetmap.org/way/${p.way}`; a.target = "_blank"; a.rel = "noopener"; a.className = "sub";
      a.textContent = "Open on OpenStreetMap"; a.style.display = "block"; a.style.marginTop = "10px";
      el.appendChild(a);
    }
  }

  function setMode(live, note) {
    const chip = $("mode");
    chip.classList.toggle("live", live);
    chip.textContent = live ? "Live data: measured, aggregated, noised" : "Sample data: values are made up";
    $("note").textContent = note || "";
    $("keyclear").hidden = !live;
  }

  function setData(fc) {
    data = fc;
    const src = map && map.getSource("roads");
    if (src) src.setData(fc);
  }

  async function loadSample() {
    setMode(false, "The road lines are real; every figure is made up, to show the format.");
    try { setData(await (await fetch(SAMPLE)).json()); } catch (e) { $("note").textContent = "The sample didn't load. Try again."; }
  }

  async function loadLive() {
    if (!map) return;
    const b = map.getBounds(), c = map.getCenter();
    let s = b.getSouth(), w = b.getWest(), n = b.getNorth(), e = b.getEast(), clipped = false;
    if (n - s > 1) { s = c.lat - 0.5; n = c.lat + 0.5; clipped = true; }
    if (e - w > 1) { w = c.lng - 0.5; e = c.lng + 0.5; clipped = true; }
    const box = [s, w, n, e].map((v) => v.toFixed(4)).join(",");
    let res;
    try { res = await fetch(`${API}?bbox=${box}`, { headers: { authorization: `Bearer ${key}` } }); }
    catch (err) { $("keymsg").textContent = "No connection. Showing what was loaded."; return; }
    if (!res.ok) {
      let code = "";
      try { code = (await res.json()).error || ""; } catch (err) { /* not JSON */ }
      $("keymsg").textContent = code === "partner_access_not_open" ? "Partner access isn't open yet. Showing the sample."
        : res.status === 401 ? "That key isn't valid. Showing the sample." : "Something went wrong. Showing the sample.";
      key = ""; store.set("");
      loadSample();
      return;
    }
    const fc = await res.json();
    $("keymsg").textContent = "";
    setMode(true, fc.features.length ? (clipped ? "Showing the middle 1° of the view. Zoom in to see the edges." : "")
      : "No road here has 10 or more drivers yet. Unknown stays unknown.");
    setData(fc);
  }

  function refresh() {
    clearTimeout(timer);
    if (key) timer = setTimeout(loadLive, 350);
  }

  function tabs() {
    const ids = ["map", "api", "key"];
    for (const id of ids) {
      $(`tab-${id}`).addEventListener("click", () => {
        for (const o of ids) {
          $(`tab-${o}`).setAttribute("aria-selected", String(o === id));
          $(`pane-${o}`).hidden = o !== id;
        }
      });
    }
  }

  async function fields() {
    try {
      const m = await (await fetch("/api/data/v1/meta")).json();
      const dl = $("fields");
      for (const [k, v] of Object.entries(m.fields || {})) {
        const dt = document.createElement("dt"); dt.textContent = k;
        const dd = document.createElement("dd"); dd.textContent = v;
        dl.append(dt, dd);
      }
    } catch (e) { $("fields").textContent = "The field list didn't load."; }
  }

  function start() {
    buildMetrics(); drawLegend(); tabs(); fields();
    $("keyform").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const v = $("keyin").value.trim();
      if (!/^vk_[A-Za-z0-9_-]{32,128}$/.test(v)) { $("keymsg").textContent = "A key starts with vk_ and is at least 35 characters."; return; }
      key = v; store.set(v); $("keyin").value = "";
      $("keymsg").textContent = "Loading…";
      loadLive();
    });
    $("keyclear").addEventListener("click", () => { key = ""; store.set(""); loadSample(); });
    if (!window.maplibregl) { $("note").textContent = "The map didn't load."; return; }
    map = new maplibregl.Map({ container: "map", style: STYLE, center: [-84.33, 39.25], zoom: 12, attributionControl: { compact: true } });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("roads", { type: "geojson", data });
      map.addLayer({ id: "picked", type: "line", source: "roads", filter: ["==", ["get", "way"], -1],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#F5F5F7", "line-width": ["interpolate", ["linear"], ["zoom"], 9, 5, 14, 10, 17, 15] } });
      map.addLayer({ id: "roads", type: "line", source: "roads", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": colorExpr(), "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.5, 14, 5, 17, 9],
                 "line-opacity": ["match", ["get", "confidence"], "fair", 0.65, 0.95] } });
      map.on("click", "roads", (ev) => {
        const f = ev.features && ev.features[0];
        if (!f) return;
        map.setFilter("picked", ["all", ["==", ["get", "way"], f.properties.way], ["==", ["get", "dir"], f.properties.dir]]);
        showRoad(f.properties);
      });
      map.on("mouseenter", "roads", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "roads", () => { map.getCanvas().style.cursor = ""; });
      map.on("moveend", refresh);
      if (key) loadLive(); else loadSample();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
