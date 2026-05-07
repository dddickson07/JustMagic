/**
 * main.js — entry point. Wires the whole app together:
 *   - HUD elements
 *   - Audio context (lazily, on first cast)
 *   - MediaPipe Hands + camera
 *   - Web Speech voice commands
 *   - Three.js fire renderer
 *   - Keyboard fallbacks (I = cast, X/Esc = dismiss)
 *
 * No module here owns more than its slice. Cross-module communication
 * happens through `spellState` (data) and explicit callback wiring (events).
 */

import {
  spellState,
  activateFire as setActive,
  deactivateFire as setInactive,
} from './modules/spellState.js';
import {
  ensureAudio,
  playCastSound,
  startFireLoop,
  stopFireLoop,
} from './modules/audio.js';
import { setupVoice } from './modules/voice.js';
import { startHandTracking } from './modules/handTracking.js';
import {
  setMicStatus,
  setSpellLevelDots,
  flashSpell,
  setActiveLabel,
} from './modules/hud.js';
import { createFireRenderer } from './modules/fireRenderer.js';

setMicStatus({ kind: '', message: '◎ Initializing…' });

function activateFire() {
  ensureAudio();
  const wasActive = spellState.active;
  setActive();

  if (!wasActive) startFireLoop();

  playCastSound(spellState.level);

  const marks = spellState.level > 1 ? ' ' + '✦'.repeat(spellState.level - 1) : '';
  flashSpell('INCENDIA' + marks);
  setSpellLevelDots(spellState.level);
  setActiveLabel(true);
}

function deactivateFire() {
  if (!spellState.active) return;
  setInactive();
  stopFireLoop();
  flashSpell('FINITE');
  setSpellLevelDots(0);
  setActiveLabel(false);
}

window.addEventListener('keydown', e => {
  if (e.key === 'i' || e.key === 'I') activateFire();
  if (e.key === 'x' || e.key === 'X' || e.key === 'Escape') deactivateFire();
});

setupVoice({
  onCast: activateFire,
  onDismiss: deactivateFire,
  onStatus: setMicStatus,
});

const stageEl = document.getElementById('stage');

(async () => {
  const videoEl = await startHandTracking({ onStatus: setMicStatus });

  const { render } = createFireRenderer({ mountEl: stageEl, videoEl });

  function frame(t) {
    render(t);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
