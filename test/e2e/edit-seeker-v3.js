// Third edit of the real-Seeker demo, for the take of 5 Oct 2026 (nine games, pay once US$4.99).
// Built on edit-seeker-v2.js, which stays as it is for the older take.
//   - The game is landscape and the Seed Vault Wallet is portrait, so the recording rotates at every
//     wallet visit. Each visit is cut out of the rotation and shown as an upright "phone panel" (the
//     wallet sheet only) over a blurred still of the game screen it came from.
//   - This take is two recordings joined: from SPLIT on, the recorder itself was portrait, so there
//     the wallet fills the frame (stretched) and the game is a thin band across the middle. Both are
//     put back: the wallet into the same panel, the game enlarged to the full frame (it is softer).
//   - Dead time is cut; the joins are short crossfades. Nothing is sped up.
//   - A voice reads one line per section (Kokoro, voice af_heart; the engine lives in tts() alone).
//   - The wallet's "Continue with" sheet shows a second account card: it is blurred (see PRIVACY).
// Run: node test/e2e/edit-seeker-v3.js [log] [raw mp4]
//   → .local/demo/isabella-ocean-demo-v3.mp4        the cut, at the size it was recorded
//   → .local/demo/isabella-ocean-demo-v3-phone.mp4  1280 wide, H.264 Main, under 10 MB
//   → .local/demo/v3-check/timeline.json, narration.srt: what the edit decided
// Needs .local/tts (a Kokoro model, its venv and say.py), ffmpeg and Chrome. None of them is in the repo.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { launch } = require('../paywall/cdp.js');

const LOCAL = path.join(__dirname, '../../.local');
const OUT = path.join(LOCAL, 'demo');
const TTS = path.join(LOCAL, 'tts');
const CHECK = path.join(OUT, 'v3-check');
const WORK = path.join(CHECK, 'work');             // intermediate clips, cards, speech (safe to delete)
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const LOG = files[0] || path.join(OUT, 'seeker.log');
const RAW = files[1] || path.join(OUT, 'isabella-ocean-seeker-raw.mp4');
const VOICE = 'af_heart', LANG = 'en-us';
const FPS = 30, LEAD = 0.25, TAIL = 0.4;           // a line starts LEAD into its section and ends TAIL before the next
const COLOR = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: opts.binary ? 'buffer' : 'utf8', maxBuffer: 1 << 28, input: opts.input, cwd: opts.cwd });
  if (r.status !== 0 && !opts.lenient) throw new Error(`${cmd} failed: ${String(r.stderr || r.error).slice(-1500)}`);
  return opts.stderr ? r.stderr : r.stdout;
}
const hash = (x) => crypto.createHash('sha1').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex').slice(0, 12);
const fr = (s) => Math.round(s * FPS);
const sec = (f) => f / FPS;
const stamp = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
const seconds = (file) => +run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);

// ---------------------------------------------------------------------------------------------
// The narration. Display text here (it becomes the subtitles); SAY_AS turns it into what the voice is given.
const NARRATION = {
  title: 'Isabella Ocean. Nine ad-free ocean games for kids, on the Solana Seeker.',
  real: 'This is a real Seeker. Nine games, with no ads, no accounts and no tracking. Eight of them are completely free.',
  jigsaw: 'They are made for small hands: jigsaws, mazes, word searches, a tilt-to-steer swim and more. Finish one, and the treasure chest opens.',
  gate: 'In the main game, World 1 is free too. Only World 2 is locked, and it asks for a grown-up: hold for three seconds, then solve a multiplication.',
  choices: 'A parent has two choices. Stake 1 SOL and take it back any time, or pay US$4.99, once.',
  stake: 'First, the stake. The Seed Vault Wallet connects, and the parent approves a deposit into our own stake pool. They can take it back any time. Only the staking rewards pay for the game.',
  open: 'World 2 opens at once. The app reads the unlock straight from the chain. There is no server and no login.',
  exit: 'Getting the SOL back takes one approval, behind the same parent gate. It returns straight away for a fee of 0.3%, or free after about two days.',
  back: 'The SOL is back in the wallet, and World 2 locks again.',
  pay: 'The other choice is to pay once: US$4.99, in SKR or any verified token, swapped at the moment of purchase. This demo runs on devnet, so it pays in test SOL.',
  paid: 'Paid once, World 2 stays open for good, even after a reinstall.',
  end: "That's Isabella Ocean: kids play without ads, and parents stay in control of their money.",
};
const SAY_AS = [
  [/World 1\b/g, 'World One'], [/World 2\b/g, 'World Two'], [/\b1 SOL\b/g, 'one SOL'], [/0\.3%/g, 'zero point three percent'],
  [/US\$4\.99/g, 'four dollars ninety-nine'], [/\bSKR\b/g, 'S K R'], [/\bdevnet\b/g, 'dev net'],
];
const spoken = (text) => SAY_AS.reduce((s, [re, to]) => s.replace(re, to), text);
const SPEED = {};                                    // per line, only where a line must fit its footage (none does)

// The only place that knows which speech engine is used: one line of text in, a mono 48 kHz wav out.
function tts(text, wav, speed = 1) {
  const python = path.join(TTS, 'venv/bin/python');
  for (const need of [python, path.join(TTS, 'say.py'), path.join(TTS, 'kokoro-v1.0.onnx'), path.join(TTS, 'voices-v1.0.bin')]) {
    if (!fs.existsSync(need)) throw new Error(`the voice needs .local/tts (Kokoro: venv, say.py, kokoro-v1.0.onnx, voices-v1.0.bin), which is not in the repo: ${path.relative(LOCAL, need)} is missing`);
  }
  const k = wav.replace(/\.wav$/, '-24k.wav');
  fs.rmSync(k, { force: true });
  // say.py can abort while it shuts down, after the file is written: the file decides, not the exit code
  const said = run(python, ['say.py', VOICE, LANG, k, text, String(speed)], { cwd: TTS, lenient: true, stderr: true });
  if (!fs.existsSync(k) || fs.statSync(k).size < 2000) throw new Error(`Kokoro wrote no speech for "${text.slice(0, 40)}…": ${String(said).slice(-600)}`);
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', k, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
  fs.unlinkSync(k);
}
// A line, trimmed of the engine's leading and trailing silence, with its real length.
function line(id) {
  const text = spoken(NARRATION[id]), speed = SPEED[id] || 1;
  const wav = path.join(WORK, `say-${hash([VOICE, LANG, speed, text])}.wav`);
  if (!fs.existsSync(wav)) {
    const rawWav = wav.replace(/\.wav$/, '-raw.wav');
    tts(text, rawWav, speed);
    const trim = 'silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.03';
    run('ffmpeg', ['-y', '-loglevel', 'error', '-i', rawWav, '-af', `${trim},areverse,${trim},areverse,afade=t=in:d=0.01`, '-c:a', 'pcm_s16le', wav]);
    fs.unlinkSync(rawWav);
  }
  return { id, text, wav, speed, dur: seconds(wav) };
}

if (!fs.existsSync(RAW) || !fs.existsSync(LOG)) { console.error('EDIT FAILED: the take is not here (.local/demo/isabella-ocean-seeker-raw.mp4 and seeker.log)'); process.exit(1); }
fs.mkdirSync(WORK, { recursive: true });

// ---------------------------------------------------------------------------------------------
// The take, measured.
const meta = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_frames:format=duration', '-of', 'json', RAW]));
const W = meta.streams[0].width, H = meta.streams[0].height, DUR = +meta.format.duration, FRAMES = +meta.streams[0].nb_frames;
// The cut list, the privacy window and SPLIT below are raw times found in ONE take. A new take needs
// all three re-derived, frame by frame, before this may run on it.
const TAKE_FRAMES = 5725;
if (FRAMES !== TAKE_FRAMES) throw new Error(`this cut was written for the ${TAKE_FRAMES}-frame take, not this ${FRAMES}-frame one: re-derive EDL, PRIVACY and SPLIT first`);
// Frames are counted on the 30 fps clock (frame f is at f/30 s). The second recording starts at SPLIT,
// after a gap of 7 frames in which the last frame of the first one stands.
const SPLIT = 5105, GAP = 6;
const late = (f) => f >= SPLIT;

// Early part: in a wallet visit the phone is portrait, a strip in the middle of the landscape recording.
const SW = 2 * Math.floor((H * H) / W / 2), SX = 2 * Math.round((W - SW) / 4);          // 484 wide at x=960
// Late part: the game is a band across the middle of the (stretched) portrait recording.
const BAND_H = 2 * Math.floor((H * H * H) / (W * W) / 2), BAND_Y = Math.round((H - BAND_H) / 2);   // 218 high at y=431
// Per frame: is the phone showing the wallet, and where is the top of the wallet's sheet?
function measure() {
  const cache = path.join(WORK, `measure-${hash([RAW, fs.statSync(RAW).size, SW, SX, SPLIT, 3])}.json`);
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, 'utf8'));
  // one-pixel columns per frame. Early: the strip's middle, the strip's left margin, the frame's left side.
  // Late: the frame's middle, the frame's left margin.
  const b = run('ffmpeg', ['-loglevel', 'error', '-i', RAW, '-filter_complex',
    `[0:v]fps=${FPS},split=5[a][b][c][d][e];[a]crop=${SW - 60}:${H}:${SX + 30}:0,scale=1:${H}:flags=area[p];[b]crop=8:${H}:${SX + 3}:0,scale=1:${H}:flags=area[m];` +
    `[c]crop=${SX - 200}:${H}:100:0,scale=1:${H}:flags=area[s];[d]crop=${W - 300}:${H}:150:0,scale=1:${H}:flags=area[p2];[e]crop=40:${H}:15:0,scale=1:${H}:flags=area[m2];` +
    '[p][m][s][p2][m2]hstack=inputs=5,format=rgb24[o]', '-map', '[o]', '-f', 'rawvideo', '-'], { binary: true });
  const size = 5 * H * 3, n = b.length / size, portrait = [], state = [], top = [];
  let held = -1;                                     // the last sheet top seen in this visit
  for (let f = 0; f < n; f++) {
    const px = (col, y) => { const i = f * size + (y * 5 + col) * 3; return [b[i], b[i + 1], b[i + 2]]; };
    const P = late(f) ? 3 : 0, MARGIN = late(f) ? 4 : 1;
    const isSheet = ([r, g, bl]) => r >= 8 && g >= 15 && bl <= g + 3;          // the sheet is (12,22,19); the dimmed game above it is (0,3,4)
    let side = 0, mid = 0, bars = 0, band = 0;
    const foot = [0, 0, 0];
    for (let y = 0; y < H; y += 8) { side += px(2, y)[0] + px(2, y)[1] + px(2, y)[2]; mid = Math.max(mid, px(P, y)[1]); }
    for (let y = 40; y < 400; y += 4) bars += (px(3, y)[1] + px(3, H - 1 - y)[1]) / 2 / 90;
    for (let y = 460; y < 620; y += 4) band += px(3, y)[1] / 40;
    for (let y = H - 40; y < H - 4; y++) px(MARGIN, y).forEach((v, k) => { foot[k] += v / 36; });
    // early: black to the left of the strip. late: anything but the game band between black bars.
    portrait.push(late(f) ? !(bars < 2 && band > 12) : side / (3 * Math.ceil(H / 8)) < 2);
    let t = -1;
    for (let y = 34; y < H - 10 && t < 0; y++) { let ok = true; for (let k = 0; k < 6 && ok; k++) ok = isSheet(px(P, y + k)); if (ok) t = y; }
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
const spans = [];                                    // [first wallet frame, first game frame after it]
M.portrait.forEach((p, f) => { if (p && !M.portrait[f - 1]) spans.push([f, f]); if (p) spans[spans.length - 1][1] = f + 1; });
// The log says when the recorder saw the wallet: every one of those must fall in a measured span.
const walletSeen = fs.readFileSync(LOG, 'utf8').split('\n').map((l) => l.match(/\[video ([\d.]+)s\]\s+\w+: wallet on screen/)).filter(Boolean).map((m) => +m[1]);
for (const t of walletSeen) if (!spans.some(([a, b]) => fr(t) >= a - FPS && fr(t) < b)) throw new Error(`the log has the wallet on screen at ${t}s, but the recording does not show it there`);
const ROT_IN = 12, ROT_OUT = 2;                      // frames of rotation animation before a span / kept clear after it

// ---------------------------------------------------------------------------------------------
// PRIVACY. Only the first wallet visit of this take (the stake's Connect) shows accounts: a picker
// with three cards, then "Continue with" with the chosen card and a sliver of the others under it.
// No other visit shows an account card (the later sheets name the chosen wallet in a text row only).
// Inside `clear` ("Continue with", standing still) the cards under the chosen one are blurred;
// anywhere else inside `window` the whole lower sheet is. Strip coordinates, raw seconds.
const PRIVACY = [
  { window: [45.5, 52.95], clear: [51.40, 52.72] },  // stake: connect
];
const BLUR_CARD = { y: 796, h: 148 }, BLUR_SHEET = { y: 540, h: H - 540 };
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
//   G: game footage (landscape as recorded; enlarged from the band in the late part).
//   P: a wallet visit, shown as the phone panel.
//   sec: the narration section that starts with this clip; marks: sections that start inside it.
const G = (a, b, o = {}) => ({ kind: 'game', a, b, x: 0.25, ...o });
const P = (a, b, o = {}) => ({ kind: 'wallet', a, b, x: 0.2, ...o });
const EDL = [
  { kind: 'card', card: 'title', sec: 'title', x: 0 },
  // the title: three games and "+" → the more-games screen: nine games → Sea Jigsaw's puzzles
  G(0.10, 8.70, { x: 0.3, sec: 'real', marks: [[7.60, 'jigsaw']] }),
  G(9.50, 24.25),                                                // puzzle 1 solved piece by piece; the key; the chest; the reward
  // the title again → the map opens on World 2 (padlocks) → World 1 → World 2, a locked level, "Ask a grown-up"
  G(25.20, 33.00, { sec: 'gate' }),
  G(33.72, 45.15, { marks: [[37.60, 'choices']] }),              // the hold ring fills (3 s); the sum; the two choices; tap Stake
  P(51.42, 52.70, { x: 0.3, sec: 'stake' }),                     // Connect: "Continue with Game Wallet", tap Connect
  G(53.05, 56.95),                                               // "Approve the deposit in your wallet"
  P(60.47, 64.35),                                               // Transaction: -1.01 SOL, +1.01 OCEAN; trust; tap Approve
  P(69.55, 71.28),                                               // Processing → Success
  P(71.75, 73.65),                                               // Success, with the transaction ID
  G(74.70, 87.50, { x: 0.3, sec: 'open' }),                      // "Unlocking World 2" → "World 2!" → the map → "Level 11" → a swim
  G(96.40, 98.20, { x: 0.3, sec: 'exit' }),                      // the title, tap the grown-ups button → the gate
  G(100.20, 101.15),                                             // the hold ring fills
  G(103.00, 103.90),                                             // the sum answered
  G(107.80, 114.60),                                             // "Staked ✓" → "Get your SOL back now?" → "Getting your SOL back"
  P(121.55, 123.60, { x: 0.3 }),                                 // Transaction: +1.01 SOL, -1.01 OCEAN; trust; tap Approve
  P(124.35, 125.75),                                             // "Double tap to confirm"
  P(126.95, 128.60),                                             // fingerprint: "Approved"
  P(130.10, 131.75),                                             // Processing
  P(133.30, 135.55, { sec: 'back' }),                            // Success
  G(136.55, 139.60, { x: 0.3 }),                                 // "Your SOL is back … World 2 is locked again"
  G(140.72, 142.20),                                             // grown-ups: "Not unlocked"
  G(144.60, 146.75),                                             // World 2: padlocks again
  G(147.20, 148.25, { sec: 'pay' }),                             // "Ask a grown-up"
  G(151.40, 152.18),                                             // the third gate, only its end
  G(154.10, 163.40),                                             // the sum → "Pay US$4.99 once" → "Looking in your wallet" → choose a token: 0.1 SOL → "Approve the payment"
  P(168.90, 169.93, { x: 0.3 }),                                 // Transaction: -0.1 SOL
  P(170.20, 170.83),                                             // trust; tap Approve
  P(171.70, 172.85),                                             // "Double tap to confirm"
  P(174.00, 175.60),                                             // fingerprint: "Approved"
  P(177.00, 178.60),                                             // Processing
  P(182.20, 183.40, { sec: 'paid' }),                            // Success
  G(185.36, 190.95, { x: 0.3 }),                                 // "Unlocking World 2" → "World 2!"
  { kind: 'card', card: 'end', sec: 'end', x: 0.3 },
];

// Every clip checked against the measurement: no game clip may touch a rotation or a wallet frame,
// every frame of a wallet clip must show a sheet (so: never the sideways game), and no clip may
// cross the join between the two recordings.
for (const c of EDL) {
  if (c.kind === 'card') continue;
  c.fa = fr(c.a); c.fb = fr(c.b); c.n = c.fb - c.fa; c.late = late(c.fa);
  if (c.fb > SPLIT - GAP && c.fa < SPLIT) throw new Error(`clip ${c.a}–${c.b}s crosses the join of the two recordings at ${sec(SPLIT).toFixed(2)}s`);
  if (c.kind === 'game') {
    const hit = spans.find(([a, b]) => c.fb > a - ROT_IN && c.fa < b + ROT_OUT);
    if (hit) throw new Error(`game clip ${c.a}–${c.b}s touches the rotation around ${sec(hit[0]).toFixed(2)}–${sec(hit[1]).toFixed(2)}s`);
    for (let f = c.fa; f < c.fb; f++) if (M.state[f] !== 'land') throw new Error(`game clip ${c.a}–${c.b}s: not the game at ${sec(f).toFixed(3)}s`);
    if (PRIVACY.some((p) => c.fb > fr(p.window[0]) && c.fa < fr(p.window[1]))) throw new Error(`game clip ${c.a}–${c.b}s is inside a privacy window`);
  } else {
    c.span = spans.find(([a, b]) => c.fa >= a && c.fb <= b);
    if (!c.span) throw new Error(`wallet clip ${c.a}–${c.b}s is not inside one wallet visit`);
    if (late(c.span[0] - ROT_IN - 1)) throw new Error(`wallet clip ${c.a}–${c.b}s: its backdrop would come from the late part`);
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
  if (sec(TOTAL) > 175) throw new Error(`the cut is ${sec(TOTAL).toFixed(1)}s: over the 2:55 limit`);

  // ---- cards and the panel's shape (headless Chrome)
  const cdp = await launch({ port: 9474, profile: path.join(WORK, '.chrome'), width: W, height: H });
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
      <div style="font-size:62px;font-weight:600;margin-top:30px">Nine ad-free ocean games for kids, on the Solana Seeker</div>
      <div style="font-size:46px;margin-top:26px;opacity:.95">Stake 1 SOL to unlock and take it back any time · or pay US$4.99 once</div>
      <div style="position:absolute;bottom:64px;font-size:38px;opacity:.85">Recorded on a real Solana Seeker · Seed Vault Wallet · Solana devnet</div></body>`, 'card-title.png'),
    end: await render(`<body style="${sea}">
      <div style="font-size:130px;font-weight:800;text-shadow:0 8px 0 rgba(0,0,0,.18)">Isabella Ocean</div>
      <div style="font-size:70px;margin-top:32px;font-weight:700">isabellaocean-app.pages.dev</div>
      <div style="font-size:48px;margin-top:34px;font-weight:600">Kids play without ads. Parents stay in control of their money.</div></body>`, 'card-end.png'),
  };
  // the panel's shape (white on black, used as its alpha), and its shadow and hairline on the backdrop
  const round = await render(`<body style="margin:0;background:#000"><div id="p" style="width:${PW}px;height:${PH}px;background:#000"><div style="width:100%;height:100%;background:#fff;border-radius:${RADIUS}px"></div></div></body>`, 'panel-round.png', '#p');
  const frame = await render(`<body style="margin:0"><div style="position:absolute;left:${PX}px;top:${PY}px;width:${PW}px;height:${PH}px;border-radius:${RADIUS}px;box-shadow:0 0 0 2px rgba(255,255,255,.16),0 24px 90px 10px rgba(0,0,0,.6)"></div></body>`, 'panel-frame.png');
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
      // late part: the game is the band across the middle, enlarged back to the whole frame
      a = [...seek(c.fa), '-i', RAW, '-vf', `${fixed}${c.late ? `,crop=${W}:${BAND_H}:0:${BAND_Y},scale=${W}:${H}:flags=lanczos` : ''},format=yuv420p`];
    } else {
      // The sheet only: everything above its top edge (the game, drawn sideways and dimmed) becomes plain scrim.
      const mask = Buffer.alloc(c.n * H);
      for (let k = 0; k < c.n; k++) mask.fill(255, k * H + M.top[c.fa + k] + 2, (k + 1) * H);
      const maskFile = path.join(WORK, `mask-${i}.gray`);
      fs.writeFileSync(maskFile, mask);
      extra = hash(mask.toString('base64'));
      const sw = c.late ? W : SW, sx = c.late ? 0 : SX;                // late part: the wallet is the whole (stretched) frame
      const f = [`[0:v]${fixed},crop=${sw}:${H}:${sx}:0[s0]`];
      c.blurs.forEach((b, k) => f.push(`[s${k}]split[k${k}][j${k}]`, `[j${k}]crop=${sw}:${b.h}:0:${b.y},scale=30:8:flags=area,scale=${sw}:${b.h}:flags=bilinear,boxblur=8:2[q${k}]`, `[k${k}][q${k}]overlay=0:${b.y}[s${k + 1}]`));
      f.push(`[s${c.blurs.length}]crop=${sw}:${WIN_H}:0:${WIN_Y},scale=${PW}:${PH}:flags=lanczos[sc]`,
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
  const voiceTrack = path.join(WORK, `narration-${hash(sections.map((s) => [s.id, s.lineStart, lines[s.id].text, lines[s.id].speed, VOICE]))}.wav`);
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

  // ---- the cut: the clips joined by their crossfades, and the voice
  const ins = [], f = [];
  EDL.forEach((c, i) => { ins.push('-i', c.file); f.push(`[${i}:v]fps=${FPS},format=yuv420p[v${i}]`); });
  let cur = 'v0';
  EDL.slice(1).forEach((c, k) => {
    const i = k + 1;
    f.push(`[${cur}][v${i}]xfade=transition=fade:duration=${sec(xf(c)).toFixed(5)}:offset=${sec(c.start).toFixed(5)}[x${i}]`);
    cur = `x${i}`;
  });
  f.push(`[${cur}]fade=t=in:st=0:d=0.3,fade=t=out:st=${(sec(TOTAL) - 0.4).toFixed(3)}:d=0.4[faded]`);
  const audioIndex = EDL.length;
  ins.push('-i', voiceTrack);
  const out = path.join(OUT, 'isabella-ocean-demo-v3.mp4');
  run('ffmpeg', ['-y', '-loglevel', 'error', ...ins, '-filter_complex', f.join(';'), '-map', '[faded]', '-map', `${audioIndex}:a`,
    '-frames:v', String(TOTAL), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', ...COLOR,
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', out]);

  // ---- a copy a phone can open: 1280 wide, Main profile, under 10 MB
  const phone = path.join(OUT, 'isabella-ocean-demo-v3-phone.mp4');
  for (let rate = 520; ; rate -= 60) {
    run('ffmpeg', ['-y', '-loglevel', 'error', '-i', out, '-vf', 'scale=1280:-2:flags=lanczos', '-c:v', 'libx264', '-profile:v', 'main', '-level', '3.1', '-preset', 'slow', '-crf', '24',
      '-maxrate', `${rate}k`, '-bufsize', `${2 * rate}k`, '-pix_fmt', 'yuv420p', ...COLOR, '-c:a', 'aac', '-b:a', '96k', '-ar', '48000', '-movflags', '+faststart', phone]);
    if (fs.statSync(phone).size < 9.8e6) break;
    if (rate < 240) throw new Error('the phone copy will not fit under 10 MB');
  }

  // ---- what was decided, for review: the timeline, and the narration as subtitles
  const timeline = {
    voice: VOICE, seconds: sec(TOTAL), size: [W, H], split: sec(SPLIT), panel: { x: PX, y: PY, w: PW, h: PH, zoom: PH / WIN_H }, portraitSpans: spans.map(([a, b]) => [sec(a), sec(b)]),
    clips: EDL.map((c) => ({ kind: c.kind, out: [sec(c.start), sec(c.start + c.n)], fadeIn: sec(xf(c)), raw: c.kind === 'card' ? c.card : [sec(c.fa), sec(c.fb)], blurred: (c.blurs || []).length, late: !!c.late })),
    sections: sections.map((s) => ({ id: s.id, out: [sec(s.start), sec(s.end)], raw: s.raw, line: [s.lineStart, s.lineEnd], speed: lines[s.id].speed, text: NARRATION[s.id], spoken: lines[s.id].text })),
  };
  fs.writeFileSync(path.join(CHECK, 'timeline.json'), JSON.stringify(timeline, null, 1));
  const srt = (s) => { const ms = Math.round(s * 1000); return `${new Date(ms).toISOString().slice(11, 19)},${String(ms % 1000).padStart(3, '0')}`; };
  fs.writeFileSync(path.join(CHECK, 'narration.srt'), sections.map((s, i) => `${i + 1}\n${srt(s.lineStart)} --> ${srt(s.lineEnd)}\n${NARRATION[s.id]}\n`).join('\n'));

  const kept = EDL.filter((c) => c.kind !== 'card').reduce((t, c) => t + c.n, 0);
  console.log(`raw ${DUR.toFixed(1)}s → ${stamp(sec(TOTAL))} (${sec(TOTAL).toFixed(2)}s): ${sec(kept).toFixed(1)}s of footage kept, voice ${VOICE}, ${spans.length} wallet visits as panels`);
  for (const s of timeline.sections) console.log(`  ${s.id.padEnd(8)} section ${stamp(s.out[0])}–${stamp(s.out[1])}  line ${stamp(s.line[0])}–${stamp(s.line[1])} (${(s.line[1] - s.line[0]).toFixed(2)}s)`);
  console.log(`${path.relative(process.cwd(), out)}\n${path.relative(process.cwd(), phone)}`);
  process.exit(0);
})().catch((e) => { console.error('EDIT FAILED:', e.message); process.exit(1); });
