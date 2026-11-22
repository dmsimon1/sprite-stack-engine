// art.js: build slice stacks from small functions, with a normal for every visible pixel, and pack them in one atlas.
//
// A stack is described as a box of art pixels and a function fn(x, y, z) -> material name or null (x forward,
// y sideways, measured from the middle; z is the layer). Each layer becomes one slice: a small image whose pixels
// hold a palette index and the direction that point of the surface faces. Nothing is lit here; the light pass
// (engine.js) does that once per screen pixel.
//
// Two things keep the fill cost down:
//  - every slice is cropped to the pixels it really has, and empty layers are dropped;
//  - "shell" stacks keep only pixels near the surface. A pixel deep inside a solid can never be seen, because
//    the layer above always covers it, so it is left out and its fragments are never written.
(function (global) {
  'use strict';

  // The palette: material name -> index. Index 0 is "nothing".
  function Palette() { this.names = { }; this.rgba = [[0, 0, 0, 0]]; }
  Palette.prototype.add = function (name, hex, glow) {
    this.names[name] = this.rgba.length;
    this.rgba.push([parseInt(hex.substr(1, 2), 16), parseInt(hex.substr(3, 2), 16), parseInt(hex.substr(5, 2), 16), Math.round((glow || 0) * 255)]);
  };
  Palette.prototype.bytes = function () { const b = new Uint8Array(256 * 4); this.rgba.forEach(function (c, i) { b.set(c, i * 4); }); return b; };

  // Fill a box with palette indices, then give every surface pixel a normal: the average direction towards the
  // empty space around it. shell: how many pixels deep the kept surface is (0 keeps everything).
  function voxelise(def, pal, shell) {
    const w = def.w, h = def.h, n = def.layers, vox = new Uint8Array(w * h * n);
    for (let z = 0; z < n; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const m = def.fn(x + 0.5 - w / 2, y + 0.5 - h / 2, z);
      if (m) { const id = pal.names[m]; if (!id) throw new Error(def.name + ': no material "' + m + '"'); vox[(z * h + y) * w + x] = id; }
    }
    const at = function (x, y, z) { return x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= n ? 0 : vox[(z * h + y) * w + x]; };
    const layers = [];
    for (let z = 0; z < n; z++) {
      let x0 = w, y0 = h, x1 = -1, y1 = -1; const px = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const id = at(x, y, z); if (!id) continue;
        let nx = 0, ny = 0, nz = 0, open = 0, near = false;
        for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy && !dz) continue;
          if (!at(x + dx, y + dy, z + dz) && !(z + dz < 0)) { nx += dx; ny += dy; nz += dz; open++; }
        }
        if (shell) {                                             // is there empty space within `shell` pixels?
          for (let dz = -1; dz <= 1 && !near; dz++) for (let dy = -shell; dy <= shell && !near; dy++) for (let dx = -shell; dx <= shell; dx++) if (!at(x + dx, y + dy, z + dz) && !(z + dz < 0)) { near = true; break; }
          if (!near) continue;                                   // deep inside: never visible, leave it out
        }
        // A pixel just under the surface has no empty neighbour, but a shallow view ray still lands on it (it passes
        // over the outer pixel of the copy above). Give it the facing of the nearest side, or walls come out speckled.
        for (let r = 2; r <= 4 && !open; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (!at(x + dx, y + dy, z)) { nx += dx; ny += dy; open++; }
        if (!at(x, y, z + 1)) nz += 3;                           // a top counts for more: it is the face the camera sees most
        const len = Math.hypot(nx, ny, nz); if (len < 0.01 || !open) { nx = 0; ny = 0; nz = 1; } else { nx /= len; ny /= len; nz /= len; }
        const j = (y * w + x) * 4; px[j] = id; px[j + 1] = Math.round(nx * 127 + 128); px[j + 2] = Math.round(ny * 127 + 128); px[j + 3] = Math.round(nz * 127 + 128);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      layers.push(x1 < 0 ? null : { px: px, x0: x0, y0: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    }
    return { vox: vox, layers: layers };
  }

  // The atlas: every slice of every stack in one RGBA texture (index, normal x, normal y, normal z), packed in rows.
  function Atlas(size) { this.size = size; this.data = new Uint8Array(size * size * 4); this.x = 1; this.y = 1; this.rowH = 0; this.used = 0; }
  Atlas.prototype.put = function (px, srcW, x0, y0, w, h) {
    if (this.x + w + 1 > this.size) { this.x = 1; this.y += this.rowH + 1; this.rowH = 0; }
    if (this.y + h + 1 > this.size) throw new Error('atlas full');
    for (let y = 0; y < h; y++) this.data.set(px.subarray(((y0 + y) * srcW + x0) * 4, ((y0 + y) * srcW + x0 + w) * 4), ((this.y + y) * this.size + this.x) * 4);
    const at = [this.x, this.y]; this.x += w + 1; if (h > this.rowH) this.rowH = h; this.used += w * h; return at;
  };

  // A stack ready to draw: for each kept layer its place in the atlas and its offset from the stack's axis.
  function buildStack(def, pal, atlas, shell) {
    const v = voxelise(def, pal, shell), st = { name: def.name, shell: shell, w: def.w, h: def.h, n: def.layers, slices: [], radius: Math.hypot(def.w, def.h) / 2, vox: v.vox };
    for (let z = 0; z < def.layers; z++) {
      const L = v.layers[z]; if (!L) continue;
      const at = atlas.put(L.px, def.w, L.x0, L.y0, L.w, L.h);
      // u, v, w, h in the atlas; ox, oy: the centre of the cropped slice, measured from the axis
      st.slices.push({ z: z, u: at[0], v: at[1], w: L.w, h: L.h, ox: L.x0 + L.w / 2 - def.w / 2, oy: L.y0 + L.h / 2 - def.h / 2 });
    }
    return st;
  }

  global.Art = { Palette: Palette, Atlas: Atlas, buildStack: buildStack };
})(window);
