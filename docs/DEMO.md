# Demo videos and the deck

## Videos
| Video | Where | Status |
|---|---|---|
| **The CLOCK IN demo, filmed on a real Seeker** (1:47, 1080p, narrated) | **https://youtu.be/aEXbmt3iq5U** (files: `.local/demo/isabella-ocean-demo-v3.mp4`, and `…-v3-phone.mp4`, a 1280-wide copy under 10 MB) | **This is the demo. Filmed and uploaded 5 Oct** on a Seeker running version 2.5, with the real Seed Vault Wallet on devnet. It shows the title with three games and "+", the more-games screen (nine games), a Sea Jigsaw puzzle, the parent gate, "Pay US$4.99 once", then stake 1 SOL → World 2 opens → instant exit → World 2 locks → pay once (0.1 devnet SOL) → open. A neural voice narrates it (Kokoro, "Heart"). Cut with `test/e2e/edit-seeker-v3.js`. |
| Emulator backup (3:46, 2400×1080) | `.local/demo/isabella-ocean-demo.mp4` (a 720p copy is `isabella-ocean-demo-720p.mp4`) | Done 2 Oct. Made on the earlier build (US$15). |
| First Seeker cut (2:48, 1080p, captions, silent) | https://youtu.be/__YTxNECcDc (file: `.local/demo/isabella-ocean-seeker-demo.mp4`) | **Superseded 5 Oct.** Filmed 3 Oct on the earlier build: five games and "Pay US$15 once". |
| Version 2 of that cut (1:47, 1080p, narrated) | `.local/demo/isabella-ocean-seeker-demo-v2.mp4` (a 720p copy is `…-v2-preview.mp4`; `…-v2-captions.mp4` adds captions) | **Superseded 5 Oct; never uploaded.** Cut 3 Oct from the same take as the first cut, so it shows five games, and its voiceover says US$15. |

**What the emulator backup shows:**
1. title card → the three free games;
2. World 2 locked → the parent gate → Stake 1 SOL → the wallet approves → "World 2!";
3. level 11;
4. Grown-ups → Get my SOL back now → World 2 locks;
5. Pay once → World 2 open for good.

It contains four real devnet transactions, all confirmed. The network waits are sped up 4× under a
visible label, and the wallet screens are zoomed so they can be read. **One blemish:** the test
wallet's first connect screen reads "Status: Verification failed". That is its 3-second identity
check timing out on the emulator's slow first connection; the later steps were unaffected. The
Seeker recording, which uses the real Seed Vault Wallet, has no such issue.

**Since 4 Oct 2026 the app has nine games and the one-off price is US$4.99.** The 5 Oct demo shows
both. The three older videos were made before that: the captions and narration in
`test/e2e/edit-seeker.js` and `edit-seeker-v2.js` say US$15 because their footage shows US$15, and
both scripts stay as they are for that older take.

## Recording on a real Seeker
```bash
SEEKER_SERIAL=<adb serial> node test/e2e/record-seeker.js <wallet address>
node test/e2e/edit-seeker-v3.js    # the 5 Oct demo: narrated, no captions
```
- **What it does:** it taps through Isabella Ocean on the phone over USB and records the screen. The **phone's owner approves every wallet prompt**; the script never touches the wallet.
- **The storyboard:** title → "+" (the six more games) → Sea Jigsaw, one puzzle → title → World 1 → World 2 locked → the parent gate → Stake 1 SOL → World 2 opens → a little play → Grown-ups → Get my SOL back now → World 2 locks → Pay once → World 2 open.
- **What it needs:**
  - the Seeker on USB and awake, with Isabella Ocean 2.5 or later (nine games);
  - a devnet wallet account that has never bought World 2, holds no stake, and has at least 1.15 devnet SOL (send it SOL with `tools/keys/devbank/send.js`);
  - the app's save at "World 1 finished". If the save is short of that, the script stops, because level 11 would stay shut after the stake.
- **Switches** (environment variables):
  - `SEEKER_PRESET_SAVE=1` writes the "World 1 finished" save when the save is short of it.
  - `SEEKER_MINIGAME=0` leaves the Sea Jigsaw puzzle out; the "+" screen is still shown.
  - `SEEKER_RELOCK=quick` goes straight from Grown-ups to the unlock screen after the exit. By default the take shows World 2's padlocks and passes the parent gate again.
- **Rehearsing without a phone:** `node test/e2e/record-seeker.js --dry-run <any wallet address>` runs the same storyboard in headless Chrome at the Seeker's screen shape, with a mock wallet (`test/e2e/seeker-dry.js`). It needs no phone, no adb and no network. It keeps a screenshot for each step and reports any page exception or repeated log line.
- **Account check:** if a different account connects, it stops rather than record a misleading take. Picking the right account is the wallet's job: switch the wallet's active account first.
- **The Seed Vault sheets do show in recordings.** They are portrait, so the editor shows each one as an upright phone panel.
- **Output:** `.local/demo/isabella-ocean-seeker-raw.mp4` and `seeker.log`. The editor cuts by the log's lines. An earlier take's two files are kept beside them as `*.before-<time>.*`.

### The cut (`edit-seeker-v3.js`)
- **Output:**
  - `.local/demo/isabella-ocean-demo-v3.mp4`, at the size it was recorded;
  - `…-v3-phone.mp4`, 1280 wide and under 10 MB;
  - `.local/demo/v3-check/timeline.json` and `narration.srt`, which record what the edit decided.
- **No flip.** The game is landscape and the wallet is portrait, so the raw take rotates at every wallet visit. Each visit is shown as an upright phone panel (the wallet sheet only) over a blurred still of the game screen it came from.
- **Two recordings joined.** In the second one the recorder itself was portrait: there the wallet goes into the same panel and the game is enlarged to the full frame, so it is a little softer.
- **Dead time cut, nothing sped up.** The joins are short crossfades.
- **Voiceover.** One line per section, spoken by Kokoro (voice `af_heart`), mixed to −16 LUFS. The lines are in `NARRATION` and also become `narration.srt`. The script stops if the voice would be silent for more than 2.6 s between two lines.
- **It needs things that are not in the repo:** `.local/tts` (the Kokoro model, its Python environment and `say.py`), ffmpeg and Chrome.
- **Other accounts are blurred.** Only the stake's Connect visit shows account cards. On the "Continue with" sheet the cards under the chosen one are blurred; the picker itself is not in the cut.
- **It is tied to this take.** The cut list, the privacy window and the join are raw times from one take, so the script refuses a take with a different frame count. A new take needs all three re-derived, frame by frame.

### The older cuts (the 3 Oct take)
```bash
node test/e2e/edit-seeker.js       # version 1: captions, wallet rounds at 2×, silent
node test/e2e/edit-seeker-v2.js    # version 2: narrated; add --captions for the captioned copy
```
- Both are kept for the 3 Oct take only. Version 2 refuses a take with a different frame count; version 1's blur windows were found frame by frame in that take.
- **Version 1** writes `isabella-ocean-seeker-demo.mp4` (≤3 min, with captions and the wallet rounds at 2×). It blurs the other account's card during the wallet-picker windows.
- **Version 2** shows each wallet round as an upright phone panel, cuts about 109 s of the 210 s take, and has one voiceover line per step spoken by the Mac's `say` (voice from `VOICE`, default Karen). Its checks are in `.local/demo/v2-check/`.

## Recording a take on the emulator
```bash
node test/e2e/record-demo.js <expected wallet address>
node test/e2e/edit-demo.js <the take's log> <raw mp4>
```
- **`record-demo.js`:**
  - Wipes the store app, seeds "World 1 finished", and records the whole parent flow with real Android touches (shown as dots), paced for viewers.
  - Writes `.local/demo/isabella-ocean-emulator.mp4`.
  - Stops if a different wallet connects than the one expected.
- **`edit-demo.js`:**
  - Adds a title card, speeds up waits that follow an approval, check or send, and zooms the portrait wallet screens.
  - Writes `.local/demo/isabella-ocean-demo.mp4`.
  - Its labels are drawn by headless Chrome.
- **Each take needs a wallet that has never bought World 2,** because purchases are permanent. To make one:
  1. copy `tools/keys/fakewallet/genkey-demo.mjs` to a new name and run it;
  2. build fakewallet with `tools/keys/fakewallet/build-fakewallet-demo.sh`, which writes the key to `fakewallet/local.properties` (the module reads its own file) and checks `BuildConfig`;
  3. uninstall the old fakewallet, then install the new one;
  4. move the old demo wallet's devnet SOL across.

## Devnet SOL (test money with no value)
| Wallet | Use |
|---|---|
| Bank `84Vo4y2…jq6V` (`tools/keys/devbank/`) | Funds test wallets: `node tools/keys/devbank/send.js <address> <sol>` |
| Merchant `HoackNnc…7J2x` | Receives the devnet pay-once payments (0.1 SOL each) |
| Demo wallet `Fe4U9C…ViiG` | The fakewallet in the current emulator build (has now bought World 2) |
| The owner's Seed Vault `4Jb1kc…YNPMHq` | Funded with 1.2 devnet SOL on 3 Oct |

The public faucet (faucet.solana.com) needs a GitHub sign-in with public repos.
`tools/keys/fakewallet/seeker-fund.sh` waits for a phone to connect its wallet in the store app,
then sends it 1.2 devnet SOL once.

## The deck
**https://claude.ai/artifact/RTPTuoaeKEf4GBhPQufksg** (a private Slides artifact; share it from its Share menu).
- **12 slides:** cover → the problem → nine games → what's free → two ways to unlock → how staking works → parents in control → pay once → the economics → tech → the demo → what's next.
- **Facts:** every number comes from the research brief (`docs/kids-bundle/README.md` and the appendices):
  - 121,069 activated Seekers (2 Oct);
  - no kids titles on the dApp Store;
  - US$35–90 a year for kids' subscriptions elsewhere;
  - staking yield of 4.8–5.5%, about 0.05 SOL a year per family;
  - 0% store commission.
- **Version 7 (5 Oct):** nine games with a screenshot each, US$4.99, the new title and unlock screens, and the 5 Oct demo video link (1:47). The last slide gives the site, the code, the demo and a contact.

## For judges trying the APK on a Seeker (draft)
1. Install the APK. The free games and Isabella's World 1 work offline.
2. To try an unlock on devnet:
   - put the Seed Vault Wallet on Devnet: Settings → tap the version number 7 times → Developer mode → Devnet;
   - get devnet SOL at faucet.solana.com: about 1.2 SOL covers staking plus a test purchase.
3. On a fresh install, World 2's levels also need World 1 finished. To skip that, **hold the "Isabella" logo on the title screen for 4 seconds**. Nothing changes on the title screen, but Play then opens on World 2. That opens every level's progress lock; payment is still required.
4. In the app: tap a World 2 level → Grown-ups → the parent gate (hold, then a multiplication) → Stake 1 SOL, or Pay once.
5. To try both ways, stake first: a purchase is permanent. The README's "Try it on a Seeker" has the same steps.
