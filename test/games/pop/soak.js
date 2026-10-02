// Long-play check for Isabella's Bubble Party: real taps through all five seas and back to the first.
//   node test/games/pop/soak.js <screenshotDir> <chromeProfileDir>
// Screenshots each sea, measures the frame rate in every sea, and checks that nothing piles up
// (particles, leaving friends, bubbles) and that the page logs no errors or warnings.
const fs = require('fs'), os = require('os'), path = require('path');
const { launch, sleep } = require('./cdp');

const ROOT = path.resolve(__dirname, '../../..');
const PAGE = 'file://' + path.join(ROOT, 'web/games/pop/index.html');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'pop-soak'));
const PROFILE = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'chrome-pop'));
const W = 1335, HT = 600;

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const cdp = await launch({ port: 9451, profile: PROFILE, width: W, height: HT });
  const problems = [];
  cdp.on((m) => {
    const p = m.params || {};
    if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + ((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && /error|warning|assert/.test(p.type)) problems.push('console.' + p.type + ': ' + p.args.map((a) => a.value).join(' '));
    if (m.method === 'Log.entryAdded' && /error|warning/.test(p.entry.level)) problems.push('log.' + p.entry.level + ': ' + p.entry.text);
  });
  try {
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 10 });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: HT, deviceScaleFactor: 1, mobile: false });
    const ev = async (e) => { const r = await cdp.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(e + ': ' + r.exceptionDetails.text); return r.result.value; };
    const D = (e) => ev('window.__popDebug.' + e);
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: PAGE });
    await loaded; await sleep(1200);
    const tap = async (pts) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const fpsExpr = `new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); })`;
    const peak = { parts: 0, leavers: 0, bubbles: 0 }, seas = [];
    const t0 = Date.now();
    let lastScene = -1, changes = 0;
    while (changes < 5 && Date.now() - t0 < 300000) { // five changes: through all five seas and back to the first
      const st = await D('state()');
      peak.parts = Math.max(peak.parts, st.parts); peak.leavers = Math.max(peak.leavers, st.leavers); peak.bubbles = Math.max(peak.bubbles, st.bubbles);
      if (st.scene !== lastScene && st.phase === 'play') {
        if (lastScene >= 0) changes++;
        lastScene = st.scene;
        await sleep(1500);
        const fps = await ev(fpsExpr), perf = await D('perf()');
        const shot = path.join(OUT, `sea-${changes}-${st.sceneId}.png`);
        fs.writeFileSync(shot, Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        seas.push({ visit: changes, scene: st.scene, sea: st.sceneId, fps: +fps.toFixed(1), workP95ms: +perf.p95Ms.toFixed(2), shot });
        console.log(`sea ${st.scene} (${st.sceneId}): ${fps.toFixed(1)} fps, game work p95 ${perf.p95Ms.toFixed(2)} ms  -> ${path.basename(shot)}`);
        continue;
      }
      if (st.phase === 'play') {
        // two fingers at a time on the visible bubbles (staying clear of the home button)
        const bs = (await D('bubbles()')).filter((b) => b.visible && b.cy > 40 && b.cy < HT * 0.72 && !(b.cx < 200 && b.cy < 170));
        if (bs.length) await tap(bs.slice(0, 2).map((b) => ({ x: b.cx, y: b.cy })));
      }
      await sleep(220);
    }
    const st = await D('state()'), c = await D('counters'), saved = JSON.parse(await D('saved()'));
    const report = { seconds: Math.round((Date.now() - t0) / 1000), seas, peak, counters: c, final: { scene: st.scene, sceneId: st.sceneId, total: st.total, filled: saved.filled }, problems };
    fs.writeFileSync(path.join(OUT, 'soak.json'), JSON.stringify(report, null, 2));
    const visited = new Set(seas.map((s) => s.sea));
    const wrapped = seas.length === 6 && seas[5].scene === 0;
    const ok = visited.size === 5 && wrapped && problems.length === 0 && peak.parts < 600 && peak.leavers < 40 && peak.bubbles < 14 && seas.every((s) => s.fps >= 55);
    console.log(JSON.stringify({ seconds: report.seconds, seasVisited: [...visited], wrappedToFirst: wrapped, peak, pops: c.pops, scenes: c.scenes, filled: saved.filled, problems: problems.length }));
    console.log(ok ? 'SOAK PASS' : 'SOAK FAIL');
    cdp.close(); cdp.proc.kill();
    process.exit(ok ? 0 : 1);
  } catch (e) { console.error('soak crashed:', e); cdp.proc.kill(); process.exit(2); }
})();
