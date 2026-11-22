// characters.js: the walking figure, built on the rig of the sprite-stack-animation kit (same joints, same numbers).
// parts are built by art.js like everything else; rig is read by rig.js; draw(R, art, P) puts the stacks on the
// joints of a pose, where R has stack(), slice() and limb() (see Engine.figureWriter in engine.js).
// The soldier is a man in generic 1940s kit: steel helmet, olive tunic, webbing, a pack, gaiters, a slung rifle.
(function (global) {
  'use strict';
  const ell = function (x, y, rx, ry) { return (x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1; };

  const soldier = {
    parts: [
      { name: 'head', w: 14, h: 14, layers: 10, fn: function (x, y, z) {
        if (z >= 5) { const r = z === 5 ? 6.6 : z === 6 ? 5.8 : z === 7 ? 5.4 : z === 8 ? 4.6 : 3; return x * x + y * y <= r * r ? (z === 5 ? 'helmetD' : 'helmet') : null; }      // the helmet and its brim
        const r = z === 0 ? 2.6 : z < 2 ? 3.8 : 4.4; if (x * x + y * y > r * r) return null;
        return z === 0 ? 'skin' : x > 0.2 ? (z === 3 && Math.abs(Math.abs(y) - 1.8) < 0.7 && x > 3 ? 'boots' : 'skin') : 'boots';                                           // a face, hair behind
      } },
      { name: 'torso', w: 14, h: 16, layers: 12, fn: function (x, y, z) {
        if (x < -2.4 && x > -6.2 && Math.abs(y) < 3.6 && z >= 4 && z <= 10) return z === 10 || z === 7 ? 'web' : 'packS';                                                  // the pack
        if (z <= 1) return ell(x, y, 2.5, 4.1) ? 'trousers' : null;
        if (z === 2 || z === 3) return ell(x, y, 2.9, 4.5) ? (z === 2 && x > 1.4 && Math.abs(Math.abs(y) - 2.4) < 1.1 ? 'packS' : 'web') : null;                           // the belt, a pouch each side
        if (z === 11) return ell(x, y, 1.9, 2.0) ? 'skin' : null;
        const t = (z - 3) / 6, ry = z >= 9 ? 7.0 : 4.6 + 1.5 * Math.min(1, t), rx = z >= 9 ? 2.7 : 3.0;
        if (!ell(x, y, rx, ry)) return null;
        if (Math.abs(Math.abs(y) - 2.6) < 0.7 && z < 10) return 'web';                                                                                                  // braces
        return x < 0 && z < 9 ? 'tunicD' : 'tunic';
      } },
      { name: 'arm', w: 5, h: 5, layers: 1, fn: function (x, y) { return ell(x, y, 1.8, 1.8) ? 'tunic' : null; } },
      { name: 'hand', w: 5, h: 5, layers: 1, fn: function (x, y) { return ell(x, y, 1.5, 1.5) ? 'skin' : null; } },
      { name: 'thigh', w: 5, h: 5, layers: 1, fn: function (x, y) { return ell(x, y, 2.4, 2.4) ? 'trousers' : null; } },
      { name: 'shin', w: 5, h: 5, layers: 1, fn: function (x, y) { return ell(x, y, 2.05, 2.05) ? 'gaiter' : null; } },
      { name: 'boot', w: 7, h: 5, layers: 3, fn: function (x, y, z) { return x > -2.4 && x < (z === 2 ? 1.0 : z === 1 ? 2.8 : 3.3) && Math.abs(y) < 2.0 ? 'boots' : null; } },
      { name: 'stock', w: 3, h: 3, layers: 1, fn: function (x, y) { return Math.abs(x) < 1.2 && Math.abs(y) < 1.2 ? 'rifleW' : null; } },
      { name: 'barrel', w: 3, h: 3, layers: 1, fn: function (x, y) { return Math.abs(x) < 0.8 && Math.abs(y) < 0.8 ? 'rifleM' : null; } }
    ],
    rig: { thigh: 7, shin: 7, ankle: 1.5, hipHalf: 2.4, standHip: 13.2, kneeHint: 1, stride: 18, duty: 0.6, lift: 2.4, bob: 0.35, twist: 0.16, spine: 9.5, arms: true, shoulderHalf: 7.2, upperArm: 4.6, foreArm: 4.6, armSwing: 0.5 },
    height: 34,
    draw: function (R, art, P) {
      for (let i = 0; i < 2; i++) {
        const L = P.legs[i], A = P.arms[i];
        R.stack(art.boot, L.sole[0], L.sole[1], L.sole[2], L.rot);
        R.limb(art.shin, L.ankle, L.knee, 5); R.limb(art.thigh, L.knee, L.hip, 5);
        R.limb(art.arm, A.shoulder, A.elbow, 4); R.limb(art.arm, A.elbow, A.hand, 4); R.limb(art.hand, A.hand, A.hand, 1);
      }
      const T = art.torso, z0 = P.pelvis[2] - 1;
      for (let i = 0; i < T.slices.length; i++) { const s = T.slices[i], t = Math.min(1, s.z / (T.n - 3)); R.slice(T, i, P.x, P.y, z0 + s.z, P.hipsAngle + (P.shouldersAngle - P.hipsAngle) * t); }
      R.stack(art.head, P.x, P.y, z0 + T.n, P.heading);
      // the rifle, slung across the back: from behind the right hip up past the left shoulder
      const c = Math.cos(P.shouldersAngle), s = Math.sin(P.shouldersAngle), at = function (bx, by, bz) { return [P.x + bx * c - by * s, P.y + bx * s + by * c, z0 + bz]; };
      R.limb(art.stock, at(-6.6, -4.2, 0.5), at(-6.6, 1, 9), 7); R.limb(art.barrel, at(-6.6, 1, 9), at(-6.6, 4.6, 15.5), 6);
    }
  };

  global.Characters = { soldier: soldier };
})(typeof window !== 'undefined' ? window : globalThis);
