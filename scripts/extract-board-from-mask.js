// =====================================================================
// extract-board-from-mask.js
//
// Extracts the canonical 1989/2021 HeroQuest 26x19 grid from a RED-MASK
// reference image (assets/board/board3.png) where every room cell is
// painted solid red and every corridor cell is the stone tile pattern.
// This is a pure binary signal — far more reliable than texture-based
// extraction from the photo or render.
//
// Output (drop-in):
//   data/board/board.yaml              new master board YAML
//   _reference/board3-extracted.txt    ASCII preview
//   _reference/board3-extracted-debug.png   colour overlay for review
//
// Run:  node scripts/extract-board-from-mask.js
// =====================================================================

const fs = require('fs');
const path = require('path');
const PNG = require('pngjs').PNG;

const IN  = path.join(__dirname, '..', 'assets', 'board', 'board3.png');
const REF_DIR = path.join(__dirname, '..', '_reference');
const OUT_ASCII = path.join(REF_DIR, 'board3-extracted.txt');
const OUT_DEBUG = path.join(REF_DIR, 'board3-extracted-debug.png');
const OUT_YAML  = path.join(__dirname, '..', 'data', 'board', 'board.yaml');

if (!fs.existsSync(REF_DIR)) fs.mkdirSync(REF_DIR, { recursive: true });

const COLS = 26;
const ROWS = 19;

const png = PNG.sync.read(fs.readFileSync(IN));
const W = png.width, H = png.height;
const data = png.data;

function px(x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return { r: 0, g: 0, b: 0 };
  const i = (y * W + x) * 4;
  return { r: data[i], g: data[i+1], b: data[i+2] };
}

// Red room test — solid blood red. Tolerant of slight JPEG-style
// variation but rejects stone tones (R, G, B all close).
function isRed(p) {
  return p.r > 110 && p.g < 80 && p.b < 80 && (p.r - p.g) > 50 && (p.r - p.b) > 50;
}

// ---------------------------------------------------------------------
// 1. Find the playable bounding box by scanning for the first/last
//    column/row that contains any red pixel. The picture frame is
//    stone-textured (no red), and the playable area is dominated by
//    red-room rectangles, so red presence is a clean signal.
// ---------------------------------------------------------------------
function findRedBox() {
  let top = H, bottom = -1, left = W, right = -1;
  // Sample sparse grid of pixels for speed
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      if (isRed(px(x, y))) {
        if (x < left) left = x; if (x > right) right = x;
        if (y < top) top = y;   if (y > bottom) bottom = y;
      }
    }
  }
  return { left, right, top, bottom };
}
const redBox = findRedBox();
console.log(`red bounds: ${redBox.left},${redBox.top}-${redBox.right},${redBox.bottom}`);

// The red bounds give us the OUTERMOST red pixel — i.e., the OUTSIDE
// edges of the OUTERMOST rooms in the playable area. Outside that
// outermost-room edge there is exactly ONE cell of stone-corridor
// border, then the picture frame. So the playable bbox extends one
// cell beyond the red bounds in each direction.
//
// We don't yet know the precise cell width, so estimate from the
// red-box width / something close to the room-area width. The standard
// HQ board has the rooms occupy ~24×17 cells of the 26×19 grid (with
// one outer corridor cell on each side). The red bounds bracket the
// outermost red pixels — these may not be exactly at the cell boundary
// but very close.
//
// Empirical: the playable 26×19 board is centred in the image with a
// roughly uniform picture frame. We compute cell size from the red
// bounds and add one cell of corridor on each side.

const interiorW = redBox.right - redBox.left + 1;
const interiorH = redBox.bottom - redBox.top + 1;
// Rooms span ≤ 24 cells horizontally and ≤ 17 vertically (the
// perimeter is corridor on the canonical board).
const cellW = interiorW / 24;
const cellH = interiorH / 17;
const top    = Math.round(redBox.top    - cellH);
const bottom = Math.round(redBox.bottom + cellH);
const left   = Math.round(redBox.left   - cellW);
const right  = Math.round(redBox.right  + cellW);
console.log(`board bbox ${left},${top}-${right},${bottom}, cell ${cellW.toFixed(1)}x${cellH.toFixed(1)}`);

// ---------------------------------------------------------------------
// 2. Classify each cell — sample 9 points around the centre and call
//    the cell "room" if a majority are red. Robust to grid lines and
//    JPEG noise.
// ---------------------------------------------------------------------
function cellIsRoom(c, r) {
  const cx = left + (c + 0.5) * cellW;
  const cy = top  + (r + 0.5) * cellH;
  // 5x5 grid spanning ±25% of cell size
  let red = 0, total = 0;
  const sx = Math.max(2, Math.floor(cellW * 0.20));
  const sy = Math.max(2, Math.floor(cellH * 0.20));
  for (let dy = -sy; dy <= sy; dy += Math.max(1, Math.floor(sy / 2))) {
    for (let dx = -sx; dx <= sx; dx += Math.max(1, Math.floor(sx / 2))) {
      if (isRed(px(Math.round(cx + dx), Math.round(cy + dy)))) red++;
      total++;
    }
  }
  return red >= total * 0.5;
}

const grid = [];
for (let r = 0; r < ROWS; r++) {
  const row = [];
  for (let c = 0; c < COLS; c++) {
    row.push(cellIsRoom(c, r) ? 'room' : 'corridor');
  }
  grid.push(row);
}

// ---------------------------------------------------------------------
// 3a. Wall detection between two cells. board3.png shows thin stone
//     bands AT cell boundaries between adjacent rooms (not full
//     corridor cells). Sample a strip exactly at the geometric
//     midpoint between cell centres — if any non-red pixels appear
//     along that line, there's a wall.
// ---------------------------------------------------------------------
// White/cream wall test — board3.png renders inter-room walls as
// distinctive WHITE-CREAM thin lines (not stone-coloured corridor
// cells). Look for bright pixels at the boundary midpoint.
function isWhitish(p) {
  return p.r > 180 && p.g > 170 && p.b > 160 && Math.abs(p.r - p.g) < 40;
}

function wallAt(c1, r1, c2, r2) {
  if (grid[r1][c1] !== 'room' || grid[r2][c2] !== 'room') return false;
  const x1 = left + (c1 + 0.5) * cellW, y1 = top + (r1 + 0.5) * cellH;
  const x2 = left + (c2 + 0.5) * cellW, y2 = top + (r2 + 0.5) * cellH;
  const mx = Math.round((x1 + x2) / 2);
  const my = Math.round((y1 + y2) / 2);
  const horizontal = (r1 === r2);
  // Count pixels along the boundary mid-line that are EITHER white-ish
  // (the wall colour in board3.png) OR unambiguously non-red. A real
  // wall is solid white across the full boundary span; an open red
  // boundary has barely any white.
  let wallish = 0, total = 0;
  if (horizontal) {
    const halfH = Math.floor(cellH * 0.42);
    for (let dy = -halfH; dy <= halfH; dy++) {
      // Look in a small perpendicular band (the wall might be ±2px
      // off the geometric midpoint due to drawing artefacts).
      let hit = false;
      for (let dx = -3; dx <= 3; dx++) {
        const p = px(mx + dx, my + dy);
        if (isWhitish(p)) { hit = true; break; }
      }
      if (hit) wallish++;
      total++;
    }
  } else {
    const halfW = Math.floor(cellW * 0.42);
    for (let dx = -halfW; dx <= halfW; dx++) {
      let hit = false;
      for (let dy = -3; dy <= 3; dy++) {
        const p = px(mx + dx, my + dy);
        if (isWhitish(p)) { hit = true; break; }
      }
      if (hit) wallish++;
      total++;
    }
  }
  // A genuine white wall covers most of the boundary; texture leaks <10%.
  return wallish / total > 0.30;
}

// ---------------------------------------------------------------------
// 3b. Flood-fill room cells, BUT only across boundaries with no wall.
// ---------------------------------------------------------------------
const roomId = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
const roomCells = {};
let nextId = 1;
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    if (grid[r][c] !== 'room' || roomId[r][c] != null) continue;
    const id = nextId++;
    const cells = [];
    const stack = [[r, c]];
    roomId[r][c] = id;
    while (stack.length) {
      const [cr, cc] = stack.pop();
      cells.push([cc, cr]);
      for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
        const nr = cr + dr, nc = cc + dc;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
        if (grid[nr][nc] !== 'room' || roomId[nr][nc] != null) continue;
        if (wallAt(cc, cr, nc, nr)) continue;     // wall blocks merge
        roomId[nr][nc] = id;
        stack.push([nr, nc]);
      }
    }
    roomCells[id] = cells;
  }
}
const finalRoomCount = nextId - 1;
console.log(`detected ${finalRoomCount} rooms`);

// ---------------------------------------------------------------------
// 4. ASCII preview.
// ---------------------------------------------------------------------
const GLYPHS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ascii = [];
for (let r = 0; r < ROWS; r++) {
  let line = '';
  for (let c = 0; c < COLS; c++) {
    if (grid[r][c] === 'corridor') { line += '.'; continue; }
    const id = roomId[r][c];
    line += GLYPHS[(id - 1) % GLYPHS.length];
  }
  ascii.push(line);
}
const txt = ascii.join('\n');
fs.writeFileSync(OUT_ASCII, txt + '\n', 'utf8');

// ---------------------------------------------------------------------
// 5. Debug PNG — original image + cell-classification overlay.
// ---------------------------------------------------------------------
const debugPNG = new PNG({ width: W, height: H });
debugPNG.data.set(data);
function tint(cx0, cy0, cx1, cy1, [r, g, b], alpha = 0.45) {
  for (let y = cy0; y < cy1; y++) {
    for (let x = cx0; x < cx1; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = (y * W + x) * 4;
      debugPNG.data[i]     = Math.round(debugPNG.data[i]     * (1 - alpha) + r * alpha);
      debugPNG.data[i + 1] = Math.round(debugPNG.data[i + 1] * (1 - alpha) + g * alpha);
      debugPNG.data[i + 2] = Math.round(debugPNG.data[i + 2] * (1 - alpha) + b * alpha);
    }
  }
}
const ROOM_HUES = [
  [255, 80, 80], [80, 255, 120], [80, 120, 255], [255, 200, 80],
  [255, 80, 255], [80, 255, 255], [255, 150, 80], [200, 255, 80],
  [150, 80, 255], [255, 255, 80], [80, 255, 150], [255, 80, 150],
  [150, 220, 255], [255, 220, 150], [220, 255, 80], [80, 200, 255],
  [255, 150, 220], [200, 255, 200], [80, 255, 80],  [255, 100, 100], [150, 255, 255],
  [255, 200, 200], [200, 200, 255], [255, 255, 200], [200, 255, 255],
];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const cx0 = Math.round(left + c * cellW);
    const cy0 = Math.round(top  + r * cellH);
    const cx1 = Math.round(left + (c + 1) * cellW);
    const cy1 = Math.round(top  + (r + 1) * cellH);
    let colour;
    if (grid[r][c] === 'corridor') colour = [80, 80, 80];
    else colour = ROOM_HUES[((roomId[r][c] || 1) - 1) % ROOM_HUES.length];
    tint(cx0 + 4, cy0 + 4, cx1 - 4, cy1 - 4, colour, 0.45);
  }
}
fs.writeFileSync(OUT_DEBUG, PNG.sync.write(debugPNG));

// ---------------------------------------------------------------------
// 6. Compute average room colour by sampling the SAME cell positions
//    on board.jpg or board2.png so the YAML still has visible per-room
//    floor colours (the red mask itself isn't useful for rendering).
// ---------------------------------------------------------------------
function loadColourSourceIfAvailable() {
  const candidates = [
    path.join(__dirname, '..', 'assets', 'board', 'board2.png'),
    path.join(__dirname, '..', 'assets', 'board', 'board.jpg'),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    if (p.endsWith('.png')) {
      const im = PNG.sync.read(fs.readFileSync(p));
      return { data: im.data, W: im.width, H: im.height, source: p };
    } else {
      const jpeg = require('jpeg-js');
      const im = jpeg.decode(fs.readFileSync(p), { useTArray: true });
      return { data: im.data, W: im.width, H: im.height, source: p };
    }
  }
  return null;
}
const colourSrc = loadColourSourceIfAvailable();

function pickColourFor(cells) {
  if (!colourSrc) return '#7a4a1c';  // fallback brown
  // Map our cell coords to the source image's coord space proportionally.
  const sxScale = colourSrc.W / W;
  const syScale = colourSrc.H / H;
  let sR = 0, sG = 0, sB = 0, n = 0;
  for (const [c, r] of cells) {
    const cx = (left + (c + 0.5) * cellW) * sxScale;
    const cy = (top  + (r + 0.5) * cellH) * syScale;
    const i = (Math.round(cy) * colourSrc.W + Math.round(cx)) * 4;
    if (i + 2 >= colourSrc.data.length) continue;
    sR += colourSrc.data[i];
    sG += colourSrc.data[i + 1];
    sB += colourSrc.data[i + 2];
    n++;
  }
  if (n === 0) return '#7a4a1c';
  const r = Math.round(sR / n), g = Math.round(sG / n), b = Math.round(sB / n);
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------
// 7. YAML output — drop-in replacement for data/board/board.yaml.
// ---------------------------------------------------------------------
let yaml = '# AUTO-GENERATED from assets/board/board3.png (red-mask reference)\n';
yaml += '# via scripts/extract-board-from-mask.js — re-run to regenerate.\n';
yaml += '#\n';
yaml += '# board3.png is a clean binary mask of the canonical 1989/2021\n';
yaml += '# HeroQuest board: every ROOM cell is solid red, every CORRIDOR\n';
yaml += '# cell is stone-textured. This gives a pixel-perfect cell\n';
yaml += '# classification, far more reliable than texture-based methods\n';
yaml += '# applied to board.jpg or board2.png.\n';
yaml += `# Detected: ${finalRoomCount} rooms.\n\n`;
yaml += `boardSize: [${COLS}, ${ROWS}]\n\n`;
yaml += 'corridor:\n  cells:\n';
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    if (grid[r][c] === 'corridor') yaml += `    - [${c}, ${r}]\n`;
  }
}
yaml += '\nrooms:\n';
for (let id = 1; id <= finalRoomCount; id++) {
  const cells = roomCells[id];
  let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
  for (const [c, r] of cells) {
    if (c < mnX) mnX = c; if (r < mnY) mnY = r;
    if (c > mxX) mxX = c; if (r > mxY) mxY = r;
  }
  const colour = pickColourFor(cells);
  yaml += `  - id: r${String(id).padStart(2, '0')}\n`;
  yaml += `    name: "Room ${id}"\n`;
  yaml += `    color: '${colour}'\n`;
  yaml += `    bbox: [${mnX}, ${mnY}, ${mxX - mnX + 1}, ${mxY - mnY + 1}]\n`;
  yaml += '    cells:\n';
  for (const [c, r] of cells) yaml += `      - [${c}, ${r}]\n`;
}
fs.writeFileSync(OUT_YAML, yaml, 'utf8');

console.log('\n' + txt + '\n');
console.log(`wrote ${OUT_ASCII}`);
console.log(`wrote ${OUT_DEBUG}`);
console.log(`wrote ${OUT_YAML}`);
if (colourSrc) console.log(`(room colours sampled from ${colourSrc.source})`);
