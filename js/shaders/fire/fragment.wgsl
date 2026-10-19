fn fire(height: f32, worldPos: vec3f, time: f32) -> vec4f {
  let n = fireNoise(worldPos.xz * 3.0 + vec2f(worldPos.y * 2.5, -time * 3.5));
  let heat = 1.0 - height + (n - 0.5) * 0.7;
  var col = vec3f(0.82, 0.16, 0.05);
  if (heat > 0.42) {
    col = vec3f(1.0, 0.45, 0.08);
  }
  if (heat > 0.78) {
    col = vec3f(1.0, 0.84, 0.32);
  }
  return vec4f(col, 1.0);
}

fn fireNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = fireHash(i);
  let b = fireHash(i + vec2f(1.0, 0.0));
  let c = fireHash(i + vec2f(0.0, 1.0));
  let d = fireHash(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fireHash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}
