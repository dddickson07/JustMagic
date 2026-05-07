/**
 * audio — Web Audio sound effects.
 *  - playCastSound(level): dramatic rising-whoosh + crackle burst when conjuring
 *  - startFireLoop / stopFireLoop / setFireVol: continuous filtered-noise fire roar
 *
 * setFireVol(0) is called whenever there are no hands in frame so the audio
 * gates with the visual.
 */

let audioCtx = null;
let fireGain = null;
let fireSrc  = null;

export function ensureAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

export function playCastSound(level) {
  if (!audioCtx) return;
  const t  = audioCtx.currentTime;
  const iv = level / 3;

  const osc = audioCtx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(250 + iv * 350, t);
  osc.frequency.exponentialRampToValueAtTime(55, t + 1.4);

  const filt = audioCtx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 800;
  filt.Q.value = 2.5;

  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.2 * iv, t + 0.07);
  g.gain.exponentialRampToValueAtTime(0.001, t + 1.6);

  osc.connect(filt); filt.connect(g); g.connect(audioCtx.destination);
  osc.start(t); osc.stop(t + 1.7);

  const bLen = audioCtx.sampleRate * 0.35;
  const bBuf = audioCtx.createBuffer(1, bLen, audioCtx.sampleRate);
  const bd   = bBuf.getChannelData(0);
  for (let i = 0; i < bLen; i++) {
    bd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bLen * 0.25));
  }
  const burst = audioCtx.createBufferSource();
  burst.buffer = bBuf;
  const bg = audioCtx.createGain();
  bg.gain.value = 0.14 * iv;
  burst.connect(bg); bg.connect(audioCtx.destination);
  burst.start(t + 0.04);
}

export function startFireLoop() {
  if (!audioCtx || fireGain) return;
  const sr  = audioCtx.sampleRate;
  const len = sr * 4;
  const buf = audioCtx.createBuffer(1, len, sr);
  const ch  = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;

  fireSrc = audioCtx.createBufferSource();
  fireSrc.buffer = buf;
  fireSrc.loop = true;

  const f = audioCtx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 300;
  f.Q.value = 0.9;

  fireGain = audioCtx.createGain();
  fireGain.gain.value = 0;
  fireSrc.connect(f); f.connect(fireGain); fireGain.connect(audioCtx.destination);
  fireSrc.start();
  fireGain.gain.linearRampToValueAtTime(0.07, audioCtx.currentTime + 0.7);
}

export function stopFireLoop() {
  if (!fireGain || !audioCtx) return;
  fireGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.3);
  const s = fireSrc;
  fireGain = null;
  fireSrc = null;
  setTimeout(() => { try { s.stop(); } catch (_) {} }, 1200);
}

export function setFireVol(v) {
  if (!fireGain || !audioCtx) return;
  fireGain.gain.setTargetAtTime(Math.max(0, v * 0.13), audioCtx.currentTime, 0.1);
}
