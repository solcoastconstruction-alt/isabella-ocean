# Isabella Ocean: App Store Connect listing (draft for version 1.0)

Derived from `listing/listing.md`, with every crypto, staking, wallet, Solana, Seeker and dApp Store
reference removed. Game facts are from `docs/GAMES.md`. Character counts were measured by script, not
by eye. Paste the text between the two lines of each section as it is.

**This is a draft**, written by a subagent on 9 Oct from the source, then corrected the same day
against the app running in the Simulator (the route to the purchase, the labels, the links, the
"Redeem a code" button). He has not read it yet. See "Check before pasting" at the end.

## Short fields

| Field | Limit | Text | Characters |
|---|---|---|---|
| App name | 30 | Isabella Ocean | 14 |
| Subtitle (recommended) | 30 | Ad-free ocean games for kids | 28 |
| Subtitle (option 2) | 30 | Nine ocean games, zero ads | 26 |
| In-app purchase: Display Name | 30 | World 2 | 7 |
| In-app purchase: Description (recommended) | 45 | Levels 11 to 20 of Isabella the Mermaid | 39 |
| In-app purchase: Description (option 2) | 45 | Levels 11 to 20 with Isabella | 29 |

Both subtitles are from `listing/listing.md`. Its third option ("Calm ocean games for ages 3-8") is
left out because the age band is not settled. In-app purchase option 2 is the wording already in
`ios/IsabellaOceanTests/Products.storekit`; whichever is chosen, make the two match.

## Promotional text (156 of 170 characters)

---

Nine gentle ocean games for young children. No ads, no accounts, nothing collected. Eight games are free, and so is the first world of Isabella the Mermaid.

---

## Keywords (96 of 100 characters)

Comma-separated, no spaces. No word from the app name or the recommended subtitle is repeated.

---

mermaid,sea,jigsaw,puzzle,maze,memory,match,word,search,bubble,treasure,blocks,preschool,offline

---

Every keyword is something a game in `docs/GAMES.md` is or does. "preschool" rests on Bubble Party
(ages 3 to 5), Sea Jigsaw and Sea Catch (ages 3 to 8). Drop it if the age band starts at 4 or 5.

## Description (2,519 of 4,000 characters)

---

Isabella Ocean is nine gentle ocean games for children aged about 3 to 8. Your child never needs to read. Every game is played with taps, drags, swipes or a tilt of the device.

THE NINE GAMES
• Isabella the Mermaid (ages 5 to 8): Isabella swims after your child's finger, dodges sea creatures, finds the key and opens the treasure chest. 20 levels in two worlds.
• Bubble Party (ages 3 to 5): drag each sea creature's bubble down to its picture on the sand. 10 levels.
• Shell Match (ages 5 to 8): a memory game. Open the shells and find the pairs. 6 levels.
• Coral Maze (ages 5 to 8 and up): swipe to help Isabella swim out of coral mazes with keys, gates and currents. 20 Easy levels and 20 Hard levels.
• Sea Words (ages 5 to 8): a word search where every word comes with its picture. Easy, medium and hard, and a new puzzle every time.
• Treasure Blocks (ages 5 to 8 and up): slide and turn the sinking sea blocks to fill a row. Each row cleared lifts some mist from a picture of Isabella. Easy, Medium and Hard.
• Sea Jigsaw (ages 3 to 8): 30 pictures cut into real jigsaw pieces, from 4 pieces up to 40.
• Splash Dash (ages 5 to 8): tilt the device to steer Isabella along the surface of the sea. Holding a finger to one side steers her too. 20 courses.
• Sea Catch (ages 3 to 8): slide Isabella left and right to catch the falling sea friends in her shell. 10 levels.

GENTLE ON LITTLE ONES
No ads and no nagging. Mistakes are gentle. In Bubble Party a missed bubble just floats away. In Sea Jigsaw no piece can be lost. In Sea Catch a level cannot be failed. In Splash Dash a bump is only a splash, and every course ends at the treasure chest.

WHAT IS FREE
Eight of the nine games are free from start to finish. So is World 1 of Isabella the Mermaid, levels 1 to 10.

THE ONE THING TO UNLOCK
World 2 of Isabella the Mermaid, levels 11 to 20, is the only paid part. It is one purchase, made once. There is no subscription. The unlock does not expire, and Restore purchase brings it back after a reinstall or on a new device.

GROWN-UPS ONLY
The purchase sits behind a parent gate: press and hold for 3 seconds, then answer a multiplication. After that, the App Store still asks you to confirm. The links to our privacy policy and terms sit behind the same gate.

PRIVACY AND ADS
No ads. No accounts or sign-in. No analytics or tracking. Nothing about your child is collected, and game progress stays on your device. The games play offline.

Plays in landscape, full screen.

Support: support@isabellaocean.app

---

## What's New in This Version, 1.0 (222 characters; the limit is 4,000)

---

First release. Nine ocean games for children aged about 3 to 8: eight free, plus the free first world of Isabella the Mermaid. A grown-up can unlock World 2 with a one-time purchase. No ads, no accounts, nothing collected.

---

App Store Connect may not offer this field for the very first version of an app. If the field is not there,
this text is not needed.

## App Review notes (2,640 of 4,000 characters)

---

Isabella Ocean is nine small ocean games for young children. Eight games are free from start to finish. So is World 1 (levels 1 to 10) of the ninth game, Isabella the Mermaid. There are no accounts and no sign-in, so no demo account is needed.

The only purchase is one non-consumable In-App Purchase, "World 2" (app.isabellaocean.mobile.world2). It opens levels 11 to 20 of Isabella the Mermaid.

The title screen reads "Isabella the Mermaid". That is the name of the main game. The app is Isabella Ocean.

HOW TO REACH THE PURCHASE

From the padlock:
1. On the title screen, tap the big gold Play button in the middle.
2. The level map opens on World 1. Tap the pink arrow on the right to go to World 2.
3. Every World 2 level shows a gold padlock. Tap any of them.
4. A card says "Ask a grown-up". Tap the big gold button with the picture of a grown-up and a child.
5. Pass the parent gate (below).
6. The "Unlock World 2" screen opens. Tap the gold button "Unlock for" followed by the price. "Restore purchase" and "Redeem a code" are beside it.

From the title screen:
1. Tap the small round grown-ups button in the bottom-left corner of the title screen.
2. Pass the parent gate (below).
3. On the Grown-ups screen, tap "Unlock World 2". The same purchase screen opens. "Restore purchase" and "Redeem a code" are on the Grown-ups screen too.

"Redeem a code" opens Apple's own offer code sheet (AppStore.presentOfferCodeRedeemSheet). The app has no codes of its own.

THE PARENT GATE
Step 1: press and hold the big round button for 3 seconds. A ring fills around it. If you let go early, start again.
Step 2: a multiplication appears, a two-digit number times a one-digit number (for example 23 × 7). Type the answer on the number pad and tap OK. A wrong answer brings a new question.

Every purchase screen and every link out of the app sits behind this gate. The only links are "Privacy policy" and "Terms", at the foot of the two screens above. They open https://isabellaocean.app/apple/privacy and https://isabellaocean.app/apple/terms in the browser.

DATA AND NETWORK
The app collects no data. It has no accounts, no ads and no analytics. The app makes no network requests. The only connection is Apple's own In-App Purchase system, when a grown-up looks at, buys or restores the purchase. Game progress is saved on the device only.

SPLASH DASH
This game is steered by tilting the device, so it reads the motion sensor while it is played. The readings are not saved and not sent anywhere. Holding a finger to the left or right of Isabella steers her too, so it can be played without tilting.

Support: support@isabellaocean.app

---

## Links

These are the App Store build's own pages (`site/apple/`, docs/SITE.md), live since 9 Oct 2026.

- Privacy Policy URL: https://isabellaocean.app/apple/privacy
- Support URL: https://isabellaocean.app/apple/support
- Terms (linked from the app; App Store Connect has no field for it unless a custom licence is used): https://isabellaocean.app/apple/terms
- Marketing URL: leave empty for now. The home page describes the other build.
- Support contact: support@isabellaocean.app

## What was left out of `listing/listing.md`, and why

- Both unlock options (stake 1 SOL; pay US$4.99 in a token) and the whole "Notes for the reviewer"
  section about wallets and the stake pool: crypto.
- "made for the Solana Seeker" and "The app goes online only to reach the Solana network and Jupiter":
  not true of this build.
- The price: Apple shows it in the buyer's currency, and the brief asks for no prices in the description.
- "calm, colourful": `docs/GAMES.md` does not use those words. "gentle" is its own word ("Mistakes are
  gentle").
- "clam shells" (Shell Match) and "sea pictures" (Sea Jigsaw): `docs/GAMES.md` says "shells" and "30
  pictures".

## What was added, and where it comes from

- Level counts for Bubble Party (10), Shell Match (6) and Sea Catch (10): the table at the top of
  `docs/GAMES.md`.
- "Isabella swims after your child's finger, dodges sea creatures": `docs/GAMES.md`, "Isabella the
  Mermaid".
- "Each row cleared lifts some mist from a picture of Isabella": `docs/GAMES.md`, "Treasure Blocks".
- "Holding a finger to one side steers her too": `docs/GAMES.md`, "Splash Dash", Steering.
- The "Gentle on little ones" paragraph: the "Forgiving" lists for Bubble Party, Sea Jigsaw, Sea Catch
  and Splash Dash. It does not say "no timers", because Sea Jigsaw pays bonus coins for finishing sooner
  and Treasure Blocks speeds up on Hard.
- The one In-App Purchase and "the App Store still asks you to confirm": the brief for the iOS build.
- "Restore purchase", "Unlock for" and the price, "on a new device", where the legal links sit and the
  product ID: `web-iap/paywall.js` lines 151 to 200 and 271 to 280, and `ios/IsabellaOcean/Billing.swift`
  line 11.
- "full screen" and landscape: `ios/IsabellaOcean/Info.plist` (`UIRequiresFullScreen`, landscape only).
- The padlock route, the bottom-left grown-ups button and the two gate steps: `web/index.html` and
  `web/app.js`, which the iOS build packs unchanged, and the gate in `web-iap/paywall.js`.
- The motion sensor sentence: `ios/IsabellaOcean/GameViewController.swift` lines 181 to 185, which let
  the game read motion without a system prompt.

## Check before pasting

1. **The route and the labels in the App Review notes were checked in the Simulator on 9 Oct**
   (pictures in `.local/ios-shots/`): Play, the pink arrow, the gold padlocks, "Ask a grown-up", the
   gate, "Unlock for $4.99", "Restore purchase", "Redeem a code", the bottom-left grown-ups button.
   Not on a real device yet.
2. **The site is deployed** (9 Oct): the app's links and the two URLs above answer on
   `isabellaocean.app/apple/…`.
3. **Family Sharing is on** (his yes, 9 Oct): turn it on for the purchase in App Store Connect, and
   in `ios/IsabellaOceanTests/Products.storekit` if the tests should match.
4. **Motion.** The code grants the game the motion sensor without a prompt. If that changes and a
   prompt appears, say in the SPLASH DASH note when it appears.
5. **Ages and the Kids band (settled 9 Oct).** The listing says "about 3 to 8", his word. Apple's
   Kids Category takes one band only; he left the choice to the chat, which picked **"6–8"**, because
   six of the nine games are marked 5 to 8 and it is the band a 3-to-8 game overlaps most. It
   cannot be changed after approval, so it is his last look in App Store Connect.
6. **"The app makes no network requests."** Stated as the brief gives it. The notes add that Apple's
   own purchase system connects when a grown-up looks at, buys or restores the purchase, so a
   reviewer watching traffic is not surprised.
7. **Not drafted, because the repo cannot answer them:** the seller name and the copyright line
   (they follow the legal name the Apple account is in), the age-rating answers (None or No to every
   question: the app has no ads, chat, web access, user content, gambling or violence) and the
   privacy answers in App Store Connect ("Data Not Collected", which the brief and
   `ios/IsabellaOcean/PrivacyInfo.xcprivacy` both support).
8. **Governing law.** The Terms add no clause of their own (his word, 9 Oct: whatever gets it done).
   The app is licensed under Apple's standard licence agreement, which has its own, and the Terms
   say that nothing in them limits rights consumer law gives.

## Screenshots (made 9 Oct 2026, in `listing/appstore/`; a copy is in `~/Desktop/isabella-ocean-appstore/`)

Taken from the app itself in the Simulator by the picture tests (docs/IOS.md), at Apple's two
required sizes. Ten each, in this order: the title, Isabella the Mermaid, Bubble Party, Coral Maze,
Sea Jigsaw, Splash Dash, Sea Words, Shell Match, Treasure Blocks, Sea Catch. No picture shows a
price or World 2.

| Folder | For | Pixels |
|---|---|---|
| `iphone-6.9/` | iPhone 6.9-inch display | 2868 × 1320 |
| `ipad-13/` | iPad 13-inch display | 2752 × 2064 |
| `in-app-purchase-review.jpg` | the in-app purchase's review screenshot (the unlock screen; never shown on the store) | 2868 × 1320 |
