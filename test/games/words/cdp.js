// Tiny headless-Chrome driver for the Sea Words tests (copied from test/games/maze/cdp.js): a static file server for
// the repo, Chrome on its own DevTools port (9457) and profile, and a Chrome DevTools Protocol session over Node's
// built-in WebSocket, plus real touch input (taps and drags along any path). No libraries. Needs Node 22+.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve(root) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      // browsers ask every site for a favicon; the app (file:// in a WebView) never does
      if (rel === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      const file = path.join(root, rel.endsWith('/') ? rel + 'index.html' : rel);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ port: srv.address().port, close: () => new Promise((r) => srv.close(r)) }));
  });
}

async function launch({ port, profile, width, height }) {
  fs.mkdirSync(profile, { recursive: true });
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`,
    '--no-first-run', '--no-default-browser-check', '--mute-audio', '--hide-scrollbars',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d; });
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return { proc, close: () => kill(proc) }; } catch (e) { /* not up yet */ }
    await sleep(100);
  }
  kill(proc);
  throw new Error('Chrome did not start: ' + stderr.slice(-500));
}
function kill(proc) {
  return new Promise((r) => {
    if (proc.exitCode != null) { r(); return; }
    proc.once('exit', () => r());
    proc.kill('SIGTERM');
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch (e) { /* gone */ } }, 3000);
  });
}

// One page target. send() returns the result or throws the protocol error.
async function openPage(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  const target = await r.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const waiting = new Map(), handlers = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString());
    if (msg.id && waiting.has(msg.id)) {
      const w = waiting.get(msg.id); waiting.delete(msg.id);
      if (msg.error) w.rej(new Error(`${w.method}: ${msg.error.message}`)); else w.res(msg.result);
    } else if (msg.method) (handlers.get(msg.method) || []).forEach((fn) => fn(msg.params));
  };
  const touch = (type, pts) => page.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: 1, radiusX: 10, radiusY: 10, force: 1 })) });
  const page = {
    send(method, params) { return new Promise((res, rej) => { const i = ++id; waiting.set(i, { res, rej, method }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); }); },
    on(method, fn) { if (!handlers.has(method)) handlers.set(method, []); handlers.get(method).push(fn); },
    async eval(expr) {
      const r = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text) + '\n  in: ' + expr.slice(0, 200));
      return r.result.value;
    },
    async waitFor(expr, timeoutMs, what) {
      const t0 = Date.now();
      for (;;) {
        const v = await page.eval(expr);
        if (v) return v;
        if (Date.now() - t0 > (timeoutMs || 10000)) throw new Error('timed out waiting for ' + (what || expr));
        await sleep(40);
      }
    },
    async tap(x, y) {
      await touch('touchStart', [{ x, y }]);
      await touch('touchEnd', []);
    },
    // Let `n` animation frames pass in the page. Touch moves are handed to the page in step with its frames, so a
    // move sent a moment ago may not have arrived yet: wait before reading what a finger has done. And never take a
    // screenshot while a move is still waiting: headless Chrome then hands that move over with its coordinates divided
    // by the device pixel ratio (seen 3 Oct 2026: a move to (418, 128) arrived as (159, 49)).
    async frames(n) {
      await page.eval(`new Promise((r) => { let k = ${n || 2}; const f = () => (--k <= 0 ? r(true) : requestAnimationFrame(f)); requestAnimationFrame(f); })`);
    },
    // a finger: down on the first point, through the others about a frame apart, up on the last
    async drag(points, ms, beforeEnd) {
      await touch('touchStart', [points[0]]);
      for (let i = 1; i < points.length; i++) { await sleep(ms == null ? 16 : ms); await touch('touchMove', [points[i]]); }
      if (beforeEnd) await beforeEnd();
      await touch('touchEnd', []);
    },
    async shot(file) {
      const r = await page.send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      return file;
    },
    async viewport(width, height, scale) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale || 1, mobile: true, screenOrientation: width > height ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } });
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    },
    async goto(url) {
      const loaded = new Promise((res) => { const fn = () => { res(); }; page.on('Page.loadEventFired', fn); });
      await page.send('Page.navigate', { url });
      await loaded;
    },
    close() { try { ws.close(); } catch (e) { /* closed */ } },
  };
  // collect console errors, uncaught exceptions and failed loads
  page.errors = [];
  page.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error' || p.type === 'assert') page.errors.push('console.' + p.type + ': ' + p.args.map((a) => a.value || a.description).join(' ')); });
  page.on('Runtime.exceptionThrown', (p) => page.errors.push('exception: ' + (p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text)));
  page.on('Log.entryAdded', (p) => { if (p.entry.level === 'error') page.errors.push('log: ' + p.entry.text + (p.entry.url ? ' ' + p.entry.url : '')); });
  await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Log.enable');
  return page;
}

module.exports = { serve, launch, openPage, sleep, kill };
