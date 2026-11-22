// engine.js: a sprite-stack renderer in plain WebGL2.
//
// What happens each frame:
//   1. Every slice of every stack becomes one or more instances of a quad: one for every screen row its layer is
//      tall, so stacks stay solid at any zoom, tilt or perspective. Instances are sorted by height.
//   2. The slice pass draws them into a small G-buffer: palette index, facing, height. No colour, no light.
//      - painter: lowest first, no depth test. Every slice is drawn in full (this is the overdraw).
//      - hidden-surface removal: highest first with a depth test, so a pixel already covered rejects the rest.
//   3. The light pass runs once per screen pixel: it looks up the colour, rebuilds the world position from the
//      stored height, and works out sun, shadow (a march through a height map) and lamps.
//   4. The result is copied to the canvas, scaled up without smoothing if the internal resolution is lower.
// An optional count pass draws the same instances additively to measure overdraw exactly.
(function (global) {
  'use strict';
  const FL = 11;                      // floats per instance: pos 3, rot 1, rect 4, offset 2, scale 1
  const NB = 2048, ZQ = 16;           // height buckets, and buckets per unit of height
  const HMAX = 128;                   // tallest thing the G-buffer and the height map can hold

  // ---------------------------------------------------------------- small matrix helpers (column-major 4x4)
  function mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; }
  function invert(m) {
    const a = new Float64Array(32); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { a[r * 8 + c] = m[c * 4 + r]; a[r * 8 + 4 + c] = r === c ? 1 : 0; }
    for (let i = 0; i < 4; i++) {
      let p = i; for (let r = i + 1; r < 4; r++) if (Math.abs(a[r * 8 + i]) > Math.abs(a[p * 8 + i])) p = r;
      if (p !== i) for (let c = 0; c < 8; c++) { const t = a[i * 8 + c]; a[i * 8 + c] = a[p * 8 + c]; a[p * 8 + c] = t; }
      const d = a[i * 8 + i]; for (let c = 0; c < 8; c++) a[i * 8 + c] /= d;
      for (let r = 0; r < 4; r++) if (r !== i) { const f = a[r * 8 + i]; if (f) for (let c = 0; c < 8; c++) a[r * 8 + c] -= f * a[i * 8 + c]; }
    }
    const o = new Float32Array(16); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[c * 4 + r] = a[r * 8 + 4 + c]; return o;
  }

  // The camera orbits a point on the ground. yaw turns it, pitch tilts it (90 degrees is straight down), dist zooms.
  // mode 'ortho' is the classic parallel view; 'persp' is a true perspective camera.
  // Sorting by height is exact as long as every view ray points downward, which holds while pitch > fov / 2.
  function cameraMatrices(cam, aspect) {
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    const f = [cp * cy, cp * sy, -sp], r = [sy, -cy, 0], u = [cy * sp, sy * sp, cp];
    const ortho = cam.mode !== 'persp', th = Math.tan(cam.fov / 2), back = ortho ? 1500 : cam.dist;
    const eye = [cam.tx - f[0] * back, cam.ty - f[1] * back, -f[2] * back];
    const dot = function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; };
    const V = new Float32Array([r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, eye), -dot(u, eye), dot(f, eye), 1]);
    let P;
    if (ortho) { const hh = cam.dist * th, hw = hh * aspect, n = 1, fr = 3200; P = new Float32Array([1 / hw, 0, 0, 0, 0, 1 / hh, 0, 0, 0, 0, -2 / (fr - n), 0, 0, 0, -(fr + n) / (fr - n), 1]); }
    else { const n = Math.max(2, cam.dist * 0.05), fr = cam.dist * 3 + 900; P = new Float32Array([1 / (th * aspect), 0, 0, 0, 0, 1 / th, 0, 0, 0, 0, -(fr + n) / (fr - n), -1, 0, 0, -2 * fr * n / (fr - n), 0]); }
    const vp = mul(P, V);
    return { vp: vp, inv: invert(vp), eye: eye, f: f, ortho: ortho, th: th, cp: cp };
  }

  // ---------------------------------------------------------------- shaders
  const VS_SLICE = `#version 300 es
  layout(location=0) in vec3 a_pos; layout(location=1) in float a_rot; layout(location=2) in vec4 a_rect;
  layout(location=3) in vec2 a_off; layout(location=4) in float a_scale;
  uniform mat4 u_vp; uniform float u_guard;                 // u_guard: half a pixel, in clip units (0 turns it off)
  out vec2 v_uv; flat out vec4 v_rect; flat out vec2 v_cs; out float v_h;
  void main() {
    vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
    float c = cos(a_rot), s = sin(a_rot);
    vec2 l = (a_off + (corner - 0.5) * a_rect.zw) * a_scale, m = a_off * a_scale;
    vec4 p = u_vp * vec4(a_pos + vec3(l.x * c - l.y * s, l.x * s + l.y * c, 0.0), 1.0);
    vec4 q = u_vp * vec4(a_pos + vec3(m.x * c - m.y * s, m.x * s + m.y * c, 0.0), 1.0);   // the middle of the slice
    // A slice seen edge-on has no height on screen and would vanish between pixel rows. Push every corner half a
    // pixel away from the slice's middle line, so it always covers at least one row.
    p.y += (p.y / p.w >= q.y / q.w ? 1.0 : -1.0) * u_guard * p.w;
    gl_Position = p; v_uv = a_rect.xy + corner * a_rect.zw; v_rect = a_rect; v_cs = vec2(c, s); v_h = a_pos.z;
  }`;
  const FS_G = `#version 300 es
  precision highp float;
  uniform sampler2D u_atlas;
  in vec2 v_uv; flat in vec4 v_rect; flat in vec2 v_cs; in float v_h;
  layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
  void main() {
    vec4 t = texelFetch(u_atlas, ivec2(clamp(v_uv, v_rect.xy, v_rect.xy + v_rect.zw - 0.001)), 0);
    if (t.r == 0.0) discard;                                // an empty pixel of the slice
    vec3 n = t.gba * 2.0 - 1.0; n.xy = vec2(n.x * v_cs.x - n.y * v_cs.y, n.x * v_cs.y + n.y * v_cs.x);   // turn the facing with the slice
    o0 = vec4(t.r, n * 0.5 + 0.5);                          // palette index, facing
    float h = clamp(v_h / ${HMAX}.0, 0.0, 1.0) * 65535.0, hi = floor(h / 256.0);
    o1 = vec4(hi / 255.0, (h - hi * 256.0) / 255.0, 0.0, 1.0);   // height, 16 bits
  }`;
  const FS_COUNT = `#version 300 es
  precision highp float;
  uniform sampler2D u_atlas; uniform int u_all; uniform float u_unit;   // u_unit: what one fragment adds
  in vec2 v_uv; flat in vec4 v_rect; flat in vec2 v_cs; in float v_h;
  out vec4 o;
  void main() {
    if (u_all == 1) { o = vec4(0.0, u_unit, 0.0, 0.0); return; }   // every fragment the quad covers
    vec4 t = texelFetch(u_atlas, ivec2(clamp(v_uv, v_rect.xy, v_rect.xy + v_rect.zw - 0.001)), 0);
    if (t.r == 0.0) discard;
    o = vec4(u_unit, 0.0, 0.0, 0.0);                          // every fragment written
  }`;
  const VS_FULL = `#version 300 es
  out vec2 v_uv;
  void main() { vec2 p = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)); v_uv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
  const FS_LIGHT = `#version 300 es
  precision highp float;
  uniform sampler2D u_g0, u_g1, u_pal, u_hm;
  uniform mat4 u_inv; uniform vec3 u_sun; uniform vec2 u_world; uniform float u_night; uniform int u_shadows;
  uniform vec4 u_lamp[8]; uniform int u_nlamp; uniform vec4 u_fig[8]; uniform int u_nfig;
  in vec2 v_uv; out vec4 o;
  float ground(vec2 p) { return p.x < 0.0 || p.y < 0.0 || p.x >= u_world.x || p.y >= u_world.y ? 0.0 : texelFetch(u_hm, ivec2(p), 0).r * 127.5; }
  void main() {
    ivec2 px = ivec2(gl_FragCoord.xy);
    vec4 g0 = texelFetch(u_g0, px, 0);
    vec3 sky = mix(vec3(0.62, 0.80, 0.93), vec3(0.05, 0.06, 0.12), u_night);
    if (g0.r == 0.0) { o = vec4(sky, 1.0); return; }
    vec4 g1 = texelFetch(u_g1, px, 0);
    float h = (g1.r * 255.0 * 256.0 + g1.g * 255.0) / 65535.0 * ${HMAX}.0;
    vec4 pal = texelFetch(u_pal, ivec2(int(g0.r * 255.0 + 0.5), 0), 0);
    vec3 n = normalize(g0.gba * 2.0 - 1.0);
    // the world position: where this pixel's view ray meets the plane at the stored height
    vec2 ndc = v_uv * 2.0 - 1.0; vec4 a = u_inv * vec4(ndc, -1.0, 1.0), b = u_inv * vec4(ndc, 1.0, 1.0); a /= a.w; b /= b.w;
    vec3 p = mix(a.xyz, b.xyz, (h - a.z) / (b.z - a.z));
    float lit = 1.0;
    if (u_shadows == 1) {
      vec3 q = p + n * 0.8 + vec3(0.0, 0.0, 0.5);           // step off the surface, then walk towards the sun
      for (int i = 0; i < 48; i++) { q += u_sun * 1.6; if (q.z > 100.0) break; if (ground(q.xy) > q.z) { lit = 0.0; break; } }
      for (int i = 0; i < u_nfig; i++) {                    // the walkers are not in the height map: each is a cylinder
        vec4 f = u_fig[i]; vec2 d = f.xy - p.xy; float t = dot(d, u_sun.xy) / dot(u_sun.xy, u_sun.xy);
        if (t > 0.5 && length(d - u_sun.xy * t) < f.w && p.z + u_sun.z * t < f.z) lit = min(lit, 0.2);
      }
    }
    float nl = max(dot(n, u_sun), 0.0);
    vec3 day = pal.rgb * (vec3(0.60, 0.64, 0.74) * (0.82 + 0.18 * n.z) + vec3(1.0, 0.94, 0.82) * nl * lit * 0.62);
    vec3 night = pal.rgb * vec3(0.10, 0.12, 0.20) * (0.7 + 0.3 * n.z) + pal.rgb * pal.a * vec3(1.0, 0.9, 0.6) * 1.1;
    for (int i = 0; i < u_nlamp; i++) {
      vec3 d = u_lamp[i].xyz - p; float r = length(d);
      night += pal.rgb * vec3(1.0, 0.82, 0.5) * max(dot(n, d / r), 0.15) * 1.6 / (1.0 + r * r * 0.004) * smoothstep(u_lamp[i].w, 0.0, r);
    }
    o = vec4(mix(day, night, u_night), 1.0);
  }`;
  const FS_HEAT = `#version 300 es
  precision highp float;
  uniform sampler2D u_count; uniform int u_channel; uniform float u_unit;
  in vec2 v_uv; out vec4 o;
  void main() {
    vec4 c = texture(u_count, v_uv); float n = (u_channel == 0 ? c.r : c.g) / u_unit;
    // 0 black, 1 dark blue, 4 green, 16 yellow, 64 red, 256 white (a step of colour for every doubling)
    float t = n < 0.5 ? 0.0 : (log2(n) + 1.0) / 9.0;
    vec3 col = t <= 0.0 ? vec3(0.0) : t < 0.33 ? mix(vec3(0.05, 0.10, 0.45), vec3(0.10, 0.75, 0.35), t / 0.33)
      : t < 0.55 ? mix(vec3(0.10, 0.75, 0.35), vec3(0.98, 0.90, 0.20), (t - 0.33) / 0.22)
      : t < 0.78 ? mix(vec3(0.98, 0.90, 0.20), vec3(0.92, 0.15, 0.12), (t - 0.55) / 0.23) : mix(vec3(0.92, 0.15, 0.12), vec3(1.0), min(1.0, (t - 0.78) / 0.22));
    o = vec4(col, 1.0);
  }`;
  const FS_BLIT = `#version 300 es
  precision highp float;
  uniform sampler2D u_tex; in vec2 v_uv; out vec4 o;
  void main() { o = texture(u_tex, v_uv); }`;

  function create(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not available');
    const floatOK = !!gl.getExtension('EXT_color_buffer_float');
    const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');

    function program(vs, fs) {
      const p = gl.createProgram();
      [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].forEach(function (s) {
        const sh = gl.createShader(s[0]); gl.shaderSource(sh, s[1]); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        gl.attachShader(p, sh);
      });
      gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name.replace('[0]', ''); u[name] = gl.getUniformLocation(p, name); }
      return { p: p, u: u };
    }
    function texture(w, h, internal, format, type, data, filter) {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data || null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter || gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter || gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    const pG = program(VS_SLICE, FS_G), pCount = program(VS_SLICE, FS_COUNT), pLight = program(VS_FULL, FS_LIGHT), pHeat = program(VS_FULL, FS_HEAT), pBlit = program(VS_FULL, FS_BLIT);

    // the instance buffer and its vertex array (the quad's four corners come from gl_VertexID)
    let cap = 1 << 16, inst = new Float32Array(cap * FL), tmp = new Float32Array(cap * FL), keys = new Uint16Array(cap);
    const counts = new Uint32Array(NB + 1);
    const vao = gl.createVertexArray(), buf = gl.createBuffer(); gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    [[0, 3, 0], [1, 1, 3], [2, 4, 4], [3, 2, 8], [4, 1, 10]].forEach(function (a) { gl.enableVertexAttribArray(a[0]); gl.vertexAttribPointer(a[0], a[1], gl.FLOAT, false, FL * 4, a[2] * 4); gl.vertexAttribDivisor(a[0], 1); });
    const vaoFull = gl.createVertexArray();

    // render targets, made again when the internal resolution changes
    let iw = 0, ih = 0, g0, g1, lit, countTex, depth, fboG, fboLit, fboCount;
    function targets(w, h) {
      if (w === iw && h === ih) return; iw = w; ih = h;
      g0 = texture(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE); g1 = texture(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE); lit = texture(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
      countTex = floatOK ? texture(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT) : texture(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
      depth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, depth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      fboG = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fboG);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, g0, 0); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, g1, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth); gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      fboLit = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fboLit); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lit, 0);
      fboCount = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fboCount); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, countTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    }

    const E = { gl: gl, renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown', stats: { instances: 0, slices: 0, cpuMs: 0, gpuMs: null, written: null, covered: null } };
    let palTex = null, hmTex = null, world = [1, 1], query = null, timing = false;
    const UNIT = floatOK ? 1 : 1 / 255;                      // without float targets the count stops at 255

    E.makeAtlas = function (data, size) { return texture(size, size, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, data); };
    E.setPalette = function (bytes) { palTex = texture(256, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bytes); };
    // the height map for shadows: one byte per ground cell, the height of the tallest thing standing on it (in half units)
    E.setHeightMap = function (bytes, w, h) { hmTex = texture(w, h, gl.R8, gl.RED, gl.UNSIGNED_BYTE, bytes); world = [w, h]; };

    // Turn slices into sorted instances. list: [{ stack, x, y, z, rot, scale, only (one slice index, or -1 for all) }]
    function build(list, M, opt) {
      const ppuOrtho = ih / (2 * opt.cam.dist * M.th);
      let n = 0, slices = 0;
      // A shell stack is hollow, so a shallow view ray must not slip between two copies of a slice and through the
      // shell: the copies have to be closer together than the shell is deep along that ray.
      const slope = Math.tan(Math.max(0.06, M.ortho ? opt.cam.pitch : opt.cam.pitch - opt.cam.fov * 0.35));
      for (let q = 0; q < list.length; q++) {
        const it = list[q], st = it.stack, sc = it.scale;
        // how many screen rows one layer of this stack is tall: that many copies of each slice
        let rows = 1;
        if (opt.fill) {
          if (M.ortho) rows = ppuOrtho * M.cp * sc;
          else { const d = Math.max(4, (it.x - M.eye[0]) * M.f[0] + (it.y - M.eye[1]) * M.f[1] + (it.z - M.eye[2]) * M.f[2] - st.radius * sc); rows = ih / (2 * d * M.th) * Math.min(1, M.cp + 0.25) * sc * 1.15; }
        }
        const copies = st.flat ? 1 : Math.max(st.shell ? Math.ceil(1 / (st.shell * slope)) : 1, Math.min(48, Math.ceil(rows)));
        const cs = Math.cos(it.rot), sn = Math.sin(it.rot), a = it.only < 0 ? 0 : it.only, b = it.only < 0 ? st.slices.length : it.only + 1;
        if (n + (b - a) * copies > cap) { cap *= 2; const i2 = new Float32Array(cap * FL), t2 = new Float32Array(cap * FL), k2 = new Uint16Array(cap); t2.set(tmp); k2.set(keys); inst = i2; tmp = t2; keys = k2; }
        for (let s = a; s < b; s++) {
          const sl = st.slices[s], z0 = it.z + (it.only < 0 ? sl.z * sc : 0); slices++;
          for (let k = 0; k < copies; k++) {
            const z = z0 + k / copies * sc, j = n * FL;
            tmp[j] = it.x; tmp[j + 1] = it.y; tmp[j + 2] = z; tmp[j + 3] = it.rot;
            tmp[j + 4] = sl.u; tmp[j + 5] = sl.v; tmp[j + 6] = sl.w; tmp[j + 7] = sl.h; tmp[j + 8] = sl.ox; tmp[j + 9] = sl.oy; tmp[j + 10] = sc;
            let key = Math.min(NB - 1, Math.max(0, Math.floor(z * ZQ))); if (opt.hsr) key = NB - 1 - key;      // painter: lowest first; hidden-surface removal: highest first
            keys[n++] = key;
          }
        }
      }
      counts.fill(0); for (let i = 0; i < n; i++) counts[keys[i] + 1]++;
      for (let i = 0; i < NB; i++) counts[i + 1] += counts[i];
      for (let i = 0; i < n; i++) { const d = counts[keys[i]]++ * FL, s = i * FL; for (let k = 0; k < FL; k++) inst[d + k] = tmp[s + k]; }
      E.stats.instances = n; E.stats.slices = slices; return n;
    }

    function drawSlices(prog, n, M, opt, hsr) {
      gl.useProgram(prog.p); gl.bindVertexArray(vao);
      gl.uniformMatrix4fv(prog.u.u_vp, false, M.vp); gl.uniform1f(prog.u.u_guard, opt.guard ? 1 / ih : 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, opt.atlas); gl.uniform1i(prog.u.u_atlas, 0);
      if (hsr) { gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); } else gl.disable(gl.DEPTH_TEST);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      gl.disable(gl.DEPTH_TEST);
    }

    // opt: { cam, list, hsr, fill, guard, shadows, night, heat (0 off, 1 written, 2 covered), measure, scale (canvas pixels per internal pixel), lamps, figures }
    E.render = function (opt) {
      const t0 = performance.now(), W = canvas.width, H = canvas.height;
      targets(Math.max(1, Math.round(W / opt.scale)), Math.max(1, Math.round(H / opt.scale)));
      const M = cameraMatrices(opt.cam, iw / ih), n = build(opt.list, M, opt);
      if (timerExt && !query) { query = gl.createQuery(); gl.beginQuery(timerExt.TIME_ELAPSED_EXT, query); timing = true; }
      gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, inst.subarray(0, n * FL), gl.DYNAMIC_DRAW);
      gl.viewport(0, 0, iw, ih); gl.disable(gl.BLEND);

      // the slice pass: G-buffer only
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboG); gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      drawSlices(pG, n, M, opt, opt.hsr);

      // the count pass: the same draw again, adding 1 per fragment. Red: fragments written. Green: fragments the quads cover.
      if (opt.measure || opt.heat) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboCount); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(pCount.p); gl.uniform1f(pCount.u.u_unit, UNIT); gl.uniform1i(pCount.u.u_all, 0); drawSlices(pCount, n, M, opt, opt.hsr);
        gl.useProgram(pCount.p); gl.uniform1i(pCount.u.u_all, 1); drawSlices(pCount, n, M, opt, false);
        gl.disable(gl.BLEND);
        if (opt.measure) {                                     // read the counts back: average and largest, per screen pixel
          const px = iw * ih, d = floatOK ? new Float32Array(px * 4) : new Uint8Array(px * 4); let sr = 0, sg = 0, mr = 0, mg = 0, any = 0;
          gl.readPixels(0, 0, iw, ih, gl.RGBA, floatOK ? gl.FLOAT : gl.UNSIGNED_BYTE, d);
          for (let i = 0; i < px * 4; i += 4) { const r = d[i], g = d[i + 1]; sr += r; sg += g; if (r > mr) mr = r; if (g > mg) mg = g; if (g > 0) any++; }
          E.stats.written = { avg: sr / px, max: mr }; E.stats.covered = { avg: sg / px, max: mg }; E.stats.pixels = px; E.stats.pixelsHit = any; E.stats.exact = floatOK;
        }
      }

      // the light pass: once per pixel
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboLit); gl.useProgram(pLight.p); gl.bindVertexArray(vaoFull);
      [[g0, 'u_g0'], [g1, 'u_g1'], [palTex, 'u_pal'], [hmTex, 'u_hm']].forEach(function (t, i) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t[0]); gl.uniform1i(pLight.u[t[1]], i); });
      gl.uniformMatrix4fv(pLight.u.u_inv, false, M.inv); gl.uniform3fv(pLight.u.u_sun, opt.sun); gl.uniform2fv(pLight.u.u_world, world);
      gl.uniform1f(pLight.u.u_night, opt.night ? 1 : 0); gl.uniform1i(pLight.u.u_shadows, opt.shadows ? 1 : 0);
      const lamps = new Float32Array(32), figs = new Float32Array(32);
      opt.lamps.slice(0, 8).forEach(function (l, i) { lamps.set([l[0], l[1], l[2], 90], i * 4); }); opt.figures.slice(0, 8).forEach(function (f, i) { figs.set(f, i * 4); });
      gl.uniform4fv(pLight.u.u_lamp, lamps); gl.uniform1i(pLight.u.u_nlamp, Math.min(8, opt.lamps.length)); gl.uniform4fv(pLight.u.u_fig, figs); gl.uniform1i(pLight.u.u_nfig, Math.min(8, opt.figures.length));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // to the canvas: the lit picture or the overdraw heat map, scaled up without smoothing
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); gl.activeTexture(gl.TEXTURE0);
      if (opt.heat) { gl.useProgram(pHeat.p); gl.bindTexture(gl.TEXTURE_2D, countTex); gl.uniform1i(pHeat.u.u_count, 0); gl.uniform1i(pHeat.u.u_channel, opt.heat - 1); gl.uniform1f(pHeat.u.u_unit, UNIT); }
      else { gl.useProgram(pBlit.p); gl.bindTexture(gl.TEXTURE_2D, lit); gl.uniform1i(pBlit.u.u_tex, 0); }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // GPU time for the frame, when the browser offers a timer (many do not)
      if (timing) { gl.endQuery(timerExt.TIME_ELAPSED_EXT); timing = false; }
      else if (query && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
        if (!gl.getParameter(timerExt.GPU_DISJOINT_EXT)) E.stats.gpuMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(query); query = null;
      }
      E.stats.cpuMs = performance.now() - t0; E.stats.iw = iw; E.stats.ih = ih;
    };
    // wait until the GPU has really finished the frame (reading a pixel back forces it)
    E.finish = function () { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); };
    return E;
  }

  // What the characters' draw functions call: queues slices of a figure standing at world scale `scale`.
  function figureWriter(list, scale) {
    const put = function (st, i, x, y, z, rot) { list.push({ stack: st, x: x * scale, y: y * scale, z: z * scale, rot: rot, scale: scale, only: i }); };
    return {
      slice: function (st, i, x, y, z, rot) { put(st, i, x, y, z, rot); },
      stack: function (st, x, y, z, rot) { for (let i = 0; i < st.slices.length; i++) put(st, i, x, y, z + st.slices[i].z, rot); },
      limb: function (st, a, b, n) { for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; put(st, 0, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t - 0.5, 0); } }
    };
  }

  global.Engine = { create: create, figureWriter: figureWriter, cameraMatrices: cameraMatrices, HMAX: HMAX };
})(window);
