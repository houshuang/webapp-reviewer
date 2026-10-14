// Renders the extension's own UI on demo.html with chrome.* stubbed, staging a reviewer
// who is drawing a box while talking, and saves the README screenshot.
// Usage: npm i --no-save playwright-core && node docs/screenshot.js extension/content.js docs/reviewing.jpg
// Set CHROME to your Chrome binary if it is not in the default macOS location.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const [contentJs, out] = process.argv.slice(2).map(p => path.resolve(p));

const stub = `
  window.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        if (msg.type === 'hello') return { tabId: 1, active: true };
        if (msg.type === 'check-host') return { ok: true };
        if (msg.type === 'capture-screenshot') {
          const c = document.createElement('canvas'); c.width = 4; c.height = 4; const g = c.getContext('2d'); g.fillStyle = '#1f2937'; g.fillRect(0, 0, 4, 4);
          return { dataUrl: c.toDataURL('image/jpeg') };
        }
        return { ok: true };
      },
      onMessage: { addListener: (fn) => { window.__wr = fn; } },
      getURL: (p) => p,
    },
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
  };
`;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 });
  await page.route('http://localhost:3000/**', route => route.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(__dirname, 'demo.html'), 'utf8') }));
  await page.goto('http://localhost:3000/search?q=darwin');
  await page.addScriptTag({ content: stub });
  await page.addScriptTag({ content: fs.readFileSync(contentJs, 'utf8') });
  await page.waitForTimeout(3200); // let the start toast fade

  const say = (finalText, interimText = '') =>
    page.evaluate(([f, i]) => window.__wr({ type: 'soniox-tokens', finalText: f, interimText: i, finalWords: [] }, {}, () => {}), [finalText, interimText]);

  await say('Searching for Darwin gives me a list of his letters first.');
  // Box an area with Option held, released, so it is in the timeline
  const box = await page.locator('#results li').first().boundingBox();
  const last = await page.locator('#results li').nth(4).boundingBox();
  await page.keyboard.down('Alt');
  await page.mouse.move(box.x - 10, box.y - 6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 10, box.y + box.height * 2 + 4, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.waitForTimeout(800);
  await page.keyboard.press('Alt+KeyN'); // open the timeline panel
  await say(' The person should be on top,', ' and the letters grouped at the');
  // A second box, still being dragged, around the person result
  await page.keyboard.down('Alt');
  await page.mouse.move(last.x - 10, last.y - 6);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width + 10, last.y + last.height + 6, { steps: 8 });
  await page.waitForTimeout(4200); // the bottom-left notice fades
  await page.screenshot({ path: out });
  await browser.close();
})();
