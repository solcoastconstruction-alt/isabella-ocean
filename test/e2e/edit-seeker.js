// Edits the real-Seeker take (record-seeker.js) into the CLOCK IN demo (≤3 min):
// a title card, the footage with a short caption per step, each wallet round played 2× (wallet
// visits zoomed so the Seed Vault sheets can be read), the owner's other wallet name blurred
// wherever the wallet picker shows it, and an end card. Labels are rendered by headless Chrome.
// Run: node test/e2e/edit-seeker.js [log] [raw mp4]  → .local/demo/isabella-ocean-seeker-demo.mp4
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { launch } = require('../paywall/cdp.js');

const OUT = path.join(__dirname, '../../.local/demo');
const LOG = process.argv[2] || path.join(OUT, 'seeker.log');
const RAW = process.argv[3] || path.join(OUT, 'isabella-ocean-seeker-raw.mp4');
const TITLE_S = 3.5, END_S = 3, WALLET_SPEED = 2;

const meta = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', RAW], { encoding: 'utf8' }).stdout);
const W = meta.streams[0].width, H = meta.streams[0].height, DUR = +meta.format.duration;
const ev = fs.readFileSync(LOG, 'utf8').split('\n').map((l) => l.match(/\[video ([\d.]+)s\]\s+(.*)$/)).filter(Boolean).map((m) => ({ t: +m[1], what: m[2] }));
const at = (re, from = 0) => { const e = ev.find((x) => x.t >= from && re.test(x.what)); if (!e) throw new Error(`no event ${re}`); return e.t; };

// Wallet rounds: from the first "wallet on screen" to the last "back in the app" of each action.
const rounds = ['stake', 'exit', 'buy'].map((k) => {
  const on = ev.filter((x) => x.what.startsWith(`${k}: wallet on screen`)).map((x) => x.t);
  const back = ev.filter((x) => x.what === `${k}: back in the app`).map((x) => x.t);
  const visits = on.map((a) => [a - 0.2, (back.find((b) => b > a) || a + 2) + 0.3]);
  return { k, a: visits[0][0], b: visits[visits.length - 1][1], visits };
});
const LABEL = {
  stake: 'Seed Vault: connect "Main Wallet", then approve the 1.01 SOL deposit',
  exit: 'Seed Vault: approve the instant exit (0.3% fee)',
  buy: 'Seed Vault: pick "Main Wallet", then approve the payment',
};

// Captions by raw time, on the normal-speed footage only.
const caps = [
  [0.4, at(/^World 1/), 'Four ad-free ocean games, on a real Solana Seeker'],
  [at(/^World 1/), at(/^World 2 \(locked\)/), 'World 1 is free'],
  [at(/^World 2 \(locked\)/), at(/^World 2 \(locked\)/) + 4.5, 'World 2 asks a grown-up'],
  [at(/^World 2 \(locked\)/) + 4.5, at(/^the unlock screen$/), 'The parent gate: hold, then solve a sum'],
  [at(/^the unlock screen$/), rounds[0].a, 'Stake 1 SOL and get it back any time, or pay once'],
  [rounds[0].b, at(/^level 11/), 'Staked: World 2 opens. The staking yield pays for the game'],
  [at(/^level 11/), at(/^swam for a bit/), 'World 2, level 11'],
  [at(/^title$/), at(/^grown-ups: Staked/), 'Grown-ups, behind the same parent gate'],
  [at(/^grown-ups: Staked/), rounds[1].a, 'Staked ✓  Get your SOL back any time'],
  [rounds[1].b, rounds[1].b + 6, 'SOL back in the wallet. World 2 locks again'],
  [at(/^the unlock screen again/), rounds[2].a, 'Or pay once, in any token (devnet demo: 0.1 SOL)'],
  [rounds[2].b, DUR, 'Paid once: World 2 is open for good'],
].filter(([a, b]) => b - a > 0.8);

// The owner's other wallet name shows in the Seed Vault wallet picker: blur that card wherever the
// picker is on screen (found frame by frame in this take; widen the windows for a new take).
const PW = Math.round((H * H) / W), PX = Math.round((W - PW) / 2);
const pickers = [rounds[0].visits[0][0], rounds[2].visits[0][0]];
const BLURS = [
  // generous margins: a first edit leaked the name for ~0.5 s before the second picker's window
  { x: PX + 6, y: 640, w: PW - 12, h: H - 640, wins: [[pickers[0] + 8.8, pickers[0] + 12.8], [pickers[1] + 5.0, pickers[1] + 10.6]] },   // "select a wallet": the big card
  { x: PX + 6, y: 820, w: PW - 12, h: H - 820, wins: [[pickers[0] + 11.4, pickers[0] + 15.2], [pickers[1] + 9.2, pickers[1] + 13.8]] },  // "continue with": the small card
];

(async () => {
  // Labels and cards as PNGs.
  const cdp = await launch({ port: 9472, profile: path.join(OUT, '.chrome-seeker'), width: W, height: H });
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  const font = "font-family:-apple-system,'SF Pro Rounded','Arial Rounded MT Bold',sans-serif";
  async function render(html, file, clip) {
    await cdp.navigate('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    fs.writeFileSync(path.join(OUT, file), Buffer.from(r.data, 'base64'));
  }
  const pill = (text, bg, size) => `<body style="margin:0;${font}"><div style="position:absolute;left:0;top:0;width:${W}px;height:140px;display:flex;align-items:center;justify-content:center">
    <div style="background:${bg};color:#fff;border-radius:70px;padding:24px 52px;font-size:${size}px;font-weight:700;letter-spacing:.3px">${text}</div></div></body>`;
  for (let i = 0; i < caps.length; i++) await render(pill(caps[i][2], 'rgba(10,30,60,.86)', 46), `cap${i}.png`, { x: 0, y: 0, width: W, height: 140 });
  for (const k of Object.keys(LABEL)) await render(pill(`⏩ ${WALLET_SPEED}× &nbsp;<span style="font-weight:500">${LABEL[k]}</span>`, 'rgba(10,30,60,.86)', 40), `wl-${k}.png`, { x: 0, y: 0, width: W, height: 140 });
  await render(`<body style="margin:0;width:${W}px;height:${H}px;${font};background:linear-gradient(180deg,#0b4f8a 0%,#0a7bbd 55%,#3fc1d9 100%);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
    <div style="font-size:150px;font-weight:800;letter-spacing:2px;text-shadow:0 8px 0 rgba(0,0,0,.18)">Isabella Ocean</div>
    <div style="font-size:58px;font-weight:600;margin-top:28px">Ad-free kids' games for the Solana Seeker</div>
    <div style="font-size:46px;margin-top:22px;opacity:.95">Stake 1 SOL to unlock, get it back any time · or pay once</div>
    <div style="position:absolute;bottom:60px;font-size:36px;opacity:.85">Recorded on a Solana Seeker · Seed Vault Wallet · Solana devnet</div></body>`, 'seeker-title.png');
  await render(`<body style="margin:0;width:${W}px;height:${H}px;${font};background:linear-gradient(180deg,#0b4f8a 0%,#0a7bbd 55%,#3fc1d9 100%);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
    <div style="font-size:120px;font-weight:800">Isabella Ocean</div>
    <div style="font-size:56px;margin-top:30px;font-weight:600">isabellaocean-app.pages.dev</div>
    <div style="font-size:40px;margin-top:22px;opacity:.9">Mobile Wallet Adapter · Seed Vault · our own SPL stake pool</div></body>`, 'seeker-end.png');
  await cdp.close();

  // Parts of the take: normal, or a wallet round at 2× (visits zoomed, the in-app moments between them not).
  const parts = [];
  let t = 0;
  for (const r of rounds) {
    if (r.a > t) parts.push({ a: t, b: r.a, kind: 'normal' });
    let u = r.a;
    for (const [va, vb] of r.visits) {
      if (va > u) parts.push({ a: u, b: va, kind: 'between', round: r.k });
      parts.push({ a: Math.max(va, u), b: vb, kind: 'visit', round: r.k });
      u = vb;
    }
    t = r.b;
  }
  if (t < DUR) parts.push({ a: t, b: DUR, kind: 'normal' });

  const inputs = ['-i', RAW, '-loop', '1', '-t', String(TITLE_S), '-i', path.join(OUT, 'seeker-title.png'), '-loop', '1', '-t', String(END_S), '-i', path.join(OUT, 'seeker-end.png')];
  const idx = {};
  for (const k of Object.keys(LABEL)) { idx[`wl-${k}`] = inputs.filter((x) => x === '-i').length; inputs.push('-i', path.join(OUT, `wl-${k}.png`)); }
  caps.forEach((c, i) => { idx[`cap${i}`] = inputs.filter((x) => x === '-i').length; inputs.push('-i', path.join(OUT, `cap${i}.png`)); });

  const f = [];
  // 1. blur the other wallet's name, by raw time
  f.push(`[0:v]split=${BLURS.length + 1}[base]${BLURS.map((_, i) => `[c${i}]`).join('')}`);
  BLURS.forEach((b, i) => f.push(`[c${i}]crop=${b.w}:${b.h}:${b.x}:${b.y},boxblur=28:3[bl${i}]`));
  let cur = 'base';
  BLURS.forEach((b, i) => { const en = b.wins.map(([a, z]) => `between(t,${a.toFixed(2)},${z.toFixed(2)})`).join('+'); f.push(`[${cur}][bl${i}]overlay=${b.x}:${b.y}:enable='${en}'[bo${i}]`); cur = `bo${i}`; });
  // 2. step captions, by raw time
  caps.forEach(([a, b], i) => { f.push(`[${cur}][${idx[`cap${i}`]}:v]overlay=0:H-h-46:enable='between(t,${a.toFixed(2)},${b.toFixed(2)})'[cc${i}]`); cur = `cc${i}`; });
  // 3. cut into parts
  f.push(`[${cur}]split=${parts.length}${parts.map((_, i) => `[p${i}]`).join('')}`);
  parts.forEach((p, i) => {
    const speed = p.kind === 'normal' ? 1 : WALLET_SPEED;
    let s = `[p${i}]trim=start=${p.a.toFixed(2)}:end=${p.b.toFixed(2)},setpts=(PTS-STARTPTS)/${speed}`;
    if (p.kind === 'visit') s += `,crop=${PW}:${H - 380}:${PX}:380,scale=-2:${H},pad=${W}:${H}:(ow-iw)/2:0:color=0x0b1a2a`;
    if (p.kind === 'normal') { f.push(`${s},format=yuv420p[s${i}]`); return; }
    f.push(`${s}[s${i}r]`, `[s${i}r][${idx[`wl-${p.round}`]}:v]overlay=0:30,format=yuv420p[s${i}]`);
  });
  f.push(`[1:v]scale=${W}:${H},fps=30,format=yuv420p,trim=duration=${TITLE_S},setpts=PTS-STARTPTS[title]`);
  f.push(`[2:v]scale=${W}:${H},fps=30,format=yuv420p,trim=duration=${END_S},setpts=PTS-STARTPTS[end]`);
  f.push(`[title]${parts.map((_, i) => `[s${i}]`).join('')}[end]concat=n=${parts.length + 2}:v=1:a=0[out]`);

  const out = path.join(OUT, 'isabella-ocean-seeker-demo.mp4');
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', f.join(';'), '-map', '[out]', '-r', '30', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { encoding: 'utf8' });
  if (ff.status !== 0) throw new Error(`ffmpeg failed: ${ff.stderr.slice(-1500)}`);
  const len = +spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout;
  console.log(`raw ${DUR.toFixed(1)}s → edited ${len.toFixed(1)}s; wallet rounds at ${WALLET_SPEED}×: ${rounds.map((r) => `${r.k} ${r.a.toFixed(1)}–${r.b.toFixed(1)}s`).join(', ')}`);
  console.log(`blurred windows (raw s): ${BLURS.map((b) => b.wins.map(([a, z]) => `${a.toFixed(1)}–${z.toFixed(1)}`).join(' ')).join(' | ')}`);
  console.log(out);
  process.exit(0);
})().catch((e) => { console.error('EDIT FAILED:', e.message); process.exit(1); });
