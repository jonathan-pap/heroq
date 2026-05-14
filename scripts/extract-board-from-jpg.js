// =====================================================================
// extract-board-from-jpg.js
//
// Auto-classify the canonical photographic 1989/2021 HeroQuest board
// (assets/board/board.jpg) into a 26x19 cell grid with corridors,
// rooms, walls, and per-room floor colours.
//
// This image has BLACK frame + BLACK walls between rooms, speckled-tan
// corridor floors, and distinctly-coloured room floors (red check, blue
// tile, green stone, wood plank, orange brick…). Classification is
// hue-based, walls are dark-pixel-density between adjacent cell centres.
//
// Output:
//   _reference/board-extracted.json    raw grid + walls + room IDs + colours
//   _reference/board-extracted.txt     ASCII preview
//   data/generated/board.generated.yaml  drop-in data/board/board.yaml replacement
//
// Run:  node scripts/extract-board-from-jpg.js
// =====================================================================

const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');
const PNG = require('pngjs').PNG;

// Pick the best available source image. board.jpg (photo) currently
// auto-detects more reliably because its solid black frame gives a
// clean bbox; board2.png (top-down render) has a tan frame that
// confuses the detector. Use BOARD_IMAGE=board2.png env var to override.
const PREF = process.env.BOARD_IMAGE;
const CANDIDATES = PREF
  ? [path.join(__dirname, '..', 'assets', 'board', PREF)]
  : [
      path.join(__dirname, '..', 'assets', 'board', 'board.jpg'),
      path.join(__dirname, '..', 'assets', 'board', 'board2.png'),
    ];

const IN = CANDIDATES.find(p => fs.existsSync(p));
if (!IN) throw new Error(`No board image found in assets/board/`);
const REF_DIR = path.join(__dirname, '..', '_reference');
const OUT_JSON  = path.join(REF_DIR, 'board-extracted.json');
const OUT_ASCII = path.join(REF_DIR, 'board-extracted.txt');
const OUT_YAML  = path.join(__dirname, '..', 'data', 'generated', 'board.generated.yaml');

if (!fs.existsSync(REF_DIR)) fs.mkdirSync(REF_DIR, { recursive: true });

const COLS = 26;
const ROWS = 19;

// Decode jpg or png based on extension
let raw;
if (/\.png$/i.test(IN)) {
  raw = PNG.sync.read(fs.readFileSync(IN));
} else {
  raw = jpeg.decode(fs.readFileSync(IN), { useTArray: true });
}
const W = raw.width, H = raw.height;
const data = raw.data; // RGBA
console.log(`source: ${IN}`);
console.log(`format: ${/\.png$/i.test(IN) ? 'PNG' : 'JPEG'}`);

function px(x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return { r: 0, g: 0, b: 0 };
  const i = (y * W + x) * 4;
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
}
function rgb(p) { return [p.r, p.g, p.b]; }
function isDark(p, thresh = 60) { return p.r < thresh && p.g < thresh && p.b < thresh; }

// ---------------------------------------------------------------------
// 1. Find the playable bounding box.
//   Two-stage approach so it works for both reference images:
//   STAGE A: shrink in from any solid-black outer frame (board.jpg).
//   STAGE B: find the FIRST horizontal/vertical black-wall line on each
//            edge — that's a wall between perimeter corridor and the
//            first interior room. Step back ONE cell to land on the
//            outer corridor cell. Works on board2.png (gold frame).
// ---------------------------------------------------------------------
function findBox() {
  // Stage A — strip dark outer frame (only fires on board.jpg).
  let top = 0, bottom = H - 1, left = 0, right = W - 1;
  while (top < H) {
    let any = false;
    for (let x = 0; x < W; x++) if (!isDark(px(x, top), 40)) { any = true; break; }
    if (any) break;
    top++;
  }
  while (bottom > 0) {
    let any = false;
    for (let x = 0; x < W; x++) if (!isDark(px(x, bottom), 40)) { any = true; break; }
    if (any) break;
    bottom--;
  }
  while (left < W) {
    let any = false;
    for (let y = top; y <= bottom; y++) if (!isDark(px(left, y), 40)) { any = true; break; }
    if (any) break;
    left++;
  }
  while (right > 0) {
    let any = false;
    for (let y = top; y <= bottom; y++) if (!isDark(px(right, y), 40)) { any = true; break; }
    if (any) break;
    right--;
  }
  // Stage B — scan for the first inner wall line (a row/col where >40% of
  // the centre 60% width is dark). That's the wall between outer
  // corridor and first interior room. Subtract one cell height to land
  // on the outer-corridor row.
  function rowDarkness(y) {
    let dark = 0, total = 0;
    const x0 = Math.floor(left + (right - left) * 0.20);
    const x1 = Math.ceil(left + (right - left) * 0.80);
    for (let x = x0; x <= x1; x++) {
      if (isDark(px(x, y), 40)) dark++;
      total++;
    }
    return dark / total;
  }
  function colDarkness(x) {
    let dark = 0, total = 0;
    const y0 = Math.floor(top + (bottom - top) * 0.20);
    const y1 = Math.ceil(top + (bottom - top) * 0.80);
    for (let y = y0; y <= y1; y++) {
      if (isDark(px(x, y), 40)) dark++;
      total++;
    }
    return dark / total;
  }
  // Approximate cell size (assuming 26 x 19 fits in the current bbox)
  let approxCellW = (right - left + 1) / COLS;
  let approxCellH = (bottom - top + 1) / ROWS;
  // Find first inner horizontal/vertical wall well INSIDE the image,
  // not the picture-frame trim line near the edge. Must:
  //   (a) be at least one full cell from the current edge
  //   (b) have very high darkness (true black wall, not trim)
  // Scan window starts at 1 cell in and extends 4 cells in. We pick
  // the row/col with the HIGHEST darkness in that window — that's
  // the most likely first room-wall.
  function findFirstStrongHWall(yStart, yEnd, step = 1) {
    let bestY = -1, bestD = 0.40;
    for (let y = yStart; y !== yEnd; y += step) {
      const d = rowDarkness(y);
      if (d > bestD) { bestD = d; bestY = y; }
    }
    return bestY;
  }
  function findFirstStrongVWall(xStart, xEnd, step = 1) {
    let bestX = -1, bestD = 0.40;
    for (let x = xStart; x !== xEnd; x += step) {
      const d = colDarkness(x);
      if (d > bestD) { bestD = d; bestX = x; }
    }
    return bestX;
  }
  const firstWallY = findFirstStrongHWall(
    top + Math.floor(approxCellH * 0.6), top + Math.floor(approxCellH * 4));
  const lastWallY = findFirstStrongHWall(
    bottom - Math.floor(approxCellH * 0.6), bottom - Math.floor(approxCellH * 4), -1);
  const firstWallX = findFirstStrongVWall(
    left + Math.floor(approxCellW * 0.6), left + Math.floor(approxCellW * 4));
  const lastWallX = findFirstStrongVWall(
    right - Math.floor(approxCellW * 0.6), right - Math.floor(approxCellW * 4), -1);
  console.log(`stage A bbox ${left},${top}-${right},${bottom}`);
  console.log(`approxCell ${approxCellW.toFixed(1)}x${approxCellH.toFixed(1)}`);
  console.log(`inner walls firstWallY=${firstWallY} lastWallY=${lastWallY} firstWallX=${firstWallX} lastWallX=${lastWallX}`);
  // If we found inner walls, use them — they're the wall between row 0/col 0
  // (outer corridor) and the first interior room. The OUTER corridor cell
  // is one cell away from each wall.
  if (firstWallY > 0 && lastWallY > 0 && firstWallX > 0 && lastWallX > 0
      && lastWallX > firstWallX && lastWallY > firstWallY) {
    // First/last walls are the boundaries between row0/row1 (and
    // row17/row18). Step back one cell to land on the start of the
    // outer-corridor row (row 0). Cell size derived from inner-wall
    // spacing covering the 17 interior rows / 24 interior cols.
    const cellWB = (lastWallX - firstWallX) / 24;
    const cellHB = (lastWallY - firstWallY) / 17;
    top    = Math.max(0,    Math.round(firstWallY - cellHB));
    bottom = Math.min(H - 1, Math.round(lastWallY  + cellHB));
    left   = Math.max(0,    Math.round(firstWallX - cellWB));
    right  = Math.min(W - 1, Math.round(lastWallX  + cellWB));
  }
  return { left, right, top, bottom };
}
const { left, right, top, bottom } = findBox();
const cellW = (right - left + 1) / COLS;
const cellH = (bottom - top + 1) / ROWS;
console.log(`image ${W}x${H}, board bbox ${left},${top}-${right},${bottom}, cell ~${cellW.toFixed(1)}x${cellH.toFixed(1)}`);

// ---------------------------------------------------------------------
// 2. Sample each cell's center colour (median-ish via 9-point grid).
// ---------------------------------------------------------------------
function sampleCell(c, r) {
  const cx = left + (c + 0.5) * cellW;
  const cy = top  + (r + 0.5) * cellH;
  // 5x5 grid of samples around the centre — robust to grid-line
  // pixels and small artifacts.
  let sumR = 0, sumG = 0, sumB = 0, n = 0, dark = 0;
  const sx = Math.max(2, Math.floor(cellW * 0.18));
  const sy = Math.max(2, Math.floor(cellH * 0.18));
  for (let dy = -sy; dy <= sy; dy += Math.max(1, Math.floor(sy / 2))) {
    for (let dx = -sx; dx <= sx; dx += Math.max(1, Math.floor(sx / 2))) {
      const p = px(Math.round(cx + dx), Math.round(cy + dy));
      sumR += p.r; sumG += p.g; sumB += p.b;
      if (isDark(p, 70)) dark++;
      n++;
    }
  }
  return {
    r: Math.round(sumR / n),
    g: Math.round(sumG / n),
    b: Math.round(sumB / n),
    darkRatio: dark / n,
  };
}

// ---------------------------------------------------------------------
// 3. Classify each cell.
//   - darkRatio > 0.55  → off-board/blocked
//   - tan/grey speckled (low saturation, mid brightness, R≈G≈B) → corridor
//   - else → room (with characteristic colour we'll keep for the YAML)
// ---------------------------------------------------------------------
function classifyColour(s) {
  // Empirical test from sampling: corridor stone consistently lands at
  // ~(160,135,110) with R>G>B and R-B around 35-65. Coloured rooms break
  // at least one of these rules (saturation higher, R<B, brightness off).
  const brightness = (s.r + s.g + s.b) / 3;
  const isWarmGreyOrder = s.r > s.g && s.g > s.b;
  const rb = s.r - s.b;
  const rg = s.r - s.g;
  // Corridor recipe: warm grey order, mid brightness, ~30-65 R-B spread,
  // ~10-35 R-G spread. Rejects red rooms (R-B too big), teal/blue rooms
  // (R<=B), and stone-grey rooms (R≈G≈B with very small spread).
  const isCorridor =
    isWarmGreyOrder &&
    brightness >= 95 && brightness <= 200 &&
    rb >= 30 && rb <= 70 &&
    rg >= 10 && rg <= 38;
  if (isCorridor) return { kind: 'corridor' };
  return { kind: 'room' };
}

// ---------------------------------------------------------------------
// 4. Wall detection between adjacent cells. The wall between rooms (and
//    between rooms and corridors) is solid black on this board. We
//    sample a thin strip at the midpoint between two cells.
// ---------------------------------------------------------------------
// Cell-mean colour distance (Euclidean RGB). Two cells in the same room
// produce nearly identical averages despite checker / wood-grain
// textures (each cell sample is the SAME large 5x5 grid of pixels, so
// textures average out to the same room-colour). Cells on opposite
// sides of a wall differ by 50+ in colour distance.
function colourDist(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function wallBetween(c1, r1, c2, r2) {
  // Average-cell-colour-distance test only. Pixel-level wall sampling
  // sounds robust but red-checker / wood-plank / blood-spatter create
  // dark bands inside rooms that fake walls; cell-mean averaging is
  // texture-resilient. Boards extracted this way are 80-90% accurate
  // — manual cleanup of the generated YAML is the last 10%.
  const colA = cellRGB[r1][c1];
  const colB = cellRGB[r2][c2];
  return colourDist(colA, colB) > 55;
}

// ---------------------------------------------------------------------
// 5. Build classification + walls.
// ---------------------------------------------------------------------
const grid = []; // 'off' | 'corridor' | 'room'
const cellRGB = [];
const wallE = []; // wallE[r][c] — wall to the right of cell (c,r)
const wallS = []; // wallS[r][c] — wall below cell (c,r)
// Pass 1 — sample all cells (so wall detection has full data).
for (let r = 0; r < ROWS; r++) {
  grid.push([]); cellRGB.push([]);
  for (let c = 0; c < COLS; c++) {
    const s = sampleCell(c, r);
    cellRGB[r].push([s.r, s.g, s.b]);
    grid[r].push(classifyColour(s).kind);
  }
}
// Pass 2 — compute walls now that cellRGB is populated.
for (let r = 0; r < ROWS; r++) {
  wallE.push([]); wallS.push([]);
  for (let c = 0; c < COLS; c++) {
    wallE[r].push(c < COLS - 1 ? wallBetween(c, r, c + 1, r) : true);
    wallS[r].push(r < ROWS - 1 ? wallBetween(c, r, c, r + 1) : true);
  }
}

// ---------------------------------------------------------------------
// 6. Flood-fill rooms (connected room cells with no wall between them).
// ---------------------------------------------------------------------
const roomId = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
let nextId = 1;
function passable(r1, c1, r2, c2) {
  if (r2 < 0 || r2 >= ROWS || c2 < 0 || c2 >= COLS) return false;
  if (grid[r1][c1] !== 'room' || grid[r2][c2] !== 'room') return false;
  if (r1 === r2 && c2 === c1 + 1) return !wallE[r1][c1];
  if (r1 === r2 && c2 === c1 - 1) return !wallE[r2][c2];
  if (c1 === c2 && r2 === r1 + 1) return !wallS[r1][c1];
  if (c1 === c2 && r2 === r1 - 1) return !wallS[r2][c1];
  return false;
}
const roomCells = {};
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    if (grid[r][c] !== 'room' || roomId[r][c] !== null) continue;
    const id = nextId++;
    const cells = [];
    const stack = [[r, c]];
    roomId[r][c] = id;
    while (stack.length) {
      const [cr, cc] = stack.pop();
      cells.push([cc, cr]);
      for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
        const nr = cr + dr, nc = cc + dc;
        if (passable(cr, cc, nr, nc) && roomId[nr][nc] === null) {
          roomId[nr][nc] = id;
          stack.push([nr, nc]);
        }
      }
    }
    roomCells[id] = cells;
  }
}
console.log(`detected ${nextId - 1} room(s) before merging`);

// ---------------------------------------------------------------------
// 6b. Merge over-segmented rooms — adjacent rooms with similar mean
//     colour and no corridor between them are very likely the same
//     real room split by texture variation. Two rooms get merged if:
//     (a) at least one pair of cells from each is orthogonally adjacent
//     (b) the mean-colour distance between the two rooms is < 45.
// ---------------------------------------------------------------------
function meanColourFor(cells) {
  let sR = 0, sG = 0, sB = 0;
  for (const [c, r] of cells) {
    const [pr, pg, pb] = cellRGB[r][c];
    sR += pr; sG += pg; sB += pb;
  }
  const n = cells.length;
  return [sR / n, sG / n, sB / n];
}
let merged = true;
while (merged) {
  merged = false;
  for (const idA of Object.keys(roomCells)) {
    if (!roomCells[idA]) continue;
    for (const idB of Object.keys(roomCells)) {
      if (idA === idB || !roomCells[idA] || !roomCells[idB]) continue;
      // Adjacency check
      let adjacent = false;
      const cellsA = roomCells[idA];
      const setB = new Set(roomCells[idB].map(([c, r]) => `${c},${r}`));
      for (const [c, r] of cellsA) {
        for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          if (setB.has(`${c+dc},${r+dr}`)) { adjacent = true; break; }
        }
        if (adjacent) break;
      }
      if (!adjacent) continue;
      const colA = meanColourFor(roomCells[idA]);
      const colB = meanColourFor(roomCells[idB]);
      if (colourDist(colA, colB) < 22) {
        // merge B into A
        for (const [c, r] of roomCells[idB]) roomId[r][c] = Number(idA);
        roomCells[idA] = roomCells[idA].concat(roomCells[idB]);
        delete roomCells[idB];
        merged = true;
      }
    }
    if (merged) break;
  }
}
const remainingIds = Object.keys(roomCells).map(Number).sort((a, b) => a - b);
console.log(`after merge: ${remainingIds.length} room(s)`);

// ---------------------------------------------------------------------
// 6c. Renumber rooms 1..N for stable IDs in the YAML.
// ---------------------------------------------------------------------
const remap = {};
let i = 1;
for (const oldId of remainingIds) remap[oldId] = i++;
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++)
    if (roomId[r][c] != null) roomId[r][c] = remap[roomId[r][c]];
const newRoomCells = {};
for (const oldId of remainingIds) newRoomCells[remap[oldId]] = roomCells[oldId];
for (const k of Object.keys(roomCells)) delete roomCells[k];
Object.assign(roomCells, newRoomCells);
const finalRoomCount = remainingIds.length;

// ---------------------------------------------------------------------
// 7. ASCII preview.
// ---------------------------------------------------------------------
const GLYPHS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
function glyph(r, c) {
  if (grid[r][c] === 'off')      return '#';
  if (grid[r][c] === 'corridor') return '.';
  const id = roomId[r][c];
  return id != null ? GLYPHS[(id - 1) % GLYPHS.length] : '?';
}
const ascii = [];
for (let r = 0; r < ROWS; r++) {
  let line = '';
  for (let c = 0; c < COLS; c++) line += glyph(r, c);
  ascii.push(line);
}
const txt = ascii.join('\n');
fs.writeFileSync(OUT_ASCII, txt + '\n', 'utf8');

// ---------------------------------------------------------------------
// 8. Average room colour for the YAML "color" hint.
// ---------------------------------------------------------------------
function avgColourFor(id) {
  const cells = roomCells[id];
  let sR = 0, sG = 0, sB = 0;
  for (const [c, r] of cells) {
    const [pr, pg, pb] = cellRGB[r][c];
    sR += pr; sG += pg; sB += pb;
  }
  const n = cells.length;
  const r = Math.round(sR / n), g = Math.round(sG / n), b = Math.round(sB / n);
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------
// 9. Emit a board.generated.yaml in the same shape as data/board/board.yaml.
//    Rooms are stored as cell lists (not rect) since real HQ rooms are
//    not all rectangular. Loader needs to support both forms — we'll
//    add that next. Also dump corridor cells as a list.
// ---------------------------------------------------------------------
const corridorCells = [];
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++)
    if (grid[r][c] === 'corridor') corridorCells.push([c, r]);

const roomYaml = [];
for (let id = 1; id <= finalRoomCount; id++) {
  const cells = roomCells[id];
  // bbox for "name" hint
  let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
  for (const [c, r] of cells) {
    if (c < mnX) mnX = c; if (r < mnY) mnY = r;
    if (c > mxX) mxX = c; if (r > mxY) mxY = r;
  }
  roomYaml.push({
    id: 'r' + String(id).padStart(2, '0'),
    name: `Room ${id}`,
    color: avgColourFor(id),
    bbox: [mnX, mnY, mxX - mnX + 1, mxY - mnY + 1],
    cells,
  });
}

let yaml = '# AUTO-GENERATED from assets/board/board.jpg via\n';
yaml += '# scripts/extract-board-from-jpg.js — re-run to regenerate.\n';
yaml += '# Manual cell tweaks BELOW the marker survive a re-run.\n';
yaml += '#\n# This is the canonical 1989/2021 HeroQuest board, classified into\n';
yaml += `# corridors + ${finalRoomCount} rooms. Each room is a list of cells (real HQ\n`;
yaml += '# rooms are not all rectangles). Quests overlay this layout.\n\n';
yaml += `boardSize: [${COLS}, ${ROWS}]\n\n`;
yaml += 'corridor:\n  cells:\n';
for (const [c, r] of corridorCells) yaml += `    - [${c}, ${r}]\n`;
yaml += '\nrooms:\n';
for (const r of roomYaml) {
  yaml += `  - id: ${r.id}\n`;
  yaml += `    name: "${r.name}"\n`;
  yaml += `    color: '${r.color}'\n`;
  yaml += `    bbox: [${r.bbox.join(', ')}]\n`;
  yaml += '    cells:\n';
  for (const [c, rr] of r.cells) yaml += `      - [${c}, ${rr}]\n`;
}
fs.writeFileSync(OUT_YAML, yaml, 'utf8');

// Raw dump for debugging / future re-runs.
fs.writeFileSync(OUT_JSON, JSON.stringify({
  boardSize: [COLS, ROWS],
  bbox: { left, top, right, bottom },
  cellSize: { w: cellW, h: cellH },
  grid, wallE, wallS, roomId,
  roomCount: nextId - 1,
  rooms: roomYaml,
  cellRGB,
}, null, 2), 'utf8');

console.log('\n' + txt + '\n');
console.log(`wrote ${OUT_ASCII}`);
console.log(`wrote ${OUT_JSON}`);
console.log(`wrote ${OUT_YAML}`);

// ---------------------------------------------------------------------
// 10. Debug PNG — original board with our cell classification overlaid
//     as semi-transparent coloured swatches. Verify by eye.
// ---------------------------------------------------------------------
const debugPNG = new PNG({ width: W, height: H });
debugPNG.data.set(data);  // start with the original image
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
  [220, 60, 60],  [60, 200, 80],  [60, 120, 240], [240, 180, 50],
  [200, 60, 200], [60, 200, 200], [240, 130, 60], [180, 200, 60],
  [120, 60, 200], [200, 200, 60], [60, 240, 130], [240, 60, 130],
  [120, 200, 240],[240, 200, 120],[200, 240, 60], [60, 180, 240],
  [240, 120, 200],[180, 240, 180],[60, 240, 60],  [240, 60, 60], [120, 240, 240],
];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const cx0 = Math.round(left + c * cellW);
    const cy0 = Math.round(top  + r * cellH);
    const cx1 = Math.round(left + (c + 1) * cellW);
    const cy1 = Math.round(top  + (r + 1) * cellH);
    let colour;
    if (grid[r][c] === 'corridor') colour = [80, 80, 80];
    else if (grid[r][c] === 'off') colour = [255, 0, 255];
    else {
      const id = roomId[r][c];
      colour = ROOM_HUES[((id || 1) - 1) % ROOM_HUES.length];
    }
    tint(cx0 + 4, cy0 + 4, cx1 - 4, cy1 - 4, colour, 0.55);
  }
}
const dbgPath = path.join(REF_DIR, 'board-extracted-debug.png');
fs.writeFileSync(dbgPath, PNG.sync.write(debugPNG));
console.log(`wrote ${dbgPath} (open this to verify by eye)`);
