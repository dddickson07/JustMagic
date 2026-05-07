/**
 * hud — DOM-side display layer. Owns the mic-status badge, the spell-level
 * dots, the spell-flash splash, and the active label. The renderer never
 * touches the DOM; everything visual that's NOT WebGL routes through here.
 */

const micStatusEl   = document.getElementById('mic-status');
const spellTextEl   = document.getElementById('spell-text');
const activeLabelEl = document.getElementById('active-label');
const dots = ['d0', 'd1', 'd2'].map(id => document.getElementById(id));

export function setMicStatus({ kind, message }) {
  micStatusEl.textContent = message;
  micStatusEl.className   = kind || '';
}

export function setSpellLevelDots(level) {
  dots.forEach((d, i) => { d.className = 'dot' + (i < level ? ' lit' : ''); });
}

export function flashSpell(text) {
  spellTextEl.textContent = text;
  spellTextEl.className   = '';
  // Force reflow so the animation can replay even on identical text.
  void spellTextEl.offsetWidth;
  spellTextEl.className = 'flash';
}

export function setActiveLabel(on) {
  activeLabelEl.className = on ? 'on' : '';
}
