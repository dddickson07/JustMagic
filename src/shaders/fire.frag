// fire.frag
// ============================================================================
// Stylized cinematic fire shader (v2).
//
// Built on three pillars I undercooked the first time:
//
//   1. TWO noise layers, not one.
//      - "Body" layer: low-frequency domain-warped FBM gives the overall
//        flame mass — the broad shape that reads as fire from a distance.
//      - "Detail" layer: high-frequency FBM modulated by the body adds the
//        crisp flame-tongue licks that read up close. This combination is
//        what makes game-engine fire look layered instead of "shadery".
//
//   2. Aggressive temperature gradient + HDR boost.
//      Real fire follows a black-body curve: dim red → bright orange →
//      yellow → near-white at the core. We hard-step five colour stops and
//      then push the hot core ABOVE 1.0 so the bloom pass can blow it out
//      spectacularly. (Render target is HalfFloat — values can exceed 1.)
//
//   3. Tight, contrasty mask.
//      Wispy fire = soft mask + low intensity. Dense fire = sharp mask +
//      contrast-pushed noise. We use smoothstep(0.1, 0.95, fire) at the end
//      to crush the low end and clip the bright pixels.
//
// Output: rgb = pre-multiplied fire colour (HDR), a = heat scalar used by
// the composite pass for distortion + bloom + warm light cast.
// ============================================================================

#define MAX_HANDS 2

precision highp float;

varying vec2 vUv;

uniform float uTime;
uniform vec2  uResolution;
uniform float uActive;
uniform float uCastFlash;
uniform int   uHandCount;
uniform vec2  uPalms[MAX_HANDS];
uniform float uIntensities[MAX_HANDS]; // openness × spell level
uniform float uRadii[MAX_HANDS];       // base radius in screen-UV-y units

// ─── Hash + value noise ────────────────────────────────────────────────────
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i),               hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// FBM with a configurable octave count. The if-break is hoisted by the
// compiler since octaves is a literal constant at every call site.
float fbm(vec2 p, int octaves) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    v += amp * vnoise(p);
    p *= 2.05;
    amp *= 0.5;
  }
  return v;
}

vec4 firePlume(vec2 uv, vec2 palm, float intensity, float radius) {
  // ── Coordinate setup ─────────────────────────────────────────────────────
  // Aspect-correct so the fire is round even on wide screens.
  vec2 d = uv - palm;
  d.x *= uResolution.x / uResolution.y;

  // Lift the palm anchor up — fire extends BELOW the palm too, wrapping
  // over the front of the hand instead of just rising above it.
  d.y += radius * 0.18 * intensity;

  // Stretch coords for tall flame columns; scroll upward in time slowly.
  // Slow scroll matters: fast scroll reads as "screensaver", slow reads as
  // "majestic flame". 0.32 is the sweet spot from playing with values.
  vec2 fireCoord = vec2(d.x * 2.0, d.y * 1.0);
  fireCoord.y -= uTime * 0.32;

  // ── Body layer: domain-warped low-frequency FBM ─────────────────────────
  // Sample noise twice and use that as a position offset for a third sample.
  // Domain warping converts uniform noise into the swirling, churning,
  // self-organising patterns that read as fluid motion.
  vec2 q = vec2(
    fbm(fireCoord * 1.2 + vec2(0.0, uTime * 0.18), 3),
    fbm(fireCoord * 1.2 + vec2(5.2, 1.3) - uTime * 0.10, 3)
  );
  float body = fbm(fireCoord * 1.5 + q * 1.6, 4);

  // ── Detail layer: high-frequency tongues ────────────────────────────────
  // Sampled at higher frequency, MODULATED by the body so detail concentrates
  // along the body's edges (which is where real flame tongues form).
  float detail = fbm(fireCoord * 5.5 + q * 0.6 - vec2(0.0, uTime * 0.55), 3);

  // Blend: body provides the mass, detail adds tongues primarily near edges.
  // The edge weight: detail contribution is high where body is mid-range
  // (i.e. at the silhouette of the flame), low in the centre (solid mass).
  float edgeWeight = 1.0 - abs(body - 0.5) * 1.6;
  float n = body + detail * edgeWeight * 0.55;

  // ── Shape mask ──────────────────────────────────────────────────────────
  // Tall, narrow ellipse anchored on the (lifted) palm. The "narrow" makes
  // the fire look like a column rising up rather than a fuzzy blob.
  vec2 sd = d;
  sd.x *= 1.5;   // squish x → narrower in horizontal
  sd.y *= 0.55;  // stretch y → taller in vertical
  float shapeDist = length(sd);

  float r0 = radius * (0.7 + intensity * 0.55);
  float mask = smoothstep(r0, r0 * 0.12, shapeDist);

  // ── Combine + crush contrast ────────────────────────────────────────────
  float fire = mask * (n * 1.5 + 0.18) * intensity;
  // smoothstep with tight bounds = the difference between thick fire and
  // wispy fire. 0.10/0.95 crushes everything dim into black and clips
  // everything bright to the hottest colour stop.
  fire = smoothstep(0.10, 0.95, fire);

  // ── Temperature gradient ────────────────────────────────────────────────
  // Five-stop ramp keyed to fire intensity. Real flames go through these
  // colours as temperature rises, so the noise-low areas are dim red and
  // noise-peak areas are near-white.
  vec3 col = vec3(0.0);
  col = mix(col, vec3(0.55, 0.04, 0.00), smoothstep(0.05, 0.20, fire));
  col = mix(col, vec3(1.00, 0.30, 0.02), smoothstep(0.20, 0.45, fire));
  col = mix(col, vec3(1.00, 0.65, 0.08), smoothstep(0.42, 0.65, fire));
  col = mix(col, vec3(1.00, 0.92, 0.30), smoothstep(0.62, 0.85, fire));
  col = mix(col, vec3(1.00, 1.00, 0.92), smoothstep(0.85, 1.00, fire));

  // HDR core: blow out the brightest pixels well above 1.0 so the bloom
  // pass downstream creates a real "white-hot" glow instead of a flat
  // yellow patch. Without this the core looks tame.
  col *= 1.0 + smoothstep(0.70, 1.00, fire) * 2.5;

  // Pre-multiply by alpha so additive composite works correctly.
  col *= fire;

  // ── Heat field ──────────────────────────────────────────────────────────
  // Wider, softer mask used by the composite pass for: (a) UV displacement
  // of the camera feed (heat shimmer), (b) light cast on surroundings,
  // (c) the bloom mask. Extends ABOVE the visible flame because real heat
  // rises beyond where you can still see fire.
  vec2 hd = d;
  hd.y += radius * 0.55 * intensity;
  hd.y *= 0.60;
  float heatDist = length(hd);
  float heat = smoothstep(radius * 2.0, radius * 0.15, heatDist);
  heat *= (body * 0.65 + 0.45) * intensity;
  heat = max(heat, fire);

  return vec4(col, heat);
}

void main() {
  vec3  colAccum  = vec3(0.0);
  float heatAccum = 0.0;

  for (int i = 0; i < MAX_HANDS; i++) {
    if (i >= uHandCount) break;
    vec4 c = firePlume(vUv, uPalms[i], uIntensities[i], uRadii[i]);
    colAccum  += c.rgb;
    heatAccum += c.a;
  }

  // Cast-burst flare — every spell cast briefly boosts colour + heat for
  // ~600ms (the JS decays this each frame).
  colAccum  *= 1.0 + uCastFlash * 0.55;
  heatAccum *= 1.0 + uCastFlash * 0.30;

  colAccum  *= uActive;
  heatAccum *= uActive;

  gl_FragColor = vec4(colAccum, clamp(heatAccum, 0.0, 1.5));
}
