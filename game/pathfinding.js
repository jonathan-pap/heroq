// =====================================================================
// game/pathfinding.js — BFS pathfinder + visible-branch counter
//
// `findPath` is a vanilla 4-neighbour BFS over the playable grid,
// using a caller-supplied `passable(s, from, to, mover)` predicate
// so this module stays decoupled from the spell / occupant rules
// that drive movement.
//
// `countVisibleBranches` powers the corridor intersection-stop rule
// in the click-to-walk handler: pause the hero when they reach a
// cell with more than one forward option still visible.
//
// See game/pathfinding.md for the public API + state contract.
// =====================================================================
'use strict';

const HQRules = require('../public/shared/rules.js');
const { wallBetween, doorBetween } = HQRules;
const { tileAt, occupantAt, isMultiShareCell } = require('./los');

// findPath(s, hero, target, maxLength, passable)
//   → array of cells `[hero.at, …, target]` (inclusive), or `null`
//     when no path of length ≤ maxLength exists.
//
// `passable` is the caller's movement predicate — typically the
// server's `passable(s, fromCell, toCell, mover)` which returns
// `true`, `false`, or `{ needsOpenDoor: door }`. We treat any
// truthy return as walkable (the click-to-walk handler in server.js
// reacts to `needsOpenDoor` separately when stepping).
function findPath(s, hero, target, maxLength, passable) {
  const sx = hero.at[0], sy = hero.at[1];
  if (sx === target[0] && sy === target[1]) return [hero.at];

  const finalT = tileAt(s, target[0], target[1]);
  if (!finalT) return null;
  if (finalT.furnitureId) return null;

  // 2021 multi-share exception — heroes may end on a cell with another
  // hero only when it's a stair tile or a sprung pit.
  const occ = occupantAt(s, target);
  if (occ) {
    if (occ.kind === 'hero' && isMultiShareCell(s, target)) {
      // share allowed
    } else {
      return null;
    }
  }

  const visited = new Map();
  visited.set(`${sx},${sy}`, null);
  const queue = [[hero.at, 0]];
  while (queue.length > 0) {
    const [cur, dist] = queue.shift();
    if (cur[0] === target[0] && cur[1] === target[1]) {
      const path = [];
      let k = `${cur[0]},${cur[1]}`;
      while (k != null) {
        const [x, y] = k.split(',').map(Number);
        path.unshift([x, y]);
        k = visited.get(k);
      }
      return path;
    }
    if (dist >= maxLength) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = [cur[0] + dx, cur[1] + dy];
      const nk = `${n[0]},${n[1]}`;
      if (visited.has(nk)) continue;
      const result = passable(s, cur, n, { kind: 'hero', id: hero.id });
      if (!result) continue;
      visited.set(nk, `${cur[0]},${cur[1]}`);
      queue.push([n, dist + 1]);
    }
  }
  return null;
}

// countVisibleBranches(s, here, prev) → integer
//   Number of cardinal neighbours of `here` (excluding `prev`) that
//   heroes can currently SEE: not solid rock, not behind a wall, not
//   behind a closed-and-undiscovered door, not fogged. Used by the
//   click-to-walk handler to halt at corridor intersections.
function countVisibleBranches(s, here, prev) {
  let n = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const cand = [here[0] + dx, here[1] + dy];
    if (prev && cand[0] === prev[0] && cand[1] === prev[1]) continue;
    const tc = tileAt(s, cand[0], cand[1]);
    if (!tc || tc.solidRock) continue;
    if (tc.hiddenFor && tc.hiddenFor.heroes) continue;
    if (wallBetween(s, here, cand)) continue;
    const door = doorBetween(s, here, cand);
    if (door && door.state !== 'open' && !door.revealed) continue;
    n++;
  }
  return n;
}

module.exports = { findPath, countVisibleBranches };
