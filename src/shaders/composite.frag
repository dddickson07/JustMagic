// composite.frag
// ============================================================================
// Final pass — takes the fire RT (rgb = HDR colour, a = heat scalar) and
// composites it onto the camera feed.
//
// What this pass does that the previous version didn't do enough of:
//
//   • HEAVY BLOOM. We sample the fire RT at TWO concentric rings (inner
//     ring tight = halo, outer ring wide = the soft glow that bleeds far
//     beyond the flame). 24 taps total. This is what makes the fire actually
//     glow instead of just being a coloured shape on screen.
//
//   • STRONG FIRE-LIGHT CAST. The hand and surroundings near the fire get
//     tinted warm orange in proportion to a "fire-presence" field sampled
//     in a wider radius. Without this, the fire looks pasted-in. With it,
//     the camera feed reads as actually being illuminated by flames.
//
//   • HEAT-DRIVEN UV DISPLACEMENT. The camera feed is shifted with two
//     time-modulated sine waves, scaled by the heat field at this pixel.
//     Air above the visible fire shimmers; air far from it doesn't.
// ============================================================================

#define MAX_HANDS 2

precision highp float;

varying vec2 vUv;

uniform sampler2D uVideo;
uniform sampler2D uFire;
uniform vec2  uResolution;
uniform float uTime;
uniform float uCastFlash;

// ─── Bloom: two-ring radial sample ───────────────────────────────────────
// Most "real" bloom in modern engines uses multi-pass downsample/blur/upsample
// (Mip-chain bloom, COD/Frostbite-style). Here we do a 24-tap single-pass
// approximation — cheaper, perfectly fine for a single light source.
vec3 sampleBloom(vec2 uv) {
  vec2 px = 1.0 / uResolution;
  vec3 acc = texture2D(uFire, uv).rgb * 0.50;  // sharp centre

  // Inner ring: 8 taps at moderate radius — produces the "halo" right
  // around the visible flame.
  for (int i = 0; i < 8; i++) {
    float a = 6.2831853 * float(i) / 8.0;
    vec2  o = vec2(cos(a), sin(a));
    acc += texture2D(uFire, uv + o * px * 10.0).rgb * 0.42;
  }

  // Outer ring: 16 taps at large radius — produces the broad atmospheric
  // glow that makes the fire feel volumetrically bright.
  for (int i = 0; i < 16; i++) {
    float a = 6.2831853 * float(i) / 16.0;
    vec2  o = vec2(cos(a), sin(a));
    acc += texture2D(uFire, uv + o * px * 30.0).rgb * 0.18;
  }

  return acc * 0.75;
}

// Heat at a given pixel — accumulates the heat-field channel from the fire
// RT at the pixel and a few vertical taps below (heat extends upward in real
// life, so a pixel "above" a hot region is also hot). Used for distortion
// and for the warm light cast.
float sampleHeatField(vec2 uv) {
  float h = texture2D(uFire, uv).a * 0.55;
  for (int i = 1; i <= 6; i++) {
    float t = float(i) / 6.0;
    h += texture2D(uFire, uv - vec2(0.0, t * 0.04)).a * (1.0 - t) * 0.18;
  }
  return h;
}

void main() {
  // ── 1. Heat-shimmer distortion of the camera feed ───────────────────────
  float heat = sampleHeatField(vUv);

  float wx = sin(vUv.y * 95.0 + uTime * 8.0)
           + sin(vUv.y * 41.0 - uTime * 5.0) * 0.6;
  float wy = sin(vUv.x * 75.0 + uTime * 6.0)
           + sin(vUv.x * 27.0 - uTime * 3.5) * 0.6;
  vec2 distort = vec2(wx, wy) * 0.0042 * heat;

  // Camera feed is mirrored — flip x in the sampling UV.
  vec2 videoUv = vec2(1.0 - (vUv.x + distort.x), vUv.y + distort.y);
  vec3 video   = texture2D(uVideo, videoUv).rgb;

  // Cinematic darken + radial vignette.
  video *= 0.78;
  vec2  vc  = vUv - 0.5;
  float vig = smoothstep(0.95, 0.25, length(vc));
  video *= mix(0.55, 1.0, vig);

  // ── 2. Sharp fire + bloom ───────────────────────────────────────────────
  vec3 sharpFire = texture2D(uFire, vUv).rgb;
  vec3 bloom     = sampleBloom(vUv);

  // ── 3. Strong warm fire-light cast on the camera feed ───────────────────
  // The bloom field doubles as our "how much fire is near this pixel" map.
  // We tint the underlying camera in a warm orange proportional to that
  // brightness — that's what sells the fire as actually existing in the
  // scene rather than being a sticker on top.
  float castStrength = clamp(dot(bloom, vec3(0.299, 0.587, 0.114)), 0.0, 1.5);
  vec3  warmCast     = vec3(1.00, 0.55, 0.20);

  // Multiply the camera feed by an orange tint where there's heat — this is
  // the colour of light hitting a surface, not a glow on top of it.
  video = mix(video, video * (vec3(1.0) + warmCast * 1.4), clamp(castStrength * 1.2, 0.0, 1.0));

  // ── 4. Composite ────────────────────────────────────────────────────────
  // Additive: bright fire pixels stack on top of the (now warm-lit) video.
  vec3 composited = video + bloom + sharpFire * 0.75;

  // Cast-flash full-screen orange wash decays per frame in JS.
  composited += vec3(1.0, 0.45, 0.05) * uCastFlash * 0.32;

  // Light tonemap so HDR core values that pile up don't go pure white —
  // this preserves some yellow tint in the hottest pixels.
  composited = composited / (composited + vec3(0.85));
  composited = pow(composited, vec3(1.0 / 1.05));  // mild gamma

  gl_FragColor = vec4(composited, 1.0);
}
