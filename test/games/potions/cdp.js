// Minimal Chrome DevTools Protocol helper for the Potion Colours headless checks.
// No dependencies: Node 22+ (global WebSocket and fetch) and a local Chrome.
const { spawn } = require('child_process');

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Start headless Chrome with its own debugging port and profile, and attach to its first tab.
async function launch({ port, profile, width, height }) {
  const args = ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'];
  const proc = spawn(CHROME, args, { stdio: 'ignore' });
  let page = null;
  for (let i = 0; i < 150 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch (e) { /* not up yet */ }
    if (!page) await sleep(100);
  }
  if (!page) { proc.kill(); throw new Error(`Chrome did not open port ${port}`); }
  const cdp = await connect(page.webSocketDebuggerUrl);
  cdp.proc = proc;
  return cdp;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url), pending = new Map(), handlers = [];
    let id = 0;
    const api = {
      send(method, params = {}) {
        const i = ++id;
        ws.send(JSON.stringify({ id: i, method, params }));
        return new Promise((res, rej) => pending.set(i, { res, rej, method }));
      },
      on(fn) { handlers.push(fn); },
      // resolve with the params of the next `method` event
      once(method, ms = 15000) {
        return new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error(`timed out waiting for ${method}`)), ms);
          const h = (m) => { if (m.method === method) { clearTimeout(t); handlers.splice(handlers.indexOf(h), 1); res(m.params); } };
          handlers.push(h);
        });
      },
      close() { try { ws.close(); } catch (e) { /* already closed */ } },
    };
    ws.onopen = () => resolve(api);
    ws.onerror = () => reject(new Error('CDP websocket error'));
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        if (m.error) p.rej(new Error(`${p.method}: ${m.error.message}`)); else p.res(m.result);
      } else if (m.method) for (const h of handlers.slice()) h(m);
    };
  });
}

module.exports = { launch, sleep };
