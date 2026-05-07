// fullscreen.vert
// Trivial passthrough used by every effect quad in this project.
// We render a unit-screen triangle/quad in clip space and just forward UVs.

varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
