// composite.frag
// ============================================================================
// Final pass — takes the fire RT (rgb = HDR colour, a = heat scalar) and
// composites it onto the camera feed. SHARP build (no wide bloom blur).
//
//   • SHARP FIRE. We sample the fire RT at the current pixel only. No
//     multi-tap radial blur — the soft halo is gone, fire reads crisp.
//   • WARM FIRE-LIGHT CAST is driven directly by the heat-field channel
//     instead of bloom. Surfaces near the fire still glow orange.
//   • HEAT-SHIMMER UV DISPLACEMENT of the camera (unchanged) — air above
//     the flame still ripples.
// ============================================================================

#define MAX_HANDS 2

precision highp float;

varying vec2 vUv;

uniform sampler2D uVideo;
uniform sampler2D uFire;
uniform vec2  uResolution;
uniform float uTime;
uniform float uCastFlash;

// Heat at a given pixel — accumulates the heat-field channel from the fire
// RT at the pixel and a few vertical taps below (heat rises in real life,
// so a pixel "above" a hot region still feels hot). Used for camera
// distortion + warm light cast.
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

  // ── 2. Sharp fire (no bloom) ────────────────────────────────────────────
  vec3 sharpFire = texture2D(uFire, vUv).rgb;

  // ── 3. Warm fire-light cast on the camera feed ──────────────────────────
  // Driven by heat field directly — pixels near hot regions get tinted
  // warm orange. This is the only thing that makes the hand actually look
  // illuminated by fire instead of having fire stuck on top.
  vec3 warmCast = vec3(1.00, 0.55, 0.20);
  video = mix(
    video,
    video * (vec3(1.0) + warmCast * 1.4),
    clamp(heat * 1.2, 0.0, 1.0)
  );

  // ── 4. Composite ────────────────────────────────────────────────────────
  // Sharp additive: bright fire pixels stack on top of the warm-lit video.
  // Slight extra weight on sharp fire to compensate for losing the bloom
  // contribution.
  vec3 composited = video + sharpFire * 1.15;

  // Cast-flash full-screen orange wash decays per frame in JS.
  composited += vec3(1.0, 0.45, 0.05) * uCastFlash * 0.32;

  // Light tonemap so HDR core values that pile up don't go pure white —
  // this preserves some yellow tint in the hottest pixels.
  composited = composited / (composited + vec3(0.85));
  composited = pow(composited, vec3(1.0 / 1.05));  // mild gamma

  gl_FragColor = vec4(composited, 1.0);
}
