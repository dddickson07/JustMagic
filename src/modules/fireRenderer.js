/**
 * fireRenderer — Three.js two-pass shader-VFX pipeline (v3 — pure procedural).
 *
 *   ┌──────────────────────┐    ┌────────────────────────────────────────┐
 *   │ fire.frag fullscreen │ →  │ composite.frag → screen:               │
 *   │ → fireRT (HDR RGBA)  │    │  • heat-distorts the camera video      │
 *   │  rgb = fire colour   │    │  • 24-tap bloom around the fire        │
 *   │  a   = heat field    │    │  • strong warm light cast on camera    │
 *   └──────────────────────┘    │  • cast-flash + vignette + tonemap     │
 *                               └────────────────────────────────────────┘
 *   ┌──────────────────────┐
 *   │ Embers (THREE.Points)│ — additively rendered sparks on top
 *   └──────────────────────┘
 *
 * No video textures. No stock footage. Just procedural noise + bloom + the
 * camera feed, all running on the GPU. The fire reads as fire because of
 * the combined contribution of: dense two-layer noise, HDR core blowout,
 * heavy bloom, and warm light cast on the surroundings — not just one of
 * those in isolation.
 */

import * as THREE from 'three';
import fullscreenVert from '../shaders/fullscreen.vert?raw';
import fireFrag       from '../shaders/fire.frag?raw';
import compositeFrag  from '../shaders/composite.frag?raw';

import { spellState } from './spellState.js';
import {
  palmCenterNorm,
  handOpenness,
  palmSpanNorm,
} from './handMath.js';
import { setFireVol } from './audio.js';

const MAX_HANDS = 2;

// Visible fire RADIUS (in screen-UV-y units) per unit of palm span at level 1.
// Palm span ~0.10 × 1.6 = 0.16 → fire radius is 16% of screen height.
// This is the single most important "doesn't get too big" knob.
const RADIUS_PER_SPAN = 1.6;
// Maximum fire radius regardless of how close the hand is to the camera.
const MAX_RADIUS = 0.32;

// Ember system caps.
const EMBER_CAPACITY = 220;

export function createFireRenderer({ mountEl, videoEl }) {
  // ── Three.js boilerplate ────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  mountEl.appendChild(renderer.domElement);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fireScene      = new THREE.Scene();
  const compositeScene = new THREE.Scene();

  // ── Camera video as a texture for the composite pass ────────────────────
  const videoTex = new THREE.VideoTexture(videoEl);
  videoTex.colorSpace = THREE.SRGBColorSpace;
  videoTex.minFilter  = THREE.LinearFilter;
  videoTex.magFilter  = THREE.LinearFilter;
  videoTex.generateMipmaps = false;

  // ── HDR render target for the fire pass ─────────────────────────────────
  // HalfFloat lets the shader output values above 1.0 (the "white-hot core
  // blowout"); the bloom pass then turns those super-bright pixels into
  // proper HDR glow. Without this the core caps at flat yellow.
  const fireRT = new THREE.WebGLRenderTarget(
    window.innerWidth, window.innerHeight, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    }
  );

  // ── Uniforms (pre-allocated; never reassigned per frame) ────────────────
  const palms       = Array.from({ length: MAX_HANDS }, () => new THREE.Vector2());
  const intensities = new Float32Array(MAX_HANDS);
  const radii       = new Float32Array(MAX_HANDS);

  const fireUniforms = {
    uTime:        { value: 0 },
    uResolution:  { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    uActive:      { value: 0 },
    uCastFlash:   { value: 0 },
    uHandCount:   { value: 0 },
    uPalms:       { value: palms },
    uIntensities: { value: intensities },
    uRadii:       { value: radii },
  };

  const compositeUniforms = {
    uVideo:      { value: videoTex },
    uFire:       { value: fireRT.texture },
    uResolution: { value: fireUniforms.uResolution.value },
    uTime:       { value: 0 },
    uCastFlash:  { value: 0 },
  };

  fireScene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: fireFrag,
      uniforms: fireUniforms,
      depthTest: false, depthWrite: false,
    })
  ));

  compositeScene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: compositeFrag,
      uniforms: compositeUniforms,
      depthTest: false, depthWrite: false,
    })
  ));

  // ── Ember particles (THREE.Points, additive) ────────────────────────────
  // Sparks shot off the top of the flames. Each ember has position, velocity,
  // life, size. We update them on the CPU and re-upload the buffer; cheap
  // for ~200 particles.
  const emberPositions = new Float32Array(EMBER_CAPACITY * 3);
  const emberColors    = new Float32Array(EMBER_CAPACITY * 3);
  const emberSizes     = new Float32Array(EMBER_CAPACITY);

  // Parallel CPU-side arrays.
  const emberLife  = new Float32Array(EMBER_CAPACITY);
  const emberVel   = new Float32Array(EMBER_CAPACITY * 2); // vx, vy
  const emberDecay = new Float32Array(EMBER_CAPACITY);

  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));
  emberGeo.setAttribute('color',    new THREE.BufferAttribute(emberColors, 3));
  emberGeo.setAttribute('size',     new THREE.BufferAttribute(emberSizes, 1));

  const emberMat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false, depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec3 color;
      attribute float size;
      varying vec3 vColor;
      void main() {
        vColor = color;
        // Position is already in clip-space [-1,1]
        gl_Position = vec4(position.xy, 0.0, 1.0);
        gl_PointSize = size;
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vColor;
      void main() {
        // Soft round point sprite
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.05, length(d));
        gl_FragColor = vec4(vColor, a);
      }
    `,
    uniforms: {},
  });
  const emberPoints = new THREE.Points(emberGeo, emberMat);
  emberPoints.frustumCulled = false;
  compositeScene.add(emberPoints);

  function spawnEmber(palmX_uv, palmY_uv, intensity, radius) {
    // Find a dead slot.
    for (let i = 0; i < EMBER_CAPACITY; i++) {
      if (emberLife[i] > 0) continue;

      // Spawn near the top of the flame column with random horizontal jitter.
      const jx = (Math.random() - 0.5) * radius * 1.2;
      const jy = (Math.random() * 0.4 + 0.4) * radius;

      // Convert UV (0..1) to clip-space (-1..1) for the vertex shader.
      const cx = (palmX_uv + jx) * 2.0 - 1.0;
      const cy = (palmY_uv + jy) * 2.0 - 1.0;

      emberPositions[i * 3 + 0] = cx;
      emberPositions[i * 3 + 1] = cy;
      emberPositions[i * 3 + 2] = 0;

      // Hot orange-yellow palette.
      emberColors[i * 3 + 0] = 1.0;
      emberColors[i * 3 + 1] = 0.5 + Math.random() * 0.4;
      emberColors[i * 3 + 2] = 0.05 + Math.random() * 0.15;

      // Size in pixels — tiny sparks.
      emberSizes[i] = (1.5 + Math.random() * 2.5) * (0.8 + intensity);

      // Velocity in clip-space-per-second equivalent. Mostly upward + slight drift.
      emberVel[i * 2 + 0] = (Math.random() - 0.5) * 0.20;
      emberVel[i * 2 + 1] =  (0.20 + Math.random() * 0.45) * (0.6 + intensity);

      emberLife[i]  = 1.0;
      emberDecay[i] = 0.012 + Math.random() * 0.020;
      return;
    }
  }

  function updateEmbers(dt) {
    const posAttr   = emberGeo.getAttribute('position');
    const colorAttr = emberGeo.getAttribute('color');
    const sizeAttr  = emberGeo.getAttribute('size');

    // Heuristic: account for screen aspect when applying upward velocity in
    // clip space (clip space y units differ from x in pixel terms).
    for (let i = 0; i < EMBER_CAPACITY; i++) {
      if (emberLife[i] <= 0) continue;

      emberPositions[i * 3 + 0] += emberVel[i * 2 + 0] * dt;
      emberPositions[i * 3 + 1] += emberVel[i * 2 + 1] * dt;

      // Slight drag + a tiny upward acceleration (heated air rising).
      emberVel[i * 2 + 0] *= 0.985;
      emberVel[i * 2 + 1] *= 0.985;
      emberVel[i * 2 + 1] += 0.15 * dt;

      emberLife[i] -= emberDecay[i];
      const lf = Math.max(emberLife[i], 0);

      // Fade colour toward red as the spark cools.
      emberColors[i * 3 + 1] *= 0.985;
      emberColors[i * 3 + 2] *= 0.97;

      // Shrink slightly so dying sparks aren't huge.
      emberSizes[i] *= 0.992;

      if (lf <= 0 || emberSizes[i] < 0.5) {
        emberLife[i] = 0;
        emberSizes[i] = 0; // hide
      }
    }

    posAttr.needsUpdate   = true;
    colorAttr.needsUpdate = true;
    sizeAttr.needsUpdate  = true;
  }

  // ── Resize ──────────────────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    fireRT.setSize(w, h);
    fireUniforms.uResolution.value.set(w, h);
  });

  // Smoothed activity for graceful fade-in/out.
  let smoothedActive = 0;
  let lastTime       = 0;

  function update(timeMs) {
    const tSec = timeMs * 0.001;
    const dt   = lastTime ? Math.min((timeMs - lastTime) / 1000, 0.05) : 0.016;
    lastTime   = timeMs;

    fireUniforms.uTime.value      = tSec;
    compositeUniforms.uTime.value = tSec;

    spellState.castFlash *= 0.92;
    if (spellState.castFlash < 0.005) spellState.castFlash = 0;
    fireUniforms.uCastFlash.value      = spellState.castFlash;
    compositeUniforms.uCastFlash.value = spellState.castFlash;

    const lms       = spellState.handLandmarks;
    const handsHere = Math.min(lms.length, MAX_HANDS);
    const baseLevel = spellState.level / 3;

    let totalIntensity = 0;
    let activeHands    = 0;

    if (spellState.active && handsHere > 0) {
      for (let i = 0; i < handsHere; i++) {
        const lm   = lms[i];
        const palm = palmCenterNorm(lm);
        const open = handOpenness(lm);
        const span = palmSpanNorm(lm);

        // Intensity: fist = 0.30, open palm = 1.0, scaled by spell level.
        // Higher floor than v1 — even a fist should look like real fire,
        // just a small one. Wispy fire was caused by floor being too low.
        const iv = (0.45 + open * 0.55) * baseLevel;

        // Radius scales with palm span × spell level, capped to MAX_RADIUS
        // so a hand close to the camera doesn't fill the whole screen.
        const radius = Math.min(
          span * RADIUS_PER_SPAN * (0.85 + baseLevel * 0.55),
          MAX_RADIUS
        );

        // MediaPipe y-down → WebGL UV y-up.
        const palmYUv = 1.0 - palm.y;
        palms[i].set(palm.x, palmYUv);
        intensities[i] = iv;
        radii[i]       = radius;

        // Spawn embers from the top of the flame column proportional to
        // intensity. ~iv*iv keeps the rate non-linear so a small fire emits
        // far fewer sparks than a roaring one.
        const spawnRate = iv * iv * 14;
        const spawn = Math.floor(spawnRate) +
                      (Math.random() < (spawnRate - Math.floor(spawnRate)) ? 1 : 0);
        for (let s = 0; s < spawn; s++) {
          spawnEmber(palm.x, palmYUv, iv, radius);
        }

        totalIntensity = Math.max(totalIntensity, iv);
        activeHands++;
      }
      setFireVol(totalIntensity);
    } else {
      setFireVol(0);
    }

    const target = (spellState.active && activeHands > 0) ? 1 : 0;
    smoothedActive += (target - smoothedActive) * 0.18;

    fireUniforms.uActive.value    = smoothedActive;
    fireUniforms.uHandCount.value = activeHands;

    updateEmbers(dt);
  }

  function render(timeMs) {
    update(timeMs);

    // Pass 1: procedural fire → HDR render target.
    renderer.setRenderTarget(fireRT);
    renderer.clear();
    renderer.render(fireScene, camera);

    // Pass 2: composite (camera + bloom + light cast + fire + embers) → screen.
    renderer.setRenderTarget(null);
    renderer.render(compositeScene, camera);
  }

  return { render };
}
