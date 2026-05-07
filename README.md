# JustMagic ✦ — original prototype

This branch is the **single-file Canvas2D particle prototype** from before the Cursor session rewrote the visual layer. It's preserved unmodified so you can roll back here at any time:

```bash
git checkout claude-original-prototype
```

## What's here

Just `index.html` — one self-contained file. No build step, no dependencies installed locally. To run:

1. Open `index.html` directly in **Chrome** (drag-drop into a tab, or `open index.html`).
2. Allow camera + mic when prompted.
3. Say **"Incendia"** to conjure fire, **"Finite"** to dismiss. Or press `I` / `X`.

## What it includes

- Camera feed via `getUserMedia` + MediaPipe Hands (loaded from CDN)
- Web Speech API for voice commands
- Web Audio API for cast sounds + filtered-noise fire loop
- Canvas2D particle system: `FireParticle` (elliptical flame tongues), `Ember` (sparks with gravity), `Sparkle` (ambient)
- Two-pass bloom via offscreen canvas + CSS `filter: blur()`
- Two-hand "orb" mode (palms close together → spinning fireball between hands)
- HUD: mic status, spell-level dots, cast flash text

## Why it exists

The `main` branch was rewritten to use Three.js + GLSL shaders for the fire VFX. If that direction doesn't pan out, this branch is the working starting point to iterate from instead.
