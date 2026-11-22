// main.js: the demo. Builds the town, walks the figures, moves the camera, shows the numbers.
//
// Mouse: drag turns and tilts, shift-drag or right-drag pans, wheel zooms.
// Keys: P perspective / parallel, H hidden-surface removal, O overdraw heat map (written, covered, off),
//       R internal resolution (1x, 1/2, 1/3), L shell stacks, T thickness fill, G edge guard, S shadows, N night, M measure.
// The same switches work in the address, for capture: ?mode=persp&hsr=1&heat=1&res=2&shell=0&fill=1&guard=1&night=1
//   &yaw=..&pitch=..&dist=..&tx=..&ty=..   ?tour plays a camera move   ?hud=1.6 enlarges the read-out   ?hold stops the clock (demo.seek(frame))
(function () {
  'use strict';
  const Q = new URLSearchParams(location.search), num = function (k, d) { return Q.has(k) ? parseFloat(Q.get(k)) : d; };
  const canvas = document.getElementById('c'), hud = document.getElementById('hud');
  const E = Engine.create(canvas), SCALE = 0.7, STEP = 1 / 60, TOUR = 720;

  // ---------------------------------------------------------------- art: every stack twice, whole and as a shell
  const pal = Town.palette(), SETS = [];
  [0, 3].forEach(function (shell) {                            // 0: whole stacks. 3: only the pixels within 3 of the surface
    const atlas = new Art.Atlas(2048), stacks = {}, chars = {};
    Town.stacks().forEach(function (d) { const st = stacks[d.name] = Art.buildStack(d, pal, atlas, shell); st.flat = d.layers === 1; });
    Object.keys(Characters).forEach(function (c) { chars[c] = {}; Characters[c].parts.forEach(function (d) { chars[c][d.name] = Art.buildStack(d, pal, atlas, shell); }); });
    SETS.push({ stacks: stacks, chars: chars, atlas: E.makeAtlas(atlas.data, atlas.size), pixels: atlas.used });
  });
  E.setPalette(pal.bytes());

  const LAYOUT = Town.layout();
  const statics = SETS.map(function (S) { return LAYOUT.map(function (l) { return { stack: S.stacks[l[0]], x: l[1], y: l[2], z: 0, rot: l[3], scale: 1, only: -1 }; }); });

  // the height map for shadows: the tallest solid thing over every ground cell (from the whole stacks)
  (function () {
    const W = Town.WORLD.w, H = Town.WORLD.h, hm = new Uint8Array(W * H);
    statics[0].forEach(function (it) {
      const st = it.stack; if (st.flat || st.name === 'lamp') return;      // (the head of a lamp would cast the shadow of a pillar: a height map has no overhangs)
      const c = Math.cos(it.rot), s = Math.sin(it.rot);
      for (let z = 0; z < st.n; z++) for (let y = 0; y < st.h; y++) for (let x = 0; x < st.w; x++) {
        if (!st.vox[(z * st.h + y) * st.w + x]) continue;
        const lx = x + 0.5 - st.w / 2, ly = y + 0.5 - st.h / 2, wx = Math.floor(it.x + lx * c - ly * s), wy = Math.floor(it.y + lx * s + ly * c);
        if (wx < 0 || wy < 0 || wx >= W || wy >= H) continue;
        const v = Math.min(255, (z + 1) * 2); if (v > hm[wy * W + wx]) hm[wy * W + wx] = v;
      }
    });
    E.setHeightMap(hm, W, H);
  })();

  // ---------------------------------------------------------------- the walkers
  let walkers = [], simFrame = -1;
  function resetSim() {
    walkers = Town.WALKERS.map(function (w) {
      const C = Characters[w[0]], k = { name: w[0], C: C, cx: w[1], cy: w[2], rx: w[3], ry: w[4], a: w[5] * Math.PI * 2, dir: w[6], rig: Rig.createWalker(C.rig), speed: C.rig.stride / 0.9 };
      const p = where(k); Rig.place(k.rig, p[0] / SCALE, p[1] / SCALE, p[2]); return k;
    });
    simFrame = -120;                                          // two seconds of walking before frame 0
  }
  function where(k) { const c = Math.cos(k.a), s = Math.sin(k.a); return [k.cx + k.rx * c, k.cy + k.ry * s, Math.atan2(k.ry * c * k.dir, -k.rx * s * k.dir)]; }
  function simTo(f) {
    if (f < simFrame || simFrame === -1) resetSim();
    for (; simFrame < f; simFrame++) walkers.forEach(function (k) {
      k.a += k.dir * k.speed * SCALE * STEP / Math.hypot(k.rx * Math.sin(k.a), k.ry * Math.cos(k.a));   // the same ground speed all round the loop
      const p = where(k); Rig.step(k.rig, p[0] / SCALE, p[1] / SCALE, p[2], STEP);
    });
  }

  // ---------------------------------------------------------------- state
  const VIEWS = {
    overview: { mode: 'ortho', tx: 160, ty: 128, yaw: 0.62, pitch: 0.72, dist: 370 },
    street: { mode: 'persp', tx: 160, ty: 128, yaw: 0.95, pitch: 0.44, dist: 210 },
    top: { mode: 'ortho', tx: 160, ty: 128, yaw: 0, pitch: 1.5, dist: 370 },
    low: { mode: 'ortho', tx: 160, ty: 128, yaw: 0.62, pitch: 0.2, dist: 330 }
  };
  const v0 = VIEWS[Q.get('view') || 'overview'] || VIEWS.overview;
  const cam = { mode: Q.get('mode') || v0.mode, tx: num('tx', v0.tx), ty: num('ty', v0.ty), yaw: num('yaw', v0.yaw), pitch: num('pitch', v0.pitch), dist: num('dist', v0.dist), fov: 40 * Math.PI / 180 };
  const S = { hsr: num('hsr', 0) === 1, heat: num('heat', 0), res: num('res', 1), shell: num('shell', 1) === 1, fill: num('fill', 1) === 1, guard: num('guard', 1) === 1, shadows: num('shadows', 1) === 1, night: num('night', 0) === 1, measure: num('measure', 0) === 1 };
  const TOURING = Q.has('tour'), sun = (function () { const v = [-0.58, 0.30, 0.76], l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })();
  let list = [], figures = [], frame = 0;

  function clampCam() {
    const lowest = cam.mode === 'persp' ? cam.fov / 2 + 0.06 : 0.1;     // in perspective every view ray must still point downward
    cam.pitch = Math.max(lowest, Math.min(Math.PI / 2 - 0.001, cam.pitch)); cam.dist = Math.max(40, Math.min(900, cam.dist));
  }
  // A camera move for capture. Round the block in the parallel view; the same picture as a heat map of fragments
  // written (whole stacks, then shell stacks, then hidden-surface removal); then down to the street in perspective.
  function tour(f) {
    const u = (f % TOUR) / TOUR, e = function (a, b) { const t = Math.max(0, Math.min(1, (u - a) / (b - a))); return t * t * (3 - 2 * t); };
    cam.yaw = 0.62 + u * Math.PI * 2; cam.mode = u >= 0.62 ? 'persp' : 'ortho';
    cam.pitch = 0.72 + 0.5 * (e(0.04, 0.12) - e(0.16, 0.24)) - 0.28 * (e(0.66, 0.78) - e(0.9, 1));
    cam.dist = 370 - 170 * (e(0.66, 0.78) - e(0.9, 1));
    S.measure = true; S.heat = u >= 0.25 && u < 0.62 ? 1 : 0; S.shell = !(u >= 0.25 && u < 0.38); S.hsr = u >= 0.5;
  }
  function draw(f, measure) {
    frame = f; simTo(f); if (TOURING) tour(f); clampCam();
    const set = SETS[S.shell ? 1 : 0], st = statics[S.shell ? 1 : 0];
    list.length = 0; for (let i = 0; i < st.length; i++) list.push(st[i]);
    figures = [];
    walkers.forEach(function (k) {
      const P = Rig.pose(k.rig); k.C.draw(Engine.figureWriter(list, SCALE), set.chars[k.name], P);
      figures.push([P.x * SCALE, P.y * SCALE, k.C.height * SCALE, 3.2]);
    });
    E.render({ cam: cam, list: list, atlas: set.atlas, hsr: S.hsr, fill: S.fill, guard: S.guard, shadows: S.shadows, night: S.night, heat: S.heat, measure: measure || S.measure, scale: S.res, sun: sun, lamps: S.night ? Town.LAMPS : [], figures: figures });
  }

  function fit() { const d = window.devicePixelRatio || 1; canvas.width = Math.round(window.innerWidth * d); canvas.height = Math.round(window.innerHeight * d); }
  function showHud(ms) {
    const s = E.stats, f1 = function (v) { return v === null || v === undefined ? '-' : v.toFixed(v < 10 ? 2 : 1); };
    hud.textContent = [
      canvas.width + 'x' + canvas.height + ' canvas, ' + s.iw + 'x' + s.ih + ' internal   ' + (cam.mode === 'persp' ? 'perspective' : 'parallel') + ' camera, tilt ' + Math.round(cam.pitch * 180 / Math.PI) + ' deg',
      (S.hsr ? 'hidden-surface removal: top first, depth test' : 'painter: bottom first, no depth test') + '   shell ' + (S.shell ? 'on' : 'off') + '   fill ' + (S.fill ? 'on' : 'off') + '   guard ' + (S.guard ? 'on' : 'off'),
      s.slices + ' slices, ' + s.instances + ' quads drawn',
      s.written ? 'fragments per pixel: written ' + f1(s.written.avg) + ' avg, ' + Math.round(s.written.max) + ' max    covered by quads ' + f1(s.covered.avg) + ' avg, ' + Math.round(s.covered.max) + ' max' : 'fragments per pixel: press M to measure',
      'frame ' + f1(ms) + ' ms' + (s.gpuMs !== null ? '   gpu ' + f1(s.gpuMs) + ' ms' : '') + '   (build and submit ' + f1(s.cpuMs) + ' ms)' + (S.measure || S.heat ? '   times include the count pass' : ''),
      S.heat ? 'heat map of fragments ' + (S.heat === 1 ? 'written' : 'covered') + ': black 0, blue 1, green 4, yellow 16, red 64, white 256' : 'P camera  H hidden-surface  O heat map  R resolution  L shell  T fill  G guard  S shadows  N night  M measure'
    ].join('\n');
  }

  // ---------------------------------------------------------------- input
  let drag = null;
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  canvas.addEventListener('mousedown', function (e) { drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }; });
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
    else if (k === 'r') S.res = S.res % 3 + 1; else if (k === 'l') S.shell = !S.shell; else if (k === 't') S.fill = !S.fill; else if (k === 'g') S.guard = !S.guard;
    else if (k === 's') S.shadows = !S.shadows; else if (k === 'n') S.night = !S.night; else if (k === 'm') S.measure = !S.measure;
  });
  window.addEventListener('resize', fit);

  // ---------------------------------------------------------------- the clock, and what capture and measurement call
  let playing = !Q.has('hold'), t0 = null, last = 0, smooth = 0;
  function tick(t) {
    if (playing) { if (t0 === null) t0 = t; const dt = t - last; last = t; smooth += (dt - smooth) * 0.1; draw(Math.floor((t - t0) / 1000 * 60)); showHud(smooth); }
    requestAnimationFrame(tick);
  }
  window.demo = {
    frames: TOUR, fps: 60, engine: E, cam: cam, state: S, views: VIEWS,
    ready: Promise.resolve({ frames: TOUR, fps: 60 }),
    seek: function (f) { playing = false; fit(); draw(f); showHud(E.stats.cpuMs); return f; },
    set: function (o) { Object.keys(o).forEach(function (k) { if (k in S) S[k] = o[k]; else if (k === 'view') Object.assign(cam, VIEWS[o[k]]); else cam[k] = o[k]; }); },
    // one frame with the count pass: fragments per pixel, exactly
    measure: function (f) { playing = false; fit(); draw(f || 0, true); showHud(E.stats.cpuMs); const s = E.stats; return { canvas: [canvas.width, canvas.height], internal: [s.iw, s.ih], slices: s.slices, quads: s.instances, written: s.written, covered: s.covered, pixelsHit: s.pixelsHit / s.pixels, exact: s.exact, renderer: E.renderer }; },
    // n frames one after another, each waited for: milliseconds per frame, everything included
    bench: function (n) { playing = false; fit(); for (let i = 0; i < 10; i++) { draw(i); E.finish(); } const a = performance.now(); for (let i = 0; i < n; i++) { draw(10 + i); E.finish(); } return (performance.now() - a) / n; }
  };
  fit(); draw(0); showHud(0);
  if (Q.has('nohud')) hud.style.display = 'none';
  if (Q.has('hud')) hud.style.fontSize = 13 * num('hud', 1) + 'px';      // a larger read-out, for video
  requestAnimationFrame(tick);
})();
