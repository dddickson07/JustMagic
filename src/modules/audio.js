/**
 * audio — Web Audio sound effects.
 *
 *   playCastSound(level)   — dramatic rising-whoosh + crackle burst on cast
 *   startFireLoop()        — three-layer fire-burning loop:
 *                              · deep low-pass rumble (combustion roar)
 *                              · mid-band air hiss
 *                              · stream of randomly-scheduled crackle pops
 *                                (the most important "fire" signature)
 *   stopFireLoop()         — fades it out and tears it down
 *   setFireVol(v)          — overall fire-loop volume; gated to 0 when no
 *                            hands are visible so the audio matches the
 *                            visual.
 *
 * All loop layers route through a single master `fireGain` so setFireVol
 * adjusts everything (including in-flight crackles) uniformly.
 */

let audioCtx = null;
let fireGain = null;
let fireSrcs = null;        // { rumble, hiss } for cleanup
let crackleTimer = null;
let crackleNextTime = 0;

export function ensureAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

// ─── Cast sound (one-shot on each "Incendia") ─────────────────────────────
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

  // Initial whoosh of crackle on top of the cast.
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

// ─── Fire-burning loop (three layered sources) ────────────────────────────
function makeNoiseBuffer(seconds = 4) {
  const sr  = audioCtx.sampleRate;
  const len = sr * seconds;
  const buf = audioCtx.createBuffer(1, len, sr);
  const ch  = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
  return buf;
}

export function startFireLoop() {
  if (!audioCtx || fireGain) return;

  // Master fire gain — everything routes through here so setFireVol
  // controls all layers at once.
  fireGain = audioCtx.createGain();
  fireGain.gain.value = 0;
  fireGain.connect(audioCtx.destination);

  const noise = makeNoiseBuffer(4);

  // ── Layer 1: deep rumble (low-pass noise) ──────────────────────────────
  // 90 Hz lowpass produces the slow, heavy combustion bed underneath the
  // crackles. It's what gives fire its physical "presence" rather than just
  // sounding like a hiss.
  const rumbleSrc  = audioCtx.createBufferSource();
  rumbleSrc.buffer = noise;
  rumbleSrc.loop   = true;

  const rumbleFilt = audioCtx.createBiquadFilter();
  rumbleFilt.type            = 'lowpass';
  rumbleFilt.frequency.value = 90;
  rumbleFilt.Q.value         = 0.7;

  const rumbleGain = audioCtx.createGain();
  rumbleGain.gain.value = 0.85;

  rumbleSrc.connect(rumbleFilt);
  rumbleFilt.connect(rumbleGain);
  rumbleGain.connect(fireGain);
  rumbleSrc.start();

  // ── Layer 2: mid-band air hiss ─────────────────────────────────────────
  // 700 Hz bandpass — the rushing-air component of fire (the bright
  // sustained hiss between crackles).
  const hissSrc  = audioCtx.createBufferSource();
  hissSrc.buffer = noise;
  hissSrc.loop   = true;

  const hissFilt = audioCtx.createBiquadFilter();
  hissFilt.type            = 'bandpass';
  hissFilt.frequency.value = 700;
  hissFilt.Q.value         = 0.8;

  const hissGain = audioCtx.createGain();
  hissGain.gain.value = 0.30;

  hissSrc.connect(hissFilt);
  hissFilt.connect(hissGain);
  hissGain.connect(fireGain);
  hissSrc.start();

  fireSrcs = { rumble: rumbleSrc, hiss: hissSrc };

  // Master fire-loop fade-in over ~0.7s.
  fireGain.gain.linearRampToValueAtTime(0.07, audioCtx.currentTime + 0.7);

  // ── Layer 3: scheduled crackle pops ────────────────────────────────────
  // Lookahead scheduler — every 200 ms we schedule any crackles whose start
  // times fall within the next 500 ms. This avoids setTimeout drift since
  // the actual sound timing is committed to the AudioContext's clock.
  crackleNextTime = audioCtx.currentTime + 0.05;
  scheduleCrackles();
}

function scheduleCrackles() {
  if (!audioCtx || !fireGain) return;
  const lookahead = 0.5;
  while (crackleNextTime < audioCtx.currentTime + lookahead) {
    spawnCrackle(crackleNextTime);
    // 35–280 ms gap between crackles — irregular, the way real fire pops.
    crackleNextTime += 0.035 + Math.random() * 0.245;
  }
  crackleTimer = setTimeout(scheduleCrackles, 200);
}

function spawnCrackle(when) {
  if (!audioCtx || !fireGain) return;

  // Short percussive transient: cubic decay envelope on white noise gives
  // the snap-pop of a real ember crackle.
  const sr   = audioCtx.sampleRate;
  const len  = Math.floor(sr * (0.04 + Math.random() * 0.10)); // 40–140 ms
  const buf  = audioCtx.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const env = Math.pow(1 - i / len, 3);
    data[i] = (Math.random() * 2 - 1) * env;
  }

  const src    = audioCtx.createBufferSource();
  src.buffer   = buf;

  const filt   = audioCtx.createBiquadFilter();
  filt.type            = 'bandpass';
  // Crackles span 1.2–4.5 kHz to mimic the spectral spread of real wood pops.
  filt.frequency.value = 1200 + Math.random() * 3300;
  filt.Q.value         = 1.2 + Math.random() * 1.8;

  const g = audioCtx.createGain();
  // Slight stereo-loudness variance so crackles don't all sound identical.
  g.gain.value = (0.04 + Math.random() * 0.10);

  src.connect(filt);
  filt.connect(g);
  g.connect(fireGain);
  src.start(when);
}

export function stopFireLoop() {
  if (!fireGain || !audioCtx) return;
  fireGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.3);

  if (crackleTimer) { clearTimeout(crackleTimer); crackleTimer = null; }

  const sources = fireSrcs;
  fireGain = null;
  fireSrcs = null;

  setTimeout(() => {
    try { sources.rumble.stop(); } catch (_) {}
    try { sources.hiss.stop();   } catch (_) {}
  }, 1200);
}

export function setFireVol(v) {
  if (!fireGain || !audioCtx) return;
  fireGain.gain.setTargetAtTime(Math.max(0, v * 0.13), audioCtx.currentTime, 0.1);
}
