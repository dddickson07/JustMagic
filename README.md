# JustMagic ✦

Voice-activated firebending in the browser. Open the page, allow camera + mic, hold up your hand, say **"Incendia"** — fire erupts from your palm.

Inspired by *Avatar: The Last Airbender* and *The Vampire Diaries*. Built in a day.

## What it does

- **Voice commands** trigger spells. Say *"Incendia"* (Latin for *kindle*) to conjure fire. Say it again to escalate intensity (3 levels). Say *"Finite"* to dismiss.
- **MediaPipe Hands** tracks 21 landmarks per hand at 30+ FPS. Fire follows your palm; intensity scales with hand openness — fist = small embers, open palm = roaring flame.
- **Real-time WebGL fire VFX**. Two-layer domain-warped FBM noise, HDR core blowout, multi-tap bloom, heat-shimmer distortion of the camera feed, warm light cast on whatever's near the flames, additive ember particles. No stock footage — pure procedural shaders running on your GPU.
- **Web Audio** — dramatic rising-whoosh on cast + filtered-noise fire roar that gates with hand presence.

## Run it

```bash
npm install
npm run dev
```

Open the printed URL in **Chrome**. Web Speech needs a Chromium browser; Safari and Firefox won't have voice (but `I` and `X` keys work for testing).

## Controls

| Action | Voice | Keyboard |
|---|---|---|
| Conjure fire | `Incendia` | `I` |
| Escalate | `Incendia` again (max 3) | `I` again |
| Dismiss | `Finite` / `Extinguish` | `X` or `Escape` |

## Project structure

```
JustMagic/
├── index.html                      HUD + styles only
├── src/
│   ├── main.js                     entry point — wires everything together
│   ├── modules/
│   │   ├── spellState.js           single-source-of-truth state
│   │   ├── handMath.js             palm centre, openness, span helpers
│   │   ├── handTracking.js         MediaPipe + camera setup
│   │   ├── voice.js                Web Speech API wrapper
│   │   ├── audio.js                cast sound + fire-loop audio
│   │   ├── hud.js                  DOM (mic badge, level dots, spell flash)
│   │   └── fireRenderer.js         Three.js scene + 2-pass shader pipeline
│   └── shaders/
│       ├── fullscreen.vert         passthrough vertex shader
│       ├── fire.frag               procedural fire (FBM + domain warp + temp gradient)
│       └── composite.frag          camera + bloom + light cast + heat distortion
├── package.json
└── vite.config.js
```

## Rendering pipeline

```
┌──────────────────────┐    ┌────────────────────────────────────────┐
│ fire.frag fullscreen │ →  │ composite.frag → screen:               │
│ → fireRT (HDR RGBA)  │    │  • heat-distorts the camera video      │
│  rgb = fire colour   │    │  • 24-tap bloom around the fire        │
│  a   = heat field    │    │  • strong warm light cast on camera    │
└──────────────────────┘    │  • cast-flash + vignette + tonemap     │
                            │  • additive ember particles overlay    │
                            └────────────────────────────────────────┘
```

The fire shader produces HDR colour (values can exceed 1.0) into a HalfFloat render target. The composite pass then samples that target with two concentric bloom rings to create the glow, displaces the camera feed using the heat-field channel for shimmer, and tints the camera pixels warm orange in proportion to the fire-presence field.

## Tuning

The biggest visual knobs:

- **`RADIUS_PER_SPAN`** in `fireRenderer.js` — fire size relative to the user's palm.
- **`MAX_RADIUS`** — cap so close-up hands don't fill the screen.
- **`smoothstep(0.10, 0.95, fire)`** in `fire.frag` — controls how dense vs wispy the flames look. Wider range = wispier, tighter range = denser.
- **Temperature gradient stops** in `fire.frag` — change the colour palette (cooler / hotter / different element).

## Add more spells

Each spell is a regex in `voice.js` + a particle/shader response. Latin names match the *Vampire Diaries / HP* aesthetic — `Aqua` for water, `Ventus` for wind, `Glacius` for ice, `Lux` for light. Adding one is ~30 lines: regex → state flag → its own shader effect.

## Stack

- [Vite](https://vitejs.dev) — dev server + bundler
- [Three.js](https://threejs.org) — WebGL abstraction
- [`@mediapipe/hands`](https://google.github.io/mediapipe/solutions/hands.html) — 21-landmark hand tracking
- [`@mediapipe/camera_utils`](https://github.com/google-ai-edge/mediapipe) — camera frame pump
- Web Speech API (browser-native)
- Web Audio API (browser-native)

## License

MIT.
