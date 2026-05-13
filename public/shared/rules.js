// Shared geometry + adjacency + wall/door rules consumed by both the
// Node server and the browser clients (game + map editor). Single source
// of truth so server-authoritative behavior and client UX previews
// (reachable tiles, hover paths, attack-target validation) cannot drift.
//
// Loaded as a plain script in the browser (`window.HQRules`) and
// `require`d in Node — no build step, no module bundler.
(function (global) {
  'use strict';

  function key(x, y) { return x + ',' + y; }

  function edgeKey(a, b) {
    const [x1, y1] = a, [x2, y2] = b;
    if (x1 < x2 || (x1 === x2 && y1 < y2)) return x1 + ',' + y1 + '|' + x2 + ',' + y2;
    return x2 + ',' + y2 + '|' + x1 + ',' + y1;
  }

  function adjacent(a, b) {
    const dx = Math.abs(a[0] - b[0]), dy = Math.abs(a[1] - b[1]);
    return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
  }

  function adjacentDiag(a, b) {
    const dx = Math.abs(a[0] - b[0]), dy = Math.abs(a[1] - b[1]);
    return (dx <= 1 && dy <= 1) && (dx + dy > 0);
  }

  function chebyshev(a, b) {
    return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
  }

  // Tile lookup. `tileMeta` is a plain object dict on the server and may
  // be a Map on the client (keyed by `${x},${y}`). Handle both.
  function tileAt(s, x, y) {
    const tm = s.tileMeta;
    if (!tm) return null;
    const k = key(x, y);
    if (typeof tm.get === 'function') return tm.get(k) || null;
    return tm[k] || null;
  }

  function doorBetween(s, a, b) {
    if (!s.doors) return undefined;
    return s.doors.find(d =>
      (d.a[0] === a[0] && d.a[1] === a[1] && d.b[0] === b[0] && d.b[1] === b[1]) ||
      (d.a[0] === b[0] && d.a[1] === b[1] && d.b[0] === a[0] && d.b[1] === a[1])
    );
  }

  // True if a solid wall stands between two adjacent cells. Doors are NOT
  // walls (open or closed); their passability is handled separately.
  function wallBetween(s, a, b) {
    const ta = tileAt(s, a[0], a[1]);
    const tb = tileAt(s, b[0], b[1]);
    if (!ta || !tb) return true;
    if (doorBetween(s, a, b)) return false;
    if (ta.roomId !== tb.roomId) return true;
    return false;
  }

  // True if a melee strike between two ortho-adjacent cells is blocked
  // by either a solid wall or a closed door. Heroes / monsters cannot
  // cleave through.
  function meleeBlocked(s, a, b) {
    if (wallBetween(s, a, b)) return true;
    const d = doorBetween(s, a, b);
    if (d && d.state !== 'open') return true;
    return false;
  }

  const api = {
    key, edgeKey,
    adjacent, adjacentDiag, chebyshev,
    tileAt, doorBetween, wallBetween, meleeBlocked,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.HQRules = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
