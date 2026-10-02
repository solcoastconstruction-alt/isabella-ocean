// A tiny Chrome DevTools Protocol client (Node 22+, no dependencies): launch headless Chrome on its
// own port and profile, open a page, evaluate, tap/hold real mouse input at an element, screenshot.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch({ port = 9450, profile, width = 1335, height = 600, chrome = process.env.CHROME || MAC_CHROME }) {
  fs.mkdirSync(profile, { recursive: true });
  const proc = spawn(chrome, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', '--disable-extensions',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '', exited = null;
  // Never leave a headless Chrome holding the port: kill it however this process ends.
  process.on('exit', () => { try { proc.kill(); } catch (e) { /* gone */ } });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130));
  process.stdout.on('error', () => process.exit(1));   // e.g. piped into `head`
  proc.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  proc.on('exit', (code, sig) => { exited = `${code}/${sig}`; });
  proc.on('error', (e) => { exited = e.message; });
  let version = null;
  for (let i = 0; i < 200 && !version && !exited; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch (e) { await sleep(100); }
  }
  if (!version) { proc.kill(); throw new Error(`Chrome did not open port ${port} (exit ${exited})\n${stderr}`); }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const cdp = await connect(page.webSocketDebuggerUrl);
  cdp.proc = proc;
  cdp.close = async () => { try { await cdp.send('Browser.close'); } catch (e) { /* already gone */ } cdp.ws.close(); setTimeout(() => proc.kill(), 500); };
  return cdp;
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let nextId = 1;
  const pending = new Map(), handlers = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      if (m.error) rej(new Error(`${m.error.message} ${m.error.data || ''}`)); else res(m.result);
    } else if (m.method) (handlers.get(m.method) || []).forEach((fn) => fn(m.params));
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const on = (method, fn) => { if (!handlers.has(method)) handlers.set(method, []); handlers.get(method).push(fn); };
  const once = (method) => new Promise((res) => { const fn = (p) => { const l = handlers.get(method); l.splice(l.indexOf(fn), 1); res(p); }; on(method, fn); });

  const cdp = { ws, send, on, once };
  // Evaluate in the page; awaits promises; returns the value (throws on a page exception).
  cdp.eval = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`page threw: ${(r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text}\n  in: ${expression.slice(0, 200)}`);
    return r.result.value;
  };
  cdp.waitFor = async (expression, timeout = 8000, what) => {
    const t0 = Date.now();
    for (;;) {
      let v = false;
      try { v = await cdp.eval(expression); } catch (e) { v = false; }
      if (v) return v;
      if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${what || expression}`);
      await sleep(50);
    }
  };
  cdp.viewport = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  cdp.navigate = async (url) => {
    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url });
    await loaded;
  };
  // Centre of the element, but only if it is really the thing on top there (an overlay can't hide it).
  cdp.center = async (selector) => {
    const r = await cdp.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { err: 'missing' };
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) return { err: 'not visible' };
      const x = b.left + b.width / 2, y = b.top + b.height / 2, top = document.elementFromPoint(x, y);
      if (!top || !(top === el || el.contains(top))) return { err: 'covered by ' + (top ? top.outerHTML.slice(0, 80) : 'nothing') };
      return { x, y };
    })()`);
    if (r.err) throw new Error(`cannot tap ${selector}: ${r.err}`);
    return r;
  };
  cdp.tap = async (selector) => {
    const { x, y } = await cdp.center(selector);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(60);
  };
  cdp.hold = async (selector, ms) => {
    const { x, y } = await cdp.center(selector);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(ms);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(60);
  };
  cdp.shot = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  };
  return cdp;
}

module.exports = { launch, connect, sleep };
