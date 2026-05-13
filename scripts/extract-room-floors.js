// =====================================================================
// extract-room-floors.js
//
// For each room in data/board.yaml, crop the FULL room region from
// assets/board/board2.png and save to assets/floors/<roomId>.png.
// Each PNG covers the room's whole rectangular bbox in source pixels —
// not a tile sample — so the renderer can sub-sample one cell at a
// time and every cell shows its canonical printed texture.
//
// Also writes assets/floors/_index.json with each room's bbox + the
// reference cell-pixel size, so the renderer doesn't have to redo the
// math.
//
// Run:  node scripts/extract-room-floors.js
// =====================================================================

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { PNG } = require('pngjs');

// Switched 2026-05 from board2.png (1060×766) → board_v1.png (1134×831)
// → board_v2.png (1150×843). v2 is the canonical 2021 board art with
// the cleanest scan. No cropping — the whole image IS the playable
// board.
const SOURCE  = path.join(__dirname, '..', 'assets', 'board', 'board_v2.png');
const BOARD   = path.join(__dirname, '..', 'data', 'board.yaml');
const OUT_DIR = path.join(__dirname, '..', 'assets', 'floors');

// No cropping at extraction time — playable.png stays as the full
// board_v2.png. The SRC_PLAYABLE region records where the printed
// playable cells live INSIDE the wall frame. Probed values:
// top/left wall stones extend to ~y=62 / x=62 (printed art is 3D
// with shadow falloff), and for 26×19 square cells of 40 px each
// the math works out to BORDER 55 horizontal / 42 vertical. That
// centres the playable region in the image and lands the grid
// exactly on the printed-cell boundaries.
const GRID = {
  COLS: 26,
  ROWS: 19,
  BORDER_X: 0,
  BORDER_Y: 0,
  SRC_PLAYABLE: {
    x: 55, y: 42,
    w: 1150 - 2 * 55,  // 1040 → 40 px/cell × 26
    h: 843  - 2 * 42,  // 759  → ~39.9 px/cell × 19
  },
};

// ---------------------------------------------------------------------

// Cell pitch comes from the PLAYABLE REGION, not the full image — the
// outer wall frame on board_v2.png is 55px wide horizontally and 42px
// tall vertically, NOT part of the cell grid. Using src.width/26 here
// (the old behaviour) treated those wall stones as cells, so every
// per-room PNG was cropped from a position offset by half-a-cell and
// every "cell slice" inside the PNG straddled two real cells —
// producing the visible doubled-texture effect when the renderer
// sub-sampled cell-by-cell.
function cellSize(src) {
  const region = GRID.SRC_PLAYABLE || {
    x: 0, y: 0,
    w: src.width  - 2 * GRID.BORDER_X,
    h: src.height - 2 * GRID.BORDER_Y,
  };
  return [region.w / GRID.COLS, region.h / GRID.ROWS];
}

function cellPx(cellX, cellY, src) {
  const region = GRID.SRC_PLAYABLE || { x: GRID.BORDER_X, y: GRID.BORDER_Y };
  const [cw, ch] = cellSize(src);
  return [
    Math.round(region.x + cellX * cw),
    Math.round(region.y + cellY * ch),
  ];
}

function clip(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function crop(srcPng, sx, sy, w, h) {
  sx = clip(sx, 0, srcPng.width  - 1);
  sy = clip(sy, 0, srcPng.height - 1);
  w  = clip(w,  1, srcPng.width  - sx);
  h  = clip(h,  1, srcPng.height - sy);
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((sy + y) * srcPng.width + (sx + x)) * 4;
      const di = (y * w + x) * 4;
      out.data[di]     = srcPng.data[si];
      out.data[di + 1] = srcPng.data[si + 1];
      out.data[di + 2] = srcPng.data[si + 2];
      out.data[di + 3] = srcPng.data[si + 3];
    }
  }
  return out;
}

(function main() {
  if (!fs.existsSync(SOURCE)) { console.error('missing', SOURCE); process.exit(1); }
  if (!fs.existsSync(BOARD))  { console.error('missing', BOARD);  process.exit(1); }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const src = PNG.sync.read(fs.readFileSync(SOURCE));
  const yml = yaml.load(fs.readFileSync(BOARD, 'utf8'));
  const rooms = yml.rooms || [];
  const [cw, ch] = cellSize(src);
  console.log(`Source: ${path.basename(SOURCE)}  ${src.width}×${src.height}`);
  console.log(`Cell:   ${cw.toFixed(2)}px × ${ch.toFixed(2)}px`);
  console.log(`Rooms:  ${rooms.length}\n`);

  // ---- Playable area (single continuous image) ---------------------
  // The renderer's primary path uses this — every cell of the board,
  // room or corridor, sub-samples from it at (c*cellW, r*cellH). This
  // preserves the exact wear/variation visible in the reference photo,
  // which the previous "tile a 4×1 corridor sample" approach lost.
  const playW = src.width  - 2 * GRID.BORDER_X;
  const playH = src.height - 2 * GRID.BORDER_Y;
  const playable = crop(src, GRID.BORDER_X, GRID.BORDER_Y, playW, playH);
  fs.writeFileSync(path.join(OUT_DIR, 'playable.png'), PNG.sync.write(playable));
  console.log(`  → playable.png  ${playW}×${playH}px  (full 26×19 grid)`);

  // Override cell pitch with the SRC_PLAYABLE region (skip the printed
  // wall frame) so the editor sub-samples from the actual playable
  // cells. cellW/cellH on the index reflect playable-region pitch even
  // when playable.png stores the full uncropped image.
  const region = GRID.SRC_PLAYABLE || { x: 0, y: 0, w: playW, h: playH };
  const playableCellW = region.w / GRID.COLS;
  const playableCellH = region.h / GRID.ROWS;
  const index = {
    source: path.basename(SOURCE),
    playable: { file: 'playable.png', width: playW, height: playH },
    // Cell pitch derived from the playable REGION inside playable.png,
    // not the full image bounds. The editor adds srcPlayable.x/y when
    // sub-sampling so the wall frame in playable.png stays visible
    // (as part of the background image) while cells line up with the
    // printed-art playable grid.
    cellW: playableCellW,
    cellH: playableCellH,
    srcPlayable: { x: region.x, y: region.y, w: region.w, h: region.h },
    rooms: {},
    corridor: null,
  };

  // Inner-wall inset: with cellPx now aligned to the playable region
  // (offset by srcPlayable.x/y, pitch=40/39.95), walls between rooms
  // live BETWEEN cells — a cell-aligned crop is already pure floor.
  // Keep this at 0 so the PNG covers exactly (spanC × cellW) by
  // (spanR × cellH) and the renderer's per-cell sub-sampling stays
  // perfectly aligned with the cell grid. Any non-zero value here
  // shifts every cell-slice by a fractional amount and reintroduces
  // the half-and-half "doubled" sampling artifact.
  const INNER_INSET = 0;
  let n = 0;
  for (const room of rooms) {
    if (!room.cells || !room.cells.length) continue;
    let mc = 99, mr = 99, xc = -1, xr = -1;
    for (const [c, r] of room.cells) {
      if (c < mc) mc = c; if (r < mr) mr = r;
      if (c > xc) xc = c; if (r > xr) xr = r;
    }
    // Outer pixel bbox (cell-aligned)
    const [opx1, opy1] = cellPx(mc,     mr,     src);
    const [opx2, opy2] = cellPx(xc + 1, xr + 1, src);
    // Inset inward to skip the printed wall ring
    const px1 = opx1 + INNER_INSET;
    const py1 = opy1 + INNER_INSET;
    const px2 = opx2 - INNER_INSET;
    const py2 = opy2 - INNER_INSET;
    const w = Math.max(1, px2 - px1), h = Math.max(1, py2 - py1);
    const cropped = crop(src, px1, py1, w, h);
    fs.writeFileSync(path.join(OUT_DIR, `${room.id}.png`), PNG.sync.write(cropped));
    index.rooms[room.id] = {
      cellBbox: [mc, mr, xc, xr],     // inclusive cell bbox (logical)
      pxBbox:   [px1, py1, w, h],     // source pixels (inset, pure floor)
      cellSpan: [xc - mc + 1, xr - mr + 1],  // width×height in cells
    };
    console.log(`  → ${room.id}.png  cells (${mc},${mr})-(${xc},${xr})  ${w}×${h}px (inset ${INNER_INSET})`);
    n++;
  }

  // Corridor — crop a 4×1 strip of pure corridor cells. Cells
  // (5..8, 9) are all in board.yaml's corridor list (r11's bbox
  // starts at column 10, so we stop at 9 to avoid bleeding chamber
  // texture in). The 4-cell width gives the renderer enough variation
  // when tiled across long corridor stretches.
  {
    const [px1, py1] = cellPx(5, 9, src);
    const [px2, py2] = cellPx(9, 10, src);
    const w = px2 - px1, h = py2 - py1;
    const cor = crop(src, px1, py1, w, h);
    fs.writeFileSync(path.join(OUT_DIR, 'corridor.png'), PNG.sync.write(cor));
    index.corridor = { cellBbox: [5, 9, 8, 9], pxBbox: [px1, py1, w, h] };
    console.log(`  → corridor.png  cells (5,9)-(8,9)  ${w}×${h}px`);
  }

  fs.writeFileSync(path.join(OUT_DIR, '_index.json'),
    JSON.stringify(index, null, 2) + '\n');
  console.log(`\nWrote ${n} room PNG(s) + corridor + _index.json.`);
})();
