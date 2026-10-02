# Isabella the Mermaid

An offline Android game for a 6-year-old: Isabella swims through the sea, dodges creatures, finds the
key, and opens the treasure chest. 20 levels share one engine; each level only changes the dials
(speed, length, gaps, which obstacles appear, how many heart bubbles). World 2 (levels 11-20) adds
sliding gates, spinning urchin wheels, winch anchors, fish schools, eel rows, jelly walls and long
tunnels; beating level 20 earns Isabella a crown.

- `web/` is the game (plain HTML5 canvas, no libraries): `core.js` rules, `render.js` drawing,
  `audio.js` synthesised sound, `app.js` screens/input/saving. It is packed as the APK's assets.
- `android/` is a minimal WebView app (`app.isabella.mermaid`, no dependencies).
- `test/verify.js` proves every level can be finished, measures how tight each one is, and checks
  that levels 1-10 are byte-for-byte the levels she first learned.
- `test/tune.js` picks each world-2 level's layout (`seed`) so difficulty climbs level by level.
- `test/render.html?n=12&kind=wheel` draws one moment of a level, for screenshots without a phone.

## Build and install on the phone

```
node test/verify.js
cd android && JAVA_HOME=$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home ./gradlew assembleDebug
~/Library/Android/sdk/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk
```

`install -r` keeps her progress. Add `--ez pin true` to
`adb shell am start -n app.isabella.mermaid/.MainActivity` to pop the "Add to Home screen" prompt.

Grown-ups: hold the title for 4 seconds to unlock every level.

## Making another game from this

The game itself is four plain JavaScript files with no libraries and no build step:

- `web/core.js`: the rules. `LEVELS` is the level table, each obstacle's motion is a pure
  function of time, and `buildLevel` turns a level's dials into a layout. A new game mostly means
  new entries in `LEVELS` and new pattern builders.
- `web/render.js`: all drawing (the character, `THEMES` with one look per level, obstacles, the
  celebration).
- `web/audio.js`: synthesised sound effects and music.
- `web/app.js` + `web/index.html`: screens, touch input, saving, the Android back button.

`android/` is a dependency-free WebView shell. For a new game, copy it and change
`applicationId`/`namespace` in `android/app/build.gradle`, the package in `MainActivity.java`
(and its folder), the label in `AndroidManifest.xml`, and the icon in
`res/drawable/ic_launcher_fg.xml`.

Keep the habit that made this one solid: `node test/verify.js` proves every level can be finished
before each build, and `test/tune.js` picks layouts that hit a difficulty target.

---
Source published for the Solana Mobile CLOCK IN hackathon. All rights reserved.
