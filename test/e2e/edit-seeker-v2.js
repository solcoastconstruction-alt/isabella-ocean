// Second edit of the real-Seeker take (record-seeker.js): narrated, no flips, no waiting.
//   - The game is landscape and the Seed Vault Wallet is portrait, so the recording rotates at every
//     wallet visit. Here each visit is cut out of the rotation entirely and shown as an upright
//     "phone panel" (the wallet sheet only) over a blurred still of the game screen it came from.
//   - Dead time is cut; the joins are short crossfades. Nothing is sped up.
//   - A voice reads one line per section (macOS `say`; the engine lives in tts() alone).
//   - The owner's other wallet name is blurred in the wallet's account picker (see PRIVACY).
// Run: node test/e2e/edit-seeker-v2.js [--captions] [log] [raw mp4]      VOICE=Karen|Samantha|...
//   → .local/demo/isabella-ocean-seeker-demo-v2.mp4, -v2-preview.mp4, v2-<voice>-sample.m4a
//   → with --captions: isabella-ocean-seeker-demo-v2-captions.mp4 (the same cut, a caption per step)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { launch } = require('../paywall/cdp.js');

const OUT = path.join(__dirname, '../../.local/demo');
const CHECK = path.join(OUT, 'v2-check');          // timeline.json, narration.srt: what the edit decided
const WORK = path.join(CHECK, 'work');             // intermediate clips, labels, speech (safe to delete)
const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const CAPTIONS = flags.includes('--captions');
const LOG = files[0] || path.join(OUT, 'seeker.log');
const RAW = files[1] || path.join(OUT, 'isabella-ocean-seeker-raw.mp4');
const VOICE = process.env.VOICE || 'Karen';
const FPS = 30, LEAD = 0.25, TAIL = 0.4;           // a line starts LEAD into its section and ends TAIL before the next
const COLOR = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
fs.mkdirSync(WORK, { recursive: true });

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: opts.binary ? 'buffer' : 'utf8', maxBuffer: 1 << 28, input: opts.input });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${String(r.stderr || r.error).slice(-1500)}`);
  return opts.stderr ? r.stderr : r.stdout;
}
const hash = (x) => crypto.createHash('sha1').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex').slice(0, 12);
const fr = (s) => Math.round(s * FPS);
const sec = (f) => f / FPS;
const stamp = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;

// ---------------------------------------------------------------------------------------------
// The narration. Display text here; SAY_AS turns it into what the voice is given.
const NARRATION = {
  title: 'Isabella Ocean. Ad-free ocean games for kids, on the Solana Seeker.',
  real: 'This is a real Seeker. The games are free to start and play offline, with no ads, no accounts and no tracking.',
  gate: 'Only World 2 is locked, and it asks for a grown-up: hold for three seconds, then solve a multiplication.',
  choices: 'A parent has two choices. Stake 1 SOL and take it back any time, or pay once.',
  stake: 'First, the stake. The Seed Vault Wallet connects, and the parent approves a deposit into our own stake pool. They can take it back any time. Only the staking rewards pay for the game.',
  open: 'World 2 opens at once. The app reads the unlock straight from the chain. There is no server and no login.',
  exit: 'Getting the SOL back takes one approval, behind the same parent gate. It returns straight away for a fee of 0.3%, or free after about two days.',
  back: 'The SOL is back in the wallet, and World 2 locks again.',
  pay: 'The other choice is to pay once: US$15, in SKR or any verified token, swapped at the moment of purchase. This demo runs on devnet, so it pays in test SOL.',
  paid: 'Paid once, World 2 stays open for good, even after a reinstall.',
  end: "That's Isabella Ocean: kids play without ads, and parents stay in control of their money.",
};
const SAY_AS = [
  [/World 2/g, 'World Two'], [/\b1 SOL\b/g, 'one SOL'], [/0\.3%/g, 'zero point three percent'],
  [/US\$15/g, 'fifteen U S dollars'], [/\bSKR\b/g, 'S K R'], [/\bdevnet\b/g, 'dev net'],
];
const spoken = (text) => SAY_AS.reduce((s, [re, to]) => s.replace(re, to), text);

// The only place that knows which speech engine is used: one line of text in, a mono 48 kHz wav out.
function tts(text, wav) {
  const aiff = wav.replace(/\.wav$/, '.aiff');
  run('say', ['-v', VOICE, '-o', aiff, text]);
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', aiff, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
  fs.unlinkSync(aiff);
}
// A line, trimmed of the engine's leading and trailing silence, with its real length.
function line(id) {
  const text = spoken(NARRATION[id]);
  const wav = path.join(WORK, `say-${VOICE.toLowerCase()}-${hash(text)}.wav`);
  if (!fs.existsSync(wav)) {
    const rawWav = wav.replace(/\.wav$/, '-raw.wav');
    tts(text, rawWav);
    const trim = 'silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.03';
    run('ffmpeg', ['-y', '-loglevel', 'error', '-i', rawWav, '-af', `${trim},areverse,${trim},areverse,afade=t=in:d=0.01`, '-c:a', 'pcm_s16le', wav]);
    fs.unlinkSync(rawWav);
  }
  return { id, text, wav, dur: +run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]) };
}

// ---------------------------------------------------------------------------------------------
// The take, measured.
const meta = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_frames:format=duration', '-of', 'json', RAW]));
const W = meta.streams[0].width, H = meta.streams[0].height, DUR = +meta.format.duration, FRAMES = +meta.streams[0].nb_frames;
// The cut list and the privacy windows below are raw times found in ONE take. A new take needs both
// re-derived, frame by frame, before this may run on it.
const TAKE_FRAMES = 6305;
if (FRAMES !== TAKE_FRAMES) throw new Error(`this cut was written for the ${TAKE_FRAMES}-frame take, not this ${FRAMES}-frame one: re-derive EDL and PRIVACY first`);

// In a wallet visit the phone is portrait: a strip in the middle of the landscape recording.
const SW = 2 * Math.floor((H * H) / W / 2), SX = 2 * Math.round((W - SW) / 4);          // 484 wide at x=960
// Per frame: is the phone portrait, and where is the top of the wallet's sheet in the strip?
function measure() {
  const cache = path.join(WORK, `measure-${hash([RAW, fs.statSync(RAW).size, SW, SX])}.json`);
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, 'utf8'));
  // three one-pixel columns per frame: the strip's middle, the strip's left margin, the frame's left side
  const b = run('ffmpeg', ['-loglevel', 'error', '-i', RAW, '-filter_complex',
    `[0:v]split=3[a][b][c];[a]crop=${SW - 60}:${H}:${SX + 30}:0,scale=1:${H}:flags=area[p];[b]crop=8:${H}:${SX + 3}:0,scale=1:${H}:flags=area[m];` +
    `[c]crop=${SX - 200}:${H}:100:0,scale=1:${H}:flags=area[s];[p][m][s]hstack=inputs=3,format=rgb24[o]`, '-map', '[o]', '-f', 'rawvideo', '-'], { binary: true });
  const size = 3 * H * 3, n = b.length / size, portrait = [], state = [], top = [];
  let held = -1;                                     // the last sheet top seen in this visit
  for (let f = 0; f < n; f++) {
    const px = (col, y) => { const i = f * size + (y * 3 + col) * 3; return [b[i], b[i + 1], b[i + 2]]; };
    const isSheet = ([r, g, bl]) => r >= 8 && g >= 15 && bl <= g + 3;          // the sheet is (12,22,19); the dimmed game above it is (0,3,4)
    let side = 0, mid = 0, foot = [0, 0, 0];
    for (let y = 0; y < H; y += 8) { side += px(2, y)[0] + px(2, y)[1] + px(2, y)[2]; mid = Math.max(mid, px(0, y)[1]); }
    for (let y = H - 40; y < H - 4; y++) px(1, y).forEach((v, k) => { foot[k] += v / 36; });
    portrait.push(side / (3 * Math.ceil(H / 8)) < 2);
    let t = -1;
    for (let y = 34; y < H - 10 && t < 0; y++) { let ok = true; for (let k = 0; k < 6 && ok; k++) ok = isSheet(px(0, y + k)); if (ok) t = y; }
    // 'sheet': a sheet at full brightness. 'modal': the sheet dimmed under a confirmation (its top does not move).
    // 'none': no sheet (the sideways game, the rotation, or the black secure screen).
    const st = !portrait[f] ? 'land' : isSheet(foot) && t > 0 ? 'sheet' : foot[1] < 9 && foot[2] < 9 && mid > 30 ? 'modal' : 'none';
    state.push(st);
    held = st === 'land' ? -1 : st === 'sheet' ? t : held;
    top.push(st === 'sheet' || st === 'modal' ? held : -1);
  }
  const m = { portrait, state, top };
  fs.writeFileSync(cache, JSON.stringify(m));
  return m;
}
const M = measure();
const spans = [];                                    // [first portrait frame, first landscape frame after it]
M.portrait.forEach((p, f) => { if (p && !M.portrait[f - 1]) spans.push([f, f]); if (p) spans[spans.length - 1][1] = f + 1; });
// The log says when the recorder saw the wallet: every one of those must fall in a measured span.
const walletSeen = fs.readFileSync(LOG, 'utf8').split('\n').map((l) => l.match(/\[video ([\d.]+)s\]\s+\w+: wallet on screen/)).filter(Boolean).map((m) => +m[1]);
for (const t of walletSeen) if (!spans.some(([a, b]) => fr(t) >= a - FPS && fr(t) < b)) throw new Error(`the log has the wallet on screen at ${t}s, but the recording is not portrait there`);
const ROT_IN = 11, ROT_OUT = 2;                      // frames of rotation animation before a span / kept clear after it

// ---------------------------------------------------------------------------------------------
// PRIVACY. The wallet's account picker lists the owner's other wallet by name. Two pickers in this
// take. Inside `clear` (the "Continue with" state, standing still) only the small card is blurred;
// anywhere else inside `window` the whole lower sheet is. Strip coordinates, raw seconds.
const PRIVACY = [
  { window: [27.7, 44.2], clear: [41.0, 43.0] },     // stake: connect
  { window: [169.3, 182.5], clear: [179.8, 181.167] }, // pay once: connect
];
const BLUR_CARD = { y: 806, h: 134 }, BLUR_SHEET = { y: 560, h: H - 560 };
function blursFor(a, b) {                            // a, b in frames, b exclusive
  const out = [];
  for (const p of PRIVACY) {
    if (b <= fr(p.window[0]) || a >= fr(p.window[1])) continue;
    out.push(BLUR_CARD);
    if (a < fr(p.clear[0]) || b > fr(p.clear[1])) out.push(BLUR_SHEET);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The cut. Raw seconds. `x` is the crossfade (s) from the previous clip into this one.
//   G: landscape game footage, as recorded.   P: a wallet visit, shown as the phone panel.
//   sec: the narration section that starts with this clip; marks: sections that start inside it.
//   cap / caps: the caption (only with --captions) from this clip's start / from a raw time inside it.
const G = (a, b, o = {}) => ({ kind: 'game', a, b, x: 0.25, ...o });
const P = (a, b, o = {}) => ({ kind: 'wallet', a, b, x: 0.2, ...o });
const CAP = {
  real: 'A real Solana Seeker: ad-free games, free to start',
  w1: 'World 1 is free',
  w2: 'World 2 asks a grown-up',
  gate: 'The parent gate: hold for 3 seconds, then a multiplication',
  choices: 'Stake 1 SOL and take it back any time, or pay once',
  connect: 'Seed Vault Wallet: connect "Main Wallet"',
  deposit: 'Seed Vault Wallet: approve the 1.01 SOL deposit into the stake pool',
  open: 'Staked: World 2 opens',
  play: 'World 2, level 11',
  grown: 'The grown-ups button',
  gate2: 'The same parent gate',
  staked: 'Staked ✓  Get the SOL back any time',
  exit: 'Seed Vault Wallet: approve the instant exit (0.3% fee)',
  back: 'SOL back in the wallet. World 2 locks again',
  pay: 'Or pay once, in any token (devnet demo: 0.1 SOL)',
  payment: 'Seed Vault Wallet: approve the payment',
  paid: 'Paid once: World 2 is open for good',
};
const EDL = [
  { kind: 'card', card: 'title', sec: 'title', x: 0 },
  // title screen → the map opens on World 2 → World 1 → World 2 again, a locked level, "Ask a grown-up"
  G(0.90, 13.55, { x: 0.3, sec: 'real', marks: [[9.10, 'gate']], cap: CAP.real, caps: [[6.50, CAP.w1], [9.10, CAP.w2]] }),
  G(15.50, 19.25, { cap: CAP.gate, at: 'left' }),                                // the hold ring fills (3 s); the sum appears
  G(20.40, 28.40, { marks: [[22.47, 'choices']], cap: CAP.gate, at: 'left', caps: [[22.47, CAP.choices]] }),   // the answer; the two choices; tap Stake; "Connecting to your wallet"
  P(41.00, 43.00, { sec: 'stake', cap: CAP.connect }),                           // Connect: "Continue with Main Wallet", tap Connect
  P(52.50, 56.37, { cap: CAP.deposit }),                                         // Transaction: -1.01 SOL, +1.01 OCEAN; trust; tap Approve
  P(57.40, 58.85, { cap: CAP.deposit }),                                         // "Double tap to confirm"
  P(59.90, 61.60, { cap: CAP.deposit }),                                         // fingerprint: "Approved"
  P(64.60, 69.40, { cap: CAP.deposit }),                                         // Processing → Success
  G(72.70, 77.00, { x: 0.3, sec: 'open', cap: CAP.open }),                       // "Unlocking World 2: checking with Solana" → "World 2!"
  G(79.60, 87.60, { cap: CAP.open, caps: [[80.10, CAP.play]] }),                 // the map, level 11 open → "Level 11" → play
  G(97.15, 98.45, { x: 0.3, sec: 'exit', cap: CAP.grown }),                      // title screen, tap the grown-ups button → the gate
  G(101.55, 103.30, { cap: CAP.gate2, at: 'left' }),                             // the hold ring fills
  G(104.60, 106.80, { cap: CAP.gate2, at: 'left' }),                             // the sum answered
  G(109.10, 115.30, { cap: CAP.staked }),                                        // "Staked ✓" → "Get your SOL back now?" → "Getting your SOL back"
  P(124.53, 126.53, { x: 0.3, cap: CAP.exit }),                                  // Transaction: +1.01 SOL, -1.01 OCEAN; trust; tap Approve
  P(127.80, 128.95, { cap: CAP.exit }),                                          // "Double tap to confirm"
  P(130.40, 131.60, { cap: CAP.exit }),                                          // "Approved"
  P(135.10, 137.95, { marks: [[136.00, 'back']], cap: CAP.exit }),               // Processing → Success (the line waits for Success)
  G(138.55, 141.50, { x: 0.3, cap: CAP.back }),                                  // "Your SOL is back … World 2 is locked again"
  G(147.75, 150.10, { cap: CAP.back }),                                          // World 2: padlocks again → "Ask a grown-up"
  G(158.30, 163.50, { marks: [[159.73, 'pay']], cap: CAP.gate2, at: 'left', caps: [[159.73, CAP.pay]] }),   // the gate's sum → the choices, tap Pay once → "Looking in your wallet"
  G(164.50, 169.00, { cap: CAP.pay }),                                           // choose a token: 0.1 SOL → "Approve the payment in your wallet"
  P(179.80, 181.167, { x: 0.3, cap: CAP.connect }),                              // Connect: "Continue with Main Wallet", tap Connect
  P(185.20, 188.33, { cap: CAP.payment }),                                       // Transaction: -0.1 SOL; trust; tap Approve
  P(189.20, 190.50, { cap: CAP.payment }),                                       // "Double tap to confirm"
  P(191.60, 193.30, { cap: CAP.payment }),                                       // "Approved"
  P(198.00, 201.15, { marks: [[199.70, 'paid']], cap: CAP.payment }),            // Processing → Success (the line waits for Success)
  G(203.27, 209.90, { x: 0.3, cap: CAP.paid }),                                  // "Unlocking World 2" → "World 2!"
  { kind: 'card', card: 'end', sec: 'end', x: 0.3 },
];

// Every clip checked against the measurement: no game clip may touch a rotation or a portrait
// frame, and every frame of a wallet clip must show a sheet (so: never the sideways game).
for (const c of EDL) {
  if (c.kind === 'card') continue;
  c.fa = fr(c.a); c.fb = fr(c.b); c.n = c.fb - c.fa;
  if (c.kind === 'game') {
    const hit = spans.find(([a, b]) => c.fb > a - ROT_IN && c.fa < b + ROT_OUT);
    if (hit) throw new Error(`game clip ${c.a}–${c.b}s touches the rotation around ${sec(hit[0]).toFixed(2)}–${sec(hit[1]).toFixed(2)}s`);
  } else {
    c.span = spans.find(([a, b]) => c.fa >= a && c.fb <= b);
    if (!c.span) throw new Error(`wallet clip ${c.a}–${c.b}s is not inside one wallet visit`);
    for (let f = c.fa; f < c.fb; f++) if (M.top[f] < 0) throw new Error(`wallet clip ${c.a}–${c.b}s: no sheet at ${sec(f).toFixed(3)}s (${M.state[f]})`);
    c.blurs = blursFor(c.fa, c.fb);
  }
}

// The phone panel: the strip from WIN_Y down, enlarged, in the middle of the frame.
const WIN_Y = 292, WIN_H = H - WIN_Y, PH = 1024, PW = 2 * Math.round((SW * PH) / WIN_H / 2), PX = 2 * Math.round((W - PW) / 4), PY = 24, RADIUS = 34;
const SCRIM = '0x000304';                           // what the wallet's scrim leaves of the game above a sheet
for (const c of EDL) if (c.kind === 'wallet') for (let f = c.fa; f < c.fb; f++) if (M.top[f] < WIN_Y) throw new Error(`a sheet reaches above the panel at ${sec(f).toFixed(3)}s`);

(async () => {
  // ---- speech first: the cards last as long as their lines
  const lines = {};
  for (const id of Object.keys(NARRATION)) lines[id] = line(id);

  // ---- the timeline, in output frames
  const xf = (c) => fr(c.x);
  EDL.forEach((c, i) => {
    if (c.kind !== 'card') return;
    const next = EDL[i + 1];
    c.n = fr((c.card === 'title' ? 0.3 : c.x) + lines[c.sec].dur + (next ? 0.45 + next.x : 1.6));
  });
  let cursor = 0;
  EDL.forEach((c, i) => { c.start = cursor - (i ? xf(c) : 0); cursor = c.start + c.n; });
  const TOTAL = cursor;
  const sections = [];
  EDL.forEach((c) => {
    if (c.sec) sections.push({ id: c.sec, start: c.start, raw: c.kind === 'card' ? null : c.a });
    for (const [t, id] of c.marks || []) { if (t < c.a || t >= c.b) throw new Error(`mark ${id} is outside its clip`); sections.push({ id, start: c.start + fr(t) - c.fa, raw: t }); }
  });
  sections.forEach((s, i) => {
    s.end = i + 1 < sections.length ? sections[i + 1].start : TOTAL;
    const first = EDL.find((c) => c.sec === s.id);
    s.lineStart = sec(s.start) + (s.id === 'title' ? 0.3 : first && first.kind === 'card' ? first.x : LEAD);
    s.lineEnd = s.lineStart + lines[s.id].dur;
    if (s.lineEnd + (i + 1 < sections.length ? TAIL - LEAD : 0) > sec(s.end) + 0.02) throw new Error(`"${s.id}" (${lines[s.id].dur.toFixed(2)}s) does not fit its section (${sec(s.end - s.start).toFixed(2)}s): keep more footage there`);
  });
  if (Object.keys(NARRATION).some((id) => !sections.find((s) => s.id === id))) throw new Error('a narration line has no section');

  // ---- labels and cards (headless Chrome)
  const cdp = await launch({ port: 9473, profile: path.join(WORK, '.chrome'), width: W, height: H });
  await cdp.send('Page.enable');
  await cdp.viewport(W, H);                          // the window is shorter than asked for: its viewport is not
  await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  const font = "font-family:-apple-system,'SF Pro Rounded','Arial Rounded MT Bold',sans-serif";
  async function render(html, name, selector) {
    await cdp.navigate('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    let clip;
    if (selector) clip = await cdp.eval(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.floor(b.left), y: Math.floor(b.top), width: 2 * Math.ceil(b.width / 2), height: 2 * Math.ceil(b.height / 2) }; })()`);
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    const file = path.join(WORK, name);
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return { file, w: clip ? clip.width : W, h: clip ? clip.height : H };
  }
  const sea = `margin:0;width:${W}px;height:${H}px;${font};background:linear-gradient(180deg,#0b4f8a 0%,#0a7bbd 55%,#3fc1d9 100%);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center`;
  const cards = {
    title: await render(`<body style="${sea}">
      <div style="font-size:150px;font-weight:800;letter-spacing:2px;text-shadow:0 8px 0 rgba(0,0,0,.18)">Isabella Ocean</div>
      <div style="font-size:62px;font-weight:600;margin-top:30px">Ad-free ocean games for kids, on the Solana Seeker</div>
      <div style="font-size:48px;margin-top:26px;opacity:.95">Stake 1 SOL to unlock and take it back any time · or pay once</div>
      <div style="position:absolute;bottom:64px;font-size:38px;opacity:.85">Recorded on a real Solana Seeker · Seed Vault Wallet · Solana devnet</div></body>`, 'card-title.png'),
    end: await render(`<body style="${sea}">
      <div style="font-size:130px;font-weight:800;text-shadow:0 8px 0 rgba(0,0,0,.18)">Isabella Ocean</div>
      <div style="font-size:70px;margin-top:32px;font-weight:700">isabellaocean-app.pages.dev</div>
      <div style="font-size:48px;margin-top:34px;font-weight:600">Kids play without ads. Parents stay in control of their money.</div>
      <div style="position:absolute;bottom:64px;font-size:38px;opacity:.85">Mobile Wallet Adapter · Seed Vault · our own SPL stake pool</div></body>`, 'card-end.png'),
  };
  // the panel's shape (white on black, used as its alpha), and its shadow and hairline on the backdrop
  const round = await render(`<body style="margin:0;background:#000"><div id="p" style="width:${PW}px;height:${PH}px;background:#000"><div style="width:100%;height:100%;background:#fff;border-radius:${RADIUS}px"></div></div></body>`, 'panel-round.png', '#p');
  const frame = await render(`<body style="margin:0"><div style="position:absolute;left:${PX}px;top:${PY}px;width:${PW}px;height:${PH}px;border-radius:${RADIUS}px;box-shadow:0 0 0 2px rgba(255,255,255,.16),0 24px 90px 10px rgba(0,0,0,.6)"></div></body>`, 'panel-frame.png');
  // captions: a small pill under game footage (or bottom-left where the gate's keypad is), a note beside the panel
  const caps = [];
  if (CAPTIONS) {
    EDL.forEach((c) => {
      const at = c.kind === 'wallet' ? 'side' : c.at || 'bottom';
      if (c.cap) caps.push({ text: c.cap, at, start: c.start + (c.kind === 'card' ? 0 : xf(c)), clip: c });
      for (const [t, text] of c.caps || []) caps.push({ text, at: c.kind === 'wallet' ? 'side' : 'bottom', start: c.start + fr(t) - c.fa, clip: c });
      if (c.kind === 'card' || !c.cap) caps.push({ text: null, start: c.start });
    });
    for (let i = caps.length - 1; i > 0; i--) if (caps[i].text === caps[i - 1].text && caps[i].at === caps[i - 1].at) caps.splice(i, 1);   // one caption across its clips
    caps.forEach((k, i) => { k.end = i + 1 < caps.length ? caps[i + 1].start : TOTAL; });
    for (const k of caps.filter((x) => x.text)) {
      const box = k.at === 'side'
        ? `<div id="c" style="display:inline-block;max-width:${PX - 220}px;background:rgba(6,20,40,.78);color:#fff;border-radius:28px;padding:22px 32px;font-size:38px;font-weight:600;line-height:1.3;text-align:center">${k.text}</div>`
        : `<div id="c" style="display:inline-block;background:rgba(10,30,60,.86);color:#fff;border-radius:60px;padding:16px 38px;font-size:36px;font-weight:700;letter-spacing:.3px;white-space:nowrap">${k.text}</div>`;
      Object.assign(k, await render(`<body style="margin:0;${font}"><div style="padding:8px">${box}</div></body>`, `cap-${hash([k.text, k.at, PX])}.png`, '#c'));
      k.x = k.at === 'side' ? Math.round((PX - k.w) / 2) : k.at === 'left' ? 70 : Math.round((W - k.w) / 2);
      k.y = k.at === 'side' ? Math.round((H - k.h) / 2) : H - k.h - 40;
    }
  }
  await cdp.close();

  // ---- every clip rendered on its own, to an intermediate file with exactly its frames
  const x264 = ['-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '8', '-bf', '0', '-pix_fmt', 'yuv420p', ...COLOR];
  const seek = (f) => ['-ss', ((f - 0.5) / FPS).toFixed(4)];        // half a frame early: the first frame decoded is frame f
  const fixed = `setpts=N/${FPS}/TB`;
  EDL.forEach((c, i) => {
    let a, extra = '';
    if (c.kind === 'card') {
      a = ['-loop', '1', '-framerate', String(FPS), '-i', cards[c.card].file, '-vf', `scale=${W}:${H}:out_color_matrix=bt709:out_range=tv,format=yuv420p`];
    } else if (c.kind === 'game') {
      a = [...seek(c.fa), '-i', RAW, '-vf', `${fixed},format=yuv420p`];
    } else {
      // The sheet only: everything above its top edge (the game, drawn sideways and dimmed) becomes plain scrim.
      const mask = Buffer.alloc(c.n * H);
      for (let k = 0; k < c.n; k++) mask.fill(255, k * H + M.top[c.fa + k] + 2, (k + 1) * H);
      const maskFile = path.join(WORK, `mask-${i}.gray`);
      fs.writeFileSync(maskFile, mask);
      extra = hash(mask.toString('base64'));
      const f = [`[0:v]${fixed},crop=${SW}:${H}:${SX}:0[s0]`];
      c.blurs.forEach((b, k) => f.push(`[s${k}]split[k${k}][j${k}]`, `[j${k}]crop=${SW}:${b.h}:0:${b.y},scale=30:8:flags=area,scale=${SW}:${b.h}:flags=bilinear,boxblur=8:2[q${k}]`, `[k${k}][q${k}]overlay=0:${b.y}[s${k + 1}]`));
      f.push(`[s${c.blurs.length}]crop=${SW}:${WIN_H}:0:${WIN_Y},scale=${PW}:${PH}:flags=lanczos[sc]`,
        `[1:v]${fixed},crop=1:${WIN_H}:0:${WIN_Y},scale=${PW}:${PH}:flags=bilinear[mk]`, '[sc][mk]alphamerge[fg]',
        `color=c=${SCRIM}:s=${PW}x${PH}:r=${FPS}[fill]`, '[fill][fg]overlay=shortest=1[pan]', '[2:v]format=gray[rm]', '[pan][rm]alphamerge[panr]',
        // the backdrop: the last clean game frame before this visit, blurred and dimmed, held still
        `[3:v]trim=end_frame=1,gblur=sigma=70,lutyuv=y='16+(val-16)*0.62',loop=loop=-1:size=1,${fixed}[bd0]`, '[bd0][4:v]overlay=0:0[bd]',
        `[bd][panr]overlay=${PX}:${PY}:shortest=1,format=yuv420p[out]`);
      a = [...seek(c.fa), '-i', RAW, '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `1x${H}`, '-r', String(FPS), '-i', maskFile,
        '-loop', '1', '-framerate', String(FPS), '-i', round.file, ...seek(c.span[0] - ROT_IN - 1), '-t', '0.2', '-i', RAW, '-loop', '1', '-framerate', String(FPS), '-i', frame.file,
        '-filter_complex', f.join(';'), '-map', '[out]'];
    }
    a.push('-frames:v', String(c.n), ...x264);
    c.file = path.join(WORK, `clip-${String(i).padStart(2, '0')}-${hash([a, extra, c.kind === 'card' ? fs.readFileSync(cards[c.card].file).toString('base64') : ''])}.mp4`);
    if (!fs.existsSync(c.file)) { run('ffmpeg', ['-y', '-loglevel', 'error', ...a, c.file + '.tmp.mp4']); fs.renameSync(c.file + '.tmp.mp4', c.file); }
    const got = +run('ffprobe', ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', c.file]);
    if (got !== c.n) throw new Error(`clip ${i} has ${got} frames, wanted ${c.n}`);
  });

  // ---- the narration track: each line at its time, then loudness to -16 LUFS (two passes, linear)
  const voiceTrack = path.join(WORK, `narration-${VOICE.toLowerCase()}-${hash(sections.map((s) => [s.id, s.lineStart, lines[s.id].text]))}.wav`);
  if (!fs.existsSync(voiceTrack)) {
    const ins = [], f = [];
    sections.forEach((s, i) => { ins.push('-i', lines[s.id].wav); f.push(`[${i}:a]adelay=${Math.round(s.lineStart * 1000)}:all=1[a${i}]`); });
    f.push(`${sections.map((_, i) => `[a${i}]`).join('')}amix=inputs=${sections.length}:normalize=0,apad=whole_dur=${sec(TOTAL).toFixed(4)},aformat=channel_layouts=stereo[mix]`);
    const dry = voiceTrack.replace(/\.wav$/, '-dry.wav');
    run('ffmpeg', ['-y', '-loglevel', 'error', ...ins, '-filter_complex', f.join(';'), '-map', '[mix]', '-c:a', 'pcm_s16le', dry]);
    const target = 'I=-16:TP=-1.5:LRA=11';
    const m = JSON.parse(run('ffmpeg', ['-hide_banner', '-i', dry, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-'], { stderr: true }).match(/\{[^{}]*"input_i"[^{}]*\}/)[0]);
    run('ffmpeg', ['-y', '-loglevel', 'error', '-i', dry, '-af', `loudnorm=${target}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`,
      '-t', sec(TOTAL).toFixed(4), '-c:a', 'pcm_s16le', voiceTrack]);
    fs.unlinkSync(dry);
  }

  // ---- the cut: the clips joined by their crossfades, the captions if asked for, the voice
  const ins = [], f = [];
  EDL.forEach((c, i) => { ins.push('-i', c.file); f.push(`[${i}:v]fps=${FPS},format=yuv420p[v${i}]`); });
  let cur = 'v0';
  EDL.slice(1).forEach((c, k) => {
    const i = k + 1;
    f.push(`[${cur}][v${i}]xfade=transition=fade:duration=${sec(xf(c)).toFixed(5)}:offset=${sec(c.start).toFixed(5)}[x${i}]`);
    cur = `x${i}`;
  });
  f.push(`[${cur}]fade=t=in:st=0:d=0.3,fade=t=out:st=${(sec(TOTAL) - 0.4).toFixed(3)}:d=0.4[faded]`);
  cur = 'faded';
  const audioIndex = EDL.length;
  ins.push('-i', voiceTrack);
  caps.filter((k) => k.text).forEach((k, j) => {
    const a = sec(k.start) + 0.1, d = sec(k.end - k.start) - 0.2;
    ins.push('-loop', '1', '-framerate', String(FPS), '-t', d.toFixed(3), '-i', k.file);
    f.push(`[${audioIndex + 1 + j}:v]format=rgba,fade=t=in:st=0:d=0.15:alpha=1,fade=t=out:st=${(d - 0.15).toFixed(3)}:d=0.15:alpha=1,setpts=PTS+${a.toFixed(3)}/TB[c${j}]`,
      `[${cur}][c${j}]overlay=${k.x}:${k.y}:eof_action=pass:enable='between(t,${a.toFixed(3)},${(a + d).toFixed(3)})'[o${j}]`);
    cur = `o${j}`;
  });
  const out = path.join(OUT, `isabella-ocean-seeker-demo-v2${CAPTIONS ? '-captions' : ''}.mp4`);
  run('ffmpeg', ['-y', '-loglevel', 'error', ...ins, '-filter_complex', f.join(';'), '-map', `[${cur}]`, '-map', `${audioIndex}:a`,
    '-frames:v', String(TOTAL), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', ...COLOR,
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', out]);

  if (!CAPTIONS) {
    // a 720p copy for a phone, under 10 MB
    const preview = path.join(OUT, 'isabella-ocean-seeker-demo-v2-preview.mp4');
    for (let rate = 560; ; rate -= 80) {
      run('ffmpeg', ['-y', '-loglevel', 'error', '-i', out, '-vf', 'scale=-2:720:flags=lanczos', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '24',
        '-maxrate', `${rate}k`, '-bufsize', `${2 * rate}k`, '-pix_fmt', 'yuv420p', ...COLOR, '-c:a', 'aac', '-b:a', '96k', '-ar', '48000', '-movflags', '+faststart', preview]);
      if (fs.statSync(preview).size < 10e6 || rate < 240) break;
    }
    // the first two lines in this voice, to compare voices by ear
    const sample = path.join(OUT, `v2-${VOICE.toLowerCase()}-sample.m4a`);
    run('ffmpeg', ['-y', '-loglevel', 'error', '-i', lines.title.wav, '-i', lines.real.wav, '-filter_complex', '[1:a]adelay=600:all=1[b];[0:a][b]concat=n=2:v=0:a=1,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]',
      '-map', '[a]', '-c:a', 'aac', '-b:a', '128k', sample]);
  }

  // ---- what was decided, for review: the timeline, and the narration as subtitles
  const timeline = {
    voice: VOICE, seconds: sec(TOTAL), size: [W, H], panel: { x: PX, y: PY, w: PW, h: PH, zoom: PH / WIN_H }, portraitSpans: spans.map(([a, b]) => [sec(a), sec(b)]),
    clips: EDL.map((c) => ({ kind: c.kind, out: [sec(c.start), sec(c.start + c.n)], fadeIn: sec(xf(c)), raw: c.kind === 'card' ? c.card : [sec(c.fa), sec(c.fb)], blurred: (c.blurs || []).length })),
    sections: sections.map((s) => ({ id: s.id, out: [sec(s.start), sec(s.end)], raw: s.raw, line: [s.lineStart, s.lineEnd], text: NARRATION[s.id], spoken: lines[s.id].text })),
    captions: caps.filter((k) => k.text).map((k) => ({ out: [sec(k.start), sec(k.end)], at: k.at, text: k.text })),
  };
  fs.writeFileSync(path.join(CHECK, `timeline${CAPTIONS ? '-captions' : ''}.json`), JSON.stringify(timeline, null, 1));
  const srt = (s) => { const ms = Math.round(s * 1000); return `${new Date(ms).toISOString().slice(11, 19)},${String(ms % 1000).padStart(3, '0')}`; };
  fs.writeFileSync(path.join(CHECK, 'narration.srt'), sections.map((s, i) => `${i + 1}\n${srt(s.lineStart)} --> ${srt(s.lineEnd)}\n${NARRATION[s.id]}\n`).join('\n'));

  const kept = EDL.filter((c) => c.kind !== 'card').reduce((t, c) => t + c.n, 0);
  console.log(`raw ${DUR.toFixed(1)}s → ${stamp(sec(TOTAL))} (${sec(TOTAL).toFixed(2)}s): ${sec(kept).toFixed(1)}s of footage kept, voice ${VOICE}, ${spans.length} wallet visits as panels`);
  for (const s of timeline.sections) console.log(`  ${s.id.padEnd(8)} section ${stamp(s.out[0])}–${stamp(s.out[1])}  line ${stamp(s.line[0])}–${stamp(s.line[1])} (${(s.line[1] - s.line[0]).toFixed(2)}s)`);
  console.log(out);
  process.exit(0);
})().catch((e) => { console.error('EDIT FAILED:', e.message); process.exit(1); });
