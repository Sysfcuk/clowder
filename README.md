# Clowder

**Grow your clowder. Claim the Rift.**

*A clowder is a group of cats.* Clowder is a cosmic strategy game for the browser: Galactic
Cats and Dino Cats fight over a floating lattice of hexes. Clone a step, leap two, and every
enemy you land beside joins your side. It runs on **Three.js** with real-time shadows, AgX
colour, bloom and a filmic grade. Every piece of art and sound is procedural: no image or
audio files, no build step, no dependencies to install.

## Run

ES modules and Web Workers need an HTTP server, not `file://`. `serve.py` is a static
server that disables caching, so edits always load:

```powershell
python serve.py 8123
```

Then open <http://localhost:8123>. Any static server works.

## Android app

`android/` is a small native wrapper: a single full-screen WebView that serves the game from
files packed inside the APK (via `WebViewAssetLoader` on `https://appassets.androidplatform.net`).
That origin is needed because ES modules, import maps and Web Workers don't work from `file://`.
Nothing is downloaded at runtime: three.js and the fonts are vendored in `vendor/`.

```powershell
.\build-android.ps1            # debug APK  -> Clowder-debug.apk
.\build-android.ps1 -Install   # ...and install + launch on a connected phone or running emulator
.\build-android.ps1 -Release   # signed release APK (needs android\keystore.properties)
```

Needs a JDK 17 (`winget install Microsoft.OpenJDK.17`) and the Android SDK (found in
`%LOCALAPPDATA%\Android\Sdk`). Gradle downloads itself on the first build, and the build copies
the current game into the APK every time. Sideload: copy `Clowder-debug.apk` to a phone and
open it (allow installs from unknown sources), or plug in with USB debugging and use `-Install`.

What the wrapper adds:

* immersive full screen, screen kept on, rotation in any direction;
* music allowed to start without a tap first;
* vibration on moves, captures and merges;
* timers and audio paused in the background;
* the **back button** steps back through the UI (skip the story, close a panel, deselect, open
  the menu, return to the game) and only then exits.

On phones the game also caps the resolution at 1.5x, halves the shadow map, frames the board
for tall screens, and plays Quick Play on the 61-cell board, so every hex is a comfortable tap
target. Debug builds forward the page's console to logcat (tag `Clowder`) and allow
`chrome://inspect`.

**Play Store:** create a keystore (`keytool -genkey -v -keystore clowder.jks -keyalg RSA -keysize
2048 -validity 10000 -alias clowder`), then put `storeFile`, `storePassword`, `keyAlias` and
`keyPassword` in `android/keystore.properties` (gitignored). The store wants an app bundle,
so run `gradlew.bat bundleRelease` in `android/`.

**As a website,** the game is also an installable PWA: there's a web manifest, icons, and a
network-first service worker for offline play.

Icons are drawn by `tools/make_icons.py` (pure Python) and dependencies are fetched by
`tools/vendor.py`. Re-run either after changing the emblem or the three.js version.

## Rules

Pick a cat, then a glowing hex. A **clone** (gold, 1 step) adds a cat. A **leap** (green,
2 steps) moves it. Every enemy touching the hex you land on joins you. If the side to move is
stuck, the other side claims every empty hex. Most power wins. If 50 moves pass without the
board getting fuller than its record, the game ends as it stands.

## Modes

| Mode | What's new |
|---|---|
| Cat Clash | Galactic vs Dino (and Robo Cat with 3 players), with Cascade and Merge. **PLAY** starts this |
| Origin | The pure game: no twists |
| Triad | Three players (human or AI in any seat) on the 85-cell Grand board |
| Cascade | Captures chain: an enemy left touching 4+ of your pieces flips too, in waves |
| Tectonic | Every two rounds the outer ring turns clockwise and the inner ring turns back, carrying pieces |
| Fog of War | You see only within 2 hexes of your pieces. Hot-seat play hides the board between turns |
| Blitz | 60 s chess clock, +2 s per move |
| Misère | Fewest wins; clones only |
| Hyperspace | 3D: three stacked layers |
| Tesseract | 4D: two parallel worlds × three layers |
| Daily Rift | A date-seeded procedural board and twist against the Master AI; best margin is saved |

Every mode is a preset of **mutators**, which you can mix freely under *All modes*. Boards:
Classic, Compact (37), Grand (85), Halo (ring), Rift (procedural symmetric holes), plus the 3D
and 4D boards. Pieces come in two skins: **Cats** (default) or **Gems** (Ruby, Pearl, Jade).

## Presentation: how it was designed

The look was rebuilt from first principles. Presentation is everything the player perceives,
so each of these exists to fix a specific problem:

| Principle | What it became |
|---|---|
| **One voice** | One name, one emblem (a hex badge with a cat face, half Galactic, half Dino), one type pairing (Lilita One + Nunito), one colour story (two faction colours plus gold for actions). No emoji anywhere. |
| **The world is the hero** | The menu is a side panel over a live AI exhibition game, not a modal that hides it. |
| **Faces, not icons** | Faction portraits are rendered from the real 3D cats at startup and used in the HUD, the VS screen, the menu and the results screen. |
| **Weight** | The board sits on a floating rock island with faction crystals. A soft-shadowed key light grounds every cat. Big captures kick the camera's field of view. |
| **Read it at a glance** | Territory paint washes each owned tile in its owner's colour. A tug-of-war bar shows who's winning. Active-player cards glow, and AI turns show "thinking" dots. |
| **One motion language** | A single hex-iris wipe for every scene change, springy UI entrances, tactile buttons with a pressable edge. |
| **Colour you can trust** | AgX tone mapping (saturated colours don't clip to white), colours authored in sRGB, half-resolution bloom, then a final grade: vignette, edge fringing and film grain. |
| **Sound is half of it** | A generative score in D (pads, bass, arpeggio, light percussion) whose pulse follows the game's tension. Clones and captures play notes from the current chord, so a multi-capture plays a rising arpeggio in key. One button cycles music + effects → effects → mute. |
| **Smooth is quality** | Adaptive resolution steps the pixel ratio down if the frame rate drops and back up when it recovers. |

### Lightning and lasers

Bolts are generated live by midpoint displacement: a jagged main channel plus forks. Each is
drawn as a white-hot core inside a coloured glow, and re-rolls its shape a few times as it
flickers. A short-lived point light flashes at each strike, so nearby cats and tiles light up.
Lasers have a core, glow and halo, shoot out from a muzzle flash, and hit with sparks and a ring.

| Where | What happens |
|---|---|
| Galactic Cat captures | Twin eye-lasers (pink and cyan) from the attacker's actual eyes; meteors follow on 2+ captures |
| Dino Cat captures | A roar, then lightning crawls along the ground to every victim |
| Robo Cat captures | A heavy laser, then chain lightning hops from victim to victim |
| Gem skin captures | Arcs from the landing piece to each victim |
| Cascades | Each wave is struck from the nearest piece of the previous wave |
| Merges | A sky strike onto the merging cat, with thunder |
| Aiming | A laser sight from your cat to the hovered hex |
| The Rift | Distant storm: sky strikes every 5–14 s, the nebula lights up, and thunder arrives after a delay |
| Intro and victory | Lightning tears the sky open, strikes the board's corners as the title lands, and storms around the winner |

### First launch

A boot screen waits for the fonts and the first rendered frame, so nothing pops in
half-styled. First-time players then *tap to begin* (browsers only allow sound after a tap),
which plays the story. *The Rift* is a short cinematic in the game's own 3D scene: the
universe tears in two, a Galactic Cat streaks past a ringed planet, a volcano erupts and a
Dino Cat roars back. The island rises as the Rift assembles tile by tile. Then real moves on a
demo board teach **Clone, Leap, Convert and Merge** before the title lands. Click or Space skips
a scene, **Skip ▸▸** or Esc skips the rest, and *The story* on the menu replays it.
### Merge and crowned pieces

With the **Merge** mutator (on in Cat Clash), a piece can step onto a neighbouring piece of
its own with the same level, and the two fuse into one crowned piece (★2, then ★3). A crowned
piece:

* is worth its level in points (scores are *power*: the sum of levels);
* survives a hit by losing a level (its crown pops off) instead of converting;
* is drawn larger, with a gold crown (cats) and glowing aura rings.

A merge converts nothing, so it is a defensive investment that frees a hex to clone into.
(Merges that also converted made clone-merge-clone loops churn without the board ever filling.
Self-play showed games stalling with half the board empty, so merges became upgrades only.)
For the same reason the end rule is a **stall rule**: 50 moves without the board getting fuller
than its record ends the game as it stands. For classic play this is the same as the old
"50 jumps without a clone".

### Conversions

Each capturing move uses one of several conversion styles, weighted by faction:

* somersault flip;
* hypno-spin (spiral rings close in);
* UFO abduction (tractor beam lift and set-down);
* yarn-ball bonk (a ball of yarn is lobbed from the attacker);
* love-struck hearts.

In Cat Clash these come on top of each faction's signature strike: meteors, roar or lasers.

### Playing comfortably

* **Quick Play** on the menu starts Cat Clash against the computer in one click.
  *2 players, 1 screen* and every other mode and setting are one click further.
* **Drag** a piece onto a glowing hex, or click it and then click the hex.
* A **coach line** at the bottom always says what you can do right now (✕ hides it).
* A **YOUR TURN** banner, **+N / −N** score pops and floating previews (+gain, ⛨ cracks,
  MERGE → ★) make every move readable before and after you make it.

### The Journey: Across the Rift

A 15-stage campaign (menu: **The Journey**). You play Nova, a young Galactic Cat, against
Rex the Dino warlord, then Unit-9, a Robo Cat from beyond the Veil. Elder Comet narrates.

| Chapter | Stages | What it teaches |
|---|---|---|
| 1. The Shattered Shore | First Light · Leap of Faith · Crowned · Chain Lightning · **Rex, the Tyrant Tail** | clone, leap, merge, cascades; boss: every Rex cat starts crowned |
| 2. The Shifting Wilds (8★) | Fault Lines · Into the Fog · The Halo · Against the Clock · **The Rift Storm** | tectonic, fog, crowns + cascades, blitz; boss: shattered board, Rex with a doubled army |
| 3. Beyond the Veil (20★) | Unit-9 Awakens · Ascension · Two Worlds · Triad War · **Heart of the Rift** | 3-player wars, the 3D spire, 4D worlds; finale: Unit-9's cats all Legendary ★3, Master AI |

* **Scenes:** dialogue before and after every stage, with the factions' rendered portraits
  and a typewriter effect. Tap to advance, Skip to jump ahead.
* **Stars:** each stage has three objectives: win, plus two challenges such as "win by 8",
  "merge 3 times", "convert 5 in one move", "no undo or hints" or "finish with 20 s on the
  clock". Your best result per objective is kept.
* **Progression:** clearing a stage opens the next; chapters open at 8★ and 20★. Your
  star total earns ranks from *Stray* through *Kitten Scout*, *Rift Prowler*, *Star Stalker*,
  *Clowder Captain* and *Legend of the Rift* to *Rift Sovereign* (all 45★). Results show
  stars flying in, each objective ticked or crossed, and what you just unlocked.
* **Data:** stages live in `src/journey.js` (plain data plus small setup functions for boss
  twists). Screens are in `src/journey-ui.js`. Progress is saved in localStorage
  (`hx.journey`).

### Multi-dimensional boards

Cells are `(q, r, layer, world)`, and distance is hex distance + |Δlayer| + |Δworld|. A clone can
go to the 6 hexes in its plane, the hex directly above or below, or its twin in the other
world. A jump is any cell at distance 2, and captures reach across layers and worlds too. Boards:
Spire (3 × 37 cells), Tower (5 × 19) and Tesseract (2 worlds × 3 × 19). In game, **1–5** shows one
layer, **0** shows all and **X** spreads the stack apart. Gold threads show moves that leave the
current plane. The rules, AI and every mutator work on these boards unchanged, because they only
see neighbour lists.

### Cat Clash

Choose **Pieces: Cats** in the menu for any mode, or pick the Cat Clash preset. The pieces are
procedural 3D cats that breathe, blink, swish their tails, turn to face their moves and
somersault when they jump:

* **Galactic Cat**: nebula fur with glowing stars, a bubble helmet and a comet-star tail. Its
  captures call down meteors.
* **Dino Cat**: scaly hide, spine spikes, fangs and slit eyes. Its captures set off a roar
  shockwave that shakes the camera.
* **Robo Cat** (3 players): chrome plating with a scanning visor. Its captures fire lasers.

You also get a VERSUS splash, a split-universe sky (nebula and ringed planet on one side,
an erupting volcano and fern islands on the other), tiles that glow in their owner's colour,
taunt bubbles on multi-captures, synthesised meows and roars, and a victory dance with
fireworks.

The AI runs in a Web Worker: alpha-beta minimax, "paranoid" in 3-player games, with four
levels from Easy (noisy depth 1) to Master (iterative deepening, time-boxed).

Keys: **U** undo · **H** hint · **M** mute · **F** fullscreen · **P** photo mode · **Esc** menu. Drag to orbit, scroll to zoom.

### Graphics (`src/gfx.js`)

- **Tiers.** Auto, Low, Medium, High and Ultra, chosen in Settings → Graphics. Auto picks Medium on phones and High on desktop.
- **Lighting and post-processing.**
  - Ambient occlusion (GTAO).
  - God rays from the key light, plus drifting dust motes.
  - Half-resolution bloom.
  - A final grade pass that adds vignette, grain, shockwave ripples and a glitch effect for Robo moves.
- **Tiles and territory.**
  - Clearcoat crystal tiles with an inner glow in the owner's colour. Ultra adds glass transmission.
  - Territory changes are painted on with a burning-edge dissolve.
  - Tiles look wet after a Dino roar.
- **Reflections.** A cube camera feeds the glossy chrome, armour and island rim.
- **Cats.** Fur has rim light. Eyes and heads follow your cursor and the action. Pieces squash and stretch when they land.
- **Particles.** GPU particles in a ring buffer (24k): sparks, vortexes for merges and confetti.
- **Skies.** Each Journey chapter has its own living sky (aurora, galaxy band or storm).
- **Director.** Big cascades and crowned merges get a slow-motion close-up with depth of field, and wins get a low hero shot.
- **Screen transitions.** A shattering hex wipe.
- **Photo mode** (camera button or **P**). Freezes time and frees the camera. Offers five filters, focus blur and HUD-free capture.

## Code

```
index.html            UI shell, styles, import map
src/rules.js          board shapes, move generation, captures, cascade, tectonic, end rules
src/ai.js             search (shared by the worker and the tests)
src/ai.worker.js      worker wrapper
src/render.js         Three.js scene, materials, animation and effects
src/cats.js           procedural cat models and their idle animation
src/intro.js          the opening cinematic
src/audio.js          WebAudio synth
src/main.js           game flow, modes, HUD, menu, transitions, persistence
tests/selfplay.html   AI-vs-AI games under every rule set; checks legality and invariants
```
