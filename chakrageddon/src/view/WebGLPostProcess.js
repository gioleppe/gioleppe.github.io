// Intoxication post-process (spec 8.3). The 320x180 back buffer is drawn through one fragment shader
// driven by u_intox (0..1) and u_time, plus short "cues" requested by moves.
//   0.00-0.25 Microdose: clean pixels.            0.26-0.60 Come-Up: saturation, ripple, edge aberration.
//   0.61-0.90 Peaking: horizontal scanline sway.   0.91-1.00 Ego Dissolution: hue drift, ghost trails.
// Everything is sampled on the texel grid so pixels stay square. If WebGL is missing the caller
// falls back to a plain 2D blit.
const VERT = `attribute vec2 a; varying vec2 v; void main(){ v = a * 0.5 + 0.5; v.y = 1.0 - v.y; gl_Position = vec4(a, 0.0, 1.0); }`;
const FRAG = `precision mediump float;
varying vec2 v;
uniform sampler2D u_texture;
uniform vec2 u_res;
uniform float u_time, u_intox, u_motion, u_beat, u_cue, u_cueT, u_invert;

vec3 tex(vec2 uv){ uv = (floor(clamp(uv, 0.0, 0.9999) * u_res) + 0.5) / u_res; return texture2D(u_texture, uv).rgb; }
vec3 hue(vec3 c, float a){ const vec3 k = vec3(0.57735); float ca = cos(a), sa = sin(a); return c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca); }

void main(){
  vec2 uv = v;
  float px = 1.0 / u_res.x;
  float come = smoothstep(0.25, 0.60, u_intox);
  float peak = smoothstep(0.60, 0.90, u_intox);
  float ego  = smoothstep(0.90, 1.00, u_intox);
  float m = u_motion;
  float k = sin(clamp(u_cueT, 0.0, 1.0) * 3.14159);        // cue envelope 0 -> 1 -> 0

  // geometry
  uv.x += m * come * sin(uv.y * 34.0 + u_time * 1.7) * px * 0.9;
  uv.x += m * peak * sin(uv.y * u_res.y * 0.21 + u_time * 2.6) * px * 2.0;
  uv.y += m * ego * sin(uv.x * 9.0 + u_time * 1.3) * px * 2.0;
  if (u_cue == 1.0) uv += m * k * vec2(sin(u_time * 91.0), cos(u_time * 73.0)) * px * 2.5;                    // JITTER_SHAKE
  if (u_cue == 2.0) uv.x += m * k * sin(uv.y * u_res.y * 0.35 + u_time * 14.0) * px * 7.0;                     // SCANLINE_WARP
  if (u_cue == 5.0) uv += m * k * vec2(sin(uv.y * 12.0 + u_time * 6.0), sin(uv.x * 10.0 + u_time * 5.0)) * px * 4.0; // WOBBLE

  // colour: chromatic aberration grows toward the edges
  float edge = smoothstep(0.25, 0.75, distance(v, vec2(0.5)));
  float ab = m * (come * edge * 1.0 + ego * 1.5) * px;
  vec3 c = vec3(tex(uv + vec2(ab, 0.0)).r, tex(uv).g, tex(uv - vec2(ab, 0.0)).b);
  if (ego > 0.0) { vec3 ghost = tex(uv + vec2(sin(u_time) * 6.0, cos(u_time * 0.8) * 3.0) * px); c = mix(c, max(c, hue(ghost, u_time * 2.0) * 0.8), ego * 0.35 * m); }
  if (u_cue == 6.0) { vec3 g1 = tex(uv - vec2(5.0 * px, 0.0)), g2 = tex(uv + vec2(5.0 * px, 0.0)); c = mix(c, max(c, max(hue(g1, 2.0), hue(g2, 4.0)) * 0.85), k * 0.6); }  // RAINBOW_TRAIL

  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.0 + 0.30 * come);                                   // +30% saturation
  c = hue(c, m * ego * sin(u_time * 0.7) * 0.6);
  c *= 1.0 + 0.04 * peak * u_beat * m;                                      // pulse on the beat
  if (u_cue == 3.0) c = mix(c, c * vec3(1.18, 1.05, 0.86) + vec3(0.05, 0.02, 0.0), k * 0.7);   // WARM_BLOOM
  if (u_cue == 4.0) c += m * 0.22 * k * step(0.5, fract(u_cueT * 2.0));                         // STROBE (two soft pulses)
  if (u_cue == 7.0) c = mix(c, vec3(l) * vec3(0.85, 0.85, 1.0), k * 0.8);                        // DESATURATE
  if (u_cue == 8.0) c = mix(c, vec3(1.0), clamp(u_cueT, 0.0, 1.0));                              // WHITEOUT
  c = mix(c, 1.0 - c, u_invert);
  gl_FragColor = vec4(c, 1.0);
}`;
export const CUES = { JITTER_SHAKE: 1, SCANLINE_WARP: 2, WARM_BLOOM: 3, STROBE: 4, WOBBLE: 5, RAINBOW_TRAIL: 6, DESATURATE: 7, WHITEOUT: 8 };
export const CUE_SECONDS = { JITTER_SHAKE: 0.35, SCANLINE_WARP: 0.6, WARM_BLOOM: 0.7, STROBE: 0.5, WOBBLE: 0.7, RAINBOW_TRAIL: 0.7, DESATURATE: 0.7, WHITEOUT: 1.2 };

export class WebGLPostProcess {
  constructor(canvas) {
    this.ok = false;
    try {
      const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false }) || canvas.getContext('experimental-webgl');
      if (!gl) return;
      this.gl = gl;
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'a');
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      for (const [k, val] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, val);
      this.u = {};
      for (const n of ['u_res', 'u_time', 'u_intox', 'u_motion', 'u_beat', 'u_cue', 'u_cueT', 'u_invert']) this.u[n] = gl.getUniformLocation(prog, n);
      canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.ok = false; this.lost = true; });
      this.ok = true;
    } catch (e) { console.warn('WebGL post-process unavailable, using plain canvas.', e); this.ok = false; }
  }
  resize(w, h) { if (this.ok) this.gl.viewport(0, 0, w, h); }
  /** fx: { time, intox, motion, beat, cue, cueT, invert } */
  render(back, fx = {}) {
    const gl = this.gl, u = this.u;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, back);
    gl.uniform2f(u.u_res, back.width, back.height);
    gl.uniform1f(u.u_time, (fx.time || 0) % 1000);
    gl.uniform1f(u.u_intox, fx.intox || 0);
    gl.uniform1f(u.u_motion, fx.motion ?? 1);
    gl.uniform1f(u.u_beat, fx.beat || 0);
    gl.uniform1f(u.u_cue, fx.cue || 0);
    gl.uniform1f(u.u_cueT, fx.cueT || 0);
    gl.uniform1f(u.u_invert, fx.invert || 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
