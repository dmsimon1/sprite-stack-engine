// scene.js: the demo scene. A village in hedgerow country, summer 1944, a few days after the fighting passed:
// a stream and its stone bridge, a dirt road, fields behind hedges, a farm with a shelled barn, a church, an
// orchard; a tank and a sandbag post watching the bridge, a burnt-out lorry, craters, wire, a patrol.
// Everything is a slice stack built by art.js. World units are art pixels: x and y on the ground, z up.
//
// The ground is not flat paint. It is a height field cut into 32 x 32 tiles, each a stack a few layers tall:
// the stream lies two layers under the fields, craters are dug into it, and the hedges and stone walls are part
// of it (which lets them follow any line). The shadow and occlusion passes read the same heights.
(function (global) {
  'use strict';
  const hash = Art.hash, noise = Art.noise, abs = Math.abs, floor = Math.floor, hypot = Math.hypot, sin = Math.sin, cos = Math.cos;
  const WORLD = { w: 512, h: 384, ground: 3 }, W = WORLD.w, H = WORLD.h, G = WORLD.ground, TILE = 32;

  function palette() {
    const P = new Art.Palette(), add = function (list) { for (let i = 0; i < list.length; i += 2) { const g = list[i + 1].split(' '); P.add(list[i], g[0], g[1] ? parseFloat(g[1]) : 0); } };
    // the ground
    add(['grass', '#86a653', 'grass2', '#74974a', 'grass3', '#97b15f', 'grassDry', '#b3b06a', 'grassB', '#5f8540', 'grassT', '#a5bd68', 'pasture', '#7ca34d', 'clover', '#648f47',
      'flowerW', '#f3eeda', 'flowerY', '#ecc94a', 'poppy', '#d6402c', 'dirt', '#bd9d6c', 'dirt2', '#ab8c5e', 'rut', '#917650', 'pebble', '#d2bd96', 'earth', '#80664a', 'mud', '#7a6447',
      'soil', '#8c6b48', 'soil2', '#76583b', 'soil3', '#9d7c56', 'scorch', '#4d433a', 'crater', '#5f4d3b', 'ash', '#77706a', 'stubble', '#cbb56c', 'stubble2', '#b9a25c',
      'wheat', '#dfc264', 'wheat2', '#ecd47c', 'wheat3', '#c7a64b', 'hay', '#dbc87c', 'hay2', '#c5b064', 'mown', '#a9b85c', 'mown2', '#9aab52', 'cabbage', '#4f8a4a', 'cabbage2', '#6aa35a',
      'cobble', '#b8ae9a', 'cobble2', '#a59a86', 'cobble3', '#c8bfac', 'gravel', '#d2c9b0', 'yard', '#b29a70', 'yard2', '#c4ae80',
      'water', '#5a8f7d', 'water2', '#4a7d70', 'water3', '#6ba38c', 'reed', '#86a04a', 'reed2', '#bba95e', 'bank', '#6f8a44']);
    // hedges and trees
    add(['hedge1', '#456e38', 'hedge2', '#527d3f', 'hedge3', '#678f49', 'hedgeD', '#37592f', 'oak1', '#50803a', 'oak2', '#629243', 'oak3', '#416b32', 'oak4', '#7ba551',
      'pop1', '#71964a', 'pop2', '#88a957', 'pop3', '#5a7b3d', 'apple1', '#628e42', 'apple2', '#76a04c', 'apple3', '#4f7837', 'appleR', '#cc392b',
      'wil1', '#86aa59', 'wil2', '#9cbc69', 'wil3', '#6f954a', 'yew1', '#2f5b35', 'yew2', '#3b6c3e', 'ivy1', '#447a3a', 'ivy2', '#36662f', 'trunk', '#6d5138', 'trunk2', '#59412e', 'splinter', '#c9a878', 'moss', '#8e9b58']);
    // buildings
    add(['lime1', '#dad0b5', 'lime2', '#cdc1a2', 'lime3', '#e5dcc4', 'lime4', '#bdb192', 'limeD', '#a89d82', 'quoin', '#eee7d3', 'inside', '#3a332c', 'barnIn', '#3f352b',
      'plaster', '#eee4c8', 'plaster2', '#e0d4b4', 'timber', '#7b5b3d', 'timberD', '#57402e', 'plank', '#94714b', 'plank2', '#82623f',
      'tile1', '#c2613c', 'tile2', '#b25430', 'tile3', '#d1754a', 'tile4', '#a34a2d', 'tileMoss', '#9c8148', 'ridge', '#8c3f29', 'thatch1', '#b99b57', 'thatch2', '#a48646', 'thatch3', '#ccb16b',
      'slate', '#5f5751', 'slate2', '#6e655d', 'lead', '#8d867b', 'louvre', '#39332e', 'chimPot', '#b5583a', 'gold', '#dbb23e',
      'door', '#6b4a30', 'doorG', '#5e765a', 'doorR', '#8a3d31', 'doorB', '#7a5a3c', 'shutter', '#64846c', 'shutterR', '#93463a', 'shutterB', '#a98f5a', 'frame', '#efe8d4',
      'glass', '#343a38', 'glassLit', '#ffc76e 0.75', 'glassC', '#e2a552 0.5', 'lamp', '#ffdc96 0.95', 'grave', '#bcb5a2', 'iron', '#3b3a37', 'steel', '#8b8b82', 'rope', '#cfbd8c']);
    // the army's things
    add(['tent', '#a89f6c', 'tent2', '#8f8758', 'olive', '#606c3b', 'olive2', '#6f7b45', 'oliveD', '#4c562f', 'canvas', '#8d885a', 'canvas2', '#79754b', 'track', '#3c3b35', 'track2', '#4d4b42', 'trackIn', '#2c2b27', 'wheel', '#56603a',
      'tyre', '#2e2d2a', 'grille', '#33382a', 'gun', '#42463e', 'gunD', '#2f322d', 'screen', '#a9b6a2', 'fgrey', '#5f695d', 'char', '#2c2825', 'char2', '#3c342e', 'rust', '#8c5437', 'soot', '#3f3833',
      'crate', '#aa844f', 'crate2', '#967240', 'crateD', '#6f5331', 'crateL', '#c2a26c', 'drum', '#58653b', 'drumTop', '#687645', 'drumBand', '#414c2c', 'drumRust', '#7d5a3a', 'jerry', '#515c35',
      'sand1', '#c4ae7e', 'sand2', '#b49d6d', 'sand3', '#d1bc8e', 'sandD', '#98825a', 'picket', '#6b553b', 'wire', '#46423d', 'pole', '#5d4b37', 'insul', '#eae4d2',
      'cowW', '#eee8d8', 'cowB', '#7b4b2d', 'cowN', '#e3aa9a', 'bird', '#2b2927', 'bird2', '#3d3a37']);
    // fire and smoke. A glow of 1 always shines; the lamps above (under 1) only shine at dusk.
    add(['fire1', '#fff2a8 1', 'fire2', '#ffb347 1', 'fire3', '#f26d21 1', 'ember', '#e0531f 1', 'smokeA', '#272524', 'smokeB', '#3b3836', 'smokeC', '#54504c', 'smokeD', '#716c67', 'dust', '#b6a17c', 'dust2', '#c2ae8a']);
    // the soldiers
    add(['skin', '#d9a981', 'helmet', '#56623b', 'helmetD', '#465131', 'tunic', '#6b7145', 'tunicD', '#595f39', 'trousers', '#756d49', 'web', '#bbad7c', 'boots', '#3f3026', 'gaiter', '#918862', 'rifleW', '#6b4729', 'rifleM', '#343330', 'packS', '#807b4f']);
    return P;
  }

  // ---------------------------------------------------------------- the lie of the land
  function streamX(y) { return 150 + 14 * sin(y * 0.021 + 0.6) + 5 * sin(y * 0.057 + 2); }
  function roadY(x) { return 192 + 9 * sin(x * 0.012 + 1); }
  function laneX(y) { return 316 + (y - 183) * 0.06 + 4 * sin(y * 0.035); }
  const BRIDGE = (function () { let x = 140, y = 195; for (let i = 0; i < 20; i++) { y = roadY(x); x = streamX(y); } return { x: x, y: y, rot: Math.atan(9 * 0.012 * cos(x * 0.012 + 1)) }; })();
  const CROSS = { x: 316, y: roadY(316) };
  // Fields are rectangles, measured in a slightly wobbled space so that no boundary is a ruled line.
  // [x0, y0, x1, y1, what grows there, which sides have a hedge]
  const FIELDS = [
    [8, 216, 127, 377, 'wheat', 'NESW'], [8, 8, 127, 178, 'plough', 'NESW'], [178, 214, 258, 377, 'pasture', 'NESW'], [178, 8, 208, 172, 'hay', 'NSW'],
    [268, 258, 309, 377, 'meadow', 'NSW'], [342, 302, 505, 377, 'crops', 'NESW'], [416, 10, 505, 150, 'orchard', 'NESW'], [338, 222, 462, 290, 'churchyard', 'wall'], [214, 50, 322, 166, 'farmyard', 'wall'],
    [470, 214, 505, 290, 'pasture', 'NES'], [228, 8, 400, 38, 'pasture', 'NEW']
  ];
  const GATES = [[127, 300, 9], [68, 216, 8], [100, 178, 22], [62, 178, 22], [178, 300, 7], [190, 216, 31], [309, 300, 7], [342, 340, 7], [416, 120, 8], [338, 256, 7], [400, 222, 7], [300, 166, 9], [322, 120, 7], [470, 250, 6], [300, 38, 7], [214, 100, 8]];
  // [x, y, radius]
  const CRATERS = [[44, 150, 9], [92, 158, 7], [30, 112, 6], [98, 112, 8], [62, 84, 5], [84, 214, 6], [202, 150, 7], [170, 232, 6], [70, 262, 8], [118, 172, 5], [246, 196, 4]];
  // where the tank left the road and crossed the wheat
  const TRACKS = [[108, 208], [96, 250], [74, 296], [40, 336]];
  function warp(x, y) { return [x + 5 * sin(y * 0.031 + 1), y + 5 * sin(x * 0.027)]; }
  function unwarp(x, y) { const a = x - 5 * sin(y * 0.031 + 1), b = y - 5 * sin(a * 0.027); return [x - 5 * sin(b * 0.031 + 1), b]; }
  function segDist(px, py, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy))); return hypot(px - a[0] - dx * t, py - a[1] - dy * t); }
  function lineDist(px, py, pts) { let d = 1e9; for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(px, py, pts[i - 1], pts[i])); return d; }
  const FARMTRACK = [[CROSS.x, CROSS.y], [306, 172], [298, 158], [286, 134]];

  // What stands on every ground cell: how many layers, what its top is made of, and what kind of ground it is.
  const KIND = { grass: 0, road: 1, water: 2, mud: 3, plough: 4, wheat: 5, hay: 6, pasture: 7, orchard: 8, crops: 9, farmyard: 10, cobble: 11, churchyard: 12, hedge: 13, wall: 14, crater: 15, meadow: 16, path: 17 };
  let land = null;
  function survey() {
    if (land) return land;
    const hgt = new Uint8Array(W * H), kind = new Uint8Array(W * H), top = new Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, px = x + 0.5, py = y + 0.5, wp = warp(px, py), wx = wp[0], wy = wp[1], r = hash(x, y, 1), r2 = hash(x >> 1, y >> 1, 2);
      let h = G, k = KIND.grass, m = null;
      const dS = abs(px - streamX(py)), dR = abs(py - roadY(px)), dL = py > CROSS.y ? abs(px - laneX(py)) : 99, dT = lineDist(px, py, FARMTRACK), dC = hypot(px - CROSS.x, py - CROSS.y);
      const onBridge = abs(px - BRIDGE.x) < 26 && abs(py - BRIDGE.y) < 12;
      // craters first: a pit, scorched, with a lip thrown up round it
      let cr = null; for (let c = 0; c < CRATERS.length; c++) { const C = CRATERS[c], d = hypot(px - C[0], py - C[1]) / C[2] + (noise(px * 0.3, py * 0.3, 5) - 0.5) * 0.3; if (d < 1.55 && (!cr || d < cr)) cr = d; }
      let field = null; for (let f = 0; f < FIELDS.length; f++) { const F = FIELDS[f]; if (wx >= F[0] && wx < F[2] && wy >= F[1] && wy < F[3]) { field = F; break; } }
      if (dS < 5.5 + noise(py * 0.08, 0, 6) * 2 && !onBridge) { h = 1; k = KIND.water; m = dS < 2.4 ? 'water2' : r < 0.05 ? 'pebble' : 'water'; }
      else if (dS < 8 + noise(py * 0.08, 3, 6) * 2.5 && !onBridge) { h = 2; k = KIND.mud; m = r < 0.3 ? 'bank' : r < 0.36 ? 'pebble' : 'mud'; }
      else if (cr !== null && cr < 1.3 && !onBridge) { k = KIND.crater; h = cr < 0.45 ? 1 : cr < 0.78 ? 2 : cr < 1.05 ? 3 : 4; m = h === 4 ? (r < 0.5 ? 'soil3' : 'earth') : h === 1 ? (r < 0.25 ? 'scorch' : 'crater') : r < 0.5 ? 'scorch' : 'crater'; }
      else if (dR < 7.2 + (r2 - 0.5) * 1.6 || dL < 5.6 + (r2 - 0.5) * 1.4 || dT < 5 + (r2 - 0.5) * 1.4) {
        k = KIND.road; const d = Math.min(dR, dL + 1.2, dT + 1.8);
        m = dC < 26 ? null : abs(d - 3.4) < 1 ? (r < 0.75 ? 'rut' : 'dirt2') : d < 1.3 && dR > 7 && r < 0.5 ? 'grassDry' : r < 0.05 ? 'pebble' : r2 < 0.3 ? 'dirt2' : 'dirt';
      }
      if (dC < 25 + noise(px * 0.2, py * 0.2, 7) * 4 && h === G && k !== KIND.crater) { k = KIND.cobble; const q = hash(floor(px / 3), floor((py + (floor(px / 3) & 1) * 1.5) / 3), 8); m = floor(px) % 3 === 0 && r < 0.6 ? 'cobble2' : q < 0.35 ? 'cobble' : q < 0.7 ? 'cobble3' : q < 0.92 ? 'cobble2' : 'dirt'; }
      if (!m && field) {
        const F = field, t = F[4], e = Math.min(wx - F[0], F[2] - wx, wy - F[1], F[3] - wy);       // distance to the field's edge
        let nearGate = false; for (let g = 0; g < GATES.length; g++) if (hypot(wx - GATES[g][0], wy - GATES[g][1]) < GATES[g][2]) nearGate = true;
        const side = wx - F[0] === e ? 'W' : F[2] - wx === e ? 'E' : wy - F[1] === e ? 'S' : 'N';
        const clear = dS < 13 || dR < 12 || dL < 10 || dT < 9 || nearGate || (cr !== null && cr < 1.5);
        if (F[5] === 'wall' && e < 2.2 && !clear) { k = KIND.wall; h = G + 5 + (hash(floor(wx / 9), floor(wy / 9), 9) < 0.12 ? -2 : 0); }
        else if (F[5].indexOf(side) >= 0 && F[5] !== 'wall' && !clear && e < 3.4 + noise(px * 0.15, py * 0.15, 10) * 1.6) { k = KIND.hedge; h = G + 1 + Math.round((5.5 + noise(px * 0.16, py * 0.16, 11) * 4.5) * Math.sqrt(Math.max(0.2, 1 - e / 5.2))); }
        else if (t === 'wheat') { k = KIND.wheat; m = Math.abs(lineDist(px, py, TRACKS) - 5) < 1.7 ? (r < 0.5 ? 'stubble2' : 'earth') : r < 0.5 ? 'stubble' : 'stubble2'; }
        else if (t === 'plough') { k = KIND.plough; const s = (((px * 0.28 - py) / 5) % 1 + 1) % 1; m = s < 0.55 ? (r < 0.07 ? 'soil3' : 'soil') : r < 0.06 ? 'soil' : 'soil2'; }
        else if (t === 'hay') { k = KIND.hay; m = floor((px + py * 0.2) / 7) & 1 ? (r < 0.12 ? 'hay2' : 'mown') : r < 0.12 ? 'hay' : 'mown2'; }
        else if (t === 'pasture') { k = KIND.pasture; const n = noise(px / 11, py / 11, 12); m = n > 0.62 ? 'clover' : r < 0.012 ? 'flowerY' : r2 < 0.25 ? 'grass' : 'pasture'; }
        else if (t === 'meadow') { k = KIND.meadow; m = r < 0.04 ? 'flowerW' : r < 0.07 ? 'flowerY' : r < 0.085 ? 'poppy' : r2 < 0.3 ? 'grassDry' : 'grass3'; }
        else if (t === 'orchard') { k = KIND.orchard; m = r < 0.015 ? 'appleR' : r < 0.04 ? 'flowerW' : r2 < 0.3 ? 'grass' : 'grass2'; }
        else if (t === 'crops') { k = KIND.crops; const s = ((py + px * 0.12) % 6 + 6) % 6; m = s < 2.2 ? (hash(floor(px / 3), floor((py + px * 0.12) / 6), 13) < 0.85 ? (r < 0.4 ? 'cabbage2' : 'cabbage') : 'soil') : r < 0.3 ? 'soil2' : 'soil'; }
        else if (t === 'farmyard') { k = KIND.farmyard; m = r < 0.1 ? 'hay' : r2 < 0.3 ? 'yard2' : r < 0.14 ? 'pebble' : 'yard'; }
        else if (t === 'churchyard') { k = KIND.churchyard; m = (abs(py - 256) < 2.5 && px < 350) || (abs(px - 400) < 2.5 && py < 240) ? (k = KIND.path, r < 0.3 ? 'cobble3' : 'gravel') : r < 0.02 ? 'flowerW' : r2 < 0.3 ? 'grass2' : 'grass'; }
      }
      if (!m && k !== KIND.hedge && k !== KIND.wall) {                 // open grass, darker in patches, scorched round the craters
        const n = noise(px / 13, py / 13, 14);
        m = cr !== null && cr < 1.3 + r * 0.3 ? (r < 0.5 ? 'scorch' : 'earth') : dR < 9 && r < 0.3 ? 'grassDry' : n > 0.63 ? 'grass3' : n < 0.37 ? 'grass2' : r < 0.008 ? 'flowerW' : r < 0.014 ? 'flowerY' : r2 < 0.2 ? 'grass2' : 'grass';
      }
      hgt[i] = h; kind[i] = k; top[i] = m;
    }
    return (land = { hgt: hgt, kind: kind, top: top });
  }
  function cell(x, y) { return Math.max(0, Math.min(H - 1, floor(y))) * W + Math.max(0, Math.min(W - 1, floor(x))); }
  function heightAt(x, y) { return survey().hgt[cell(x, y)]; }
  function kindAt(x, y) { return x < 0 || y < 0 || x >= W || y >= H ? -1 : survey().kind[cell(x, y)]; }
  // the height to stand on: the ground, or the bridge's deck
  function groundAt(x, y) {
    const c = cos(BRIDGE.rot), s = sin(BRIDGE.rot), lx = (x - BRIDGE.x) * c + (y - BRIDGE.y) * s, ly = -(x - BRIDGE.x) * s + (y - BRIDGE.y) * c;
    if (abs(lx) < 25 && abs(ly) < 9.5) return Models.deck(lx);
    return x < 0 || y < 0 || x >= W || y >= H ? G : Math.max(G, heightAt(x, y));
  }

  // One ground tile as a stack. Its function also answers a few pixels outside the tile (pad), so art.js sees
  // the neighbouring ground and gives the tile's edge no side-facing normals.
  function tile(tx, ty) {
    const L = survey(), ox = tx * TILE + TILE / 2, oy = ty * TILE + TILE / 2;
    let tall = 1; for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) tall = Math.max(tall, L.hgt[(ty * TILE + y) * W + tx * TILE + x]);
    return { name: 'ground' + tx + '_' + ty, w: TILE, h: TILE, layers: tall, pad: 6, ground: true, fn: function (x, y, z) {
      const gx = floor(ox + x), gy = floor(oy + y), i = cell(gx, gy), h = L.hgt[i], k = L.kind[i];
      if (z >= h) return null;
      if (k === KIND.hedge) { if (z < G) return 'earth'; if (z === G) return 'bank'; const q = hash(gx >> 1, gy >> 1, z >> 1) * 0.6 + noise(gx * 0.2, gy * 0.2 + z, 15) * 0.4; return z === h - 1 && hash(gx, gy, 16) < 0.04 ? 'flowerW' : q < 0.28 ? 'hedgeD' : q < 0.5 ? 'hedge1' : q < 0.72 ? 'hedge2' : 'hedge3'; }
      if (k === KIND.wall) return z < G ? 'earth' : z === h - 1 ? (hash(gx, gy, 17) < 0.2 ? 'moss' : 'quoin') : Models.stone(gx + gy, z, 18);
      return z === h - 1 ? L.top[i] : k === KIND.crater ? 'crater' : 'earth';
    }, bump: function (x, y, z) {                                    // furrows, cobbles and ruts are only in the normals
      const gx = floor(ox + x), gy = floor(oy + y), i = cell(gx, gy), k = L.kind[i]; if (z !== L.hgt[i] - 1) return null;
      if (k === KIND.plough) { const s = ((((gx + 0.5) * 0.28 - gy - 0.5) / 5) % 1 + 1) % 1, t = (s < 0.55 ? s / 0.55 - 0.5 : 0.5 - (s - 0.55) / 0.45) * 1.1; return [t * 0.27, -t * 0.96]; }
      if (k === KIND.cobble || k === KIND.path) return [(hash(gx, gy, 19) - 0.5) * 0.7, (hash(gy, gx, 20) - 0.5) * 0.7];
      if (k === KIND.crops) { const s = ((gy + gx * 0.12) % 6 + 6) % 6; return s < 2.2 ? [0, (s - 1.1) * 0.5] : null; }
      if (k === KIND.road || k === KIND.farmyard || k === KIND.crater) return [(hash(gx, gy, 21) - 0.5) * 0.35, (hash(gy, gx, 22) - 0.5) * 0.35];
      if (k === KIND.water || k === KIND.hedge || k === KIND.wall) return null;
      return [(hash(gx, gy, 23) - 0.5) * 0.22, (hash(gy, gx, 24) - 0.5) * 0.22];                 // grass: a little unevenness
    } };
  }
  // The standing wheat: stalks of uneven height on a 32 x 32 patch of the field. Each patch is its own stack, so
  // each can lean with the wind on its own (main.js). The idea is the "fur shell" trick, with slices as shells.
  function wheatPatch(cx, cy) {
    let any = false; const L = survey();
    const def = { name: 'wheat' + cx + '_' + cy, w: 32, h: 32, layers: 6, soft: 0.8, noShadow: true, wheat: true, at: [cx + 16, cy + 16], fn: function (x, y, z) {
      const gx = floor(cx + 16 + x), gy = floor(cy + 16 + y); if (gx < 0 || gy < 0 || gx >= W || gy >= H || L.kind[gy * W + gx] !== KIND.wheat || L.top[gy * W + gx] === 'earth' || abs(lineDist(gx, gy, TRACKS) - 5) < 2.2) return null;
      const q = hash(gx, gy, 31); if (q < 0.3) return null;
      const t = 2 + floor(hash(gy, gx, 32) * 3.99 * (0.55 + 0.45 * noise(gx * 0.1, gy * 0.1, 33))); if (z > t) return null;
      any = true; return z === t ? (q > 0.8 ? 'wheat' : 'wheat2') : z === t - 1 ? 'wheat' : 'wheat3';
    } };
    for (let y = -16; y < 16 && !any; y += 1) for (let x = -16; x < 16 && !any; x += 1) def.fn(x + 0.5, y + 0.5, 0);
    return any ? def : null;
  }

  let defs = null;
  function stacks() {
    if (defs) return defs;
    defs = Models.all();
    for (let ty = 0; ty < H / TILE; ty++) for (let tx = 0; tx < W / TILE; tx++) defs.push(tile(tx, ty));
    for (let y = 192; y < H; y += 32) for (let x = 0; x < 160; x += 32) { const d = wheatPatch(x, y); if (d) defs.push(d); }
    return defs;
  }

  const TANK = { x: 190, y: 213, rot: Math.PI + 0.1 }, WRECK = { x: 76, y: 181, rot: 0.45 };

  // ---------------------------------------------------------------- where everything stands
  // { n: stack, x, y, z, rot, sway: how far its top leans in the wind (0: rigid), scale }
  function layout() {
    const L = [], S = stacks();
    const put = function (n, x, y, rot, o) { o = o || {}; L.push({ n: n, x: x, y: y, z: o.z === undefined ? groundAt(x, y) : o.z, rot: rot || 0, sway: o.sway || 0, scale: o.scale || 1 }); };
    S.forEach(function (d) { if (d.ground) put(d.name, parseInt(d.name.substr(6)) * TILE + TILE / 2, parseInt(d.name.split('_')[1]) * TILE + TILE / 2, 0, { z: 0 }); if (d.wheat) put(d.name, d.at[0], d.at[1], 0, { z: G, sway: 0.22 }); });
    put('bridge', BRIDGE.x, BRIDGE.y, BRIDGE.rot, { z: 0 });
    // the village
    put('church', 400, 256, 0); put('farmhouse', 272, 72, 0); put('barn', 238, 124, -Math.PI / 2); put('shed', 308, 122, Math.PI / 2); put('well', 284, 112, 0.3);
    put('cottageA', 270, 238, Math.PI); put('cottageB', 386, 150, 0); put('memorial', CROSS.x + 16, CROSS.y + 15, 0.2); put('cart', 282, 156, 2.9); put('rubble', 210, 94, 1); put('rubble', 224, 78, 2.2);
    for (let i = 0; i < 14; i++) { const gx = 352 + (i % 7) * 9 + (i > 6 ? 4 : 0), gy = i > 6 ? 234 : 278; if (abs(gx - 400) > 6) put('grave', gx, gy, Math.PI / 2 + (hash(i, 1, 1) - 0.5) * 0.3); }
    [[346, 230], [454, 230], [454, 282], [346, 282], [428, 232]].forEach(function (p) { put('yew', p[0], p[1], p[0], { sway: 0.012 }); });
    // the army: a tank and a sandbag post watching the bridge, stores by the crossroads, the wreck beyond the stream
    put('tankHull', TANK.x, TANK.y, TANK.rot); put('sandbags', 170, 180, Math.PI - 0.15); put('crates', 185, 171, 0.4); put('lantern', 179, 186, 0.2); put('sandwall', 160, 206, 1.9);
    put('wreck', WRECK.x, WRECK.y, WRECK.rot); put('halftrack', 262, 206, 0.08); put('drums', 336, 170, 0.6); put('jerrycans', 333, 159, 0.2); put('crates', 325, 158, 1.9); put('tent', 204, 262, 0.5); put('tent', 222, 278, 0.62); put('lantern', 216, 258, 1); put('drums', 234, 264, 2); put('jerrycans', 226, 252, 0.9);
    put('sandbags', 342, 170, -0.3); put('lantern', 342, 163, 0);
    [[159, 224, 1.47], [162, 252, 1.5], [166, 280, 1.42], [151, 150, 1.6], [153, 122, 1.5], [100, 214, 0.2]].forEach(function (p) { put('wire', p[0], p[1], p[2]); });
    [[46, 144, 'snag'], [100, 150, 'snag'], [76, 222, 'snag']].forEach(function (p) { put(p[2], p[0], p[1], p[0]); });
    // telegraph poles along the road, fences and gates
    for (let x = 30; x < W; x += 68) if (abs(x - BRIDGE.x) > 30) put('pole', x, roadY(x) - 13, Math.PI / 2 + 0.1 * sin(x));
    put('gate', 300, 166, 0.5); put('gate', 338, 256, Math.PI / 2 - 0.9); put('fence', 362, 152, Math.PI / 2); put('fence', 246, 240, Math.PI / 2);
    // trees: oaks in the hedges, poplars up the lane, willows on the stream, apples in rows, a chestnut on the square
    FIELDS.forEach(function (F, f) {
      if (F[5] === 'wall') return;
      const per = 2 * (F[2] - F[0] + F[3] - F[1]);
      for (let s = 20 + hash(f, 1, 41) * 30; s < per; s += 34 + hash(f, s | 0, 42) * 38) {
        const w = F[2] - F[0], h = F[3] - F[1], p = s < w ? [F[0] + s, F[1]] : s < w + h ? [F[2], F[1] + s - w] : s < 2 * w + h ? [F[2] - (s - w - h), F[3]] : [F[0], F[1] + per - s], u = unwarp(p[0], p[1]);
        if (kindAt(u[0], u[1]) !== KIND.hedge) continue;
        const q = hash(f, s | 0, 43); put(q < 0.45 ? 'oak' : q < 0.75 ? 'oak2' : 'ash', u[0], u[1], q * 6.3, { sway: 0.012, scale: 0.85 + hash(f, s | 0, 44) * 0.3 });
      }
    });
    for (let y = 214; y < H; y += 23) { put('poplar', laneX(y) - 11, y + 4, y, { sway: 0.02 }); if (y > 296) put('poplar', laneX(y) + 11, y - 6, y + 1, { sway: 0.02 }); }
    for (let y = 16; y < H; y += 44) { const q = hash(y, 3, 45), x = streamX(y) + (q < 0.5 ? -14 : 14) - (q < 0.5 ? 1 : -1) * hash(y, 4, 46) * 6; if (abs(y - BRIDGE.y) > 34 && kindAt(x, y) >= 0) put('willow', x, y, q * 6, { sway: 0.025, scale: 0.85 + q * 0.3 }); }
    for (let y = 26; y < 146; y += 21) for (let x = 420; x < 500; x += 21) if (hash(x, y, 47) > 0.1) put('apple', x + (hash(x, y, 48) - 0.5) * 5 + ((y / 21) & 1) * 6, y + (hash(y, x, 49) - 0.5) * 5, hash(x, y, 50) * 6, { sway: 0.012, scale: 0.9 + hash(x, y, 51) * 0.25 });
    put('oak', CROSS.x - 18, CROSS.y + 24, 1, { sway: 0.012, scale: 1.1 }); put('oak2', 208, 56, 2, { sway: 0.012 }); put('ash', 330, 58, 0, { sway: 0.014 }); put('oak2', 446, 196, 4, { sway: 0.012 }); put('ash', 38, 196, 2, { sway: 0.014 }); put('oak', 360, 90, 3, { sway: 0.012 });
    [[262, 262, 0], [296, 250, 2], [304, 240, 1], [356, 132, 3], [392, 134, 1], [244, 178, 2], [330, 150, 0], [150, 60, 1], [466, 300, 2]].forEach(function (p) { if (kindAt(p[0], p[1]) !== KIND.road) put('bush', p[0], p[1], p[2], { sway: 0.02 }); });
    // haycocks in the mown field, cows in the pasture
    for (let i = 0; i < 9; i++) put('haycock', 186 + (i % 2) * 14 + hash(i, 5, 52) * 4, 22 + i * 16, i);
    [[200, 300, 0.4, 'cowGrazing'], [226, 330, 2.6, 'cow'], [240, 290, 4, 'cowGrazing'], [488, 250, 1.2, 'cow'], [330, 24, 3, 'cowGrazing'], [280, 20, 0.5, 'cow']].forEach(function (p) { put(p[3], p[0], p[1], p[2]); });
    // small growth, scattered by what the ground is: tufts on grass, reeds on the banks, poppies along the wheat
    for (let i = 0; i < 1500; i++) {
      const x = 4 + hash(i, 6, 53) * (W - 8), y = 4 + hash(i, 7, 54) * (H - 8), k = kindAt(x, y), q = hash(i, 8, 55), rot = q * 6.3, o = { sway: 0.2 };
      if (k === KIND.mud) put('reeds', x, y, rot, { sway: 0.1 });
      else if (k === KIND.grass || k === KIND.orchard) { if (q < 0.5) put(q < 0.2 ? 'tuft2' : 'tuft', x, y, rot, o); else if (q > 0.96) put('daisies', x, y, rot, o); else if (q > 0.93 && abs(y - roadY(x)) < 26) put('poppies', x, y, rot, o); }
      else if (k === KIND.meadow) { if (q < 0.7) put(q < 0.15 ? 'poppies' : q < 0.3 ? 'daisies' : 'tuft', x, y, rot, o); }
      else if (k === KIND.pasture && q < 0.22) put('tuft', x, y, rot, o);
      else if (k === KIND.churchyard && q < 0.3) put('tuft', x, y, rot, o);
      else if (k === KIND.wheat && q < 0.16 && (kindAt(x + 5, y) !== KIND.wheat || kindAt(x - 5, y) !== KIND.wheat || kindAt(x, y + 5) !== KIND.wheat || kindAt(x, y - 5) !== KIND.wheat)) put('poppies', x, y, rot, o);
    }
    return L;
  }

  // ---------------------------------------------------------------- what moves, and where
  // Patrol routes: closed loops of points; a man walks round at a steady pace. [points, men, gap between men]
  const side = function (xs, off) { return xs.map(function (x) { return [x, roadY(x) + off]; }); };
  const PATROLS = [
    { pts: side([300, 262, 230], 8.5).concat([[221, roadY(221)]], side([230, 262, 300], -8.5), [[308, roadY(308)]]), men: 4, gap: 11 },
    { pts: [[322, 212], [327, 240], [331, 262], [324, 266], [318, 236]], men: 1 },
    { pts: [[262, 100], [298, 100], [298, 140], [280, 144], [264, 134]], men: 1 },
    { pts: side([50, 112], 10.5).concat(side([112, 50], 8)), men: 2, gap: 62 }
  ];
  // the jeep's run: along the road from beyond one edge of the map to beyond the other (the haze hides both ends)
  const JEEP = { from: -110, to: W + 110, speed: 52 };
  // lamps that light at dusk: [x, y, z, reach]
  const LAMPS = [[179, 186, G + 6, 46], [216, 258, G + 6, 46], [342, 163, G + 6, 46], [271, 91, G + 16, 54], [346.5, 256, G + 19, 56], [391, 166.5, G + 16, 46]];
  // birds wheel round the steeple: [centre x, y, radius, height, how many]
  const BIRDS = [[358, 256, 34, 104, 5], [150, 290, 60, 70, 3]];

  // ---------------------------------------------------------------- the light, by time of day
  // t: 0 mid afternoon, 0.55 the golden hour, 1 dusk. Returns the direction to the sun and every colour the light
  // pass needs. The sun sinks and swings round, reddens, and at the end dims; the sky's fill turns from blue to
  // violet; "glow" is how far the lamps and windows are lit.
  function light(t) {
    const K = [
      { t: 0, el: 38, az: -40, sun: [1.38, 1.24, 1.0], sky: [0.40, 0.49, 0.64], bounce: [0.32, 0.27, 0.16], haze: [0.93, 0.92, 0.86], hazeK: 0.3, glow: 0, exposure: 1.0 },
      { t: 0.55, el: 17, az: -22, sun: [1.50, 1.02, 0.55], sky: [0.36, 0.40, 0.60], bounce: [0.34, 0.24, 0.13], haze: [0.98, 0.83, 0.64], hazeK: 0.46, glow: 0.12, exposure: 1.0 },
      { t: 1, el: 6, az: -8, sun: [1.05, 0.46, 0.30], sky: [0.31, 0.30, 0.45], bounce: [0.22, 0.15, 0.13], haze: [0.72, 0.52, 0.60], hazeK: 0.5, glow: 1, exposure: 1.08 }
    ];
    t = Math.max(0, Math.min(1, t)); const b = t < K[1].t ? 1 : 2, A = K[b - 1], B = K[b]; let u = (t - A.t) / (B.t - A.t); u = u * u * (3 - 2 * u);
    const mix = function (k) { return typeof A[k] === 'number' ? A[k] + (B[k] - A[k]) * u : A[k].map(function (v, i) { return v + (B[k][i] - v) * u; }); };
    const el = mix('el') * Math.PI / 180, az = mix('az') * Math.PI / 180;
    return { t: t, sun: [cos(el) * cos(az), cos(el) * sin(az), sin(el)], sunCol: mix('sun'), skyCol: mix('sky'), bounceCol: mix('bounce'), hazeCol: mix('haze'), hazeK: mix('hazeK'), glow: mix('glow'), exposure: mix('exposure'), outer: [0.50, 0.62, 0.31] };
  }

  global.Scene = { WORLD: WORLD, KIND: KIND, palette: palette, stacks: stacks, layout: layout, light: light, survey: survey, groundAt: groundAt, heightAt: heightAt, kindAt: kindAt, roadY: roadY,
    BRIDGE: BRIDGE, CROSS: CROSS, TANK: TANK, WRECK: WRECK, PATROLS: PATROLS, JEEP: JEEP, LAMPS: LAMPS, BIRDS: BIRDS };
})(typeof window !== 'undefined' ? window : globalThis);
