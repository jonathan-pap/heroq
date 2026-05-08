// One-shot fix: convert every quest's diamond-shaped stair/start cells
// into a canonical 2x2 stair-tile block (per F2847 + 2021 quest book).
//
// Two diamond patterns are in use today (south-east starting rooms):
//   Pattern A: [[22,15],[23,16],[22,17],[21,16]]  centered at (22,16)
//   Pattern B: [[23,15],[24,16],[23,17],[22,16]]  centered at (23,16)
// Both become a 2x2 block sharing a corner with the original diamond
// centre, so heroes still start in roughly the same room/cells.
//   A -> [[21,16],[22,16],[21,17],[22,17]]
//   B -> [[22,16],[23,16],[22,17],[23,17]]
//
// Sandbox-e currently has only 3 cells; we promote it to the same
// pattern A 2x2 so the stair-tile invariant always holds.

const fs = require('fs');
const path = require('path');

const QUESTS_DIR = path.join(__dirname, '..', 'data', 'quests');
const PATTERN_A_2x2 = [[21, 16], [22, 16], [21, 17], [22, 17]];
const PATTERN_B_2x2 = [[22, 16], [23, 16], [22, 17], [23, 17]];

function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function sortCells(c) { return [...c].sort((p, q) => p[1] - q[1] || p[0] - q[0]); }

const PATTERN_A_DIAMOND = sortCells([[22, 15], [23, 16], [22, 17], [21, 16]]);
const PATTERN_B_DIAMOND = sortCells([[23, 15], [24, 16], [23, 17], [22, 16]]);
const PATTERN_A_PARTIAL = sortCells([[22, 15], [23, 16], [21, 16]]);

function pickReplacement(cells) {
  const sorted = sortCells(cells);
  if (eq(sorted, PATTERN_A_DIAMOND)) return PATTERN_A_2x2;
  if (eq(sorted, PATTERN_B_DIAMOND)) return PATTERN_B_2x2;
  if (eq(sorted, PATTERN_A_PARTIAL)) return PATTERN_A_2x2;
  return null;
}

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.isFile() && p.endsWith('.json')) out.push(p);
  }
  return out;
}

let touched = 0, skipped = 0;
for (const file of walk(QUESTS_DIR)) {
  let q;
  try { q = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.warn(`SKIP (parse): ${file} — ${e.message}`); skipped++; continue; }
  let changed = false;
  for (const key of ['startCells', 'stairCells']) {
    if (!Array.isArray(q[key])) continue;
    const repl = pickReplacement(q[key]);
    if (repl) { q[key] = repl; changed = true; }
  }
  if (changed) {
    fs.writeFileSync(file, JSON.stringify(q, null, 2) + '\n');
    console.log(`FIXED: ${path.relative(QUESTS_DIR, file)}`);
    touched++;
  } else {
    skipped++;
  }
}
console.log(`\nDone. ${touched} quest(s) updated, ${skipped} skipped.`);
