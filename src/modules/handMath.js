/**
 * handMath — pure helpers for working with MediaPipe hand landmarks.
 *
 * MediaPipe gives us 21 landmarks per hand in normalized [0..1] coordinates
 * (x, y are in image space; we mirror x because the camera feed is flipped).
 *
 *   Landmark indexes used here:
 *     0          = wrist
 *     5,9,13,17  = metacarpophalangeal joints (knuckles) — used for palm center
 *     4,8,12,16,20 = fingertips
 *     6,10,14,18 = PIP joints (used to detect finger curl)
 */

const PALM_IDS = [0, 5, 9, 13, 17];
const TIP_IDS  = [8, 12, 16, 20];
const PIP_IDS  = [6, 10, 14, 18];

/** Mirror-corrected normalized x (the feed is flipped horizontally). */
export function nx(lm, i) { return 1 - lm[i].x; }
export function ny(lm, i) { return lm[i].y; }

/** Palm center in normalized [0..1] image coords (mirror-corrected). */
export function palmCenterNorm(lm) {
  let sx = 0, sy = 0;
  for (const i of PALM_IDS) { sx += nx(lm, i); sy += ny(lm, i); }
  return { x: sx / PALM_IDS.length, y: sy / PALM_IDS.length };
}

/**
 * Hand "openness" 0..1 — how splayed the fingers are.
 * 1 = open palm (big roaring fire), 0 = closed fist (small embers).
 */
export function handOpenness(lm) {
  let open = 0;
  for (let i = 0; i < TIP_IDS.length; i++) {
    if (lm[TIP_IDS[i]].y < lm[PIP_IDS[i]].y) open++;
  }
  if (Math.abs(lm[4].x - lm[5].x) > 0.07) open++;
  return open / 5;
}

/**
 * Approximate palm size in normalized image coordinates — distance from wrist
 * to middle-finger knuckle. Used to scale fire so it engulfs the hand
 * regardless of how close to the camera the user is.
 */
export function palmSpanNorm(lm) {
  const wx = nx(lm, 0), wy = ny(lm, 0);
  const mx = nx(lm, 9), my = ny(lm, 9);
  return Math.hypot(mx - wx, my - wy);
}
