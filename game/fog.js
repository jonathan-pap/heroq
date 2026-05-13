// Fog-of-war / visibility engine. Single source of truth for what the
// heroes can see at any moment.
//
// Canonical 2021 fog-of-war rules:
//   - When a hero ENTERS a room, the WHOLE room is revealed at once.
//   - When a hero stands in a CORRIDOR, only cells in cardinal LOS are
//     revealed — blocked by solid rock, walls, and closed doors.
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
const { tileAt, doorBetween } = HQRules;

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
  // the ray.
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let cur = [hero.at[0], hero.at[1]];
    while (true) {
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
