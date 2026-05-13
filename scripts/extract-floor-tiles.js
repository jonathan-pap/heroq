// =====================================================================
// extract-floor-tiles.js
//
// Crops tile-sized texture samples from assets/board/board2.png (the
// canonical reference board photo) and saves each to
// assets/floors/<name>.png. These are the candidate textures to use
// instead of flat colours for room/corridor floors.
//
// Re-run after editing TILES to fine-tune sample positions:
//   node scripts/extract-floor-tiles.js
//
// The script does NOT wire anything into the game renderer — it only
// produces PNG samples for review.
// =====================================================================

const fs   = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const SOURCE = path.join(__dirname, '..', 'assets', 'board', 'board2.png');
const OUT_DIR = path.join(__dirname, '..', 'assets', 'floors');

// Each tile is sampled as a square crop, sized to be a clean repeat.
// Coordinates are pixel positions in board2.png (1060 × 766).
//
// `size` is the side length of the crop; 64 by default. Use a size that
// captures one full repeat of the pattern so the texture tiles cleanly
// on the game board.
//
// Position is the TOP-LEFT corner of the crop. Inspect board2.png in
// any image viewer that shows pixel coords, then update these.
const DEFAULT_SIZE = 64;

const TILES = [
  // --- Row 1 (top, y ~ 50-200) -----------------------------------------
  { name: 'room-yellow-square',     x:  62, y:  60 },   // yellow tile (small grid)
  { name: 'room-red-brick',         x: 215, y:  60 },   // red brick (top middle-left)
  { name: 'room-stone-dark',        x: 365, y:  62 },   // dark cracked stone (small)
  { name: 'room-red-cracked',       x: 460, y:  60 },   // red crackle (large room)
  { name: 'room-brown-grid',        x: 690, y:  62 },   // brown wooden grid
  { name: 'room-yellow-brick',      x: 880, y:  62 },   // yellow/tan brick

  // --- Row 2 (middle, y ~ 220-360) -------------------------------------
  { name: 'room-stone-grey',        x:  62, y: 220 },   // grey cobble
  { name: 'room-cyan-tile',         x: 215, y: 220 },   // cyan/teal small tile
  { name: 'room-brown-stone',       x: 690, y: 240 },   // earthy brown stone
  { name: 'room-green-mossy',       x: 880, y: 240 },   // green/grey mossy

  // --- Row 3 (bottom, y ~ 460-620) -------------------------------------
  { name: 'room-stone-cracked',     x:  62, y: 460 },   // grey cracked stone
  { name: 'room-cyan-large',        x: 215, y: 460 },   // teal large square
  { name: 'room-brown-wood',        x: 365, y: 460 },   // wooden plank
  { name: 'room-yellow-checker',    x: 510, y: 380 },   // yellow checkerboard
  { name: 'room-brick-pink',        x: 640, y: 510 },   // pinkish brick
  { name: 'room-green-diamond',     x: 880, y: 460 },   // green diamond

  // --- Corridor & wall samples -----------------------------------------
  { name: 'corridor-stone',         x: 510, y: 280, size: 96 }, // central path / corridor stone
  { name: 'wall-stone-edge',        x:   8, y: 320, size: 32 }, // outer-wall stone slab (vertical strip)
];

function clip(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function crop(srcPng, sx, sy, w, h) {
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
  if (!fs.existsSync(SOURCE)) {
    console.error('Source not found:', SOURCE);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const src = PNG.sync.read(fs.readFileSync(SOURCE));
  console.log(`Source ${path.basename(SOURCE)}: ${src.width}×${src.height}`);

  let n = 0;
  for (const t of TILES) {
    const size = t.size || DEFAULT_SIZE;
    const sx = clip(t.x, 0, src.width - size);
    const sy = clip(t.y, 0, src.height - size);
    const cropped = crop(src, sx, sy, size, size);
    const outPath = path.join(OUT_DIR, `${t.name}.png`);
    fs.writeFileSync(outPath, PNG.sync.write(cropped));
    console.log(`  → ${t.name}.png  (${size}×${size} from ${sx},${sy})`);
    n++;
  }
  console.log(`\nWrote ${n} tile sample(s) to ${path.relative(path.join(__dirname, '..'), OUT_DIR)}.`);
  console.log('Open them in a viewer; tweak (x, y, size) in TILES and re-run as needed.');
})();
