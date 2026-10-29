// Render each mockup to PNG, one browser, one page at a time.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const out = path.resolve(__dirname, '..');
const pngDir = path.join(out, 'png');
fs.mkdirSync(pngDir, { recursive: true });
(async () => {
  const files = fs.readdirSync(out).filter(f => /^\d\d-.*\.html$/.test(f)).sort();
  const only = process.argv[2];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  for (const f of files) {
    if (only && !f.includes(only)) continue;
    await page.goto('file://' + path.join(out, f));
    await page.addStyleTag({ content: 'body{padding:0!important;background:#fff!important}' });
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(pngDir, f.replace('.html', '.png')), clip: { x: 0, y: 0, width: 390, height: 844 } });
    console.log('rendered', f);
  }
  await browser.close();
})();
