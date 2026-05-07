// composite.frag
// ============================================================================
// Single-pass photoreal fire compositor.
//
// Real photons beat any shader for "looking like fire." This pass takes a
// real fire-on-black video clip (fire-loop.mp4) and composites it onto the
// camera feed, anchored to each detected palm.
//
// Pipeline per pixel:
//   1. Sample the camera video, mirrored, with a small UV displacement driven
//      by accumulated fire brightness above this pixel (heat shimmer).
//   2. For each detected hand, compute a UV into the fire video such that:
//        - The PALM_ANCHOR fraction up the fire video sits at the palm,
//          so the bottom of the fire actually overlaps the hand (flames in
//          front of fingers, not just rising above the wrist).
//        - Width/height in screen UV is sized by palm span × spell level.
//        - Width is slightly flared so flames look broader at the base.
//      Sample the fire video there. Multiply by per-hand opacity (openness ×
//      spell level × overall fade). Use SCREEN BLEND so dark pixels in the
//      fire clip vanish and bright flames glow over the camera feed.
//   3. Add a strong warm orange cast onto pixels near the fire — the hand,
//      face, and surroundings should look fire-lit, not flatly daylit.
//   4. Add cast-flash + vignette + slight global tint.
// ============================================================================

#define MAX_HANDS 2

// Where on the fire video the palm sits. 0.0 = palm at base of fire (fire
// rises above only). 0.18 = ~18% up — base of fire wraps over the hand.
#define PALM_ANCHOR 0.18

precision highp float;

varying vec2 vUv;

uniform sampler2D uVideo;          // camera feed
uniform sampler2D uFireVideo;      // real fire on black background
uniform vec2  uResolution;
uniform float uVideoAspect;        // = fireVideoWidth / fireVideoHeight
uniform float uTime;
uniform float uActive;             // 0..1 global fade
uniform float uCastFlash;          // 0..1 burst that decays per frame

uniform int   uHandCount;
uniform vec2  uPalms[MAX_HANDS];
uniform float uOpacities[MAX_HANDS]; // openness × level × active
uniform float uScales[MAX_HANDS];    // fire height in screen UV-y units

// ─── Helpers ────────────────────────────────────────────────────────────────

// Photographic "screen" blend — inverse-multiply the inversions. This is the
// blend mode that makes black pixels transparent and bright pixels
// constructively combine, the same one After Effects uses for fire/sparks.
vec3 screenBlend(vec3 base, vec3 add) {
  return 1.0 - (1.0 - base) * (1.0 - add);
}

// Sample the fire texture for one hand and return the contribution.
//   palm     : palm centre in screen UV (y=0 at bottom, 1 at top)
//   scale    : fire height in screen UV-y units (palm span × growth factor)
//   opacity  : multiplier 0..1 (openness × level × fade)
//   mirror   : if 1.0, flip fire sample on x — used so two hands don't see
//              the identical flame pattern.
//   timeShift: temporal offset (small UV-y shift) so each hand looks like a
//              different moment of fire. Makes 2-hand mode feel less cloned.
vec3 sampleFireForHand(vec2 palm, float scale, float opacity,
                       float mirror, float timeShift) {
  if (opacity < 0.005) return vec3(0.0);

  // Native fire aspect / screen aspect → width in screen-uv units that
  // preserves the fire video's real proportions. We add 25% extra width
  // so flames flare out wider at the base, like a real fire pluming up
  // off a flat surface.
  float screenAspect = uResolution.x / uResolution.y;
  float widthUv  = scale * (uVideoAspect / screenAspect) * 1.25;
  float heightUv = scale;

  // Pixel offset from palm. Palm sits PALM_ANCHOR fraction up the fire,
  // so a band of fire renders BELOW the palm, in front of the hand.
  vec2 d = vUv - palm;

  vec2 fireUv;
  fireUv.x = d.x / widthUv + 0.5;
  fireUv.y = d.y / heightUv + PALM_ANCHOR;

  // Outside the fire's bounding box → no contribution.
  if (fireUv.x < 0.0 || fireUv.x > 1.0 || fireUv.y < 0.0 || fireUv.y > 1.0) {
    return vec3(0.0);
  }

  // Optional horizontal mirror for the second hand.
  if (mirror > 0.5) fireUv.x = 1.0 - fireUv.x;

  // Tiny temporal nudge — sampling slightly higher in the clip looks like
  // a different point in time once the fire is already moving.
  fireUv.y = clamp(fireUv.y + timeShift, 0.0, 1.0);

  vec3 fire = texture2D(uFireVideo, fireUv).rgb;

  // Soft edge mask so the fire fades out at the periphery instead of cutting
  // hard at the bounding box. Strongest in the centre column near the base.
  float edgeX = smoothstep(0.0, 0.18, fireUv.x) * smoothstep(1.0, 0.82, fireUv.x);
  float edgeY = smoothstep(1.0, 0.85, fireUv.y); // gentle fade near top
  float edge  = edgeX * edgeY;

  return fire * opacity * edge;
}

// Walk a few taps upward through the fire video and accumulate its luminance.
// Used to drive heat-shimmer distortion of the camera feed in the same column
// as the rising flames (real heat rises above the visible fire too).
float sampleHeatColumn(vec2 palm, float scale, float opacity, float mirror) {
  if (opacity < 0.005) return 0.0;

  float screenAspect = uResolution.x / uResolution.y;
  float widthUv  = scale * (uVideoAspect / screenAspect);
  float heightUv = scale;

  vec2 d = vUv - palm;
  // Distortion can extend ABOVE the visible fire — sample fire from below
  // current pixel (since hot air rises, the column above the flame is hotter).
  vec2 fireUv;
  fireUv.x = d.x / widthUv + 0.5;
  fireUv.y = d.y / heightUv;

  if (fireUv.x < -0.05 || fireUv.x > 1.05) return 0.0;
  if (mirror > 0.5) fireUv.x = 1.0 - fireUv.x;

  float h = 0.0;
  for (int i = 0; i < 3; i++) {
    float dy = -float(i) * 0.08; // sample beneath = closer to flame source
    vec2 uv = vec2(fireUv.x, fireUv.y + dy);
    if (uv.y >= 0.0 && uv.y <= 1.0) {
      vec3 c = texture2D(uFireVideo, uv).rgb;
      h += dot(c, vec3(0.299, 0.587, 0.114)) * (1.0 - float(i) * 0.3);
    }
  }
  return h * opacity * 0.4;
}

void main() {
  // ── 1. Heat distortion of the camera feed ──────────────────────────────
  float heat = 0.0;
  for (int i = 0; i < MAX_HANDS; i++) {
    if (i >= uHandCount) break;
    float mirror = (i == 1) ? 1.0 : 0.0;
    heat += sampleHeatColumn(uPalms[i], uScales[i], uOpacities[i], mirror);
  }
  heat = clamp(heat, 0.0, 1.0);

  float wx = sin(vUv.y * 95.0 + uTime * 8.0) + sin(vUv.y * 41.0 - uTime * 5.0) * 0.6;
  float wy = sin(vUv.x * 75.0 + uTime * 6.0) + sin(vUv.x * 27.0 - uTime * 3.5) * 0.6;
  vec2 distort = vec2(wx, wy) * 0.0035 * heat;

  vec2 videoUv = vec2(1.0 - (vUv.x + distort.x), vUv.y + distort.y);
  vec3 video   = texture2D(uVideo, videoUv).rgb;

  // Cinematic darken + radial vignette, like a Photo Booth filter dialled up.
  video *= 0.78;
  vec2  vc  = vUv - 0.5;
  float vig = smoothstep(0.95, 0.25, length(vc));
  video *= mix(0.55, 1.0, vig);

  // ── 2. Fire compositing (screen blend) ─────────────────────────────────
  vec3 fireAccum = vec3(0.0);
  for (int i = 0; i < MAX_HANDS; i++) {
    if (i >= uHandCount) break;
    float mirror    = (i == 1) ? 1.0 : 0.0;
    float timeShift = (i == 1) ? 0.17 : 0.0;
    fireAccum += sampleFireForHand(
      uPalms[i], uScales[i], uOpacities[i], mirror, timeShift
    );
  }
  fireAccum *= uActive;

  vec3 composited = screenBlend(video, fireAccum);

  // ── 3. Warm fire-lit illumination of the surrounding camera pixels ─────
  // The fire's brightness leaks an orange/yellow tint into anything near it.
  // We sample fire luminance at the current pixel AND at a small upward halo
  // so the cast extends below the visible flames (the hand under the fire
  // gets lit even where there's no fire pixel directly on it).
  float fireLuma = dot(fireAccum, vec3(0.299, 0.587, 0.114));
  float castStrength = fireLuma;
  // Sample fire below current pixel — that fire is what would illuminate
  // pixels above it in real life. Picks up the fire that's WRAPPING the hand
  // and casts its light across the whole near region.
  for (int i = 0; i < MAX_HANDS; i++) {
    if (i >= uHandCount) break;
    float mirror    = (i == 1) ? 1.0 : 0.0;
    float timeShift = (i == 1) ? 0.17 : 0.0;
    vec3 nearby = sampleFireForHand(uPalms[i], uScales[i], uOpacities[i], mirror, timeShift + 0.08);
    castStrength += dot(nearby, vec3(0.299, 0.587, 0.114)) * 0.6;
  }
  castStrength = clamp(castStrength, 0.0, 1.5);

  vec3 warmCast = vec3(1.0, 0.55, 0.18) * castStrength * 0.85;
  composited += warmCast * (1.0 - fireLuma * 0.6); // don't over-tint flame core

  // ── 4. Cast flash full-screen orange wash ──────────────────────────────
  composited += vec3(1.0, 0.45, 0.05) * uCastFlash * 0.32;

  gl_FragColor = vec4(composited, 1.0);
}
