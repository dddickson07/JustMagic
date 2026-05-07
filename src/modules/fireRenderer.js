/**
 * fireRenderer — Three.js single-pass compositor.
 *
 *   ┌─────────────────────────────┐    ┌──────────────────────────────────┐
 *   │ camera <video> → VideoTex   │ ──►│                                  │
 *   │ fire  <video> → VideoTex    │ ──►│  composite.frag → screen         │
 *   │ palm uniforms (per hand)    │ ──►│  (screen-blend fire onto camera) │
 *   └─────────────────────────────┘    └──────────────────────────────────┘
 *
 * The fire is real photographic footage of flames on a black background
 * (`/fire-loop.mp4`), composited onto the camera feed with a screen-blend.
 * That's what every "AI fire VFX" short on the internet does, and it's the
 * only way to get fire that doesn't read as "shader."
 *
 * Per frame: read spellState + MediaPipe landmarks, derive palm position,
 * fire scale (from palm span × spell level), and per-hand opacity (from
 * openness × spell level), feed them as uniforms.
 */

import * as THREE from 'three';
import fullscreenVert from '../shaders/fullscreen.vert?raw';
import compositeFrag  from '../shaders/composite.frag?raw';

import { spellState } from './spellState.js';
import {
  palmCenterNorm,
  handOpenness,
  palmSpanNorm,
} from './handMath.js';
import { setFireVol } from './audio.js';

const MAX_HANDS    = 2;
const FIRE_VIDEO_URL = '/fire-loop.mp4';

// Visible fire height (in screen-UV-y units) per unit of palm span at level 1.
// Palm span of 0.05 (close-ish hand) × 6 = 0.30 → fire is 30% of screen tall.
// Tuneable knob — biggest visual lever.
const SCALE_PER_SPAN = 6.0;

export function createFireRenderer({ mountEl, videoEl }) {
  // ── Three.js boilerplate ────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  mountEl.appendChild(renderer.domElement);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const scene  = new THREE.Scene();

  // ── Camera video texture ────────────────────────────────────────────────
  const cameraTex = new THREE.VideoTexture(videoEl);
  cameraTex.colorSpace = THREE.SRGBColorSpace;
  cameraTex.minFilter  = THREE.LinearFilter;
  cameraTex.magFilter  = THREE.LinearFilter;
  cameraTex.generateMipmaps = false;

  // ── Fire video texture (loaded async, plays on a hidden <video>) ────────
  const fireVideo = document.createElement('video');
  fireVideo.src         = FIRE_VIDEO_URL;
  fireVideo.loop        = true;
  fireVideo.muted       = true;
  fireVideo.playsInline = true;
  fireVideo.crossOrigin = 'anonymous';
  fireVideo.style.cssText =
    'position:fixed;opacity:0;width:1px;height:1px;pointer-events:none;top:0;left:0';
  document.body.appendChild(fireVideo);

  // Autoplay restrictions: muted videos play on most browsers, but on Safari
  // we still need a user gesture. Worst case the texture is black until the
  // user clicks/keys, which is fine since the spell isn't active yet anyway.
  fireVideo.play().catch(() => {
    const kick = () => { fireVideo.play().catch(() => {}); cleanup(); };
    const cleanup = () => {
      window.removeEventListener('click', kick);
      window.removeEventListener('keydown', kick);
    };
    window.addEventListener('click', kick);
    window.addEventListener('keydown', kick);
  });

  const fireTex = new THREE.VideoTexture(fireVideo);
  fireTex.colorSpace = THREE.SRGBColorSpace;
  fireTex.minFilter  = THREE.LinearFilter;
  fireTex.magFilter  = THREE.LinearFilter;
  fireTex.generateMipmaps = false;
  fireTex.wrapS = fireTex.wrapT = THREE.ClampToEdgeWrapping;

  // ── Uniforms ────────────────────────────────────────────────────────────
  const palms     = Array.from({ length: MAX_HANDS }, () => new THREE.Vector2());
  const opacities = new Float32Array(MAX_HANDS);
  const scales    = new Float32Array(MAX_HANDS);

  const uniforms = {
    uVideo:        { value: cameraTex },
    uFireVideo:    { value: fireTex },
    uResolution:   { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    uVideoAspect:  { value: 16 / 9 }, // refined once metadata loads
    uTime:         { value: 0 },
    uActive:       { value: 0 },
    uCastFlash:    { value: 0 },
    uHandCount:    { value: 0 },
    uPalms:        { value: palms },
    uOpacities:    { value: opacities },
    uScales:       { value: scales },
  };

  fireVideo.addEventListener('loadedmetadata', () => {
    if (fireVideo.videoWidth && fireVideo.videoHeight) {
      uniforms.uVideoAspect.value = fireVideo.videoWidth / fireVideo.videoHeight;
    }
  });

  // ── Material + fullscreen quad ──────────────────────────────────────────
  const mat = new THREE.ShaderMaterial({
    vertexShader:   fullscreenVert,
    fragmentShader: compositeFrag,
    uniforms,
    depthTest:  false,
    depthWrite: false,
  });

  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));

  // ── Resize ──────────────────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    uniforms.uResolution.value.set(w, h);
  });

  // Smoothed activity so fire fades in/out gracefully when hands appear or
  // leave the frame, instead of popping.
  let smoothedActive = 0;

  function update(timeMs) {
    uniforms.uTime.value = timeMs * 0.001;

    spellState.castFlash *= 0.92;
    if (spellState.castFlash < 0.005) spellState.castFlash = 0;
    uniforms.uCastFlash.value = spellState.castFlash;

    const lms       = spellState.handLandmarks;
    const handsHere = Math.min(lms.length, MAX_HANDS);
    const baseLevel = spellState.level / 3;

    let totalIntensity = 0;
    let activeHands = 0;

    if (spellState.active && handsHere > 0) {
      for (let i = 0; i < handsHere; i++) {
        const lm   = lms[i];
        const palm = palmCenterNorm(lm);
        const open = handOpenness(lm);
        const span = palmSpanNorm(lm);

        // Opacity: fist → low, open palm → full, scaled by spell level.
        // The 0.45 floor means even a closed fist still shows *some* fire
        // since the spell is active, just dim and small.
        const opacity = (0.45 + open * 0.55) * baseLevel;

        // Scale grows with both palm span (so fire matches hand size) and
        // spell level (each escalation makes the column noticeably bigger).
        // Capped so a too-close hand doesn't fill the whole screen.
        const scale = Math.min(span * SCALE_PER_SPAN * (0.85 + baseLevel * 0.55), 0.85);

        // Convert MediaPipe (y down) → WebGL UV (y up).
        palms[i].set(palm.x, 1.0 - palm.y);
        opacities[i] = opacity;
        scales[i]    = scale;

        totalIntensity = Math.max(totalIntensity, opacity);
        activeHands++;
      }
      setFireVol(totalIntensity);
    } else {
      setFireVol(0);
    }

    const target = (spellState.active && activeHands > 0) ? 1 : 0;
    smoothedActive += (target - smoothedActive) * 0.18;

    uniforms.uActive.value    = smoothedActive;
    uniforms.uHandCount.value = activeHands;
  }

  function render(timeMs) {
    update(timeMs);
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  }

  return { render };
}
