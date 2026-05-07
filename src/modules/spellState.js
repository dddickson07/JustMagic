/**
 * spellState — single source of truth for what spell is active and how strong it is.
 * Other modules read from / mutate this; the renderer reads it each frame.
 */
export const spellState = {
  active: false,
  level: 0,                 // 0..3 — escalates on each "Incendia" while already active
  castFlash: 0,             // 0..1 — burst that fades each frame after a cast
  handLandmarks: [],        // last MediaPipe result (mirrored later by handMath helpers)
  handsReady: false,
};

export function activateFire() {
  if (!spellState.active) {
    spellState.active = true;
    spellState.level = 1;
  } else {
    spellState.level = Math.min(spellState.level + 1, 3);
  }
  spellState.castFlash = 1.0;
}

export function deactivateFire() {
  spellState.active = false;
  spellState.level = 0;
}
