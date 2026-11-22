// town.js: the demo scene. A small town block: houses round a paved square with a fountain, a ring road, trees,
// lamps, parked cars, and a few figures walking the square. Everything is a slice stack built by art.js.
// World units are art pixels: x and y on the ground, z up. The block is 320 x 256.
(function (global) {
  'use strict';
  const WORLD = { w: 320, h: 256 };

  function palette() {
    const P = new Art.Palette(), add = function (n, hex, glow) { P.add(n, hex, glow); };
    add('grass', '#86c46e'); add('grass2', '#79b862'); add('road', '#6a7180'); add('line', '#efe9cf');
    add('pave', '#d3cec2'); add('pave2', '#c4beb0'); add('kerb', '#aaa497');
    add('wallA', '#f3e6c6'); add('wallB', '#efbfb4'); add('wallC', '#b1d5ea'); add('wallD', '#bfe5c9'); add('wallE', '#f5e08e'); add('wallF', '#d2c0ea');
    add('roofR', '#cf5f45'); add('roofB', '#56759a'); add('roofG', '#7a9a62'); add('roofP', '#8f6aa8');
    add('window', '#4a6a8a', 0.9); add('frame', '#fcf8ef'); add('door', '#83502f'); add('chimney', '#9399a3');
    add('trunk', '#80603f'); add('leaf', '#56a35a'); add('leaf2', '#6cba6d'); add('blossom', '#f2a9c4');
    add('pole', '#454a59'); add('glow', '#fff0b0', 1);
    add('carR', '#d9534a'); add('carB', '#4680d0'); add('carY', '#efc440'); add('glass', '#a9cce4'); add('tyre', '#2e3038');
    add('stone', '#c2bfb7'); add('water', '#79cbe6'); add('wood', '#b17a47');
    // the figures (from the sprite-stack-animation kit)
    add('suit', '#dcd6c6'); add('trouser', '#7b8296'); add('pack', '#c24b42'); add('boot', '#e2b233'); add('dark', '#444a59');
    add('visor', '#1f2947'); add('glint', '#a9c2ec'); add('panel', '#48ae91');
    add('shell', '#7361c4'); add('trim', '#ebe6f5'); add('lens', '#f2c750', 0.6); add('joint', '#3f374d'); add('foot', '#bdb5ca'); add('lamp', '#f0608f', 0.8);
    return P;
  }

  // deterministic noise for speckle and leaves
  function hash(x, y, z) { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

  // ---------------------------------------------------------------- ground tiles (one layer each)
  function tiles() {
    const T = 32;
    return [
      { name: 'grass', w: T, h: T, layers: 1, fn: function (x, y) { return hash(Math.floor(x / 2), Math.floor(y / 2), 1) < 0.3 ? 'grass2' : 'grass'; } },
      { name: 'pave', w: T, h: T, layers: 1, fn: function (x, y) { const a = Math.floor(x + 16) % 8, b = Math.floor(y + 16) % 8; return a === 0 || b === 0 ? 'pave2' : 'pave'; } },
      { name: 'roadH', w: T, h: T, layers: 1, fn: function (x, y) { return Math.abs(y) > 14 ? 'kerb' : Math.abs(y) < 0.6 && Math.floor(x + 16) % 16 < 8 ? 'line' : 'road'; } },
      { name: 'roadV', w: T, h: T, layers: 1, fn: function (x, y) { return Math.abs(x) > 14 ? 'kerb' : Math.abs(x) < 0.6 && Math.floor(y + 16) % 16 < 8 ? 'line' : 'road'; } },
      { name: 'roadX', w: T, h: T, layers: 1, fn: function () { return 'road'; } }
    ];
  }

  // ---------------------------------------------------------------- houses: W along x, D along y, the door on the +y side
  function house(name, wall, roof, floors, style) {
    const W = 44, D = 34, FH = 20, body = floors * FH, hw = W / 2 - 1, hd = D / 2 - 1, roofH = style === 'flat' ? 4 : 13;
    return { name: name, w: W + 4, h: D + 4, layers: body + roofH + (style === 'flat' ? 0 : 5), fn: function (x, y, z) {
      const ax = Math.abs(x), ay = Math.abs(y);
      if (z < body) {
        if (ax > hw || ay > hd) return null;
        const zf = z % FH, onX = ax > hw - 1, onY = ay > hd - 1;
        if (onY && y > 0 && z < 15 && ax < 3.5) return ax > 2.5 || z > 13 ? 'frame' : 'door';          // the door
        if (onX || onY) {
          const along = onY ? x + hw : y + hd, m = ((Math.floor(along) % 10) + 10) % 10, win = zf >= 7 && zf <= 14 && m >= 3 && m <= 7;
          if (win && !(onY && y > 0 && z < FH && ax < 6)) return zf === 7 || zf === 14 || m === 3 || m === 7 ? 'frame' : 'window';
          if (zf === 0 && z > 0) return 'frame';                                                      // a band at each floor
        }
        return wall;
      }
      const r = z - body;
      if (style === 'flat') return ax <= hw + 1 && ay <= hd + 1 && (r < 1 || ax > hw - 1 || ay > hd - 1) ? 'frame' : (r < 1 ? roof : null);
      if (x > 8 && x < 13 && Math.abs(y - 5) < 2.5 && r < roofH + 5 && r > 2) return 'chimney';
      if (r >= roofH) return null;
      if (style === 'gable') return ax <= hw + 2 && ay <= hd + 2 - r * (hd + 2) / roofH ? (ax > hw ? 'frame' : roof) : null;
      return ax <= hw + 2 - r * 1.4 && ay <= hd + 2 - r * 1.4 ? roof : null;                           // hip
    } };
  }

  function props() {
    return [
      { name: 'tree', w: 22, h: 22, layers: 30, fn: function (x, y, z) {
        if (z < 12) return Math.hypot(x, y) < 1.7 ? 'trunk' : null;
        const d = Math.hypot(x, y, (z - 19) * 1.15) + hash(Math.floor(x / 2), Math.floor(y / 2), Math.floor(z / 2)) * 2.2; if (d > 9.5) return null;
        return hash(Math.floor(x), Math.floor(y), z) < 0.3 ? 'leaf2' : 'leaf';
      } },
      { name: 'blossom', w: 18, h: 18, layers: 24, fn: function (x, y, z) {
        if (z < 10) return Math.hypot(x, y) < 1.4 ? 'trunk' : null;
        const d = Math.hypot(x, y, (z - 15) * 1.2) + hash(Math.floor(x / 2), Math.floor(y / 2), Math.floor(z / 2)) * 2; if (d > 7.5) return null;
        return hash(Math.floor(x), Math.floor(y), z) < 0.45 ? 'blossom' : 'leaf2';
      } },
      { name: 'lamp', w: 7, h: 7, layers: 24, fn: function (x, y, z) { const d = Math.hypot(x, y); return z < 20 ? (d < 0.8 ? 'pole' : null) : z < 23 ? (d < 2.6 ? 'glow' : null) : d < 3 ? 'pole' : null; } },
      { name: 'fountain', w: 30, h: 30, layers: 12, fn: function (x, y, z) {
        const d = Math.hypot(x, y);
        if (z < 4) return d < 14 ? (d > 11.5 ? 'stone' : z < 3 ? 'water' : null) : null;
        if (z < 9) return d < 2 ? 'stone' : null;
        return d < (z === 9 ? 5 : 3.5) ? (z === 9 && d < 4 ? 'water' : 'stone') : null;
      } },
      { name: 'bench', w: 14, h: 6, layers: 6, fn: function (x, y, z) {
        const ax = Math.abs(x);
        if (z < 3) return ax > 4.5 && ax < 6 && Math.abs(y) < 2 ? 'pole' : null;
        if (z === 3) return ax < 6.5 && Math.abs(y) < 2.3 ? 'wood' : null;
        return ax < 6.5 && y < -1.4 && y > -2.4 ? 'wood' : null;
      } }
    ].concat(['carR', 'carB', 'carY'].map(function (c) {
      return { name: c, w: 24, h: 12, layers: 9, fn: function (x, y, z) {
        const ax = Math.abs(x), ay = Math.abs(y);
        if (z < 2) return (Math.abs(ax - 6.5) < 2 && ay > 3.6 && ay < 5.2) ? 'tyre' : null;
        if (z < 5) return ax < 11 && ay < 5 ? (z === 3 && ax > 10 && ay > 2.5 ? 'glow' : c) : null;
        if (x < -6.5 || x > 4.5 || ay > 4.4) return null;
        return z === 8 ? c : (ay > 3.4 || x < -5.5 || x > 3.5 ? 'glass' : c);
      } };
    }));
  }

  function stacks() {
    return tiles().concat(props(), [
      house('houseA', 'wallA', 'roofR', 2, 'gable'), house('houseB', 'wallB', 'roofB', 3, 'hip'), house('houseC', 'wallC', 'roofR', 2, 'hip'),
      house('houseD', 'wallD', 'roofP', 3, 'gable'), house('houseE', 'wallE', 'roofG', 2, 'flat'), house('houseF', 'wallF', 'roofB', 2, 'gable')
    ]);
  }

  // ---------------------------------------------------------------- where everything stands: [stack, x, y, angle]
  function layout() {
    const L = [], T = 32, put = function (n, x, y, a) { L.push([n, x, y, a || 0]); };
    for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 10; tx++) {
      const onH = (ty === 2 || ty === 5) && tx >= 1 && tx <= 8, onV = (tx === 1 || tx === 8) && ty >= 2 && ty <= 5;
      const inside = tx >= 2 && tx <= 7 && ty >= 3 && ty <= 4;
      put(onH && onV ? 'roadX' : onH ? 'roadH' : onV ? 'roadV' : inside ? 'pave' : (ty < 2 || ty > 5) && tx >= 1 && tx <= 8 && (ty === 1 || ty === 6) ? 'pave' : 'grass', tx * T + 16, ty * T + 16);
    }
    const top = ['houseA', 'houseB', 'houseC', 'houseD', 'houseE'], bottom = ['houseF', 'houseC', 'houseE', 'houseA', 'houseB'];
    for (let i = 0; i < 5; i++) { put(top[i], 56 + i * 52, 30, 0); put(bottom[i], 56 + i * 52, 226, Math.PI); }
    put('fountain', 160, 128);
    [[84, 104], [236, 104], [84, 152], [236, 152]].forEach(function (p, i) { put(i % 2 ? 'blossom' : 'tree', p[0], p[1], i); });
    [[14, 40], [14, 100], [16, 170], [12, 230], [306, 36], [304, 96], [308, 160], [304, 224], [120, 12], [200, 244]].forEach(function (p, i) { put(i % 3 === 1 ? 'blossom' : 'tree', p[0], p[1], i * 1.3); });
    [[70, 100], [250, 100], [70, 156], [250, 156], [160, 100], [160, 156]].forEach(function (p) { put('lamp', p[0], p[1]); });
    put('bench', 124, 100, 0); put('bench', 196, 100, 0); put('bench', 124, 156, Math.PI); put('bench', 196, 156, Math.PI);
    put('carR', 110, 74, 0); put('carB', 214, 86, Math.PI); put('carY', 150, 182, 0); put('carB', 44, 120, Math.PI / 2); put('carR', 276, 140, -Math.PI / 2);
    return L;
  }

  // lamps as lights for the night view: [x, y, z]
  const LAMPS = [[70, 100, 21], [250, 100, 21], [70, 156, 21], [250, 156, 21], [160, 100, 21], [160, 156, 21]];
  // walkers: [character, loop centre x, y, radius x, y, where on the loop it starts (0 to 1), direction]
  const WALKERS = [['explorer', 160, 128, 84, 20, 0, 1], ['explorer', 160, 128, 84, 20, 0.5, 1], ['robot', 160, 128, 58, 22, 0.2, -1], ['robot', 160, 128, 58, 22, 0.7, -1]];

  global.Town = { WORLD: WORLD, palette: palette, stacks: stacks, layout: layout, LAMPS: LAMPS, WALKERS: WALKERS };
})(window);
