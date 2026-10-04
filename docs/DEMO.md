# Demo videos and the deck

## Videos
| Video | Where | Status |
|---|---|---|
| Emulator backup (3:46, 2400×1080) | `.local/demo/isabella-ocean-demo.mp4` (a 720p copy is `isabella-ocean-demo-720p.mp4`) | Done 2 Oct |
| **The CLOCK IN demo, filmed on a real Seeker** (2:48, 1080p) | **https://youtu.be/__YTxNECcDc** (file: `.local/demo/isabella-ocean-seeker-demo.mp4`) | **Done 3 Oct.** Real Seed Vault Wallet on devnet: stake, play, instant exit, pay once. This is the video to submit unless version 2 replaces it. **It no longer matches the app:** it shows "Pay US$15 once" and the old title screen with four game buttons. |
| **Version 2 of the Seeker demo** (1:47, 1080p, narrated) | `.local/demo/isabella-ocean-seeker-demo-v2.mp4` (a 720p copy is `…-v2-preview.mp4`; `…-v2-captions.mp4` adds captions) | **Cut 3 Oct from the same take; not uploaded yet.** No rotation flips, the waits cut, no captions, and a voiceover. **It no longer matches the app either:** same footage, and the voiceover says the old US$15 price. |

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

**Since 4 Oct 2026 the app has nine games and the one-off price is US$4.99.** Every video above was
made before that. The captions and narration in `test/e2e/edit-seeker.js` and `edit-seeker-v2.js`
say US$15 because the footage shows US$15; they change only with a new take.

## Recording on a real Seeker
```bash
SEEKER_SERIAL=<adb serial> node test/e2e/record-seeker.js <wallet address>
node test/e2e/edit-seeker.js       # version 1: captions, wallet rounds at 2×, silent
node test/e2e/edit-seeker-v2.js    # version 2: narrated; add --captions for the captioned copy
```
- **What it does:** it taps through Isabella Ocean on the phone over USB and records the screen. The **phone's owner approves every wallet prompt**; the script never touches the wallet.
- **What it needs:** a wallet account that has never bought World 2 and holds at least 1.15 devnet SOL. Send it SOL with `tools/keys/devbank/send.js`.
- **Account check:** if a different account connects, it stops rather than record a misleading take. Picking the right account is the wallet's job: switch the wallet's active account first.
- **The Seed Vault sheets do show in recordings.** They are portrait, so the editor zooms into them.
- **Version 2 (`edit-seeker-v2.js`):**
  - **No flip.** The wallet is portrait and the game is landscape, so the raw take shows the game sideways in a narrow strip each time the wallet opens. Version 2 never shows those frames: each wallet round is an upright phone panel over a blurred, dimmed game frame, joined by short crossfades.
  - **Waits cut, nothing sped up.** About 109 s of the 210 s take is removed: wallet and confirmation waits, pauses and repeats.
  - **Voiceover.** One line per step, spoken by the Mac's `say` (voice from `VOICE`, default Karen), mixed to −16 LUFS. A line never overlaps the next or outruns its section; the script stops if one would.
  - **The wallet picker.** The "select a wallet" screen is not in the cut. On the "Continue with" sheet, the other account's card is blurred in every frame.
  - **It is tied to this take.** The cut list is in raw seconds, so the script refuses a take with a different frame count.
  - **Checks it leaves behind:** contact sheets and a timeline in `.local/demo/v2-check/`.
- **Blurring other accounts:** the wallet's account picker lists the phone's other wallets. `edit-seeker.js` blurs that card during the picker windows. Re-check the windows, frame by frame, for any new take.
- **Output:** `.local/demo/isabella-ocean-seeker-raw.mp4` and `seeker.log`, then the edited `isabella-ocean-seeker-demo.mp4` (≤3 min, with captions and the wallet rounds at 2×).

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
- **12 slides:** cover → the problem → five games → what's free → two ways to unlock → how staking works → parents in control → pay once → the economics → tech → the demo → what's next.
- **Facts:** every number comes from the research brief (`docs/kids-bundle/README.md` and the appendices):
  - 121,069 activated Seekers (2 Oct);
  - no kids titles on the dApp Store;
  - US$35–90 a year for kids' subscriptions elsewhere;
  - staking yield of 4.8–5.5%, about 0.05 SOL a year per family;
  - 0% store commission.
- **Version 6 (3 Oct):** five games, the Seeker proof image and the demo video link. The last slide gives the site, the code, the demo and a contact.
- **Out of date since 4 Oct:** the deck still says five games and US$15. Its games, what's-free, pay-once and economics slides need the nine games and US$4.99 before it is exported.

## For judges trying the APK on a Seeker (draft)
1. Install the APK. The free games and Isabella's World 1 work offline.
2. To try an unlock on devnet:
   - put the Seed Vault Wallet on Devnet: Settings → tap the version number 7 times → Developer mode → Devnet;
   - get devnet SOL at faucet.solana.com: about 1.2 SOL covers staking plus a test purchase.
3. On a fresh install, World 2's levels also need World 1 finished. To skip that, **hold the "Isabella" logo on the title screen for 4 seconds**. Nothing changes on the title screen, but Play then opens on World 2. That opens every level's progress lock; payment is still required.
4. In the app: tap a World 2 level → Grown-ups → the parent gate (hold, then a multiplication) → Stake 1 SOL, or Pay once.
5. To try both ways, stake first: a purchase is permanent. The README's "Try it on a Seeker" has the same steps.
