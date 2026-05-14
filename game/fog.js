// Fog-of-war / visibility engine. Single source of truth for what the
// heroes can see at any moment.
//
// Canonical 2021 fog-of-war rules:
//   - When a hero ENTERS a room, the WHOLE room is revealed at once.
//   - When a hero stands in a CORRIDOR, only cells in cardinal LOS are
//     revealed — blocked by solid rock, walls, and closed doors.
//   - Cardinal rays also peek ONE cell perpendicular into adjacent
//     corridors as the ray passes ("see one cell down side passages").
//     When the depth-1 peek cell sits in a corridor running parallel
//     to the main ray for at least 2 cells back, a depth-2 peek fires
//     too — so walking down a 2-wide corridor lets you see one cell
//     into the perpendicular passage beyond your parallel lane. Walls
//     and closed doors still block the peek; rooms still need a door.
//   - Opening a door reveals the ROOM behind it, cascading through
//     chained open doors.
//
// All functions take a state object that follows the server's shape:
//   { tileMeta, allTileKeys, roomState, doors, monsters, heroes,
//     stairCells, traps, ... }
// and an optional `log(text, cls)` callback for surfacing reveal events.
// They mutate state in-place — visibility is part of the canonical model
// (see audit Q4 in docs/architecture.md if you ever extract per-player
// fog later).
'use strict';
const HQRules = require('../public/shared/rules.js');
const { tileAt, doorBetween, wallBetween } = HQRules;

function noop() {}

// Reveal a whole room (tiles, doors touching it, monsters in it).
// Used for legacy / manual reveal triggers; normal play goes through
// `recomputeFromHeroes`. Returns true if the room actually changed.
function revealRoomById(state, roomId, log = noop) {
  const rs = state.roomState[roomId];
  if (!rs || !rs.hiddenFor.heroes) return false;
  rs.hiddenFor.heroes = false;
  for (const k of state.allTileKeys) {
    const t = state.tileMeta[k];
    if (t.roomId === roomId) t.hiddenFor.heroes = false;
  }
  for (const d of state.doors) {
    const ta = tileAt(state, d.a[0], d.a[1]);
    const tb = tileAt(state, d.b[0], d.b[1]);
    if ((ta && ta.roomId === roomId) || (tb && tb.roomId === roomId)) d.revealed = true;
  }
  for (const m of state.monsters) {
    if (m.roomId === roomId && !m.dead) m.active = true;
  }
  log(`${rs.name} revealed!`, 'reveal');
  return true;
}

// Reveal everything visible to one hero from their current cell.
// Mutates state and (optionally) appends to a log via the callback.
function recomputeFromHero(state, hero, log = noop) {
  if (!hero || hero.dead) return;
  const newlyRevealedRooms = new Set();

  function revealCell(t) {
    if (!t || t.solidRock || !t.hiddenFor.heroes) return;
    t.hiddenFor.heroes = false;
    if (t.roomId && state.roomState[t.roomId].hiddenFor.heroes) {
      state.roomState[t.roomId].hiddenFor.heroes = false;
      newlyRevealedRooms.add(t.roomId);
    }
  }
  function revealWholeRoom(rid) {
    if (!rid) return;
    for (const k of state.allTileKeys) {
      const t = state.tileMeta[k];
      if (t.roomId === rid) revealCell(t);
    }
  }

  const start = tileAt(state, hero.at[0], hero.at[1]);
  if (!start) return;
  revealCell(start);
  if (start.roomId) revealWholeRoom(start.roomId);

  // Cardinal raycasts from the hero's cell. Each ray walks one cell at
  // a time, stopping when it hits rock, a wall, or a closed door.
  // Crossing into a different room reveals that room whole and ends
  // the ray. At every cell along the ray (including the hero's start
  // cell) the engine ALSO peeks one cell perpendicular into corridors
  // — "you can see one cell down the side passage as you pass it".
  // A depth-2 peek fires when the depth-1 cell sits inside a corridor
  // running parallel to the main ray for at least two cells "behind"
  // (i.e. the hero has been walking down a 2-wide corridor, and at the
  // turn into a perpendicular passage can see one more cell into it).
  // Walls and closed doors block the peek; rooms are corridor-only.
  function peekFrom(cur, dx, dy) {
    const perps = (dx !== 0) ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
    for (const [px, py] of perps) {
      const p1 = [cur[0] + px, cur[1] + py];
      if (wallBetween(state, cur, p1)) continue;
      const door1 = doorBetween(state, cur, p1);
      if (door1 && door1.state !== 'open') continue;
      const t1 = tileAt(state, p1[0], p1[1]);
      // Corridor-only — rooms still need a door to reveal.
      if (!t1 || t1.solidRock || t1.roomId !== null) continue;
      revealCell(t1);
      // Parallel-lane check: the depth-1 cell must sit in a corridor
      // running parallel to the main ray for at least 2 cells "behind"
      // (opposite of the main-ray direction).
      const b1 = tileAt(state, p1[0] - dx, p1[1] - dy);
      if (!b1 || b1.solidRock || b1.roomId !== null) continue;
      const b2 = tileAt(state, p1[0] - 2 * dx, p1[1] - 2 * dy);
      if (!b2 || b2.solidRock || b2.roomId !== null) continue;
      const p2 = [cur[0] + 2 * px, cur[1] + 2 * py];
      if (wallBetween(state, p1, p2)) continue;
      const door2 = doorBetween(state, p1, p2);
      if (door2 && door2.state !== 'open') continue;
      const t2 = tileAt(state, p2[0], p2[1]);
      if (!t2 || t2.solidRock || t2.roomId !== null) continue;
      revealCell(t2);
    }
  }

  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let cur = [hero.at[0], hero.at[1]];
    while (true) {
      peekFrom(cur, dx, dy);
      const next = [cur[0] + dx, cur[1] + dy];
      const tn = tileAt(state, next[0], next[1]);
      if (!tn || tn.solidRock) break;
      const tCur = tileAt(state, cur[0], cur[1]);
      const door = doorBetween(state, cur, next);
      const sameZone = (tCur.roomId === tn.roomId);
      if (!sameZone && (!door || door.state !== 'open')) break;
      revealCell(tn);
      if (tn.roomId && tn.roomId !== tCur.roomId) {
        revealWholeRoom(tn.roomId);
        break;
      }
      cur = next;
    }
  }

  // Cascading open-door room reveals: an open door with a revealed cell
  // on one side and a hidden ROOM cell on the other reveals the whole
  // connected room. Iterate until stable so chained open doors
  // (room → room → room) cascade correctly. Corridor cells beyond an
  // open door stay hidden unless cardinal LOS already reached them.
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of state.doors) {
      if (d.state !== 'open') continue;
      const ta = tileAt(state, d.a[0], d.a[1]);
      const tb = tileAt(state, d.b[0], d.b[1]);
      if (!ta || !tb) continue;
      const aRev = !ta.hiddenFor.heroes;
      const bRev = !tb.hiddenFor.heroes;
      if (aRev === bRev) continue;
      const dst = aRev ? tb : ta;
      if (dst.roomId && dst.hiddenFor.heroes) {
        revealCell(dst);
        revealWholeRoom(dst.roomId);
        changed = true;
      }
    }
  }

  // Doors adjacent to any visible cell become revealed so heroes can
  // see they exist even if the far side is still hidden.
  for (const d of state.doors) {
    if (d.revealed) continue;
    const ta = tileAt(state, d.a[0], d.a[1]);
    const tb = tileAt(state, d.b[0], d.b[1]);
    if ((ta && !ta.hiddenFor.heroes) || (tb && !tb.hiddenFor.heroes)) {
      d.revealed = true;
    }
  }

  // Activate monsters in newly-revealed rooms; surface a log line per room.
  for (const rid of newlyRevealedRooms) {
    const rs = state.roomState[rid];
    for (const m of state.monsters) {
      if (m.roomId === rid && !m.dead) m.active = true;
    }
    log(`${rs.name} revealed!`, 'reveal');
  }
  // ALSO activate corridor monsters (roomId == null) once their cell is
  // visible to the heroes — without this they sit inert even after the
  // hero's cardinal raycast has spotted them.
  for (const m of state.monsters) {
    if (m.dead || m.active) continue;
    if (m.roomId) continue;
    const t = tileAt(state, m.at[0], m.at[1]);
    if (t && !t.hiddenFor.heroes) {
      m.active = true;
      log(`A ${m.type} stirs in the corridor!`, 'reveal');
    }
  }
}

// Recompute visibility from every living hero. Call after any state
// change that could shift LOS: hero move, door open, secret-door reveal.
function recomputeFromAllHeroes(state, log = noop) {
  if (!state) return;
  for (const h of state.heroes) {
    if (!h.dead) recomputeFromHero(state, h, log);
  }
}

module.exports = {
  revealRoomById,
  recomputeFromHero,
  recomputeFromAllHeroes,
};
