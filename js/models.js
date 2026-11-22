// models.js: every object of the scene as a small function. Buildings, trees, vehicles, field works, smoke.
//
// Each entry is { name, w, h, layers, fn(x, y, z) -> material name or null } and art.js turns it into slices.
// x runs forward (a vehicle's nose, a building's length), y sideways, both measured from the middle; z is the layer.
// One art pixel is about a tenth of a metre high for a man, less for a house: the scene is a model, not a survey.
// Extra fields: soft (see art.js), noShadow (left out of the shadow height map), shadowIf (x, y, z) -> bool (which
// pixels count for the height map: a telegraph pole without its cross-arm, or it would cast a wall's shadow).
(function (global) {
  'use strict';
  const hash = Art.hash, noise = Art.noise, abs = Math.abs, floor = Math.floor, hypot = Math.hypot;
  const ell = function (x, y, rx, ry) { return (x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1; };
  const pick = function (r, list) { return list[Math.min(list.length - 1, floor(r * list.length))]; };
  const n3 = function (x, y, z, s) { return noise(x + z * 5.3, y - z * 3.7, s); };          // smooth noise in three directions

  // limestone in courses three layers high, each block its own shade; a: the distance along the wall
  function stone(a, z, seed) { const row = floor(z / 3), r = hash(floor((a + (row & 1) * 2.5 + 400) / 5), row, seed || 7); return r < 0.14 ? 'lime4' : r < 0.5 ? 'lime1' : r < 0.8 ? 'lime2' : 'lime3'; }
  // clay roof tiles: a row per layer, colour per tile, a few mossy
  function tile(x, r, seed) { const q = hash(floor((x + 400) / 2), r, seed || 3); return q < 0.1 ? 'tile4' : q < 0.5 ? 'tile1' : q < 0.78 ? 'tile2' : q < 0.95 ? 'tile3' : 'tileMoss'; }
  function thatch(x, y, r) { const q = noise(x * 0.5, y * 1.3 + r, 9); return q < 0.35 ? 'thatch2' : q < 0.7 ? 'thatch1' : 'thatch3'; }
  function planks(a, z, seed) { const q = hash(floor((a + 400) / 2), floor(z / 9), seed || 2); return q < 0.3 ? 'plank2' : q < 0.9 ? 'plank' : 'timber'; }

  // ---------------------------------------------------------------- buildings
  // A house: W along x, D along y, the ridge along x, the front on the +y side. o.wall(face, a, z, end) paints the
  // walls: face 0 front (+y), 1 back, 2 the +x gable end, 3 the -x end; a runs along the wall, end is the distance
  // to the nearer corner. o.roof(x, y, r) paints the roof, r layers above the eaves.
  function house(o) {
    const hw = o.W / 2, hd = o.D / 2, body = o.wallH, rh = o.roofH, ov = o.eave || 2, chim = o.chimneys || [];
    return { name: o.name, w: o.W + ov * 2 + 2, h: o.D + ov * 2 + 4, layers: body + rh + 8, fn: function (x, y, z) {
      const ax = abs(x), ay = abs(y), r = z - body;
      for (let i = 0; i < chim.length; i++) { const c = chim[i]; if (abs(x - c[0]) < 2.6 && abs(y - c[1]) < 2.1 && z > body - 3 && z < body + c[2]) return z >= body + c[2] - 1 ? 'chimPot' : stone(x + y, z, 5); }
      if (o.extra) { const m = o.extra(x, y, z); if (m) return m; }
      if (z < body) {
        if (ax > hw || ay > hd) return null;
        const onX = ax > hw - 1, onY = ay > hd - 1;
        if (!onX && !onY) return 'inside';
        return onY ? o.wall(y > 0 ? 0 : 1, x, z, hw - ax) : o.wall(x > 0 ? 2 : 3, y, z, hd - ay);
      }
      if (r >= rh) return null;
      const e = (hd + ov) * (1 - r / rh);                        // half the roof's width at this layer
      if (ay > e || ax > hw + ov) return null;
      if (ax > hw) return ay > e - 2.4 ? o.roof(x, y, r, e) : null;       // the verge: the roof past the gable wall
      if (ax > hw - 1 && ay < e - 1.7) return o.wall(x > 0 ? 2 : 3, y, z, hd - ay);
      return ay < e - 3 ? 'inside' : o.roof(x, y, r, e);
    } };
  }
  const tiled = function (seed) { return function (x, y, r, e) { return e < 2 ? 'ridge' : r === 0 ? 'tile4' : tile(x, r, seed); }; };
  // A shuttered window in a wall: m is the distance from the window's middle, zf the height above the floor.
  function win(m, zf, lit, shutter) { const am = abs(m); return zf < 6 || zf > 13 || am >= 4.5 ? null : am < 2 ? (zf === 6 || zf === 13 ? 'quoin' : zf === 10 ? 'frame' : lit ? 'glassLit' : 'glass') : zf > 6 ? shutter : null; }

  const farmhouse = house({ name: 'farmhouse', W: 84, D: 34, wallH: 38, roofH: 18, chimneys: [[-38, 0, 25], [38, 0, 25], [6, -3, 23]], roof: tiled(3),
    wall: function (f, a, z, end) {
      const FH = 19, fl = floor(z / FH), zf = z - fl * FH;
      if (z < 2) return 'limeD';
      if (f === 0 && abs(a + 6) < 3.5 && z < 15) return abs(a + 6) > 2.5 || z > 13 ? 'quoin' : z === 7 && a + 6 > 1 ? 'iron' : 'doorG';
      if (f < 2) {
        const m = ((a + 6 + 700) % 14) - 7, id = floor((a + 6 + 700) / 14);
        if (!(f === 0 && fl === 0 && abs(a + 6) < 7) && end > 5) { const w = win(m, zf, hash(id, fl, f + 11) < (f === 0 ? 0.55 : 0.25), 'shutter'); if (w) return w; }
        if (f === 0 && zf === 5 && abs(m) < 2.6 && end > 5 && fl === 1) return hash(floor(a), 3, 1) < 0.5 ? 'poppy' : 'hedge3';       // window boxes
        if (f === 1 && a > 8 && noise(a * 0.11 + 3, z * 0.1, 4) > 0.5 && z < 30 + 6 * noise(a * 0.3, 1, 2)) return hash(floor(a), z, 1) < 0.5 ? 'ivy1' : 'ivy2';
      } else if (z > 24 && z < 32 && abs(a) < 1.6) return z === 25 ? 'quoin' : 'glass';
      if (end < 2 && (floor(z / 3) & 1)) return 'quoin';                                         // corner stones
      return stone(a, z, 7 + f);
    },
    extra: function (x, y, z) { return abs(x + 1) < 0.9 && abs(y - 17.6) < 0.9 && z >= 15 && z <= 18 ? (z === 15 || z === 18 ? 'iron' : 'lamp') : null; }   // the lantern by the door
  });

  // The barn: stone below, boards above, a shell hole through the roof and a breach in one corner. Where the
  // damage bites, the inside shows: dark, with rafters and a little hay.
  const barn = (function () {
    const b = house({ name: 'barnWhole', W: 72, D: 38, wallH: 26, roofH: 19, roof: function (x, y, r, e) { return e < 2 ? 'ridge' : noise(x * 0.12, r * 0.2, 8) > 0.68 && hash(x, r, 9) < 0.6 ? 'tileMoss' : tile(x, r, 21); },
      wall: function (f, a, z, end) {
        if (f === 0 && abs(a) < 9 && z < 19) return abs(a) > 8 || z > 17 || abs(a) < 0.6 ? 'timberD' : abs(abs(a) - 4.5 - (z - 9) * 0.45) < 0.8 ? 'timberD' : planks(a, z, 5);       // the doors, braced
        if (f > 1 && z > 27 && z < 35 && abs(a) < 2.6) return 'timberD';                          // the hay-loft hatch
        if (z < 11) return end < 2 && (floor(z / 3) & 1) ? 'quoin' : stone(a, z, 13 + f);
        return z === 11 ? 'timberD' : floor(a + 400) % 9 === 0 ? 'timberD' : planks(a, z, f);
      } });
    return { name: 'barn', w: b.w, h: b.h, layers: b.layers, fn: function (x, y, z) {
      let m = b.fn(x, y, z);
      const d1 = hypot(x - 33, (y + 17) * 0.9, (z - 5) * 0.8) + n3(x * 0.4, y * 0.4, z * 0.4, 6) * 5;       // the breach in the corner
      const d2 = hypot(x + 12, y + 6, (z - 36) * 1.2) + n3(x * 0.5, y * 0.5, z * 0.5, 7) * 4;              // the hole in the roof
      if (d1 < 15) return z < 5.5 - d1 * 0.32 + hash(floor(x / 2), floor(y / 2), 5) * 3 ? (hash(x, y, z) < 0.75 ? stone(x, z * 3, 3) : 'timberD') : null;      // rubble where the wall stood
      if (d2 < 10) return null;
      if (!m) return hypot(x - 40, y + 21) < 7 && z < 2.5 * hash(floor(x), floor(y), 9) ? stone(x, y, 4) : null;                                    // stones thrown outside
      if (m === 'inside') m = z < 7 && x > 4 ? (hash(x, y, z) < 0.5 ? 'hay' : 'hay2') : (floor(x + 400) % 8 === 0 && z > 22) || (z === 26 && floor(y + 400) % 6 === 0) ? 'timber' : 'barnIn';
      else if (d1 < 18.5 || d2 < 12.5) return hash(x, y, z) < 0.6 ? 'soot' : m;                                                                     // scorched edges
      return m;
    } };
  })();

  // The church: a nave with buttresses and lancet windows, a round apse at the east end, a tower and spire at the west.
  const church = { name: 'church', w: 110, h: 38, layers: 118, fn: function (x, y, z) {
    const ay = abs(y), tx = x + 42, atx = abs(tx);
    if (atx <= 11 && ay <= 11) {                                                      // the tower
      if (z < 72) {
        const on = atx > 10 || ay > 10; if (!on) return 'inside';
        const a = atx > 10 ? y : tx;
        if (tx < -10 && ay < 3.6 && z < 16 - ay * ay * 0.25) return ay > 2.7 || z > 14 - ay * ay * 0.25 ? 'quoin' : 'door';
        if (z > 52 && z < 64 && abs(a) < 2.6) return z > 62 - abs(a) ? 'quoin' : (z & 1 ? 'louvre' : 'slate');
        if (z > 30 && z < 38 && abs(a) < 1.2) return 'glass';
        if (z === 24 || z === 48 || z >= 70) return 'quoin';
        if (atx > 9 && ay > 9 && (floor(z / 3) & 1)) return 'quoin';
        return z < 2 ? 'limeD' : stone(a, z, 31);
      }
      const s = 11.5 * (1 - (z - 72) / 39);                                           // the spire: eight sides
      if (z < 111) return atx <= s && ay <= s && atx + ay <= s * 1.42 ? (s < 1 ? 'lead' : hash(floor(tx), floor(y), z >> 1) < 0.3 ? 'slate2' : 'slate') : null;
      return z < 115 ? (atx < 0.6 && ay < 0.6 ? 'iron' : null) : z < 117 ? (ay < 0.6 && tx > -2 && tx < (z === 115 ? 2 : 1) ? 'gold' : null) : null;      // the weathercock
    }
    if (abs(tx + 11.6) < 0.9 && ay < 0.9 && z >= 18 && z <= 21) return z === 18 || z === 21 ? 'iron' : 'lamp';       // the lantern over the door
    if (x > -31 && x <= 31) {                                                         // the nave
      if (z < 36) {
        if (ay > 14) { const b = abs(((x + 31 + 700) % 14) - 7); return b > 5.6 && ay < 17.5 - Math.max(0, z - 22) * 0.25 && z < 31 ? (z > 21 && ay > 16 - (z - 22) * 0.25 ? 'quoin' : stone(x + y, z, 33)) : null; }   // buttresses
        if (ay <= 13) return 'inside';
        const m = ((x + 31 + 700) % 14) - 7, am = abs(m);
        if (z > 11 && z < 30 - am * am * 0.5 && am < 2.6) return am > 1.7 || z > 28 - am * am * 0.5 || z === 12 ? 'quoin' : (hash(floor((x + 31) / 14), 2, y > 0 ? 1 : 2) < 0.7 ? 'glassC' : 'glass');
        return z < 2 ? 'limeD' : z >= 34 ? 'quoin' : stone(x, z, 35);
      }
      const r = z - 36, e = 16 * (1 - r / 17);
      if (r >= 17 || ay > e) return null;
      if (x > 30 && ay < e - 1.7) return stone(y, z, 37);
      return ay < e - 3 ? 'inside' : e < 2 ? 'ridge' : hash(floor(x / 2), r, 41) < 0.4 ? 'tile4' : tile(x, r, 43);
    }
    const d = hypot(x - 31, y);                                                       // the apse
    if (x > 31) {
      if (z < 30) return d > 13 ? null : d < 12 ? 'inside' : z > 10 && z < 24 && abs(((Math.atan2(y, x - 31) + 9) % 0.8) - 0.4) < 0.1 ? 'glassC' : z >= 28 ? 'quoin' : z < 2 ? 'limeD' : stone(Math.atan2(y, x - 31) * 13, z, 39);
      const rr = 14 * (1 - (z - 30) / 12); return z < 42 && d <= rr ? (d < rr - 3 ? 'inside' : hash(floor(Math.atan2(y, x - 31) * 6), z, 45) < 0.4 ? 'tile4' : 'tile1') : null;
    }
    return null;
  } };

  // A half-timbered cottage under thatch, and a stone one under tiles.
  const cottageA = house({ name: 'cottageA', W: 42, D: 26, wallH: 18, roofH: 16, eave: 3, chimneys: [[17, 0, 22]], roof: function (x, y, r, e) { return e < 2.5 ? (floor(x + 400) % 4 < 2 ? 'thatch2' : 'thatch3') : thatch(x, y, r); },
    wall: function (f, a, z, end) {
      if (z < 4) return stone(a, z, 51);
      if (f === 0 && abs(a - 5) < 3 && z < 15) return abs(a - 5) > 2.2 || z > 13 ? 'timberD' : 'doorR';
      if (f < 2 && z > 7 && z < 14 && abs(abs(a - 5) - 11) < 3.5 && !(f === 1 && a > 5)) { const m = abs(abs(a - 5) - 11); return m < 1.6 ? (z === 8 ? 'timberD' : a < 0 && f === 0 ? 'glassLit' : 'glass') : 'shutterR'; }
      if (z === 4 || z === 17 || end < 1 || floor(a + 400) % 7 === 0 || (end < 9 && abs(end - (z - 4) * 0.6) < 0.8)) return 'timberD';       // the frame
      return hash(floor(a), z, 53) < 0.08 ? 'plaster2' : 'plaster';
    } });
  const cottageB = house({ name: 'cottageB', W: 46, D: 28, wallH: 22, roofH: 15, chimneys: [[-19, 0, 21]], roof: tiled(61),
    wall: function (f, a, z, end) {
      if (z < 2) return 'limeD';
      if (f === 0 && abs(a) < 3 && z < 15) return abs(a) > 2.2 || z > 13 ? 'quoin' : 'doorB';
      if (f < 2 && end > 4 && abs(abs(a) - 12) < 4.5) { const w = win(abs(a) - 12, z - 2, f === 0 && a > 0, 'shutterB'); if (w) return w; }
      if (end < 2 && (floor(z / 3) & 1)) return 'quoin';
      return stone(a, z, 63 + f);
    },
    extra: function (x, y, z) { return abs(x - 5) < 0.9 && abs(y - 14.6) < 0.9 && z >= 15 && z <= 18 ? (z === 15 || z === 18 ? 'iron' : 'lamp') : null; } });
  // A lean-to shed of boards: one slope, an open front.
  const shed = { name: 'shed', w: 28, h: 20, layers: 17, fn: function (x, y, z) {
    const ax = abs(x), top = 13 - (y + 8) * 0.3;
    if (ax > 13 || abs(y) > 9) return null;
    if (z >= top) return z < top + 1.6 && ax <= 13 ? (hash(floor(x / 2), floor(y), 3) < 0.2 ? 'tileMoss' : 'tile2') : null;
    if (ax > 12 || y < -7.5) return ax > 12 && (z > 11 || abs(y) > 8) ? 'timberD' : planks(x + y, z, 7);
    if (y > 7.5) return ax > 11 || abs(ax - 4) < 0.6 ? 'timberD' : null;                 // posts along the open front
    return z < 5 && x < 2 ? (z < 4 - (x + 12) * 0.1 ? 'trunk' : null) : null;              // firewood stacked inside
  } };
  const well = { name: 'well', w: 14, h: 14, layers: 18, fn: function (x, y, z) {
    const d = hypot(x, y);
    if (z < 6) return d < 5.5 ? (d > 3.6 ? (z === 5 ? 'quoin' : stone(Math.atan2(y, x) * 5, z, 71)) : z < 2 ? 'water2' : null) : null;
    if (z < 13) return abs(y) < 0.8 && abs(abs(x) - 4.6) < 0.8 ? 'timberD' : z === 11 && abs(y) < 0.6 && abs(x) < 4 ? 'timber' : z < 11 && z > 8 && abs(x) < 0.5 && abs(y) < 0.5 ? 'rope' : null;
    const e = 5.5 * (1 - (z - 13) / 4.5); return abs(y) <= e && abs(x) < 6.5 ? tile(x, z, 73) : null;
  } };
  // The bridge: one arch over the stream, a humped deck, a parapet on each side. Its deck is Models.deck(x).
  function deck(x) { return 3 + 3.2 * Math.cos(Math.min(1, abs(x) / 25) * Math.PI / 2); }
  const bridge = { name: 'bridge', w: 52, h: 24, layers: 11, fn: function (x, y, z) {
    const ax = abs(x), ay = abs(y), top = deck(x);
    if (ax > 25 || ay > 11) return null;
    if (ax < 10 && z < 4.7 - x * x * 0.045) return null;                                   // the arch
    if (ay > 9) return z < top + 3 ? (z >= top + 2 ? 'quoin' : stone(x, z, 81)) : null;      // parapets
    if (z >= top) return null;
    if (z < top - 1) return ay > 8.2 && abs(z - (4.7 - x * x * 0.045) - 0.6) < 0.9 && ax < 11 ? 'quoin' : stone(x + y, z, 83);
    const q = hash(floor(x / 2), floor(y / 2), 85); return q < 0.3 ? 'cobble2' : q < 0.6 ? 'cobble' : q < 0.85 ? 'dirt' : 'cobble3';
  }, bump: function (x, y) { return [(hash(floor(x / 2), floor(y / 2), 86) - 0.5) * 0.5, (hash(floor(x / 2), floor(y / 2), 87) - 0.5) * 0.5]; } };
  const memorial = { name: 'memorial', w: 12, h: 12, layers: 22, fn: function (x, y, z) {
    const a = Math.max(abs(x), abs(y)); return z < 2 ? (a < 5.5 ? 'cobble3' : null) : z < 4 ? (a < 4 ? 'quoin' : null) : z < 8 ? (a < 2.8 ? (z === 6 && abs(x) < 1.5 && y > 2 ? 'hedge1' : 'lime3') : null) : a < 2.2 - (z - 8) * 0.11 ? 'lime3' : null;
  } };

  // ---------------------------------------------------------------- trees and plants
  // A crown made of a few overlapping balls, with a ragged edge, in three or four leaf colours.
  function crown(x, y, z, lobes, rough, seed) {
    let best = 9; for (let i = 0; i < lobes.length; i++) { const L = lobes[i], d = hypot(x - L[0], y - L[1], (z - L[2]) * (L[4] || 1)) / L[3]; if (d < best) best = d; }
    return best + (n3(x * 0.35, y * 0.35, z * 0.35, seed) - 0.5) * rough;
  }
  function leaves(x, y, z, set, seed) { const q = n3(x * 0.3, y * 0.3, z * 0.3, seed + 1) * 0.7 + hash(x, y, z + seed) * 0.3; return q < 0.3 ? set[2] : q < 0.5 ? set[0] : q < 0.72 ? set[1] : set[3]; }
  const OAK = ['oak1', 'oak2', 'oak3', 'oak4'], POP = ['pop1', 'pop2', 'pop3', 'pop2'], APP = ['apple1', 'apple2', 'apple3', 'apple2'], WIL = ['wil1', 'wil2', 'wil3', 'wil2'], YEW = ['yew1', 'yew2', 'yew1', 'yew2'];
  function oak(name, seed, lobes, trunkTo) {
    return { name: name, w: 40, h: 40, layers: 46, fn: function (x, y, z) {
      const d = hypot(x, y);
      if (z < trunkTo && d < (z < 3 ? 3.4 - z * 0.4 : 2.2)) return hash(floor(Math.atan2(y, x) * 3), floor(z / 3), seed) < 0.4 ? 'trunk2' : 'trunk';
      if (z > 10 && z < trunkTo + 6 && abs(abs(x) - (z - 10) * 0.9) < 0.9 && abs(y) < 0.9) return 'trunk';     // two boughs
      return z > 8 && crown(x, y, z, lobes, 0.5, seed) < 1 ? leaves(x, y, z, OAK, seed) : null;
    } };
  }
  const trees = [
    oak('oak', 101, [[0, 0, 30, 13, 1.2], [8, 4, 26, 9], [-8, -3, 27, 10], [2, -8, 24, 8], [-3, 8, 33, 8]], 20),
    oak('oak2', 111, [[0, 0, 29, 12, 1.3], [-9, 5, 25, 9], [9, -4, 28, 9], [3, 9, 23, 7]], 18),
    { name: 'ash', w: 28, h: 28, layers: 38, fn: function (x, y, z) {
      if (z < 16 && hypot(x, y) < (z < 2 ? 2.4 : 1.6)) return 'trunk2';
      return z > 9 && crown(x, y, z, [[0, 0, 24, 9.5, 0.85], [5, 3, 19, 6.5], [-5, -4, 20, 7]], 0.5, 121) < 1 ? leaves(x, y, z, ['pop1', 'oak2', 'oak1', 'pop2'], 121) : null;
    } },
    { name: 'poplar', w: 14, h: 14, layers: 62, fn: function (x, y, z) {
      if (z < 10) return hypot(x, y) < 1.4 ? 'trunk' : null;
      const t = (z - 8) / 54, r = 5.6 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.97 + 0.03)), 0.55) * (0.85 + 0.3 * n3(x * 0.4, y * 0.4, z * 0.3, 131));
      return hypot(x, y) < r ? leaves(x, y, z, POP, 131) : null;
    } },
    { name: 'apple', w: 22, h: 22, layers: 21, fn: function (x, y, z) {
      if (z < 8) return hypot(x - (z > 4 ? 0.6 : 0), y) < 1.3 ? 'trunk2' : null;
      if (crown(x, y, z, [[0, 0, 13, 8.6, 1.35], [4, -3, 11, 5.5]], 0.45, 141) >= 1) return null;
      return hash(x, y, z + 3) < 0.045 ? 'appleR' : leaves(x, y, z, APP, 141);
    } },
    { name: 'willow', w: 32, h: 32, layers: 30, fn: function (x, y, z) {
      const d = hypot(x, y);
      if (z < 15 && d < (z < 2 ? 2.6 : 1.8)) return 'trunk';
      if (z > 12 && crown(x, y, z, [[0, 0, 19, 13.5, 1.35]], 0.35, 151) < 1) return leaves(x, y, z, WIL, 151);
      const f = hash(floor(x), floor(y), 152);                                           // hanging fronds round the edge
      return d > 8.5 && d < 13.5 && f < 0.5 && z > 4 + f * 14 && z <= 19 ? (f < 0.25 ? 'wil3' : 'wil1') : null;
    } },
    { name: 'yew', w: 12, h: 12, layers: 27, fn: function (x, y, z) {
      if (z < 3) return hypot(x, y) < 1.1 ? 'trunk2' : null;
      return hypot(x, y) < 5 * Math.pow(1 - (z - 3) / 24.5, 0.8) * (0.8 + 0.4 * n3(x * 0.6, y * 0.6, z * 0.4, 161)) ? leaves(x, y, z, YEW, 161) : null;
    } },
    { name: 'bush', w: 12, h: 12, layers: 8, fn: function (x, y, z) { return crown(x, y, z, [[0, 0, 2.5, 5, 1.5], [2, 1, 3, 3.4]], 0.6, 171) < 1 ? (hash(x, y, z) < 0.05 ? 'flowerW' : leaves(x, y, z, ['hedge2', 'hedge3', 'hedge1', 'hedge3'], 171)) : null; } },
    // a tree a shell has broken: the trunk ends in splinters
    { name: 'snag', w: 10, h: 10, layers: 18, fn: function (x, y, z) {
      const d = hypot(x, y); if (z < 3 && d < 3.2 - z * 0.4) return 'trunk2';
      return d < 2 && z < 9 + hash(floor(x), floor(y), 181) * 9 - d * 2 ? (z > 9 && hash(x, y, z) < 0.5 ? 'splinter' : hash(x, y, floor(z / 2)) < 0.3 ? 'soot' : 'trunk2') : null;
    } }
  ];
  // Small growth: a few stalks each. soft normals, no shadows, and they sway (see main.js).
  function stalks(name, size, tall, radius, density, mats, seed) {
    return { name: name, w: size, h: size, layers: tall, soft: 0.75, noShadow: true, fn: function (x, y, z) {
      const q = hash(floor(x), floor(y), seed); if (hypot(x, y) > radius || q > density) return null;
      const top = 1 + floor(hash(floor(y), floor(x), seed + 1) * tall); return z > top ? null : z === top ? mats[1] : mats[0];
    } };
  }
  const plants = [
    stalks('tuft', 7, 4, 3.2, 0.42, ['grassB', 'grassT'], 201), stalks('tuft2', 7, 3, 3.2, 0.35, ['grassB', 'grassDry'], 211),
    stalks('reeds', 8, 9, 3.6, 0.4, ['reed', 'reed2'], 221), stalks('poppies', 9, 4, 4.2, 0.24, ['grassB', 'poppy'], 231), stalks('daisies', 9, 3, 4.2, 0.22, ['grassB', 'flowerW'], 241),
    { name: 'haycock', w: 14, h: 14, layers: 10, soft: 0.25, fn: function (x, y, z) { return hypot(x, y) < 6.2 * Math.pow(1 - z / 10.5, 0.6) * (0.9 + 0.2 * noise(x * 0.7, y * 0.7, 251)) ? pick(noise(x * 0.8 + z, y * 0.8, 252), ['hay2', 'hay', 'hay', 'thatch3']) : null; } }
  ];

  // ---------------------------------------------------------------- vehicles (generic shapes, no markings)
  const wheelsAt = function (x, z, xs, zc, r) { for (let i = 0; i < xs.length; i++) if (hypot(x - xs[i], z - zc) < r) return true; return false; };
  function paint(x, y, z, seed) { const q = n3(x * 0.2, y * 0.2, z * 0.3, seed); return q > 0.66 ? 'olive2' : q < 0.3 ? 'oliveD' : 'olive'; }      // worn olive drab
  const tankHull = { name: 'tankHull', w: 52, h: 28, layers: 12, fn: function (x, y, z) {
    const ax = abs(x), ay = abs(y);
    if (ay >= 8 && ay < 12.5 && ax < 24) {                                                 // the tracks
      if (z === 8 && ax < 23) return ay > 11.6 ? 'oliveD' : paint(x, y, z, 301);            // track guards
      if (z > 8 || (ax > 20 && hypot(ax - 20, z - 4) > 4)) return null;
      if (ay > 11.4) return z > 0 && z < 7 && wheelsAt(x, z, [-17, -11.3, -5.6, 0, 5.6, 11.3, 17], 3.2, 2.5) ? (wheelsAt(x, z, [-17, -11.3, -5.6, 0, 5.6, 11.3, 17], 3.2, 0.9) ? 'steel' : 'wheel') : z === 0 || z === 7 || ax > 20 ? (floor(x + 60) & 1 ? 'track' : 'track2') : 'trackIn';
      return z === 7 || z === 0 || ax > 20 ? (floor(x + 60) & 1 ? 'track' : 'track2') : 'trackIn';
    }
    if (ay >= 8.6 || z < 3 || z > 10) return null;
    if (x > 24 - Math.max(0, z - 5) * 1.7 - (z < 5 ? (5 - z) * 0.8 : 0) || x < -24 + Math.max(0, z - 7) * 0.9) return null;      // the sloped nose and tail
    if (z === 10 && x < -7) return (floor(x + 60) & 1) && ay < 6.5 ? 'grille' : 'oliveD';   // the engine deck
    if (z >= 9 && x < -17 && ay < 6) return 'canvas';                                       // a rolled tarpaulin
    if (x > 19 - (z - 5) * 1.7 && z > 5 && z < 9 && abs(ay - 4) < 2.2) return floor(x + y + 60) & 1 ? 'track' : 'track2';        // spare links on the nose
    if (z === 9 && x > 14 && abs(ay - 6.6) < 0.9) return 'steel';                           // lamps
    return z < 5 ? (hash(floor(x / 2), floor(y), z) < 0.3 ? 'mud' : 'oliveD') : paint(x, y, z, 303);
  } };
  // the hull's stowage sits outside its outline, so it is added on top of the function above
  (function () { const f = tankHull.fn; tankHull.fn = function (x, y, z) {
    if (y > 9 && y < 11.4 && z >= 9 && z <= 10 && x > -14 && x < 7) return hypot(y - 10.2, z - 9.6) < 1.3 ? (x > 5.5 || x < -13 ? 'splinter' : 'trunk') : null;       // a log for soft ground
    if (y < -8.8 && y > -12 && z >= 9 && z <= 11 && x > -16 && x < -8) return z === 11 ? 'crateD' : 'crate';                                                         // a stowage box
    return f(x, y, z);
  }; })();
  const tankTurret = { name: 'tankTurret', w: 72, h: 22, layers: 16, noShadow: true, fn: function (x, y, z) {
    const ay = abs(y);
    if (z >= 3 && z <= 5 && x > 9 && x < 35 && hypot(y, z - 4) < (x > 32.5 ? 1.9 : x < 13 ? 2.2 : 1.35)) return x > 32.5 ? 'gunD' : 'gun';          // the gun
    if (z < 7 && ell(x + 1, y, 10 - (z > 5 ? 1 : 0) - (z < 1 ? 1 : 0), 8.8 - (z > 5 ? 1 : 0) - (z < 1 ? 1 : 0))) return x > 7 && ay < 4 && z > 0 ? 'oliveD' : z === 6 && hypot(x - 2, y + 4) < 2 ? 'oliveD' : paint(x, y, z, 311);
    if (z > 0 && z < 6 && x < -8 && x > -14.5 && ay < 5.5) return z === 5 ? 'canvas2' : paint(x, y, z, 313);     // the bustle, a bedroll on it
    if (hypot(x + 3, y - 3.4) < 2.9 && z >= 7 && z < 9) return hypot(x + 3, y - 3.4) < 1.8 && z === 8 ? 'trackIn' : 'oliveD';                         // the cupola, its hatch open
    if (x < -5.4 && x > -6.6 && abs(y - 3.4) < 2.6 && z >= 9 && z < 12) return 'olive';
    return abs(x + 9) < 0.55 && abs(y + 5.5) < 0.55 && z >= 7 ? 'iron' : null;                                                                       // the aerial
  } };
  const halftrack = { name: 'halftrack', w: 50, h: 22, layers: 17, fn: function (x, y, z) {
    const ax = abs(x), ay = abs(y);
    if (ay > 7 && ay < 9.8) {
      if (hypot(x - 16.5, z - 3) < 3.2) return hypot(x - 16.5, z - 3) < 1.2 && ay > 8.8 ? 'wheel' : 'tyre';                                           // front wheels
      if (x > -21 && x < 7 && z < 6 && !(x < -18 && hypot(x + 18, z - 3) > 3) && !(x > 4 && hypot(x - 4, z - 3) > 3)) return ay > 8.8 && z > 0 && z < 5 && wheelsAt(x, z, [-17, -12, -7, -2, 3], 2.6, 2.1) ? 'wheel' : z === 0 || z === 5 || x < -18 || x > 4 ? (floor(x + 60) & 1 ? 'track' : 'track2') : 'trackIn';
      if (z === 7 && x > 11 && x < 21) return 'oliveD';                                                                                              // mudguards
      if (z === 6 && x > -21 && x < 7) return 'oliveD';
      return null;
    }
    if (ay >= 8 || z < 3) return null;
    if (x > 8) {                                                                                                                                     // the bonnet
      if (x > 23.6 || ay > 6 - Math.max(0, x - 17) * 0.35 || z > 10.5 - (x - 8) * 0.07) return x > 22.5 && x < 24.6 && ay < 7 && z > 3 && z < 6 ? 'oliveD' : null;
      return x > 22.6 ? (z & 1 ? 'grille' : 'oliveD') : z > 9 && ay < 0.6 ? 'oliveD' : paint(x, y, z, 321);
    }
    if (x < -22.5) return null;
    if (z > 12) return x > 6.2 && z < 15 && ay < 7.4 ? (z === 13 && abs(ay - 3.5) < 2 ? 'trackIn' : 'oliveD') : abs(x - 2) < 0.6 && ay < 0.6 && z < 16 ? 'gun' : z === 15 && ay < 0.6 && x > 2 && x < 9 ? 'gun' : x < -12 && ay < 7.4 && z < 14 ? (floor(y + 60) % 5 === 0 ? 'canvas2' : 'canvas') : null;   // the visor, a gun on its post, a canvas tilt
    if (ay > 6.8 || x < -21.5 || x > 7) return z === 12 ? 'oliveD' : paint(x, y, z, 323);                                                           // the armoured sides
    if (z < 5) return 'oliveD';
    if (ay > 4.4 && x < -2 && z < 8) return 'canvas2';                                                                                             // benches
    return x > 0 && x < 5 && abs(ay - 3.4) < 2 && z < 9 ? 'canvas2' : null;                                                                        // seats
  } };
  // The burnt-out lorry: field grey where the paint survived, black and rust elsewhere, embers in the load bed.
  const wreck = { name: 'wreck', w: 48, h: 20, layers: 15, fn: function (x, y, z) {
    const ay = abs(y), burnt = function () { const q = n3(x * 0.25, y * 0.25, z * 0.3, 331); return q > 0.68 ? 'fgrey' : q > 0.6 ? 'rust' : q < 0.33 ? 'char2' : 'char'; };
    if (ay > 6.4 && ay < 8.8 && z < 6) return (hypot(x - 15, z - 2.6) < 2.9 && y > 0) || hypot(x + 13, z - 2.6) < 2.9 ? (hash(x, y, z) < 0.25 ? 'ash' : 'char') : null;      // three tyres left
    if (ay >= 8 || z < 3) return null;
    if (x > 9) { if (x > 21.5 || ay > 5.6 || z > 8.5 + n3(x, y, 0, 332) * 2 - (x > 16 ? 1 : 0)) return null; return z > 6 && hash(x, y, z) < 0.12 ? 'ember' : burnt(); }           // the bonnet, sprung
    if (x > 1) { if (z > 12 - noise(x * 0.6, y * 0.6, 333) * 5) return null; return (ay > 5.8 || x > 8 || x < 2 || z < 5) ? (z > 8 && z < 11 && ay < 5.8 ? null : burnt()) : null; } // the cab, its roof fallen in
    if (x < -21.5) return null;
    if (z < 5) return hash(floor(x / 2), floor(y / 2), 334) < 0.2 ? 'ember' : burnt();                                                                                           // the load bed
    if (ay > 6.6 || x < -20.6) return z < 7 + hash(floor(x / 3), floor(y / 3), 335) * 3.5 ? (floor(x + 60) % 6 === 0 ? 'char' : burnt()) : null;                                 // its boards
    return z < 5 + noise(x * 0.5, y * 0.5, 336) * 3 ? (hash(x, y, z) < 0.3 ? 'ember' : hash(x, y, z) < 0.5 ? 'ash' : 'char') : null;                                             // what is left of the load
  } };
  const jeep = { name: 'jeep', w: 30, h: 15, layers: 13, noShadow: true, fn: function (x, y, z) {
    const ax = abs(x), ay = abs(y);
    if (ay > 4.8 && ay < 6.8 && hypot(ax - 8, z - 2.8) < 2.9) return hypot(ax - 8, z - 2.8) < 1.1 && ay > 6 ? 'wheel' : 'tyre';
    if (x < -11.8 && x > -13.6 && hypot(y, z - 6) < 3) return hypot(y, z - 6) < 1.2 ? 'wheel' : 'tyre';                       // the spare
    if (x < -11.8 && x > -13.2 && abs(y - 4.4) < 1 && z > 3 && z < 8) return 'jerry';
    if (ay > 5.6 || ax > 12.4 || z < 2) return null;
    if (ay > 4.6 && abs(ax - 8) < 3.6 && z < 6) return z === 5 ? 'oliveD' : null;                                             // wheel arches
    if (x > 3.6) return z < 8 - (x > 10.5 ? 0.6 : 0) && ay < 5 ? (x > 11.6 ? (z > 4 && abs(ay - 3.6) < 0.8 ? 'steel' : floor(y + 60) & 1 ? 'grille' : 'oliveD') : paint(x, y, z, 341)) : null;      // the bonnet
    if (x > 2.6) return z < 11.5 && ay < 5.4 ? (z > 7.4 && z < 10.5 && ay < 4.6 ? 'screen' : 'oliveD') : null;                 // the windscreen
    if (z < 4) return 'oliveD';
    if (hypot(x + 1.5, y - 2.6) < 1.9) return z < 9 ? 'tunic' : z < 10 ? 'skin' : z < 12 && hypot(x + 1.5, y - 2.6) < (z === 10 ? 1.9 : 1.4) ? 'helmet' : null;   // the driver
    if (abs(x - 1.2) < 0.6 && hypot(y - 2.6, z - 7.6) < 1.3) return 'iron';                                                    // the wheel he holds
    if (ay > 4.6 || x < -10.8) return z < 7 ? paint(x, y, z, 343) : null;                                                     // the tub
    return (x > -3.5 && x < 0 && y < 0) || x < -7 ? (z < 6.4 ? 'canvas2' : null) : null;                                      // seats
  } };

  // ---------------------------------------------------------------- field works and stores
  function bag(u, z, seed) { const row = z >> 1, v = u + (row & 1) * 2.5, q = hash(floor(v / 5), row, seed); return (z & 1) === 0 && floor(v) % 5 === 0 ? 'sandD' : q < 0.3 ? 'sand2' : q < 0.75 ? 'sand1' : 'sand3'; }
  const works = [
    // sandbags in a half circle, open to the rear (-x), with a gap to fire through
    { name: 'sandbags', w: 36, h: 36, layers: 8, bump: function (x, y, z) { return z > 5 ? [(hash(floor(x), floor(y), 5) - 0.5) * 0.5, (hash(floor(y), floor(x), 6) - 0.5) * 0.5] : null; }, fn: function (x, y, z) {
      const d = hypot(x + 4, y), a = Math.atan2(y, x + 4);
      if (abs(a) > 1.75 || d < 13 + (z > 5 ? 0.8 : 0) || d > 17.6 - (z > 5 ? 0.8 : 0) || z > (abs(a) < 0.16 ? 4 : 7)) return null;
      return bag(a * 15 + 100, z, 401);
    } },
    { name: 'sandwall', w: 26, h: 8, layers: 7, fn: function (x, y, z) { return abs(x) < 12.5 - (z > 5 ? 2 : 0) && abs(y) < 2.8 - (z > 4 ? 0.8 : 0) ? bag(x + 100, z, 411) : null; } },
    { name: 'crates', w: 18, h: 16, layers: 13, fn: function (x, y, z) {
      const box = function (x0, x1, y0, y1, z0, z1, s) { if (x < x0 || x >= x1 || y < y0 || y >= y1 || z < z0 || z >= z1) return null; const e = (x < x0 + 1 || x >= x1 - 1 ? 1 : 0) + (y < y0 + 1 || y >= y1 - 1 ? 1 : 0) + (z < z0 + 1 || z >= z1 - 1 ? 1 : 0); return e > 1 ? 'crateD' : z === z1 - 3 ? 'crateL' : hash(floor(x / 2), floor(y / 2), s) < 0.4 ? 'crate2' : 'crate'; };
      return box(-8, 0, -7, 1, 0, 7, 1) || box(1, 8, -5, 3, 0, 6, 2) || box(-6, 2, -5, 3, 7, 12, 3) || box(-2, 4, 4, 8, 0, 4, 4);
    } },
    { name: 'drums', w: 16, h: 16, layers: 10, fn: function (x, y, z) {
      const c = [[-3.6, -3, 0], [3.6, -2, 1], [0, 4, 2]];
      for (let i = 0; i < 3; i++) { const d = hypot(x - c[i][0], y - c[i][1]); if (d < 3.4 && z < 9) return z === 8 ? (d < 0.8 ? 'iron' : d > 2.6 ? 'drumBand' : 'drumTop') : z === 2 || z === 5 ? 'drumBand' : i === 1 ? 'drumRust' : 'drum'; }
      return null;
    } },
    { name: 'jerrycans', w: 14, h: 6, layers: 7, fn: function (x, y, z) {
      const m = ((x + 70) % 3.4) - 1.7; if (abs(x) > 6.6 || abs(y) > 2.2 || abs(m) > 1.2) return null;
      return z < 6 ? (z === 5 && abs(y) > 1.4 ? null : 'jerry') : abs(y) < 1 && abs(m) < 0.6 ? 'oliveD' : null;
    } },
    // a hurricane lamp on an ammunition box
    { name: 'lantern', w: 8, h: 8, layers: 9, noShadow: true, fn: function (x, y, z) { return z < 4 ? (abs(x) < 3.2 && abs(y) < 2.4 ? (z === 3 || abs(x) > 2.2 ? 'crateD' : 'jerry') : null) : hypot(x, y) < (z === 4 || z === 7 ? 1.4 : z === 8 ? 0.6 : 1.2) ? (z === 5 || z === 6 ? 'lamp' : 'iron') : null; } },
    // barbed wire: two pickets and a coil between them
    { name: 'wire', w: 30, h: 8, layers: 8, noShadow: true, soft: 0.5, fn: function (x, y, z) {
      if (abs(abs(x) - 13.5) < 0.9 && abs(y) < 0.9) return z < 8 ? 'picket' : null;
      if (abs(x) > 13.5) return null;
      return hypot(y - 2.5 * Math.cos(x * 0.75), z - 3.5 - 2.7 * Math.sin(x * 0.75)) < 0.8 || hypot(y + 2.5 * Math.cos(x * 0.75 + 1.3), z - 3.5 - 2.7 * Math.sin(x * 0.75 + 1.3)) < 0.6 ? 'wire' : null;
    } },
    { name: 'pole', w: 12, h: 4, layers: 36, shadowIf: function (x, y) { return abs(x) < 1.2; }, fn: function (x, y, z) {
      if (abs(x) < 1 && abs(y) < 1) return z < 35 ? (z < 3 ? 'trunk2' : 'pole') : null;
      return abs(y) < 0.6 ? (z === 30 && abs(x) < 5.4 ? 'pole' : z === 31 && (abs(abs(x) - 4.5) < 0.6 || abs(abs(x) - 2.5) < 0.6) ? 'insul' : null) : null;
    } },
    { name: 'fence', w: 26, h: 3, layers: 7, noShadow: true, fn: function (x, y, z) { return abs(y) > 0.7 ? null : abs(((x + 13 + 80) % 8) - 0.5) < 0.9 ? (z < 7 ? 'picket' : null) : z === 2 || z === 5 ? 'plank' : null; } },
    { name: 'gate', w: 16, h: 3, layers: 8, noShadow: true, fn: function (x, y, z) { return abs(y) > 0.7 || abs(x) > 7.4 ? null : abs(x) > 6.4 ? 'timberD' : z > 0 && z < 7 && (z % 2 === 1 || abs(abs(x) - (z - 1) * 1.05) < 0.7) ? 'plank' : null; } },
    { name: 'grave', w: 6, h: 4, layers: 7, fn: function (x, y, z) { return abs(y) < 0.9 && abs(x) < (z > 4 ? 6.4 - z : 2) ? (z < 2 && hash(floor(x), z, 1) < 0.4 ? 'moss' : 'grave') : null; } },
    { name: 'rubble', w: 16, h: 16, layers: 5, fn: function (x, y, z) { return z < noise(x * 0.45 + 9, y * 0.45, 421) * 6.5 - hypot(x, y) * 0.42 ? (hash(x, y, z) < 0.2 ? 'timberD' : stone(x * 2, y + z * 3, 423)) : null; } },
    { name: 'cart', w: 26, h: 14, layers: 12, fn: function (x, y, z) {
      const ay = abs(y), d = hypot(x + 2, z - 4);
      if (ay > 4.4 && ay < 5.6) return d < 4.2 ? (d > 3.2 || d < 0.9 || abs(x + 2) < 0.5 || abs(z - 4) < 0.5 ? 'timberD' : null) : null;      // two spoked wheels
      if (ay > 4.4) return null;
      if (x > 6.5) return z === 4 && abs(ay - 2.6) < 0.6 && x < 12.5 ? 'timber' : null;                                                    // shafts
      if (x < -9.5) return null;
      if (z === 5) return 'plank'; if (z < 5) return null;
      if (z < 8 && (ay > 3.5 || x < -8.6 || x > 5.6)) return (floor(x + 60) & 1) || z === 7 ? 'plank2' : null;                              // slatted sides
      return hypot(x + 1.5, y * 1.6, (z - 6) * 1.5) < 7.6 + noise(x, y, 431) ? pick(noise(x * 0.9 + z, y * 0.9, 432), ['hay2', 'hay', 'thatch3']) : null;   // a load of hay
    } },
    // a ridge tent
    { name: 'tent', w: 24, h: 16, layers: 10, fn: function (x, y, z) {
      const e = 7 * (1 - z / 9.5); if (abs(x) > 10.5 || abs(y) > e) return null;
      if (x > 9.4 && abs(y) < e - 1.4 && z < 7) return abs(y) < 1.6 + (6 - z) * 0.25 ? 'trackIn' : 'tent2';                                // the open end, its flaps tied back
      return abs(y) < e - 2.6 && abs(x) < 9.4 ? 'inside' : e < 1.2 || z === 0 ? 'tent2' : noise(x * 0.3, y * 0.3 + z, 441) > 0.7 ? 'tent2' : 'tent';
    } }
  ];
  function cow(name, grazing, seed) {
    return { name: name, w: 20, h: 8, layers: 11, fn: function (x, y, z) {
      const ay = abs(y), hide = function () { return noise(x * 0.45 + seed, y * 0.6 + z * 0.3, seed) > 0.52 ? 'cowB' : 'cowW'; };
      if (z < 5) return abs(abs(x + 1) - 4) < 0.9 && abs(ay - 1.5) < 0.8 ? (z === 0 ? 'iron' : hide()) : (grazing && x > 6.4 && x < 9.6 && ay < 1.3 && z > 0 && z < 4 ? (x > 8.6 ? 'cowN' : hide()) : null);
      if (x > -6.6 && x < 5 && z < 10 && ell(y, z - 7, 2.9, 3)) return hide();
      if (grazing) return x >= 5 && x < 7.5 && ay < 1.5 && z < 8 - (x - 5) * 1.3 ? hide() : null;
      return x >= 5 && x < 9.6 && ay < 1.5 && z > 6 && z < 10.6 ? (x > 8.6 ? 'cowN' : z > 9.6 && x < 6.4 ? 'cowB' : hide()) : null;
    } };
  }

  // ---------------------------------------------------------------- smoke, fire, birds: the moving bits
  // A puff is a ragged ball with holes. Four of them, from thick and dark to thin and pale: a puff of smoke is
  // drawn with the next one as it ages (main.js). Opaque pixels with gaps stand in for transparency.
  function puff(name, mats, density, seed, size) {
    const R = size / 2 - 1.5;
    return { name: name, w: size, h: size, layers: size - 3, soft: 0.45, noShadow: true, fn: function (x, y, z) {
      const d = hypot(x, y, z - R) / R + (n3(x * 0.4, y * 0.4, z * 0.4, seed) - 0.5) * 0.7; if (d > 1) return null;
      if (hash(x, y, z + seed) > density + (1 - d) * 0.25) return null;
      return n3(x * 0.25, y * 0.25, z * 0.3, seed + 1) + z / size * 0.35 > 0.62 ? mats[1] : mats[0];
    } };
  }
  function flame(name, seed) {
    return { name: name, w: 12, h: 12, layers: 14, soft: 0.6, noShadow: true, fn: function (x, y, z) {
      const cx = (noise(z * 0.5, seed, 1) - 0.5) * 3.4, cy = (noise(z * 0.5, seed, 2) - 0.5) * 3.4, r = 4.6 * Math.pow(1 - z / 14, 0.75) * (0.7 + 0.6 * noise(z * 0.8, seed, 3)), d = hypot(x - cx, y - cy);
      return d > r ? null : d < r * 0.4 && z < 8 ? 'fire1' : d < r * 0.75 ? 'fire2' : 'fire3';
    } };
  }
  function bird(name, pose) {                                    // pose: 1 wings up, 0 level, -1 down
    return { name: name, w: 8, h: 14, layers: 3, noShadow: true, fn: function (x, y, z) {
      const ay = abs(y); if (ay < 0.9) return z === 1 && x > -3.2 && x < 3 ? 'bird' : null;
      return abs(x - 0.4 + ay * 0.12) < 1.3 - ay * 0.1 && ay < 6.4 && z === 1 + pose * (ay > 4 ? 1 : ay > 2 ? (pose > 0 ? 1 : 0) : 0) ? 'bird2' : null;
    } };
  }

  function all() {
    return [farmhouse, barn, church, cottageA, cottageB, shed, well, bridge, memorial].concat(trees, plants, [tankHull, tankTurret, halftrack, wreck, jeep], works, [
      cow('cow', false, 3), cow('cowGrazing', true, 8),
      puff('smoke0', ['smokeA', 'smokeB'], 0.95, 501, 18), puff('smoke1', ['smokeB', 'smokeC'], 0.7, 511, 18), puff('smoke2', ['smokeC', 'smokeD'], 0.42, 521, 18), puff('smoke3', ['smokeD', 'smokeD'], 0.2, 531, 18),
      puff('dust0', ['dust', 'dust2'], 0.3, 541, 12), puff('dust1', ['dust2', 'dust2'], 0.12, 551, 12),
      flame('flame0', 3), flame('flame1', 17), flame('flame2', 31),
      bird('bird0', 1), bird('bird1', 0), bird('bird2', -1)
    ]);
  }

  global.Models = { all: all, deck: deck, stone: stone };
})(typeof window !== 'undefined' ? window : globalThis);
