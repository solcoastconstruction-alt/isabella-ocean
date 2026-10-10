// The fairy art contact sheet in headless Chrome: loads web/fairy/sheet.html, fails on any JavaScript
// exception or console error, checks window.FairyArt exposes the whole API, and saves two pictures:
//   .local/shots/fairy-sheet.png   (1920x1080, every drawable)
//   .local/shots/fairy-poses.png   (just Isabella the Fairy's poses, large)
//   node test/fairy/sheet.js [screenshotDir]          (DevTools port 9490, its own throwaway profile)
'use strict';
const fs = require('fs'), path = require('path');
const { launch, sleep } = require('../paywall/cdp.js');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '.local/shots'));
const PROFILE = path.join(ROOT, '.local/chrome-fairy');
const PAGE = 'file://' + path.join(ROOT, 'web/fairy/sheet.html');
const API = ['drawFairy', 'drawWings', 'drawSparkles', 'drawDust', 'drawSky', 'drawCloud', 'drawRainbow', 'drawRainbowRibbon', 'drawWaterfall',
  'drawTree', 'drawMushroom', 'drawFlower', 'drawGrass', 'drawLilyPad', 'drawCoin', 'drawKey', 'drawChest', 'drawButterfly', 'drawBug',
  'drawCritter', 'drawFirefly', 'drawHand', 'setupCanvas'];

let pass = 0, fail = 0, chrome = null;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail != null ? `  (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`);
}

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const cdp = await launch({ port: 9490, profile: PROFILE, width: 1920, height: 1080 });
  chrome = cdp.proc;
  const problems = [];
  cdp.on('Runtime.exceptionThrown', (p) => problems.push('exception: ' + ((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text)));
  cdp.on('Runtime.consoleAPICalled', (p) => { if (/^(error|warning|assert)$/.test(p.type)) problems.push('console.' + p.type + ': ' + p.args.map((a) => (a.value != null ? a.value : a.description)).join(' ')); });
  cdp.on('Log.entryAdded', (p) => { if (/^(error|warning)$/.test(p.entry.level)) problems.push('log.' + p.entry.level + ': ' + p.entry.text + (p.entry.url ? ' ' + p.entry.url : '')); });
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: PAGE });
  await loaded; await sleep(300);

  check('sheet.html loads and draws', await cdp.eval('window.__sheetReady === true'));
  const missing = await cdp.eval(`(${JSON.stringify(API)}).filter((n) => typeof (window.FairyArt || {})[n] !== 'function')`);
  check('FairyArt exposes every drawing function', Array.isArray(missing) && missing.length === 0, missing);
  const data = await cdp.eval(`(() => { const F = window.FairyArt; return { rainbow: F.RAINBOW, themes: F.THEMES.length, pal: !!F.PAL && Array.isArray(F.PAL.wing) }; })()`);
  check('RAINBOW, PAL and THEMES are there', data.rainbow.length === 7 && data.themes >= 8 && data.pal, data);

  // the sheet is not blank
  const painted = await cdp.eval(`(() => { const c = document.getElementById('c'), g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] !== 255 || d[i + 1] !== 255 || d[i + 2] !== 255) n++; return n; })()`);
  check('the sheet is painted', painted > 1000, painted);

  const full = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 } });
  const f1 = path.join(OUT, 'fairy-sheet.png');
  fs.writeFileSync(f1, Buffer.from(full.data, 'base64'));

  await cdp.eval('window.drawPoses(0.7)');
  const poses = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1920, height: 800, scale: 1 } });
  const f2 = path.join(OUT, 'fairy-poses.png');
  fs.writeFileSync(f2, Buffer.from(poses.data, 'base64'));

  await sleep(200);
  check('no JavaScript exception or console error', problems.length === 0, problems.slice(0, 5));
  check('screenshots saved', fs.statSync(f1).size > 20000 && fs.statSync(f2).size > 20000, [fs.statSync(f1).size, fs.statSync(f2).size]);
  console.log('PNG ' + f1);
  console.log('PNG ' + f2);
  console.log(`${pass} passed, ${fail} failed`);
  try { await cdp.close(); } catch (e) { /* gone */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL  ' + ((e && e.stack) || e)); try { if (chrome) chrome.kill(); } catch (_) { /* gone */ } process.exit(1); });
