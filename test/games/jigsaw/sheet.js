// Sea Jigsaw: the contact sheet. Opens test/games/jigsaw/sheet.html in headless Chrome and saves pictures of it.
//   node test/games/jigsaw/sheet.js [outDir] [chromeProfileDir] [id ...]
//   (defaults: <repo>/.local/shots and <repo>/.local/chrome-jigsaw-sheet; DevTools port 9481)
// With no ids: contact-sheet.png (all thirty pictures), contact-sheet-cuts.png (with the jigsaw cuts drawn over
// them), and the measurements browser.js checks, printed as a table. With ids (e3 h10 ...): picture-<id>.png and
// picture-<id>-cut.png, each full size.
'use strict';
const fs = require('fs'), path = require('path');
const { launch, sleep } = require('./cdp');

const ROOT = path.resolve(__dirname, '../../..');
const SHEET = 'file://' + path.join(__dirname, 'sheet.html');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '.local/shots'));
const PROFILE = path.resolve(process.argv[3] || path.join(ROOT, '.local/chrome-jigsaw-sheet'));
const IDS = process.argv.slice(4);
const PORT = 9481;

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const cdp = await launch({ port: PORT, profile: PROFILE, width: 1900, height: 1100 });
  try {
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    const problems = [];
    cdp.on((m) => { if (m.method === 'Runtime.exceptionThrown') problems.push((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text); });
    const ev = async (e) => { const r = await cdp.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '')); return r.result.value; };
    async function open(query, w, h) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      const loaded = cdp.once('Page.loadEventFired');
      await cdp.send('Page.navigate', { url: SHEET + query });
      await loaded; await sleep(300);
    }
    async function shot(name, w, h) {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
      const f = path.join(OUT, name + '.png');
      fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
      console.log('saved', f);
    }
    if (IDS.length) {
      for (const id of IDS) {
        await open(`?id=${id}`, 856, 544); await shot(`picture-${id}`, 856, 544);
        await open(`?id=${id}&cuts=1`, 856, 544); await shot(`picture-${id}-cut`, 856, 544);
      }
    } else {
      const W = 6 * 300 + 5 * 10 + 24, H = 5 * 187.5 + 4 * 10 + 24;
      await open('', W, Math.ceil(H)); await shot('contact-sheet', W, Math.ceil(H));
      const m = await ev('window.__sheet.metrics()');
      await open('?cuts=1', W, Math.ceil(H)); await shot('contact-sheet-cuts', W, Math.ceil(H));
      console.log('\nid    picture      biggest empty square (units, share of a piece, where)   barest piece (strong edges)   weak / strong edges');
      for (const r of m.rows) console.log(`${r.id.padEnd(5)} ${r.pic.padEnd(12)} ${String(r.flatUnits).padStart(4)}  ${r.flatShare.toFixed(2)}  at ${r.flatAt.padEnd(9)}                             ${(r.least * 100).toFixed(1).padStart(5)}% at ${r.leastAt.padEnd(5)}             ${(r.weakShare * 100).toFixed(1)}% / ${(r.strongShare * 100).toFixed(1)}%`);
      console.log(`\n${m.distinctHashes}/30 different pictures; the two most alike are ${m.closest.a} and ${m.closest.b} (thumbnail difference ${m.closest.d} of 255)`);
    }
    if (problems.length) { console.log('PAGE ERRORS:\n' + problems.join('\n')); process.exitCode = 1; }
  } finally { cdp.close(); cdp.proc.kill(); }
})().catch((e) => { console.error('sheet crashed:', e); process.exit(2); });
