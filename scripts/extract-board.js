// =====================================================================
// extract-board.js — auto-classify the canonical 2021 blank-board image
// into a 26x19 cell grid with corridors, rooms, and walls between cells.
//
// For each cell:
//   class       '.' corridor   '#' room   '?' off-board
//   wallN/E/S/W boolean — is there a thick maroon wall on that side?
// Then flood-fills connected room cells (no wall between them) to assign
// room IDs. Outputs JSON + ASCII preview.
//
// Run:  node scripts/extract-board.js
// =====================================================================

const fs = require('fs');
const path = require('path');
const PNG = require('pngjs').PNG;

const IN  = path.join(__dirname, '..', '_reference', 'quest-pages', 'board-300-17.png');
const OUT_JSON = path.join(__dirname, '..', '_reference', 'board-grid.json');
const OUT_ASCII = path.join(__dirname, '..', '_reference', 'board-grid.txt');

const COLS = 26;
const ROWS = 19;

const png = PNG.sync.read(fs.readFileSync(IN));
const W = png.width, H = png.height;

function px(x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return { r: 0, g: 0, b: 0 };
  const i = (y * W + x) * 4;
  return { r: png.data[i], g: png.data[i+1], b: png.data[i+2] };
}

// Maroon walls / outline: red dominant, low blue & green.
function isMaroon(p) { return p.r > 90 && p.r < 210 && p.g < 70 && p.b < 70; }
// Corridor cells are noticeably more tan than room interiors.
function isCorridorTone(p) { return p.r - p.g > 18; }

// 1. Find the board bounding box (largest maroon rectangle in the top
//    65 % of the page — that's the board; the symbols legend is below).
let minX = W, maxX = 0, minY = H, maxY = 0;
const cutY = Math.floor(H * 0.65);
for (let y = 0; y < cutY; y++) {
  for (let x = 0; x < W; x++) {
    if (isMaroon(px(x, y))) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
// Step inside the outer border thickness so cell sampling doesn't pick
// up the border itself.
const BORDER = 8;
minX += BORDER; maxX -= BORDER; minY += BORDER; maxY -= BORDER;
const cellW = (maxX - minX) / COLS;
const cellH = (maxY - minY) / ROWS;
console.log(`board ${minX}-${maxX} x ${minY}-${maxY}, cell ${cellW.toFixed(1)}x${cellH.toFixed(1)}`);

// 2. Classify each cell by sampling a 7x7 region around the centre.
function classify(col, row) {
  const cx = Math.round(minX + (col + 0.5) * cellW);
  const cy = Math.round(minY + (row + 0.5) * cellH);
  let n = 0, light = 0, maroon = 0, sumR = 0, sumG = 0;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const p = px(cx + dx, cy + dy);
      n++;
      sumR += p.r; sumG += p.g;
      if (isMaroon(p)) maroon++;
      if (p.r > 200 && p.g > 180) light++;
    }
  }
  if (maroon > n * 0.4) return '?';
  if (light < n * 0.5) return '?';
  const avgRG = (sumR - sumG) / n;
  return avgRG > 18 ? '.' : '#';
}

// 3. Wall detection — sample the 30-pixel-wide strip between two cell
//    centres. If a thick maroon segment runs across that strip → wall.
function wallBetween(c1, r1, c2, r2) {
  // Strip midpoint and orientation
  const x1 = minX + (c1 + 0.5) * cellW, y1 = minY + (r1 + 0.5) * cellH;
  const x2 = minX + (c2 + 0.5) * cellW, y2 = minY + (r2 + 0.5) * cellH;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const horizontal = (r1 === r2);  // horizontal neighbours -> vertical wall
  let maroonHits = 0, total = 0;
  if (horizontal) {
    // Wall is vertical at x=mx, sample a vertical strip of pixels at the
    // midpoint, ±cellH*0.4 in y, with ±5 px tolerance in x.
    for (let dy = -Math.floor(cellH * 0.4); dy <= Math.floor(cellH * 0.4); dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        if (isMaroon(px(Math.round(mx + dx), Math.round(my + dy)))) maroonHits++;
        total++;
      }
    }
  } else {
    // Vertical neighbours -> horizontal wall at y=my
    for (let dx = -Math.floor(cellW * 0.4); dx <= Math.floor(cellW * 0.4); dx++) {
      for (let dy = -5; dy <= 5; dy++) {
        if (isMaroon(px(Math.round(mx + dx), Math.round(my + dy)))) maroonHits++;
        total++;
      }
    }
  }
  // Empirically a true wall produces ~20%+ maroon; thin grid lines <5%.
  return maroonHits / total > 0.15;
}

// 4. Build classification + wall maps.
const grid = [];
const walls = { east: [], south: [] };
for (let r = 0; r < ROWS; r++) {
  const row = [];
  const eastRow = []; const southRow = [];
  for (let c = 0; c < COLS; c++) {
    row.push(classify(c, r));
    eastRow.push(c < COLS - 1 ? wallBetween(c, r, c + 1, r) : true);
    southRow.push(r < ROWS - 1 ? wallBetween(c, r, c, r + 1) : true);
  }
  grid.push(row);
  walls.east.push(eastRow);
  walls.south.push(southRow);
}

// 5. Flood-fill connected '#' cells (no wall between) to assign room IDs.
const roomId = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
let nextId = 1;
function passable(r1, c1, r2, c2) {
  if (r1 < 0 || r2 < 0 || r1 >= ROWS || r2 >= ROWS) return false;
  if (c1 < 0 || c2 < 0 || c1 >= COLS || c2 >= COLS) return false;
  if (grid[r1][c1] !== '#' || grid[r2][c2] !== '#') return false;
  if (r1 === r2 && c2 === c1 + 1) return !walls.east[r1][c1];
  if (r1 === r2 && c2 === c1 - 1) return !walls.east[r1][c2];
  if (c1 === c2 && r2 === r1 + 1) return !walls.south[r1][c1];
  if (c1 === c2 && r2 === r1 - 1) return !walls.south[r2][c1];
  return false;
}
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    if (grid[r][c] !== '#' || roomId[r][c] !== null) continue;
    const id = nextId++;
    const queue = [[r, c]];
    roomId[r][c] = id;
    while (queue.length) {
      const [cr, cc] = queue.shift();
      for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
        const nr = cr + dr, nc = cc + dc;
        if (passable(cr, cc, nr, nc) && roomId[nr][nc] === null) {
          roomId[nr][nc] = id;
          queue.push([nr, nc]);
        }
      }
    }
  }
}
console.log(`detected ${nextId - 1} room(s) before merging`);

// 6. Render ASCII preview: . corridor, ? off, single-digit/letter for room id.
const ROOM_GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function glyph(r, c) {
  const cell = grid[r][c];
  if (cell !== '#') return cell;
  const id = roomId[r][c];
  return id != null ? ROOM_GLYPHS[(id - 1) % ROOM_GLYPHS.length] : '#';
}
const ascii = [];
for (let r = 0; r < ROWS; r++) {
  let line = '';
  for (let c = 0; c < COLS; c++) line += glyph(r, c);
  ascii.push(line);
}
const txt = ascii.join('\n');
fs.writeFileSync(OUT_ASCII, txt + '\n', 'utf8');
fs.writeFileSync(OUT_JSON, JSON.stringify({
  cols: COLS, rows: ROWS, grid, walls, roomId,
  roomCount: nextId - 1,
}, null, 2));

console.log('\n' + txt + '\n');
console.log(`wrote ${OUT_ASCII}`);
console.log(`wrote ${OUT_JSON}`);
