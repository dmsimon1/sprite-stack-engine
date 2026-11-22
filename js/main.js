// main.js: the demo. Builds the village, moves what moves, flies the camera, shows the numbers.
//
// Mouse: drag turns and tilts, shift-drag or right-drag pans, wheel zooms.
// Keys: P perspective / parallel, H hidden-surface removal, O overdraw heat map (written, covered, off), M measure,
//       R internal resolution (1x, 1/2, 1/3), L shell stacks, T thickness fill, G edge guard,
//       S shadows, A ambient occlusion, B bloom, N time of day (drifting, afternoon, golden hour, dusk),
//       Space stops and starts the slow turn, U hides the read-out.
// The same switches work in the address, for capture: ?mode=persp&hsr=1&heat=1&res=2&shell=0&fill=1&guard=1&tod=0.6
//   &yaw=..&pitch=..&dist=..&tx=..&ty=..   ?view=street   ?tour plays the camera move   ?hud=1.6 enlarges the read-out
//   ?nohud hides it   ?hold stops the clock (demo.seek(frame))
(function () {
  'use strict';
  const Q = new URLSearchParams(location.search), num = function (k, d) { return Q.has(k) ? parseFloat(Q.get(k)) : d; };
  const canvas = document.getElementById('c'), hud = document.getElementById('hud'), statsEl = document.getElementById('stats'), keysEl = document.getElementById('keys');
  const E = Engine.create(canvas), SCALE = 0.45, STEP = 1 / 60, TOUR = 1080, TAU = Math.PI * 2;
  const WORLD = Scene.WORLD, G = WORLD.ground;

  // ---------------------------------------------------------------- art: every stack twice, whole and as a shell
  const pal = Scene.palette(), DEFS = Scene.stacks(), SETS = [];
  [0, 3].forEach(function (shell) {                            // 0: whole stacks. 3: only the pixels within 3 of the surface
    const atlas = new Art.Atlas(2048), stacks = {}, chars = {};
    DEFS.forEach(function (d) { stacks[d.name] = Art.buildStack(d, pal, atlas, shell); });
    Object.keys(Characters).forEach(function (c) { chars[c] = {}; Characters[c].parts.forEach(function (d) { chars[c][d.name] = Art.buildStack(d, pal, atlas, shell); }); });
    SETS.push({ stacks: stacks, chars: chars, atlas: E.makeAtlas(atlas.data, atlas.size), pixels: atlas.used });
  });
  E.setPalette(pal.bytes());

  const LAYOUT = Scene.layout();
  const statics = SETS.map(function (S) { return LAYOUT.map(function (l) { return { stack: S.stacks[l.n], x: l.x, y: l.y, z: l.z, rot: l.rot, scale: l.scale, only: -1, sway: l.sway, shx: 0, shy: 0 }; }); });
  const swayers = statics.map(function (st) { return st.filter(function (it) { return it.sway; }); });

  // The height map for shadows and occlusion: the tallest solid thing over every ground cell. The land comes
  // straight from the scene's survey; every standing stack then stamps its own outline on it.
  (function () {
    const W = WORLD.w, H = WORLD.h, hm = new Uint8Array(W * H), land = Scene.survey().hgt;
    for (let i = 0; i < W * H; i++) hm[i] = land[i] * 2;
    statics[0].forEach(function (it) {
      const st = it.stack, d = st.def; if (d.ground || d.noShadow) return;
      const c = Math.cos(it.rot), s = Math.sin(it.rot);
      for (let y = 0; y < st.h; y++) for (let x = 0; x < st.w; x++) {
        const lx = x + 0.5 - st.w / 2, ly = y + 0.5 - st.h / 2;
        let z = st.n - 1; while (z >= 0 && !(st.vox[(z * st.h + y) * st.w + x] && (!d.shadowIf || d.shadowIf(lx, ly, z)))) z--;      // the top of this column
        if (z < 0) continue;
        const wx = it.x + (lx * c - ly * s) * it.scale, wy = it.y + (lx * s + ly * c) * it.scale, v = Math.min(255, Math.round((it.z + (z + 1) * it.scale) * 2));
        for (let k = 0; k < 4; k++) {                          // a turned or enlarged stack would leave holes: stamp four cells
          const cx = Math.floor(wx + (k & 1) * 0.6 - 0.3), cy = Math.floor(wy + (k >> 1) * 0.6 - 0.3);
          if (cx > 0 && cy > 0 && cx < W - 1 && cy < H - 1 && v > hm[cy * W + cx]) hm[cy * W + cx] = v;
        }
      }
    });
    E.setHeightMap(hm, W, H);
  })();

  // ---------------------------------------------------------------- routes
  // A smooth curve through a list of points (Catmull-Rom), walked at a steady pace: at(s) -> [x, y, heading].
  function route(pts, closed) {
    const P = [], n = pts.length, get = function (i) { return closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]; };
    for (let i = 0; i < (closed ? n : n - 1); i++) for (let k = 0; k < 12; k++) {
      const t = k / 12, a = get(i - 1), b = get(i), c = get(i + 1), d = get(i + 2), f = function (j) { return 0.5 * (2 * b[j] + (c[j] - a[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t * t + (3 * b[j] - a[j] - 3 * c[j] + d[j]) * t * t * t); };
      P.push([f(0), f(1)]);
    }
    P.push(closed ? P[0] : pts[n - 1]);
    const L = [0]; for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const total = L[L.length - 1];
    return { length: total, at: function (s) {
      s = closed ? ((s % total) + total) % total : Math.max(0, Math.min(total - 0.001, s));
      let lo = 0, hi = L.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= s) lo = m; else hi = m; }
      const t = (s - L[lo]) / (L[hi] - L[lo] || 1), a = P[lo], b = P[hi];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[1] - a[1], b[0] - a[0])];
    } };
  }

  // ---------------------------------------------------------------- the patrols (the only things with memory: a rig per man)
  const C = Characters.soldier;
  let walkers = [], simFrame = -1;
  function resetSim() {
    walkers = [];
    Scene.PATROLS.forEach(function (p) {
      const r = route(p.pts, true);
      for (let i = 0; i < p.men; i++) { const k = { path: r, s: r.length * 0.3 - i * (p.gap || 0), rig: Rig.createWalker(C.rig), speed: C.rig.stride / 0.95 * SCALE }; const q = r.at(k.s); Rig.place(k.rig, q[0] / SCALE, q[1] / SCALE, q[2]); walkers.push(k); }
    });
    simFrame = -120;                                          // two seconds of walking before frame 0
  }
  function simTo(f) {
    if (f < simFrame || simFrame === -1) resetSim();
    for (; simFrame < f; simFrame++) walkers.forEach(function (k) { k.s += k.speed * STEP; const q = k.path.at(k.s); Rig.step(k.rig, q[0] / SCALE, q[1] / SCALE, q[2], STEP); });
  }

  // ---------------------------------------------------------------- state
  const VIEWS = {
    overview: { mode: 'ortho', tx: 256, ty: 192, yaw: 0.62, pitch: 0.72, dist: 450 },
    street: { mode: 'persp', tx: 262, ty: 194, yaw: 0.3, pitch: 0.44, dist: 158 },
    village: { mode: 'ortho', tx: 300, ty: 190, yaw: 0.62, pitch: 0.66, dist: 280 },
    bridge: { mode: 'persp', tx: 150, ty: 198, yaw: 2.6, pitch: 0.5, dist: 170 },
    top: { mode: 'ortho', tx: 256, ty: 192, yaw: Math.PI / 2, pitch: 1.5, dist: 620 },
    low: { mode: 'ortho', tx: 256, ty: 192, yaw: 0.62, pitch: 0.2, dist: 500 }
  };
  const v0 = VIEWS[Q.get('view') || 'overview'] || VIEWS.overview;
  const cam = { mode: Q.get('mode') || v0.mode, tx: num('tx', v0.tx), ty: num('ty', v0.ty), yaw: num('yaw', v0.yaw), pitch: num('pitch', v0.pitch), dist: num('dist', v0.dist), fov: 40 * Math.PI / 180 };
  const TOURING = Q.has('tour'), HELD = Q.has('hold');
  // tod: the time of day, 0 afternoon to 1 dusk; -1 lets it drift by itself (the live page does; a held page stays put)
  const S = { hsr: num('hsr', 1) === 1, heat: num('heat', 0), res: num('res', 1), shell: num('shell', 1) === 1, fill: num('fill', 1) === 1, guard: num('guard', 1) === 1,
    shadows: num('shadows', 1) === 1, ao: num('ao', 1) === 1, bloom: num('bloom', 1) === 1, tod: num('tod', HELD || TOURING ? 0.25 : -1), measure: num('measure', 0) === 1, orbit: !HELD && !TOURING && !Q.has('yaw') };
  let list = [], blobs = [], lamps = [], frame = 0, env = Scene.light(0), autoScale = 1;

  function clampCam() {
    const lowest = cam.mode === 'persp' ? cam.fov / 2 + 0.06 : 0.1;     // in perspective every view ray must still point downward
    cam.pitch = Math.max(lowest, Math.min(Math.PI / 2 - 0.001, cam.pitch)); cam.dist = Math.max(40, Math.min(1100, cam.dist));
  }
  // The film: five shots with cuts between them. Two in the parallel view, turning over the whole map: first the
  // picture, then the same picture as a heat map of fragments written (whole stacks, shell stacks, hidden-surface
  // removal). Then three in perspective as the afternoon turns to dusk: the bridge, the village, the wreck.
  // [start, end (0..1 of the film), camera, from and to: tx, ty, yaw, pitch, dist, time of day]
  const SHOTS = [
    [0, 0.25, 'ortho', [256, 192, 0.62, 0.72, 470, 0.04], [262, 192, 1.32, 0.68, 400, 0.12]],
    [0.25, 0.47, 'ortho', [262, 192, 1.32, 0.68, 400, 0.12], [262, 192, 1.95, 0.7, 430, 0.2]],
    [0.47, 0.64, 'persp', [172, 200, 3.62, 0.55, 218, 0.3], [182, 200, 3.44, 0.52, 196, 0.42]],
    [0.64, 0.82, 'persp', [322, 208, 0.74, 0.58, 212, 0.56], [326, 212, 1.04, 0.54, 194, 0.74]],
    [0.82, 1, 'persp', [106, 190, 0.8, 0.53, 204, 0.9], [120, 194, 0.68, 0.49, 178, 1]]
  ];
  function tour(f) {
    const u = (f % TOUR) / TOUR; let k = 0; while (k < SHOTS.length - 1 && u >= SHOTS[k][1]) k++;
    const sh = SHOTS[k], t = (u - sh[0]) / (sh[1] - sh[0]), e = t * 0.6 + t * t * (3 - 2 * t) * 0.4, v = function (i) { return sh[3][i] + (sh[4][i] - sh[3][i]) * e; };      // mostly steady, a little eased
    cam.mode = sh[2]; cam.tx = v(0); cam.ty = v(1); cam.yaw = v(2); cam.pitch = v(3); cam.dist = v(4); S.tod = v(5);
    const heat = k === 1;
    S.heat = heat ? 1 : 0; S.measure = true; S.shell = !(heat && t < 0.33); S.hsr = !(heat && t < 0.66);
  }

  // Everything that moves without memory is a function of the time alone, so any frame can be asked for by number.
  function animate(t, set) {
    const push = function (name, x, y, z, rot, scale) { list.push({ stack: set.stacks[name], x: x, y: y, z: z, rot: rot, scale: scale || 1, only: -1 }); };
    const wind = [-0.98, 0.17];
    // trees, grass and wheat lean with the wind: a slow wave that crosses the map
    const sw = swayers[S.shell ? 1 : 0];
    for (let i = 0; i < sw.length; i++) { const it = sw[i], ph = t * (it.sway > 0.1 ? 2.4 : 1.5) - it.x * 0.045 - it.y * 0.026, a = it.sway * (0.35 + Math.sin(ph) + 0.4 * Math.sin(ph * 2.3 + it.x)); it.shx = a * wind[0]; it.shy = a * wind[1]; }
    // the tank's turret traverses slowly, watching the bridge
    const T = Scene.TANK, ta = T.rot + 0.5 * Math.sin(t * TAU / 18) + 0.1 * Math.sin(t * TAU / 6 + 1), tz = Scene.groundAt(T.x, T.y) + 11, txp = T.x + Math.cos(T.rot) * 1.5, typ = T.y + Math.sin(T.rot) * 1.5;
    push('tankTurret', txp, typ, tz, ta); blobs.push([txp, typ, tz + 7, 9.5, tz - 1]);
    // the jeep runs the road from one side of the map to the other, every 18 seconds, with dust behind it
    const J = Scene.JEEP, jeepAt = function (time) { const x = J.from + (((time + 12.8) % 18) + 18) % 18 * J.speed, y = Scene.roadY(x); return x > J.to ? null : [x, y, Math.atan(9 * 0.012 * Math.cos(x * 0.012 + 1)), Scene.groundAt(x, y)]; };
    const j = jeepAt(t);
    if (j) {
      push('jeep', j[0], j[1], j[3] + 0.3 * Math.abs(Math.sin(j[0] * 0.33)), j[2]);
      for (let k = -1; k <= 1; k += 2) blobs.push([j[0] + Math.cos(j[2]) * 6 * k, j[1] + Math.sin(j[2]) * 6 * k, j[3] + 8, 6.5, j[3] - 1]);
    }
    for (let k = 0; k < 5; k++) { const age = ((t * 0.9 + k / 5) % 1) * 1.5, d = jeepAt(t - age - 0.25); if (d && Scene.kindAt(d[0], d[1]) === Scene.KIND.road) push(age < 0.6 ? 'dust0' : 'dust1', d[0] + Math.sin(k * 5) * 2, d[1] + Math.cos(k * 3) * 3, d[3] + 1 + age * 2.5, k, 0.4 + age * 0.55); }
    // the wreck burns: three flames that flicker, and smoke that rises, spreads, thins and drifts down the wind
    const Wk = Scene.WRECK, wc = Math.cos(Wk.rot), ws = Math.sin(Wk.rot), wz = Scene.groundAt(Wk.x, Wk.y);
    [[-12, 0, 0], [-4, 2, 1], [14, -1, 2]].forEach(function (p) { const k = p[2]; push('flame' + (Math.floor(t * 9 + k * 1.7) % 3), Wk.x + p[0] * wc - p[1] * ws, Wk.y + p[0] * ws + p[1] * wc, wz + 5, t * 3 + k, (k === 2 ? 0.7 : 1) * (0.9 + 0.2 * Math.sin(t * 17 + k * 2))); });
    const N = 15, life = 6;
    for (let k = 0; k < N; k++) {
      const age = ((t / life + k / N) % 1) * life, a2 = age * age, sx = Wk.x - 8 * wc + wind[0] * (age * 3.5 + a2 * 1.1) + Math.sin(k * 2.4 + age * 0.9) * (1.5 + age), sy = Wk.y - 8 * ws + wind[1] * (age * 3.5 + a2 * 1.1) + Math.cos(k * 1.7 + age * 0.7) * (1.5 + age);
      const sz = wz + 9 + age * 15 - a2 * 0.5, sc = 0.42 + age * 0.23;
      push(age < 1.3 ? 'smoke0' : age < 2.9 ? 'smoke1' : age < 4.6 ? 'smoke2' : 'smoke3', sx, sy, Math.min(sz, 118 - 15 * sc), k * 2.1 + age * 0.25, sc);
      if (age < 4.6 && age > 0.4) blobs.push([sx, sy, sz + 14 * sc, 7 * sc, sz]);
    }
    // birds wheel round the steeple and over the wheat, flapping, now and then gliding
    Scene.BIRDS.forEach(function (F, fi) {
      for (let i = 0; i < F[4]; i++) {
        const a = t * TAU / 18 * (fi ? -1 : 2) + i * 0.5 + fi, r = F[2] + 9 * Math.sin(t * TAU / 9 + i * 2.1), x = F[0] + Math.cos(a) * r, y = F[1] + Math.sin(a) * r, z = F[3] + 6 * Math.sin(t * TAU / 6 + i * 1.3);
        const glide = Math.sin(t * TAU / 4.5 + i * 2) > 0.45, w = glide ? 1 : [0, 1, 2, 1][Math.floor(t * 10 + i * 1.3) % 4];
        push('bird' + w, x, y, z, a + (fi ? -1 : 1) * Math.PI / 2 + 0.25, 1.15); if (blobs.length < 22) blobs.push([x, y, z + 2, 3.5, z - 1]);
      }
    });
    // the light of the fire (always), and the lamps as dusk falls: [x, y, z, reach, r, g, b]
    const fl = 0.8 + 0.14 * Math.sin(t * 13) + 0.1 * Math.sin(t * 31 + 2), fk = (0.55 + 1.2 * env.glow) * fl;
    lamps.push([Wk.x - 6 * wc, Wk.y - 6 * ws, wz + 11, 70, 1.5 * fk, 0.72 * fk, 0.25 * fk]);
    if (env.glow > 0.02) Scene.LAMPS.forEach(function (L, i) { const k = env.glow * 1.5 * (0.94 + 0.06 * Math.sin(t * 9 + i * 2)); lamps.push([L[0], L[1], L[2], L[3], 1.0 * k, 0.72 * k, 0.4 * k]); });
  }

  function draw(f, measure) {
    frame = f; simTo(f); if (TOURING) tour(f); else if (S.orbit) cam.yaw = v0.yaw + f / 60 * 0.06; clampCam();
    const t = f / 60, set = SETS[S.shell ? 1 : 0], st = statics[S.shell ? 1 : 0];
    env = Scene.light(S.tod < 0 ? 0.5 - 0.5 * Math.cos(t * TAU / 80) : S.tod); env.cloud = 0.5 * (1 - env.glow);
    list.length = 0; blobs = []; lamps = [];
    walkers.forEach(function (k) {
      const P = Rig.pose(k.rig), lift = Scene.groundAt(P.x * SCALE, P.y * SCALE); C.draw(Engine.figureWriter(list, SCALE, lift), set.chars.soldier, P);
      blobs.push([P.x * SCALE, P.y * SCALE, lift + C.height * SCALE, 3, lift - 1]);
    });
    animate(t, set);
    for (let i = 0; i < st.length; i++) list.push(st[i]);
    E.render({ cam: cam, list: list, atlas: set.atlas, hsr: S.hsr, fill: S.fill, guard: S.guard, heat: S.heat, measure: measure || S.measure, scale: S.res * autoScale,
      shadows: S.shadows, ao: S.ao, bloom: S.bloom, light: env, lamps: lamps, blobs: blobs, water: pal.names.water2, ground: G, time: t });
  }

  // The canvas is as large as the window in device pixels; the picture inside it is kept to about two million
  // pixels (the light pass is paid per pixel, and a 4K screen has four times that).
  function fit() { const d = window.devicePixelRatio || 1; canvas.width = Math.round(window.innerWidth * d); canvas.height = Math.round(window.innerHeight * d); autoScale = Math.max(1, Math.sqrt(canvas.width * canvas.height / 2.4e6)); }
  function showHud(ms) {
    const s = E.stats, f1 = function (v) { return v === null || v === undefined ? '-' : v.toFixed(v < 10 ? 2 : 1); }, th = function (v) { return String(v).replace(/\B(?=(\d{3})+$)/g, ','); };
    const tod = env.t < 0.3 ? 'afternoon' : env.t < 0.82 ? 'golden hour' : 'dusk';
    statsEl.textContent = [
      s.iw + ' x ' + s.ih + (s.iw !== canvas.width ? ' (shown at ' + canvas.width + ' x ' + canvas.height + ')' : '') + '   ' + (cam.mode === 'persp' ? 'perspective' : 'parallel') + ' camera, tilt ' + Math.round(cam.pitch * 180 / Math.PI) + '°   ' + tod,
      (S.hsr ? 'hidden-surface removal: top first, depth test' : 'painter order: bottom first, no depth test') + '   ' + (S.shell ? 'shell' : 'whole') + ' stacks' + (S.fill ? '' : '   fill off') + (S.guard ? '' : '   guard off'),
      th(s.slices) + ' slices, ' + th(s.instances) + ' quads',
      s.written ? 'fragments per pixel: ' + f1(s.written.avg) + ' written (' + Math.round(s.written.max) + ' max), ' + f1(s.covered.avg) + ' covered (' + Math.round(s.covered.max) + ' max)' : 'fragments per pixel: press M to measure',
      'frame ' + f1(ms) + ' ms' + (s.gpuMs !== null ? '   gpu ' + f1(s.gpuMs) + ' ms' : '') + '   build ' + f1(s.cpuMs) + ' ms' + (S.measure || S.heat ? '   (with the count pass)' : '')
    ].concat(S.heat ? ['heat map, fragments ' + (S.heat === 1 ? 'written' : 'covered') + ':  black 0  blue 1  green 4  yellow 16  red 64  white 256'] : []).join('\n');
  }

  // ---------------------------------------------------------------- input
  let drag = null;
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  canvas.addEventListener('mousedown', function (e) { drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }; if (S.orbit) { S.orbit = false; v0.yaw = cam.yaw; } });
  window.addEventListener('mouseup', function () { drag = null; });
  window.addEventListener('mousemove', function (e) {
    if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) { const k = cam.dist / 500, c = Math.cos(cam.yaw), s = Math.sin(cam.yaw); cam.tx += (-dx * s - dy * c / Math.max(0.3, Math.sin(cam.pitch))) * k * -1; cam.ty += (dx * c - dy * s / Math.max(0.3, Math.sin(cam.pitch))) * k; }
    else { cam.yaw -= dx * 0.006; cam.pitch += dy * 0.005; }
  });
  canvas.addEventListener('wheel', function (e) { cam.dist *= Math.exp(e.deltaY * 0.001); e.preventDefault(); }, { passive: false });
  window.addEventListener('keydown', function (e) {
    const k = e.key.toLowerCase();
    if (k === 'p') cam.mode = cam.mode === 'persp' ? 'ortho' : 'persp'; else if (k === 'h') S.hsr = !S.hsr; else if (k === 'o') S.heat = (S.heat + 1) % 3;
    else if (k === 'r') { S.res = S.res % 3 + 1; resByHand = true; } else if (k === 'l') S.shell = !S.shell; else if (k === 't') S.fill = !S.fill; else if (k === 'g') S.guard = !S.guard;
    else if (k === 's') S.shadows = !S.shadows; else if (k === 'a') S.ao = !S.ao; else if (k === 'b') S.bloom = !S.bloom; else if (k === 'm') S.measure = !S.measure;
    else if (k === 'n') S.tod = S.tod < 0 ? 0 : S.tod < 0.3 ? 0.55 : S.tod < 0.8 ? 1 : -1;
    else if (k === ' ') { S.orbit = !S.orbit; v0.yaw = cam.yaw - frame / 60 * 0.06; e.preventDefault(); }
    else if (k === 'u') hud.classList.toggle('off');
  });
  window.addEventListener('resize', fit);
  // If the browser takes the graphics context away (a driver reset, too many pages), say so instead of going blank.
  canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); playing = false; hud.classList.remove('off'); statsEl.textContent = 'The browser lost the WebGL context. Reload the page.'; });

  // ---------------------------------------------------------------- the clock, and what capture and measurement call
  let playing = !HELD, t0 = null, last = 0, smooth = 0, slow = 0, resByHand = Q.has('res');
  function tick(t) {
    if (playing) {
      if (t0 === null) t0 = t; const dt = t - last; last = t; smooth += (dt - smooth) * 0.1; draw(Math.floor((t - t0) / 1000 * 60)); showHud(smooth);
      // On hardware that cannot keep up (under about 30 frames a second for a second and a half), render fewer
      // pixels: the same as pressing R. Once R has been pressed the choice is left alone.
      slow = smooth > 32 && !S.heat && !S.measure ? slow + 1 : 0; if (slow > 90 && !resByHand && S.res < 3) { S.res++; slow = 0; }
    }
    requestAnimationFrame(tick);
  }
  window.demo = {
    frames: TOUR, fps: 60, engine: E, cam: cam, state: S, views: VIEWS, scene: Scene,
    ready: Promise.resolve({ frames: TOUR, fps: 60 }),
    seek: function (f) { playing = false; fit(); draw(f); showHud(E.stats.cpuMs); return f; },
    set: function (o) { Object.keys(o).forEach(function (k) { if (k in S) S[k] = o[k]; else if (k === 'view') Object.assign(cam, VIEWS[o[k]]); else cam[k] = o[k]; }); },
    // one frame with the count pass: fragments per pixel, exactly
    measure: function (f) { playing = false; fit(); draw(f || 0, true); showHud(E.stats.cpuMs); const s = E.stats; return { canvas: [canvas.width, canvas.height], internal: [s.iw, s.ih], slices: s.slices, quads: s.instances, written: s.written, covered: s.covered, pixelsHit: s.pixelsHit / s.pixels, exact: s.exact, renderer: E.renderer }; },
    // n frames one after another, each waited for: milliseconds per frame, everything included
    bench: function (n) { playing = false; fit(); for (let i = 0; i < 10; i++) { draw(i); E.finish(); } const a = performance.now(); for (let i = 0; i < n; i++) { draw(10 + i); E.finish(); } return (performance.now() - a) / n; }
  };
  fit(); draw(0); showHud(0);
  if (Q.has('nohud')) hud.classList.add('off');
  if (TOURING) hud.classList.add('film');                           // the film shows the numbers, not the keys
  if (Q.has('hud')) hud.style.fontSize = 12 * num('hud', 1) + 'px';      // a larger read-out, for video
  document.body.classList.add('ready');
  requestAnimationFrame(tick);
})();
