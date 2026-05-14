// =====================================================================
// game/los.js — line-of-sight + occupant queries
//
// Pure functions over the server's `state` shape. Walks the
// Bresenham line between two cells and reports whether the trace is
// blocked by walls, closed doors, rubble, or intermediate occupants.
//
// Shared wall / door predicates come from public/shared/rules.js so
// the browser previews use the exact same rules as the server.
//
// See game/los.md for the public API + state-shape contract.
// =====================================================================
'use strict';

const { bresenham } = require('./util');
const HQRules = require('../public/shared/rules.js');
const { key, doorBetween, wallBetween } = HQRules;

// ---- State accessors ------------------------------------------------
// tileAt(s, x, y) — fetches the tile-meta record at (x, y), or null
// when the cell is off the board.
function tileAt(s, x, y) { return s.tileMeta[key(x, y)] || null; }

// occupantAt(s, cell) — first hero or monster whose `.at` matches the
// given cell (dead pieces are ignored). Returns
// `{ kind: 'hero'|'monster', id, ref }` or `null`.
function occupantAt(s, cell) {
  for (const h of s.heroes) {
    if (!h.dead && h.at[0] === cell[0] && h.at[1] === cell[1]) {
      return { kind: 'hero', id: h.id, ref: h };
    }
  }
  for (const m of s.monsters) {
    if (!m.dead && m.at[0] === cell[0] && m.at[1] === cell[1]) {
      return { kind: 'monster', id: m.id, ref: m };
    }
  }
  return null;
}

// ---- Fog-of-war visibility -----------------------------------------
// isMonsterVisibleToHeroes(s, m) — used by the move loop to detect
// "new monster came into view" reveal-stops. A monster is visible
// when its room (or corridor cell) is no longer hidden for heroes.
function isMonsterVisibleToHeroes(s, m) {
  if (!m || m.dead) return false;
  if (m.roomId) return !s.roomState[m.roomId].hiddenFor.heroes;
  const t = s.tileMeta[key(m.at[0], m.at[1])];
  return !!(t && !t.hiddenFor.heroes);
}

// ---- LoS edge predicate --------------------------------------------
// losEdgeBlocked(s, a, b) — true if the edge between the two ortho-
// adjacent cells `a` and `b` blocks line-of-sight: a solid wall, or
// a CLOSED door. Open doors and same-zone neighbours are clear.
function losEdgeBlocked(s, a, b) {
  if (wallBetween(s, a, b)) return true;
  const door = doorBetween(s, a, b);
  if (door && door.state !== 'open') return true;
  return false;
}

// ---- Line of sight --------------------------------------------------
// lineOfSight(s, from, to) — 2021 rulebook LoS: an unobstructed
// straight line from caster centre to target centre. Walls, closed
// doors, rubble cells, and intermediate creatures block.
//
// Diagonal-step rule: when the Bresenham line crosses the corner
// where four cells meet, both L-paths around the corner are
// considered. The diagonal is blocked only when BOTH L-paths are
// shut. A single clear side keeps the line visible (per the canonical
// "even if the line just touches a corner" clause).
function lineOfSight(s, from, to) {
  if (from[0] === to[0] && from[1] === to[1]) return true;
  const cells = bresenham(from, to);
  for (let i = 1; i < cells.length; i++) {
    const a = cells[i - 1], b = cells[i];
    const tb = tileAt(s, b[0], b[1]);
    if (!tb) return false;

    if (a[0] === b[0] || a[1] === b[1]) {
      // Orthogonal step — single edge check.
      if (losEdgeBlocked(s, a, b)) return false;
    } else {
      // Diagonal step — corner traversal. Two L-paths around the
      // corner; both must be shut to block the line.
      const c1 = [a[0], b[1]];
      const c2 = [b[0], a[1]];
      const path1Open = !losEdgeBlocked(s, a, c1) && !losEdgeBlocked(s, c1, b);
      const path2Open = !losEdgeBlocked(s, a, c2) && !losEdgeBlocked(s, c2, b);
      if (!path1Open && !path2Open) return false;
    }

    // Intermediate-cell blocking — rubble (sprung falling-block trap)
    // and any creature standing mid-line. Endpoints (caster + target)
    // are excluded from this check.
    if (i < cells.length - 1) {
      if (tb.blocked) return false;
      if (occupantAt(s, b)) return false;
    }
  }
  return true;
}

// ---- Multi-share cell rule -----------------------------------------
// isMultiShareCell(s, cell) — true when two heroes are allowed to
// stand on the same cell. Per the 2021 rules: stair cells and a
// SPRUNG pit (a pit trap that's been triggered) are the only places.
function isMultiShareCell(s, cell) {
  if (!cell) return false;
  if (Array.isArray(s.stairCells) &&
      s.stairCells.some(c => c[0] === cell[0] && c[1] === cell[1])) return true;
  if (Array.isArray(s.traps)) {
    return s.traps.some(t =>
      t.type === 'pit' && t.triggered &&
      t.at[0] === cell[0] && t.at[1] === cell[1]);
  }
  return false;
}

module.exports = {
  tileAt,
  occupantAt,
  isMonsterVisibleToHeroes,
  losEdgeBlocked,
  lineOfSight,
  isMultiShareCell,
};
