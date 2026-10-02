// Edits a take from record-demo.js into the shareable demo: a title card, then the take with each
// long wait on devnet or the wallet (over 6 s, after an approval, a check or a send) sped up 4×
// under a visible "4×" label. Everything a parent does plays at normal speed.
// The labels are rendered by headless Chrome (this ffmpeg has no drawtext).
// Run: node test/e2e/edit-demo.js <record-demo log> [raw .mp4]  → .local/demo/isabella-ocean-demo.mp4
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { launch } = require('../paywall/cdp.js');

const OUT = path.join(__dirname, '../../.local/demo');
const [logFile, rawArg] = process.argv.slice(2);
if (!logFile) { console.error('usage: node test/e2e/edit-demo.js <record-demo log> [raw.mp4]'); process.exit(2); }
const RAW = rawArg || path.join(OUT, 'isabella-ocean-emulator.mp4');
const FAST = 4, GAP = 6, KEEP = 1.2, TITLE_S = 4;

const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', RAW], { encoding: 'utf8' });
const meta = JSON.parse(probe.stdout);
const W = meta.streams[0].width, H = meta.streams[0].height, DUR = +meta.format.duration;

// Events with their time in the video, then the long gaps between them.
const events = fs.readFileSync(logFile, 'utf8').split('\n')
  .map((l) => l.match(/\[video ([\d.]+)s\]\s+(.*)$/)).filter(Boolean).map((m) => ({ t: +m[1], what: m[2] }));
if (events.length < 5) throw new Error(`only ${events.length} timed events in ${logFile}; is it a record-demo log?`);
// Only stretches where the app waits on the network or the wallet: they start at one of these.
const WAITS_AFTER = [/tapped AUTHORIZE/, /tapped SEND TRANSACTION/, /^tapped Stake/, /^tapped Pay once/, /^picked a token/,
  /^confirmed: get my SOL back/, /^grown-ups: checking/, /^exit sent/];
const fast = [];
for (let i = 1; i < events.length; i++) {
  const a = events[i - 1].t + KEEP, b = events[i].t - KEEP;
  if (WAITS_AFTER.some((re) => re.test(events[i - 1].what)) && events[i].t - events[i - 1].t > GAP && b - a > 2) fast.push([a, b, `${events[i - 1].what} → ${events[i].what}`]);
}

// The wallet screens are portrait, letterboxed in the landscape take: zoom into their top part so
// they can be read, from each "on screen" to just after its tap (one zoom per wallet visit).
const PW = Math.round((H * H) / W), PX = Math.round((W - PW) / 2), PH = Math.round(PW * 1.1);
const zoom = [];
for (let i = 0; i < events.length; i++) {
  if (!/ on screen$/.test(events[i].what)) continue;
  let j = i + 1;
  while (j < events.length && !/: tapped /.test(events[j].what)) j++;
  if (j >= events.length) break;
  const a = events[i].t - 0.5, b = events[j].t + 0.8, last = zoom[zoom.length - 1];
  if (last && a - last[1] < 5) last[1] = b; else zoom.push([a, b]);
}

(async () => {
  // Labels as transparent PNGs.
  const cdp = await launch({ port: 9471, profile: path.join(OUT, '.chrome'), width: W, height: H });
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  async function render(html, file, clip) {
    await cdp.navigate('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
  const font = "font-family:-apple-system,'SF Pro Rounded','Arial Rounded MT Bold',sans-serif";
  await render(`<body style="margin:0;${font}">
    <div style="position:absolute;left:0;top:0;width:900px;height:120px;display:flex;align-items:center;justify-content:center">
      <div style="background:rgba(10,30,60,.82);color:#fff;border-radius:60px;padding:22px 44px;font-size:44px;font-weight:700;letter-spacing:.5px">
        ⏩ ${FAST}× &nbsp;<span style="font-weight:500;opacity:.85">waiting for Solana devnet</span></div></div></body>`,
  path.join(OUT, 'fast.png'), { x: 0, y: 0, width: 900, height: 120 });
  await render(`<body style="margin:0;width:${W}px;height:${H}px;${font};background:linear-gradient(180deg,#0b4f8a 0%,#0a7bbd 55%,#3fc1d9 100%);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
    <div style="font-size:150px;font-weight:800;letter-spacing:2px;text-shadow:0 8px 0 rgba(0,0,0,.18)">Isabella Ocean</div>
    <div style="font-size:58px;font-weight:600;margin-top:28px">Ad-free kids' games for the Solana Seeker</div>
    <div style="font-size:50px;margin-top:22px;opacity:.95">Stake 1 SOL to unlock, get it back any time · or pay once</div>
    <div style="position:absolute;bottom:60px;font-size:36px;opacity:.8">Devnet demo · Android emulator · Solana Mobile's test wallet · real transactions</div></body>`,
  path.join(OUT, 'title.png'));
  await cdp.close();

  // Title card, then the take: normal speed, except the long waits.
  // Special stretches (sped up, or a zoomed wallet) in time order; fast ones win any overlap.
  const special = fast.map(([a, b]) => [a, b, 'fast']);
  for (const [za, zb] of zoom) {
    let a = Math.max(0, za);
    for (const [fa, fb] of fast) if (fa < zb && fb > a) { if (fa > a) special.push([a, fa, 'zoom']); a = Math.max(a, fb); }
    if (zb > a) special.push([a, Math.min(zb, DUR), 'zoom']);
  }
  special.sort((x, y) => x[0] - y[0]);
  const parts = [], filters = [];
  let t = 0, n = 0;
  for (const [a, b, kind] of special) { if (a > t) parts.push([t, a, 'normal']); if (b > Math.max(a, t)) parts.push([Math.max(a, t), b, kind]); t = Math.max(t, b); }
  if (t < DUR) parts.push([t, DUR, 'normal']);
  filters.push(`[1:v]scale=${W}:${H},fps=30,format=yuv420p,trim=duration=${TITLE_S},setpts=PTS-STARTPTS[title]`);
  for (const [a, b, kind] of parts) {
    const seg = `[0:v]trim=start=${a.toFixed(2)}:end=${b.toFixed(2)},setpts=(PTS-STARTPTS)/${kind === 'fast' ? FAST : 1}`;
    if (kind === 'fast') filters.push(`${seg}[s${n}raw]`, `[s${n}raw][2:v]overlay=x=(W-w)/2:y=40,format=yuv420p[s${n}]`);
    else if (kind === 'zoom') filters.push(`${seg},crop=${PW}:${PH}:${PX}:0,scale=-2:${H},pad=${W}:${H}:(ow-iw)/2:0:color=black,format=yuv420p[s${n}]`);
    else filters.push(`${seg},format=yuv420p[s${n}]`);
    n++;
  }
  filters.push(`[title]${Array.from({ length: n }, (_, i) => `[s${i}]`).join('')}concat=n=${n + 1}:v=1:a=0[out]`);
  const out = path.join(OUT, 'isabella-ocean-demo.mp4');
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', RAW, '-loop', '1', '-t', String(TITLE_S), '-i', path.join(OUT, 'title.png'), '-i', path.join(OUT, 'fast.png'),
    '-filter_complex', filters.join(';'), '-map', '[out]', '-r', '30', '-c:v', 'libx264', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { encoding: 'utf8' });
  if (ff.status !== 0) throw new Error(`ffmpeg failed: ${ff.stderr}`);
  const len = +spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout;
  console.log(`raw ${DUR.toFixed(1)}s → edited ${len.toFixed(1)}s (${fast.length} waits at ${FAST}×, ${zoom.length} wallet zooms):`);
  for (const [a, b, why] of fast) console.log(`  ${a.toFixed(1)}–${b.toFixed(1)}s  ${why}`);
  console.log(out);
  process.exit(0);
})().catch((e) => { console.error('EDIT FAILED:', e.message); process.exit(1); });
