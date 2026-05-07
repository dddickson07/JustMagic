/**
 * handTracking — wraps MediaPipe Hands + the user-facing camera.
 *
 * On boot: requests the camera, loads the MediaPipe Hands model, and starts
 * pumping frames. Each result updates `state.handLandmarks` and the first
 * successful frame flips `state.handsReady = true` so the HUD can transition
 * from "Initializing…" to "Listening."
 *
 * Returns the <video> element so the renderer can use it as a WebGL texture.
 */

import { Hands }  from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import { spellState } from './spellState.js';

export async function startHandTracking({ onStatus }) {
  const video = document.createElement('video');
  video.autoplay     = true;
  video.playsInline  = true;
  video.muted        = true;
  // Hidden — we draw it via WebGL, not the DOM.
  video.style.cssText =
    'position:fixed;opacity:0;width:1px;height:1px;pointer-events:none;top:0;left:0';
  document.body.appendChild(video);

  const hands = new Hands({
    // Model files live next to the JS package; resolve them via Vite's URL
    // rewriting so they ship in the bundle.
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
  });

  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.55,
  });

  hands.onResults(r => {
    spellState.handLandmarks = r.multiHandLandmarks || [];
    if (!spellState.handsReady) {
      spellState.handsReady = true;
      onStatus({ kind: 'listening', message: '◉ Ready · Listening' });
    }
  });

  try {
    const cam = new Camera(video, {
      onFrame: async () => { await hands.send({ image: video }); },
      width: 1280,
      height: 720,
    });
    await cam.start();
  } catch (err) {
    // Fallback: getUserMedia + manual rAF loop.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 1280, height: 720 },
      });
      video.srcObject = stream;
      await video.play();
      const loop = async () => {
        if (video.readyState >= 2) await hands.send({ image: video });
        requestAnimationFrame(loop);
      };
      video.onloadedmetadata = loop;
    } catch {
      onStatus({ kind: 'error', message: '◎ Camera denied' });
    }
  }

  return video;
}
