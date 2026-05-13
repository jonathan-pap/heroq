// =====================================================================
// render-quest-maps.js
//
// Renders every quest in data/quests/*.json to a PNG in assets/map_qa/
// for visual QA without having to click through each quest in-game.
//
// No browser, no native deps — uses the already-installed `pngjs`
// against a raw RGBA buffer with a hand-baked 5x7 bitmap font.
//
// Run:  node scripts/render-quest-maps.js
//       node scripts/render-quest-maps.js quest1-trial   (single quest)
// =====================================================================

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const QUEST_DIR = path.join(__dirname, '..', 'data', 'quests');
const OUT_DIR   = path.join(__dirname, '..', 'assets', 'map_qa');
const ONLY      = process.argv[2] || null;   // optional bare quest id

const COLS = 26;
const ROWS = 19;
const CELL = 32;

const PAD_L = 36;
const PAD_T = 64;
const PAD_R = 16;
const PAD_B = 240;       // legend + monster/objective text

const BOARD_W = COLS * CELL;
const BOARD_H = ROWS * CELL;
const W = PAD_L + BOARD_W + PAD_R;
const H = PAD_T + BOARD_H + PAD_B;

// ---------- raw RGBA buffer + drawing primitives ----------------------

const buf = (function () {
  const b = Buffer.alloc(W * H * 4);
  return b;
})();

function reset(c) {
  for (let i = 0; i < W * H; i++) {
    buf[i * 4]     = c[0];
    buf[i * 4 + 1] = c[1];
    buf[i * 4 + 2] = c[2];
    buf[i * 4 + 3] = 255;
  }
}

function putPx(x, y, c) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  x = x | 0; y = y | 0;
  const i = (y * W + x) * 4;
  if (c.length === 4 && c[3] < 255) {
    const a = c[3] / 255;
    buf[i]     = Math.round(buf[i]     * (1 - a) + c[0] * a);
    buf[i + 1] = Math.round(buf[i + 1] * (1 - a) + c[1] * a);
    buf[i + 2] = Math.round(buf[i + 2] * (1 - a) + c[2] * a);
  } else {
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
  }
  buf[i + 3] = 255;
}

function fillRect(x, y, w, h, c) {
  const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
  const x1 = Math.min(W, (x + w) | 0), y1 = Math.min(H, (y + h) | 0);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) putPx(xx, yy, c);
  }
}

function strokeRect(x, y, w, h, c, thick) {
  thick = thick || 1;
  for (let t = 0; t < thick; t++) {
    fillRect(x + t, y + t, w - 2 * t, 1, c);
    fillRect(x + t, y + h - 1 - t, w - 2 * t, 1, c);
    fillRect(x + t, y + t, 1, h - 2 * t, c);
    fillRect(x + w - 1 - t, y + t, 1, h - 2 * t, c);
  }
}

function line(x0, y0, x1, y1, c) {
  // Bresenham
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    putPx(x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function thickLine(x0, y0, x1, y1, c, thick) {
  thick = thick || 1;
  // crude — stamp a small disc at each point
  const r = Math.floor(thick / 2);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    fillCircle(x0, y0, r, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function fillCircle(cx, cy, r, c) {
  for (let yy = -r; yy <= r; yy++) {
    for (let xx = -r; xx <= r; xx++) {
      if (xx * xx + yy * yy <= r * r) putPx(cx + xx, cy + yy, c);
    }
  }
}

function strokeCircle(cx, cy, r, c) {
  // Bresenham circle
  let x = r, y = 0, err = 0;
  while (x >= y) {
    putPx(cx + x, cy + y, c); putPx(cx + y, cy + x, c);
    putPx(cx - x, cy + y, c); putPx(cx - y, cy + x, c);
    putPx(cx + x, cy - y, c); putPx(cx + y, cy - x, c);
    putPx(cx - x, cy - y, c); putPx(cx - y, cy - x, c);
    y++;
    if (err <= 0) err += 2 * y + 1;
    if (err > 0)  { x--; err -= 2 * x + 1; }
  }
}

function fillTriangle(p0, p1, p2, c) {
  // sort by y
  const pts = [p0, p1, p2].slice().sort((a, b) => a[1] - b[1]);
  const [a, b, cc] = pts;
  function edgeX(p, q, y) {
    if (q[1] === p[1]) return p[0];
    return p[0] + (q[0] - p[0]) * (y - p[1]) / (q[1] - p[1]);
  }
  for (let y = Math.floor(a[1]); y <= Math.ceil(cc[1]); y++) {
    const xL = (y < b[1]) ? edgeX(a, b, y) : edgeX(b, cc, y);
    const xR = edgeX(a, cc, y);
    const x0 = Math.floor(Math.min(xL, xR));
    const x1 = Math.ceil(Math.max(xL, xR));
    fillRect(x0, y, x1 - x0 + 1, 1, c);
  }
}

// ---------- 5x7 bitmap font ------------------------------------------
//
// Every glyph is 5 wide × 7 tall. Stride (horizontal) is 6px (one px
// gap). Lowercase falls back to uppercase.
// '1' for ink, '.' for blank.

const FONT = {
  ' ': ['.....','.....','.....','.....','.....','.....','.....'],
  '!': ['..1..','..1..','..1..','..1..','..1..','.....','..1..'],
  "'": ['..1..','..1..','.....','.....','.....','.....','.....'],
  '"': ['.1.1.','.1.1.','.....','.....','.....','.....','.....'],
  '#': ['.1.1.','11111','.1.1.','11111','.1.1.','.....','.....'],
  '(': ['...1.','..1..','..1..','..1..','..1..','...1.','.....'],
  ')': ['.1...','..1..','..1..','..1..','..1..','.1...','.....'],
  '*': ['.....','.1.1.','..1..','.1.1.','.....','.....','.....'],
  '+': ['.....','..1..','.111.','..1..','.....','.....','.....'],
  ',': ['.....','.....','.....','.....','.....','..1..','.1...'],
  '-': ['.....','.....','.....','.111.','.....','.....','.....'],
  '.': ['.....','.....','.....','.....','.....','.....','..1..'],
  '/': ['....1','...1.','..1..','.1...','1....','.....','.....'],
  ':': ['.....','..1..','.....','.....','.....','..1..','.....'],
  ';': ['.....','..1..','.....','.....','..1..','.1...','.....'],
  '=': ['.....','.....','.111.','.....','.111.','.....','.....'],
  '?': ['.111.','1...1','...1.','..1..','..1..','.....','..1..'],
  '0': ['.111.','1...1','1..11','1.1.1','11..1','1...1','.111.'],
  '1': ['..1..','.11..','..1..','..1..','..1..','..1..','.111.'],
  '2': ['.111.','1...1','....1','...1.','..1..','.1...','11111'],
  '3': ['11111','...1.','..1..','...1.','....1','1...1','.111.'],
  '4': ['...1.','..11.','.1.1.','1..1.','11111','...1.','...1.'],
  '5': ['11111','1....','1111.','....1','....1','1...1','.111.'],
  '6': ['..11.','.1...','1....','1111.','1...1','1...1','.111.'],
  '7': ['11111','....1','...1.','..1..','.1...','.1...','.1...'],
  '8': ['.111.','1...1','1...1','.111.','1...1','1...1','.111.'],
  '9': ['.111.','1...1','1...1','.1111','....1','...1.','.11..'],
  'A': ['.111.','1...1','1...1','11111','1...1','1...1','1...1'],
  'B': ['1111.','1...1','1...1','1111.','1...1','1...1','1111.'],
  'C': ['.111.','1...1','1....','1....','1....','1...1','.111.'],
  'D': ['111..','1.1..','1..1.','1..1.','1..1.','1.1..','111..'],
  'E': ['11111','1....','1....','111..','1....','1....','11111'],
  'F': ['11111','1....','1....','111..','1....','1....','1....'],
  'G': ['.111.','1...1','1....','1.111','1...1','1...1','.111.'],
  'H': ['1...1','1...1','1...1','11111','1...1','1...1','1...1'],
  'I': ['.111.','..1..','..1..','..1..','..1..','..1..','.111.'],
  'J': ['..111','...1.','...1.','...1.','...1.','1..1.','.11..'],
  'K': ['1...1','1..1.','1.1..','11...','1.1..','1..1.','1...1'],
  'L': ['1....','1....','1....','1....','1....','1....','11111'],
  'M': ['1...1','11.11','1.1.1','1.1.1','1...1','1...1','1...1'],
  'N': ['1...1','1...1','11..1','1.1.1','1..11','1...1','1...1'],
  'O': ['.111.','1...1','1...1','1...1','1...1','1...1','.111.'],
  'P': ['1111.','1...1','1...1','1111.','1....','1....','1....'],
  'Q': ['.111.','1...1','1...1','1...1','1.1.1','1..1.','.11.1'],
  'R': ['1111.','1...1','1...1','1111.','1.1..','1..1.','1...1'],
  'S': ['.1111','1....','1....','.111.','....1','....1','1111.'],
  'T': ['11111','..1..','..1..','..1..','..1..','..1..','..1..'],
  'U': ['1...1','1...1','1...1','1...1','1...1','1...1','.111.'],
  'V': ['1...1','1...1','1...1','1...1','1...1','.1.1.','..1..'],
  'W': ['1...1','1...1','1...1','1.1.1','1.1.1','11.11','1...1'],
  'X': ['1...1','1...1','.1.1.','..1..','.1.1.','1...1','1...1'],
  'Y': ['1...1','1...1','.1.1.','..1..','..1..','..1..','..1..'],
  'Z': ['11111','....1','...1.','..1..','.1...','1....','11111'],
};

function drawText(x, y, str, c, scale) {
  scale = scale || 1;
  const stride = 6 * scale;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i].toUpperCase();
    const g = FONT[ch] || FONT['?'];
    for (let r = 0; r < 7; r++) {
      for (let cc = 0; cc < 5; cc++) {
        if (g[r][cc] === '1') {
          fillRect(x + i * stride + cc * scale, y + r * scale, scale, scale, c);
        }
      }
    }
  }
}

function textWidth(str, scale) {
  scale = scale || 1;
  return str.length * 6 * scale - scale;
}

// ---------- color palette --------------------------------------------

const C = {
  bg:        [240, 232, 210],
  title:     [40, 30, 20],
  outOfPlay: [40, 30, 20],          // dark cells (solid rock around the dungeon outline)
  floor:     [225, 210, 175],       // playable floor
  blocked:   [120, 105, 90],        // rubble (visible-once-seen blocked cell)
  blockedX:  [70, 55, 45],
  grid:      [200, 180, 140],
  start:     [180, 220, 255],       // hero start cells
  stair:     [140, 190, 230],
  startBdr:  [60, 110, 180],
  door:      [170, 110, 50],
  doorBdr:   [80, 50, 20],
  secretDoor:[200, 40, 200],
  trap:      [220, 30, 30],
  treasure:  [240, 200, 60],
  treasureBdr:[140, 100, 0],
  npc:       [60, 200, 90],
  legend:    [30, 30, 30],
  facing:    [50, 50, 50],

  // furniture (stable per type — avoid clashing with monster colors)
  furn: {
    'tomb':            [110, 90, 70],
    'sorcerer-table':  [120, 60, 160],
    'alchemist-table': [180, 60, 100],
    'table':           [150, 105, 60],
    'bookcase':        [80, 60, 40],
    'cupboard':        [110, 80, 50],
    'fireplace':       [200, 80, 30],
    'weapon-rack':     [80, 80, 100],
    'rack':            [80, 80, 100],
    'chest':           [180, 140, 60],
    'throne':          [120, 60, 120],
    'altar':           [200, 200, 220],
    'stairway':        [70, 130, 200],
    'door':            [170, 110, 50],
    'block':           [110, 105, 90],
  },
};

const FURN_LABEL = {
  'tomb':            'TOMB',
  'sorcerer-table':  'SORC',
  'alchemist-table': 'ALCH',
  'table':           'TBL',
  'bookcase':        'BOOK',
  'cupboard':        'CUPB',
  'fireplace':       'FIRE',
  'weapon-rack':     'RACK',
  'rack':            'RACK',
  'chest':           'CH',
  'throne':          'THRN',
  'altar':           'ALTR',
  'stairway':        'STRS',
  'block':           'BLOK',
};

// monster type → color (tries to match in-game vibes)
const MONSTER_C = {
  'goblin':         [80, 160, 60],
  'orc':            [50, 120, 50],
  'fimir':          [180, 80, 40],
  'skeleton':       [240, 240, 220],
  'zombie':         [130, 150, 100],
  'mummy':          [200, 180, 130],
  'chaos-warrior':  [60, 60, 80],
  'chaos-sorcerer': [120, 40, 160],
  'gargoyle':       [90, 90, 110],
  'dread-warrior':  [40, 40, 60],
  'abomination':    [160, 30, 30],
  'verag':          [70, 70, 130],
};
const MONSTER_LETTER = {
  'goblin':'G', 'orc':'O', 'fimir':'F', 'skeleton':'S', 'zombie':'Z',
  'mummy':'M', 'chaos-warrior':'C', 'chaos-sorcerer':'X',
  'gargoyle':'V', 'dread-warrior':'D', 'abomination':'A',
};

// ---------- board rendering -------------------------------------------

function cellPx(c, r) {
  return [PAD_L + c * CELL, PAD_T + r * CELL];
}

function drawBoardBackground(quest) {
  // base — out-of-play
  fillRect(PAD_L, PAD_T, BOARD_W, BOARD_H, C.outOfPlay);

  // dark cells: explicit out-of-play list
  const isDark = new Set();
  for (const [c, r] of (quest.dark || [])) isDark.add(c + ',' + r);

  // floor for everything not dark
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!isDark.has(c + ',' + r)) {
        const [x, y] = cellPx(c, r);
        fillRect(x, y, CELL, CELL, C.floor);
      }
    }
  }

  // start cells (hero start = stairway tile usually) — soft blue overlay
  const starts = quest.startCells || quest.stairCells || [];
  for (const [c, r] of starts) {
    const [x, y] = cellPx(c, r);
    fillRect(x, y, CELL, CELL, C.start);
  }
  // border the stair block
  if (starts.length) {
    let mn = [99, 99], mx = [-1, -1];
    for (const [c, r] of starts) {
      if (c < mn[0]) mn[0] = c; if (r < mn[1]) mn[1] = r;
      if (c > mx[0]) mx[0] = c; if (r > mx[1]) mx[1] = r;
    }
    const [x, y] = cellPx(mn[0], mn[1]);
    strokeRect(x, y, (mx[0] - mn[0] + 1) * CELL, (mx[1] - mn[1] + 1) * CELL,
               C.startBdr, 2);
    drawText(x + 4, y + 4, 'START', C.startBdr, 1);
  }

  // blocked cells (rubble — visible obstacle)
  for (const [c, r] of (quest.blocked || [])) {
    const [x, y] = cellPx(c, r);
    fillRect(x + 2, y + 2, CELL - 4, CELL - 4, C.blocked);
    line(x + 4, y + 4, x + CELL - 5, y + CELL - 5, C.blockedX);
    line(x + CELL - 5, y + 4, x + 4, y + CELL - 5, C.blockedX);
  }

  // grid lines (only between non-dark cells, subtle)
  for (let r = 0; r <= ROWS; r++) {
    fillRect(PAD_L, PAD_T + r * CELL, BOARD_W, 1, C.grid);
  }
  for (let c = 0; c <= COLS; c++) {
    fillRect(PAD_L + c * CELL, PAD_T, 1, BOARD_H, C.grid);
  }

  // outer border
  strokeRect(PAD_L, PAD_T, BOARD_W, BOARD_H, [60, 50, 30], 2);
}

function drawColRowLabels() {
  // top row — every col, small
  for (let c = 0; c < COLS; c++) {
    const x = PAD_L + c * CELL + Math.floor(CELL / 2) - 5;
    drawText(x, PAD_T - 11, String(c + 1), C.title, 1);
  }
  // left side — every row
  for (let r = 0; r < ROWS; r++) {
    const y = PAD_T + r * CELL + Math.floor(CELL / 2) - 3;
    const lbl = String(r + 1);
    drawText(PAD_L - 6 - textWidth(lbl, 1), y, lbl, C.title, 1);
  }
}

function drawFurnPiece(f) {
  const cells = f.cells || [];
  if (!cells.length) return;
  let minC = 99, minR = 99, maxC = -1, maxR = -1;
  for (const [c, r] of cells) {
    if (c < minC) minC = c; if (r < minR) minR = r;
    if (c > maxC) maxC = c; if (r > maxR) maxR = r;
  }
  const [x, y] = cellPx(minC, minR);
  const w = (maxC - minC + 1) * CELL;
  const h = (maxR - minR + 1) * CELL;
  const color = C.furn[f.type] || [150, 150, 150];

  // soft fill + border
  fillRect(x + 3, y + 3, w - 6, h - 6, color);
  strokeRect(x + 3, y + 3, w - 6, h - 6, [40, 30, 20], 2);

  // facing arrow (small triangle inside the bbox)
  drawFacingArrow(x + w / 2, y + h / 2, Math.min(w, h) * 0.3, f.facing, [255, 255, 255]);

  // type label, small, centered top-left corner
  const lbl = FURN_LABEL[f.type] || (f.type || '').slice(0, 4).toUpperCase();
  const tx = x + Math.floor((w - textWidth(lbl, 1)) / 2);
  const ty = y + h - 12;
  // text shadow
  drawText(tx + 1, ty + 1, lbl, [0, 0, 0], 1);
  drawText(tx, ty, lbl, [255, 255, 255], 1);
}

function drawFacingArrow(cx, cy, size, facing, color) {
  if (!facing) return;
  let dx = 0, dy = 0;
  switch (facing) {
    case 'downward':  dy =  1; break;
    case 'upward':    dy = -1; break;
    case 'leftward':  dx = -1; break;
    case 'rightward': dx =  1; break;
    default: return;
  }
  const tip = [cx + dx * size, cy + dy * size];
  // perpendicular
  const px = -dy, py = dx;
  const base1 = [cx - dx * size * 0.5 + px * size * 0.5,
                 cy - dy * size * 0.5 + py * size * 0.5];
  const base2 = [cx - dx * size * 0.5 - px * size * 0.5,
                 cy - dy * size * 0.5 - py * size * 0.5];
  fillTriangle(tip, base1, base2, color);
}

function drawDoor(d, secret) {
  const [a, b] = [d.a, d.b];
  const [ax, ay] = cellPx(a[0], a[1]);
  const [bx, by] = cellPx(b[0], b[1]);
  const cx = (ax + bx + CELL) / 2;
  const cy = (ay + by + CELL) / 2;
  const horizontal = (a[1] === b[1]); // cells side-by-side -> wall is vertical
  const color    = secret ? C.secretDoor : C.door;
  const colorBdr = secret ? [100, 0, 100] : C.doorBdr;

  if (horizontal) {
    // vertical wall: door rect centered on the shared edge
    const x = Math.round(cx) - 4;
    const y = Math.round(cy) - 12;
    fillRect(x, y, 8, 24, color);
    strokeRect(x, y, 8, 24, colorBdr, 1);
    if (secret) {
      // hatch
      for (let i = 0; i < 24; i += 4) line(x, y + i, x + 8, y + i + 4, colorBdr);
    }
  } else {
    // horizontal wall: door rect along the shared edge
    const x = Math.round(cx) - 12;
    const y = Math.round(cy) - 4;
    fillRect(x, y, 24, 8, color);
    strokeRect(x, y, 24, 8, colorBdr, 1);
    if (secret) {
      for (let i = 0; i < 24; i += 4) line(x + i, y, x + i + 4, y + 8, colorBdr);
    }
  }
}

function drawTrap(t) {
  if (!t || !t.at) return;
  const [c, r] = t.at;
  const [x, y] = cellPx(c, r);
  const cx = x + CELL / 2, cy = y + CELL / 2;
  // red triangle warning
  fillTriangle([cx, cy - 9], [cx - 9, cy + 7], [cx + 9, cy + 7], C.trap);
  fillRect(cx - 1, cy - 4, 2, 6, [255, 255, 255]);
  fillRect(cx - 1, cy + 4, 2, 2, [255, 255, 255]);
  // type letter
  const tk = t.kind || t.type || 'T';
  const lbl = String(tk)[0].toUpperCase();
  drawText(cx - 2, cy + 9, lbl, C.trap, 1);
}

function drawTreasure(t) {
  const [c, r] = t.at;
  const [x, y] = cellPx(c, r);
  const cx = x + CELL / 2, cy = y + CELL / 2;
  fillCircle(cx, cy, 7, C.treasure);
  strokeCircle(cx, cy, 7, C.treasureBdr);
  // amount
  if (t.amount != null) {
    const lbl = String(t.amount);
    drawText(cx - textWidth(lbl, 1) / 2, cy - 3, lbl, [50, 30, 0], 1);
  } else {
    drawText(cx - 2, cy - 3, '$', [50, 30, 0], 1);
  }
}

function drawMonster(m) {
  const [c, r] = m.at;
  const [x, y] = cellPx(c, r);
  const cx = x + CELL / 2, cy = y + CELL / 2;
  const col = MONSTER_C[m.type] || [200, 60, 60];
  fillCircle(cx, cy, 10, col);
  strokeCircle(cx, cy, 10, [20, 20, 20]);
  const ltr = (m.name && m.name[0]) || MONSTER_LETTER[m.type] || (m.type || '?')[0];
  const lbl = ltr.toUpperCase();
  // contrast text
  const isDark = (col[0] + col[1] + col[2]) < 380;
  const tcol = isDark ? [255, 255, 255] : [0, 0, 0];
  drawText(cx - 2, cy - 3, lbl, tcol, 1);
}

function drawNpc(n) {
  if (!n || !n.at) return;
  const [c, r] = n.at;
  const [x, y] = cellPx(c, r);
  const cx = x + CELL / 2, cy = y + CELL / 2;
  fillCircle(cx, cy, 10, C.npc);
  strokeCircle(cx, cy, 10, [20, 60, 30]);
  drawText(cx - 2, cy - 3, 'N', [20, 40, 20], 1);
}

// ---------- header / footer ------------------------------------------

function drawHeader(quest) {
  const title = (quest.title || quest.id || '?').toUpperCase();
  const sub   = (quest.subtitle || '').toUpperCase();
  drawText(PAD_L, 12, title, C.title, 3);
  if (sub) {
    drawText(PAD_L, 40, sub, [80, 70, 50], 2);
  }
  // id top-right
  const idLbl = (quest.id || '').toUpperCase();
  drawText(W - PAD_R - textWidth(idLbl, 1), 14, idLbl, [120, 110, 90], 1);
}

function drawLegendAndFacts(quest) {
  const top = PAD_T + BOARD_H + 12;
  let y = top;
  const lh = 11;

  // Two columns
  const colW = Math.floor((W - PAD_L - PAD_R) / 2);
  const leftX  = PAD_L;
  const rightX = PAD_L + colW;

  // ---- LEFT: counts + objective ----
  drawText(leftX, y, 'OBJECTIVE', C.title, 2); y += 16;
  const obj = quest.objective || {};
  const objText = (obj.text || '').toUpperCase();
  y = wrapText(leftX, y, colW - 8, objText, C.legend, 1, lh);
  y += 4;
  drawText(leftX, y, 'WANDERING: ' + (quest.wanderingMonster || '?').toUpperCase(),
           C.legend, 1); y += lh;
  drawText(leftX, y,
    'CHESTS:'+(quest.treasure||[]).length+
    '  TRAPS:'+(quest.traps||[]).length+
    '  SECRET:'+(quest.secretDoors||[]).length+
    '  DOORS:'+(quest.doors||[]).length, C.legend, 1);
  y += lh;
  drawText(leftX, y,
    'MONSTERS:'+(quest.monsters||[]).length+
    '  FURNITURE:'+(quest.furniture||[]).length+
    '  RUBBLE:'+(quest.blocked||[]).length, C.legend, 1);
  y += lh + 2;

  if (quest._quirks && quest._quirks.length) {
    drawText(leftX, y, 'QUIRKS', C.title, 2); y += 14;
    for (const q of quest._quirks.slice(0, 6)) {
      y = wrapText(leftX, y, colW - 8, q.toUpperCase(), C.legend, 1, lh);
      y += 2;
      if (y > H - 16) break;
    }
  }

  // ---- RIGHT: legend swatches ----
  let ry = top;
  drawText(rightX, ry, 'LEGEND', C.title, 2); ry += 16;
  const swatches = [
    ['floor',  C.floor,    'PLAYABLE FLOOR'],
    ['dark',   C.outOfPlay,'OUT OF PLAY (DARK)'],
    ['rubble', C.blocked,  'RUBBLE / BLOCKED'],
    ['start',  C.start,    'HERO START / STAIRWAY'],
    ['door',   C.door,     'DOOR'],
    ['secret', C.secretDoor,'SECRET DOOR'],
    ['trap',   C.trap,     'TRAP'],
    ['chest',  C.treasure, 'TREASURE'],
    ['npc',    C.npc,      'FRIENDLY NPC'],
  ];
  for (const [, col, lbl] of swatches) {
    fillRect(rightX, ry, 14, 10, col);
    strokeRect(rightX, ry, 14, 10, [60, 50, 30], 1);
    drawText(rightX + 20, ry + 1, lbl, C.legend, 1);
    ry += 13;
  }
  ry += 4;
  drawText(rightX, ry, 'MONSTER LETTERS', C.title, 1); ry += 10;
  let mi = 0;
  const mLetters = Object.entries(MONSTER_LETTER);
  for (const [t, l] of mLetters) {
    const mx = rightX + (mi % 4) * 90;
    const my = ry + Math.floor(mi / 4) * 11;
    fillCircle(mx + 4, my + 4, 4, MONSTER_C[t] || [200, 60, 60]);
    drawText(mx + 12, my + 1, l + ' ' + t.toUpperCase(), C.legend, 1);
    mi++;
  }
}

function wrapText(x, y, maxW, text, color, scale, lh) {
  const words = (text || '').split(/\s+/).filter(Boolean);
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (textWidth(test, scale) > maxW) {
      drawText(x, y, line, color, scale);
      y += lh;
      line = w;
    } else {
      line = test;
    }
  }
  if (line) { drawText(x, y, line, color, scale); y += lh; }
  return y;
}

// ---------- main loop ------------------------------------------------

function renderQuest(file) {
  const quest = JSON.parse(fs.readFileSync(file, 'utf8'));
  reset(C.bg);
  drawHeader(quest);
  drawColRowLabels();
  drawBoardBackground(quest);

  // furniture first, then doors on top, then treasure/traps, then monsters/npc
  for (const f of quest.furniture || []) drawFurnPiece(f);
  for (const d of quest.doors || [])      drawDoor(d, false);
  for (const d of quest.secretDoors || []) drawDoor(d, true);
  for (const t of quest.traps || [])      drawTrap(t);
  for (const t of quest.treasure || [])   drawTreasure(t);
  for (const m of quest.monsters || [])   drawMonster(m);
  if (quest.friendlyNpc) drawNpc(quest.friendlyNpc);

  drawLegendAndFacts(quest);

  const png = new PNG({ width: W, height: H });
  buf.copy(png.data);
  const out = path.join(OUT_DIR, path.basename(file).replace(/\.json$/, '.png'));
  fs.writeFileSync(out, PNG.sync.write(png));
  return out;
}

function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const files = fs.readdirSync(QUEST_DIR)
    .filter(f => f.endsWith('.json'))
    .filter(f => !ONLY || f.startsWith(ONLY));

  if (!files.length) {
    console.error('No quest JSON found' + (ONLY ? ' for ' + ONLY : ''));
    process.exit(1);
  }
  // natural sort: quest1, quest2, …, quest10
  files.sort((a, b) => {
    const na = parseInt((a.match(/quest(\d+)/) || [])[1] || 999);
    const nb = parseInt((b.match(/quest(\d+)/) || [])[1] || 999);
    return na - nb;
  });

  for (const f of files) {
    const out = renderQuest(path.join(QUEST_DIR, f));
    console.log('wrote', path.relative(path.join(__dirname, '..'), out));
  }

  // index.html for easy browsing
  const idx = files.map(f => f.replace(/\.json$/, '.png'));
  const html = `<!doctype html>
<meta charset="utf-8">
<title>HeroQuest map QA</title>
<style>
  body{background:#222;color:#eee;font-family:system-ui,sans-serif;margin:0;padding:16px}
  h1{margin:0 0 12px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(560px,1fr));gap:12px}
  figure{margin:0;background:#111;border:1px solid #333;padding:8px}
  img{width:100%;height:auto;display:block;image-rendering:pixelated}
  figcaption{padding:6px 0 0;font-size:13px;color:#bbb}
</style>
<h1>HeroQuest map QA — ${idx.length} quest${idx.length === 1 ? '' : 's'}</h1>
<div class="grid">
${idx.map(p => `  <figure><img src="${p}" alt="${p}"><figcaption>${p}</figcaption></figure>`).join('\n')}
</div>
`;
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html);
  console.log('wrote', path.relative(path.join(__dirname, '..'),
    path.join(OUT_DIR, 'index.html')));
}

main();
