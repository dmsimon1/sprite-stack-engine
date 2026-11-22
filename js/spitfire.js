// spitfire.js: Full 6-DOF D-Day June 1944 Allied Spitfire Mk.IX flying over Normandy.
// Impossible in 1D yaw-only sprite stacking; rendered natively via AASpriteStacker's
// Single-OBB 3D quaternion raymarcher inside loktar00's Normandy 1944 deferred lighting.
(function (global) {
  'use strict';

  function addPalette(pal) {
    pal.add('rafGreen', '#3d4f33', 0);
    pal.add('rafBrown', '#63523b', 0);
    pal.add('rafSky', '#9eb0a3', 0);
    pal.add('rafDark', '#242923', 0);
    pal.add('stripeW', '#eae7dc', 0);
    pal.add('stripeB', '#1d1f21', 0);
    pal.add('roundelB', '#204080', 0);
    pal.add('roundelR', '#b82a24', 0);
    pal.add('spinnerR', '#cc3028', 0);
    pal.add('canopyG', '#84b8cc', 0.25);
    pal.add('propBlur', '#d6d4c8', 0.15);
    pal.add('exhaustF', '#ff9838', 1.0);
  }

  // Sculpt a crisp 60x54x16 voxel Spitfire Mk.IX (+x nose, +y port wing, +z up)
  function createDefs() {
    const body = {
      name: 'spitfire',
      w: 60,
      h: 54,
      layers: 16,
      fn: function (x, y, z) {
        const ay = Math.abs(y);
        const cz = z - 6.5; // centerline height

        // 1. Nose spinner (x: 23..29)
        if (x >= 23 && x <= 29) {
          const t = (x - 23) / 6;
          const r = (1 - t * 0.85) * 3.1;
          if (y * y + cz * cz <= r * r) return 'spinnerR';
        }

        // 2. Sleek spinning propeller blur disc at x = 23..24
        if (x >= 23.2 && x <= 24.1) {
          const r = Math.hypot(y, cz);
          if (r >= 2.2 && r <= 7.0) {
            const ang = Math.atan2(cz, y);
            if (Math.sin(ang * 3) > 0.62) return 'propBlur';
          }
        }

        // 3. Glowing exhaust stubs along engine cowling
        if (x >= 14 && x <= 20 && ay >= 2.6 && ay <= 3.7 && Math.abs(cz - 0.6) <= 0.9) {
          return (Math.floor(x) % 2 === 0) ? 'exhaustF' : 'rafDark';
        }

        // 4. Tapered streamlined fuselage (x: -26..23)
        if (x >= -26 && x <= 23) {
          let ry, rzTop, rzBot;
          if (x > 8) {
            const t = (x - 8) / 15;
            ry = 3.6 * (1 - t * 0.25);
            rzTop = 3.8 * (1 - t * 0.25);
            rzBot = 3.3 * (1 - t * 0.25);
          } else {
            const t = (8 - x) / 34;
            ry = Math.max(0.9, 3.6 * (1 - t * 0.78));
            rzTop = Math.max(1.1, 3.8 * (1 - t * 0.68));
            rzBot = Math.max(0.8, 3.3 * (1 - t * 0.72));
          }
          const rz = cz >= 0 ? rzTop : rzBot;
          if ((y * y) / (ry * ry) + (cz * cz) / (rz * rz) <= 1.0) {
            // D-Day June 1944 black & white invasion stripes on rear fuselage!
            if (x >= -15 && x <= -5) {
              const band = Math.floor((x + 15) / 2);
              return (band & 1) === 0 ? 'stripeW' : 'stripeB';
            }
            // Sky underside vs RAF camouflage top
            if (cz < -0.7) return 'rafSky';
            const camo = Math.sin(x * 0.19 + y * 0.27) + Math.cos(x * 0.11 - y * 0.22);
            return camo > 0.15 ? 'rafBrown' : 'rafGreen';
          }
        }

        // 5. Bubble glass cockpit canopy (x: -5..6, cz > 2.2)
        if (x >= -5 && x <= 6 && cz >= 2.0 && cz <= 6.2) {
          const rx = 5.4, ry = 2.3, rz = 3.9;
          const nx = (x - 0.5) / rx, ny = y / ry, nz = (cz - 2.0) / rz;
          if (nx * nx + ny * ny + nz * nz <= 1.0) {
            if (Math.abs(x - 2.2) < 0.7 || Math.abs(x + 1.5) < 0.6) return 'rafDark';
            return 'canopyG';
          }
        }

        // 6. Iconic Elliptical Spitfire Main Wings (x: -2..12, ay: 2.5..26)
        if (ay >= 2.2 && ay <= 26 && cz >= -2.4 && cz <= -0.2) {
          const spanT = (ay - 2.2) / 23.8;
          // Elliptical chord profile!
          const halfChord = 7.2 * Math.sqrt(Math.max(0, 1 - spanT * spanT * 0.94));
          const xCenter = 4.6 - spanT * 1.4;
          const dx = x - xCenter;
          // Dihedral slight upward sweep toward wingtips
          const dih = spanT * 1.3;
          const thick = (1 - spanT * 0.55) * 1.15;
          if (Math.abs(dx) <= halfChord && Math.abs((cz + 1.4) - dih) <= thick) {
            // D-Day black & white invasion stripes on inner wings!
            if (ay >= 5.5 && ay <= 14.5) {
              const band = Math.floor((ay - 5.5) / 1.8);
              return (band & 1) === 0 ? 'stripeW' : 'stripeB';
            }
            // Iconic RAF wingtip roundels on top surface!
            const rDist = Math.hypot(x - (xCenter + 0.2), ay - 19.2);
            if ((cz + 1.4) - dih >= 0 && rDist <= 3.3) {
              if (rDist <= 1.1) return 'roundelR';
              if (rDist <= 2.1) return 'stripeW';
              return 'roundelB';
            }
            if ((cz + 1.4) - dih < -0.25) return 'rafSky';
            const camo = Math.sin(x * 0.22 + ay * 0.18);
            return camo > 0.05 ? 'rafBrown' : 'rafGreen';
          }
        }

        // 7. Elliptical Horizontal Tailplane (x: -24..-18, ay: 0..10.5)
        if (ay <= 10.5 && x >= -24 && x <= -17.5 && Math.abs(cz - 0.8) <= 0.85) {
          const st = ay / 10.5;
          const hc = 3.2 * Math.sqrt(Math.max(0, 1 - st * st * 0.92));
          if (Math.abs(x + 20.8) <= hc) {
            return cz < 0.7 ? 'rafSky' : 'rafGreen';
          }
        }

        // 8. Vertical Tail Fin & Rudder (x: -25.5..-17, ay <= 1.0, cz: 0..8.8)
        if (ay <= 0.95 && x >= -25.5 && x <= -17 && cz >= 0.5 && cz <= 8.8) {
          const ht = (cz - 0.5) / 8.3;
          const xLead = -17.2 - ht * 5.2;
          const xTrail = -25.4 + ht * 1.4;
          if (x <= xLead && x >= xTrail) {
            // RAF fin flash (red/white/blue vertical bars)
            if (cz <= 6.2 && x >= -23.6 && x <= -19.2) {
              if (x > -20.7) return 'roundelR';
              if (x > -22.2) return 'stripeW';
              return 'roundelB';
            }
            return 'rafGreen';
          }
        }

        return null;
      }
    };
    return [body];
  }

  // Quaternion from intrinsic Z (yaw) -> Y (pitch) -> X (roll) in Normandy Z-up world!
  // Local +X = nose forward, +Y = port wing left, +Z = up.
  function quatFromYPR(yaw, pitch, roll) {
    const cy = Math.cos(yaw * 0.5), sy = Math.sin(yaw * 0.5);
    const cp = Math.cos(pitch * 0.5), sp = Math.sin(pitch * 0.5);
    const cr = Math.cos(roll * 0.5), sr = Math.sin(roll * 0.5);
    // q = qZ(yaw) * qY(pitch) * qX(roll)
    return [
      sr * cp * cy - cr * sp * sy,
      cr * sp * cy + sr * cp * sy,
      cr * cp * sy - sr * sp * cy,
      cr * cp * cy + sr * sp * sy
    ];
  }

  // Smooth sweeping figure-8 / wide banked patrol right over the Normandy bridge, square & church!
  function poseAt(t) {
    const w = 0.24; // angular speed (rad/s)
    const a = t * w;
    // Lemniscate / banked oval directly over Normandy village center (256, 188)
    const pos = function (ang) {
      const x = 256 + 152 * Math.sin(ang);
      const y = 192 + 94 * Math.sin(ang * 2) * 0.72 + 24 * Math.cos(ang);
      const z = 96 + 12 * Math.sin(ang * 2 + 0.6);
      return [x, y, z];
    };
    const p0 = pos(a);
    const p1 = pos(a + 0.015);
    const p2 = pos(a + 0.030);
    const vx = (p1[0] - p0[0]) / 0.015, vy = (p1[1] - p0[1]) / 0.015, vz = (p1[2] - p0[2]) / 0.015;
    const vx2 = (p2[0] - p1[0]) / 0.015, vy2 = (p2[1] - p1[1]) / 0.015;
    const horiz = Math.hypot(vx, vy) || 1;
    const yaw = Math.atan2(vy, vx);
    // Nose pitches slightly up on climb (negative Y rotation pitches +X nose UP in right-handed Z-up!)
    const pitch = -Math.atan2(vz, horiz) * 0.85;
    // Bank cleanly into turns from signed lateral curvature (positive roll banks right wing down!)
    const crossZ = (vx * (vy2 - vy) - vy * (vx2 - vx)) / (horiz * horiz * 0.015);
    const roll = Math.max(-0.88, Math.min(0.88, -crossZ * 0.95));
    return {
      x: p0[0], y: p0[1], z: p0[2],
      yaw: yaw, pitch: pitch, roll: roll,
      quat: quatFromYPR(yaw, pitch, roll),
      vx: vx, vy: vy, vz: vz
    };
  }

  global.Spitfire = { addPalette: addPalette, createDefs: createDefs, poseAt: poseAt, quatFromYPR: quatFromYPR };
})(typeof window !== 'undefined' ? window : globalThis);
