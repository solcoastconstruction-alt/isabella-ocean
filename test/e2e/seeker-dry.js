// The stand-in phone for `node test/e2e/record-seeker.js --dry-run`: headless Chrome at the Seeker's
// screen shape (915×412 CSS px, device pixel ratio 2.9), showing web/ over a local web server, with
// web/paymock.js in place of the wallet and the chain (?mockpay=1). No phone, no adb, no network.
//   - Touches are real touch input through the DevTools protocol, at the coordinates the recorder
//     would hand to `adb shell input` (device pixels).
//   - The hub page always gets ?mockpay=1, also when a mini-game's home button loads it again.
//   - The save starts as "World 1 finished", unless DRY_SAVE=fresh.
//   - DRY_MOCK=<preset> passes a paymock preset (staked, purchased, ...); DRY_DELAY=<ms> is how long
//     each mock wallet or chain call takes (default 1200).
// It keeps a screenshot per logged beat and every JavaScript exception the page throws.
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { launch, sleep } = require('../paywall/cdp.js');

const WEB = path.resolve(__dirname, '../../web');
const PORT = +(process.env.DRY_PORT || 9485);
const W = 915, H = 412, DPR = 2.9;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.css': 'text/css' };
const WORLD1_DONE = { unlocked: 11, stars: [3, 3, 2, 3, 1, 2, 3, 3, 2, 1], gold: 420, muted: true, played: true };

function serve() {
  const server = http.createServer((req, res) => {
    const file = path.normalize(path.join(WEB, decodeURIComponent(req.url.split('?')[0])));
    if (!file.startsWith(WEB + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function open() {
  const out = path.resolve(process.env.DRY_OUT || path.join(os.tmpdir(), 'isabella-seeker-dry'));
  fs.rmSync(path.join(out, 'shots'), { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'shots'), { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const query = `mockpay=1&mockdelay=${+(process.env.DRY_DELAY || 1200)}${process.env.DRY_MOCK ? `&mock=${process.env.DRY_MOCK}` : ''}`;
  const cdp = await launch({ port: PORT, profile: path.join(out, 'chrome'), width: W, height: H });
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const exceptions = [];
  cdp.on('Runtime.exceptionThrown', (p) => exceptions.push((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text));
  const seed = process.env.DRY_SAVE === 'fresh' ? '' : `try { if (!localStorage.getItem('isabella.save')) localStorage.setItem('isabella.save', ${JSON.stringify(JSON.stringify(WORLD1_DONE))}); } catch (e) {}`;
  // Before any of the page's own scripts: seed the save, and keep the hub on the mock payments.
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `${seed}
    if (location.pathname === '/index.html' && !/[?&]mockpay=1/.test(location.search)) history.replaceState(null, '', '/index.html?${query}');` });
  await cdp.navigate(`${base}/index.html?${query}`);

  const pt = (x, y) => ({ x: x / DPR, y: y / DPR, id: 1, radiusX: 10, radiusY: 10, force: 1 });
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  let shotN = 0;
  return {
    cdp, out, exceptions,
    // device pixels in, like `adb shell input tap` / `input swipe`
    async tap(x, y) { await touch('touchStart', [pt(x, y)]); await sleep(40); await touch('touchEnd', []); },
    async swipe(x1, y1, x2, y2, ms) {
      const steps = Math.max(2, Math.round(ms / 16)), t0 = Date.now();
      await touch('touchStart', [pt(x1, y1)]);
      for (let i = 1; i <= steps; i++) {
        const u = i / steps;
        await touch('touchMove', [pt(x1 + (x2 - x1) * u, y1 + (y2 - y1) * u)]);
        const wait = t0 + ms * u - Date.now();
        if (wait > 0) await sleep(wait);
      }
      await touch('touchEnd', []);
    },
    async shot(name) {
      const file = path.join(out, 'shots', `${String(++shotN).padStart(2, '0')}-${name.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}.png`);
      try { await cdp.shot(file); } catch (e) { /* mid-navigation: no picture for this beat */ }
      return file;
    },
    async close() { server.close(); await cdp.close(); },
  };
}

module.exports = { open };
