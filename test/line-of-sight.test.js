// Line-of-sight tests against the 2021 quick-reference rule:
//   - clear straight line from centre to centre
//   - blocked by wall, closed door, hero, or monster
//   - open doors do NOT block
//   - corner-grazing diagonals are permissive: the line is blocked
//     only when BOTH L-paths around the corner are shut
//
// Mirrors the server's `lineOfSight`. Kept independent so tests run
// without spinning up server.js (which auto-listens on import).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const HQRules = require('../public/shared/rules.js');

// Bresenham from server.js — replicated verbatim.
function bresenham(from, to) {
  let [x0, y0] = from; const [x1, y1] = to;
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const out = [];
  while (true) {
    out.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return out;
}

function edgeBlocked(s, a, b) {
  if (HQRules.wallBetween(s, a, b)) return true;
  const door = HQRules.doorBetween(s, a, b);
  if (door && door.state !== 'open') return true;
  return false;
}

function lineOfSight(s, from, to) {
  if (from[0] === to[0] && from[1] === to[1]) return true;
  const cells = bresenham(from, to);
  for (let i = 1; i < cells.length; i++) {
    const a = cells[i - 1], b = cells[i];
    const tb = HQRules.tileAt(s, b[0], b[1]);
    if (!tb) return false;
    if (a[0] === b[0] || a[1] === b[1]) {
      if (edgeBlocked(s, a, b)) return false;
    } else {
      const c1 = [a[0], b[1]];
      const c2 = [b[0], a[1]];
      const path1 = !edgeBlocked(s, a, c1) && !edgeBlocked(s, c1, b);
      const path2 = !edgeBlocked(s, a, c2) && !edgeBlocked(s, c2, b);
      if (!path1 && !path2) return false;
    }
    if (i < cells.length - 1) {
      if (tb.blocked) return false;
      if (s._occupants && s._occupants.has(b[0] + ',' + b[1])) return false;
    }
  }
  return true;
}

// Fixture: 6x6 grid. Two rooms separated by a vertical wall.
//   Cols 0..2  → roomId 'r1'
//   Cols 3..5  → roomId 'r2'
// Wall lies between x=2 and x=3 across all rows.
function makeState({ door = null, blocked = [], occupants = [] } = {}) {
  const tileMeta = {};
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 6; x++) {
      tileMeta[HQRules.key(x, y)] = {
        x, y,
        roomId: x < 3 ? 'r1' : 'r2',
        blocked: blocked.some(c => c[0] === x && c[1] === y),
      };
    }
  }
  const doors = door ? [door] : [];
  const _occupants = new Set(occupants.map(c => c[0] + ',' + c[1]));
  return { tileMeta, doors, _occupants };
}

// --- Sanity: same-cell + same-room ortho ---------------------------------

test('same cell — always visible', () => {
  const s = makeState();
  assert.equal(lineOfSight(s, [1, 1], [1, 1]), true);
});

test('horizontal same-room — visible', () => {
  const s = makeState();
  assert.equal(lineOfSight(s, [0, 0], [2, 0]), true);
});

test('vertical same-room — visible', () => {
  const s = makeState();
  assert.equal(lineOfSight(s, [1, 0], [1, 4]), true);
});

// --- Walls ---------------------------------------------------------------

test('horizontal across the wall — blocked', () => {
  const s = makeState();
  assert.equal(lineOfSight(s, [1, 1], [4, 1]), false);
});

test('45-degree diagonal across the wall — blocked (was the bug)', () => {
  // (1,1) → (4,4) crosses the wall between x=2 and x=3 at the (2,2)/(3,3)
  // corner. The old code skipped the wall check on diagonal steps and
  // wrongly returned visible.
  const s = makeState();
  assert.equal(lineOfSight(s, [1, 1], [4, 4]), false);
});

test('shallow diagonal across the wall — blocked', () => {
  // (1,1) → (5,2): Bresenham emits a mix of ortho and diagonal steps,
  // and at some point crosses x=2 → x=3.
  const s = makeState();
  assert.equal(lineOfSight(s, [1, 1], [5, 2]), false);
});

// --- Doors ---------------------------------------------------------------

test('through an open door — visible', () => {
  const s = makeState({ door: { a: [2, 2], b: [3, 2], state: 'open' } });
  assert.equal(lineOfSight(s, [1, 2], [4, 2]), true);
});

test('through a closed door — blocked', () => {
  const s = makeState({ door: { a: [2, 2], b: [3, 2], state: 'closed' } });
  assert.equal(lineOfSight(s, [1, 2], [4, 2]), false);
});

test('diagonal through an open door — visible', () => {
  // Door open between (2,2)-(3,2). Diagonal from (1,1) to (4,3) crosses
  // around the door — one L-path goes through the open door, so visible.
  const s = makeState({ door: { a: [2, 2], b: [3, 2], state: 'open' } });
  assert.equal(lineOfSight(s, [1, 1], [4, 3]), true);
});

// --- Corner-grazing permissive rule --------------------------------------

test('corner-graze with one clear L-path — visible', () => {
  // Single-cell wall extension. Build a state where the wall between
  // (2,2)-(3,2) is closed (closed door, which blocks LoS), but the
  // L-path through (1,2)→(1,3) and onwards is open. Diagonal (1,1)→(3,3)
  // can take the southern L-path.
  const s = makeState({ door: { a: [2, 2], b: [3, 2], state: 'closed' } });
  // (1,1)→(2,2)→(3,3): one path crosses the closed-door edge (2,2)→(3,2),
  // the other path crosses (1,1)→(2,1)? Actually both intermediate cells
  // in the diagonal step (1,1)→(2,2) are (1,2) and (2,1) — neither is
  // on the wall edge. The diagonal step (2,2)→(3,3) has intermediates
  // (2,3) and (3,2). The edge (2,3)→(3,3) is across the wall (no door),
  // and (2,2)→(3,2) is the closed door, (3,2)→(3,3) is same-room r2.
  // So path1 (2,2)→(2,3)→(3,3) crosses the (2,3)→(3,3) wall — blocked.
  // Path2 (2,2)→(3,2)→(3,3) crosses the closed door — blocked.
  // Both blocked → diagonal blocked → LoS blocked.
  assert.equal(lineOfSight(s, [1, 1], [3, 3]), false);
});

test('clear diagonal through open room — visible', () => {
  // Both endpoints in r2, no obstacles.
  const s = makeState();
  assert.equal(lineOfSight(s, [3, 0], [5, 5]), true);
});

// --- Intermediate creatures ----------------------------------------------

test('hero/monster on the line blocks LoS', () => {
  // (1,0) → (1,4); (1,2) holds a monster.
  const s = makeState({ occupants: [[1, 2]] });
  assert.equal(lineOfSight(s, [1, 0], [1, 4]), false);
});

test('endpoint cells (caster and target) are not LoS-blockers', () => {
  // Caster at (1,0), target at (1,4) — both are heroes/monsters but
  // they don't block their own line.
  const s = makeState({ occupants: [[1, 0], [1, 4]] });
  assert.equal(lineOfSight(s, [1, 0], [1, 4]), true);
});

// --- Rubble --------------------------------------------------------------

test('rubble on the line blocks LoS', () => {
  const s = makeState({ blocked: [[1, 2]] });
  assert.equal(lineOfSight(s, [1, 0], [1, 4]), false);
});
