# Demo videos and the deck

## Videos
| Video | Where | Status |
|---|---|---|
| Emulator backup (3:46, 2400×1080) | `.local/demo/isabella-ocean-demo.mp4` (a 720p copy is `isabella-ocean-demo-720p.mp4`) | Done 2 Oct |
| **The CLOCK IN demo, filmed on a real Seeker** (2:48, 1080p) | **https://youtu.be/__YTxNECcDc** (file: `.local/demo/isabella-ocean-seeker-demo.mp4`) | **Done 3 Oct.** Real Seed Vault Wallet on devnet: stake, play, instant exit, pay once. This is the video to submit. |

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

## Recording on a real Seeker
```bash
SEEKER_SERIAL=<adb serial> node test/e2e/record-seeker.js <wallet address>
node test/e2e/edit-seeker.js
```
- **What it does:** it taps through Isabella Ocean on the phone over USB and records the screen. The **phone's owner approves every wallet prompt**; the script never touches the wallet.
- **What it needs:** a wallet account that has never bought World 2 and holds at least 1.15 devnet SOL. Send it SOL with `tools/keys/devbank/send.js`.
- **Account check:** if a different account connects, it stops rather than record a misleading take. Picking the right account is the wallet's job: switch the wallet's active account first.
- **The Seed Vault sheets do show in recordings.** They are portrait, so the editor zooms into them.
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
- **12 slides:** cover → the problem → three games → what's free → two ways to unlock → how staking works → parents in control → pay once → the economics → tech → the demo → what's next.
- **Facts:** every number comes from the research brief (`docs/kids-bundle/README.md` and the appendices):
  - 121,069 activated Seekers (2 Oct);
  - no kids titles on the dApp Store;
  - US$35–90 a year for kids' subscriptions elsewhere;
  - staking yield of 4.8–5.5%, about 0.05 SOL a year per family;
  - 0% store commission.
- **Placeholders to fill:** [Demo video link], [Seeker recording link], [Source repo link], [Contact].
- **Out of date** since 3 Oct: it shows three games and the old Bubble Party. Add Coral Maze and the new Bubble Party (TODO.md).

## For judges trying the APK on a Seeker (draft)
1. Install the APK. The free games and Isabella's World 1 work offline.
2. To try an unlock on devnet:
   - put the Seed Vault Wallet on Devnet: Settings → tap the version number 7 times → Developer mode → Devnet;
   - get devnet SOL at faucet.solana.com: about 1.2 SOL covers staking plus a test purchase.
3. On a fresh install, World 2's levels also need World 1 finished. To skip that, **hold the "Isabella" logo on the title screen for 4 seconds** (a key sound plays). That opens every level's progress lock; payment is still required.
4. In the app: tap a World 2 level → Grown-ups → the parent gate (hold, then a multiplication) → Stake 1 SOL, or Pay once.
5. The full answers for the form, with these instructions, are in `docs/SUBMISSION.md` (private).
