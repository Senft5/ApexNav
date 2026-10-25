// Lists the exact spoken calls (token sequences) the cockpit would voice on the shipped drives,
// mirroring chainedCall() in web/index.html, so tools/voicebank.py can render each as ONE phrase.
// usage: node tools/export_calls.js > tools/route_calls.json
const fs = require('fs'), path = require('path'), vm = require('vm');
const win = {}; vm.createContext(win); win.window = win;
vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/voice.js'), 'utf8'), win);
const V = win.ApexVoice;
const calls = new Set();
for (const f of ['dry_ridge.js', 'pebble_ridge.js']) {
  const ctx = { window: {} }; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/data', f), 'utf8'), ctx);
  for (const d of ctx.window.APEX_DRIVES) {
    const ev = d.events.slice().sort((a, b) => a.dist_m - b.dist_m);
    for (const e of ev) {
      if (e.type === 'alpr') continue;
      const chain = [e]; let cur = e;
      for (let hops = 0; hops < 2 && (cur.link === 'into' || cur.link === 'and'); hops++) {
        const next = ev[ev.indexOf(cur) + 1];
        if (!next) break;
        chain.push(next); cur = next;
      }
      const voiced = chain.map((n, i) => (i === chain.length - 1 && (n.link === 'into' || n.link === 'and')) ? { ...n, link: null } : n);
      calls.add(JSON.stringify(V.tokensFor(voiced, 'codriver')));
    }
  }
}
console.log(JSON.stringify([...calls].map(JSON.parse).filter(t => t.length > 1), null, 0));
