// characters.js: the two walking figures, taken from the sprite-stack-animation kit (same parts, same rig numbers).
// parts are built by art.js like everything else; rig is read by rig.js; draw(R, art, P) puts the stacks on the
// joints of a pose, where R has stack(), slice() and limb() (see Engine.figureWriter in engine.js).
(function (global) {
  'use strict';
  const ell = function (x, y, rx, ry) { return (x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1; };
  const disc = function (x, y, r) { return x * x + y * y <= r * r; };

  const explorer = {
    parts: [
      { name: 'head', w: 12, h: 12, layers: 10, fn: function (x, y, z) {
        const zc = z + 0.5 - 5.0, r2 = 5.7 * 5.7 - zc * zc * 1.25; if (r2 <= 0 || x * x + y * y > r2) return null;
        if (x > 1.6 && Math.abs(y) < 3.8 && z >= 3 && z <= 6) return z === 6 && y < -1.4 && y > -3.2 ? 'glint' : 'visor';
        if (Math.abs(y) < 0.9 && x < 1.5 && z >= 7) return 'pack';
        return 'suit';
      } },
      { name: 'torso', w: 12, h: 16, layers: 12, fn: function (x, y, z) {
        if (x < -2.4 && x > -5.6 && Math.abs(y) < 3.3 && z >= 4 && z <= 10) return 'pack';
        if (z <= 1) return ell(x, y, 2.5, 4.1) ? 'trouser' : null;
        if (z === 2) return ell(x, y, 2.8, 4.4) ? 'dark' : null;
        if (z === 11) return ell(x, y, 1.9, 2.0) ? 'dark' : null;
        const t = (z - 3) / 6, ry = z >= 9 ? 7.2 : 4.6 + 1.5 * Math.min(1, t), rx = z >= 9 ? 2.7 : 3.0;
        if (!ell(x, y, rx, ry)) return null;
        if (x > 1.6 && Math.abs(y) < 1.6 && (z === 6 || z === 7)) return 'panel';
        return 'suit';
      } },
      { name: 'arm', w: 5, h: 5, layers: 1, fn: function (x, y) { return ell(x, y, 1.8, 1.8) ? 'suit' : null; } },
      { name: 'hand', w: 5, h: 5, layers: 1, fn: function (x, y) { return ell(x, y, 1.5, 1.5) ? 'boot' : null; } },
      { name: 'thigh', w: 5, h: 5, layers: 1, fn: function (x, y) { return ell(x, y, 2.4, 2.4) ? 'trouser' : null; } },
      { name: 'shin', w: 5, h: 5, layers: 1, fn: function (x, y) { return ell(x, y, 2.05, 2.05) ? 'trouser' : null; } },
      { name: 'boot', w: 7, h: 5, layers: 3, fn: function (x, y, z) { return x > -2.4 && x < (z === 2 ? 1.0 : z === 1 ? 2.8 : 3.3) && Math.abs(y) < 2.0 ? 'boot' : null; } }
    ],
    rig: { thigh: 7, shin: 7, ankle: 1.5, hipHalf: 2.4, standHip: 13.2, kneeHint: 1, stride: 18, duty: 0.6, lift: 2.4, bob: 0.35, twist: 0.16, spine: 9.5, arms: true, shoulderHalf: 7.5, upperArm: 4.6, foreArm: 4.6, armSwing: 0.55 },
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
    }
  };

  const robot = {
    parts: [
      { name: 'body', w: 12, h: 12, layers: 9, fn: function (x, y, z) {
        const ax = Math.abs(x), ay = Math.abs(y), r = z === 0 || z === 8 ? 4.2 : 5.2;
        if (ax > r || ay > r || ax + ay > r * 1.62) return null;
        if (x > 3.6 && z >= 3 && z <= 6 && ay < 2.1) return ay < 0.9 && (z === 4 || z === 5) ? 'joint' : 'lens';
        if (z === 2 || z === 7) return 'trim';
        return 'shell';
      } },
      { name: 'aerial', w: 3, h: 3, layers: 6, fn: function (x, y, z) { return z >= 4 ? (disc(x, y, 1.3) ? 'lamp' : null) : disc(x, y, 0.6) ? 'trim' : null; } },
      { name: 'upper', w: 5, h: 5, layers: 1, fn: function (x, y) { return disc(x, y, 1.7) ? 'joint' : null; } },
      { name: 'lower', w: 5, h: 5, layers: 1, fn: function (x, y) { return disc(x, y, 1.6) ? 'shell' : null; } },
      { name: 'foot', w: 6, h: 5, layers: 2, fn: function (x, y, z) { return Math.abs(y) < (z ? 1.2 : 2.1) && x > (z ? -1.2 : -2.1) && x < (z ? 1.2 : 2.7) ? 'foot' : null; } }
    ],
    rig: { thigh: 5.5, shin: 6, ankle: 1, hipHalf: 3.6, standHip: 9.6, kneeHint: -1, stride: 14, duty: 0.62, lift: 2.6, bob: 0.55, twist: 0.1, spine: 8, arms: false },
    height: 24,
    draw: function (R, art, P) {
      for (let i = 0; i < 2; i++) { const L = P.legs[i]; R.stack(art.foot, L.sole[0], L.sole[1], L.sole[2], L.rot); R.limb(art.lower, L.ankle, L.knee, 5); R.limb(art.upper, L.knee, L.hip, 4); }
      const z0 = P.pelvis[2] - 1, a = P.heading + (P.hipsAngle - P.heading) * 0.6;
      R.stack(art.body, P.x, P.y, z0, a);
      R.stack(art.aerial, P.x - Math.cos(a) * 2.5 - Math.sin(a) * 2.5, P.y - Math.sin(a) * 2.5 + Math.cos(a) * 2.5, z0 + art.body.n, a);
    }
  };

  global.Characters = { explorer: explorer, robot: robot };
})(window);
