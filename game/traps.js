// =====================================================================
// game/traps.js — trap-trigger resolution
//
// `triggerTrapsForCell` is called when a hero steps into a cell.
// Matches the cell against `state.traps`, applies the per-type
// effect (spear / pit / block), mutates the hero + traps + tile,
// and returns `{ fired, halt, endsTurn }` so the click-to-walk
// caller can decide whether to break the walk loop.
//
// Side effects: hero body / status, trap revealed/triggered/disarmed,
// tile.blocked + tile.blockedKind (block-trap only), log entries,
// end-conditions check.
//
// See game/traps.md for the public API + deps contract.
// =====================================================================
'use strict';

const { rollCombatDie, rollAttackDice } = require('./combat');
const { tileAt } = require('./los');

// triggerTrapsForCell(room, hero, cell, deps)
//   deps:
//     logEvent(room, text, cls?)           — narration line
//     checkEndConditions(room)             — promote to winner / defeat
//   returns: { fired, halt, endsTurn }
//     fired    — true if any trap matched the cell
//     halt     — true if the multi-step walk must stop on this cell
//     endsTurn — true if the trap also ends the hero's turn (spear + skull)
//
// Per the 2021 rulebook:
//   spear: 1 combat die
//     skull  → -1 Body, "This ends your turn."         → halt + endsTurn
//     shield → dodged, trap gone forever; walk continues.
//   pit:   -1 Body, hero stays in pit (status.inPit=true).
//          "Zargon stops you" → halt, but hero may still take an action.
//   block: 3 combat dice, each skull = -1 Body, no defence.
//          Cell becomes a PERMANENT falling-block tile.
function triggerTrapsForCell(room, hero, cell, deps) {
  const { logEvent, checkEndConditions } = deps;
  const s = room.state;
  let fired = false, halt = false, endsTurn = false;
  for (const tr of s.traps) {
    if (tr.disarmed || tr.triggered) continue;
    if (tr.at[0] !== cell[0] || tr.at[1] !== cell[1]) continue;
    fired = true;
    if (tr.type === 'spear') {
      const die = rollCombatDie();
      tr.revealed = true;
      if (die === 'skull') {
        tr.triggered = true;
        hero.body = Math.max(0, hero.body - 1);
        logEvent(room, `${hero.name} steps on a spear trap — pierced! -1 Body. Turn ends.`, 'death');
        halt = true; endsTurn = true;
      } else {
        // Dodge: per rulebook p.18 "You may then continue with your move."
        tr.triggered = true; tr.disarmed = true;
        logEvent(room, `${hero.name} dodges a spear trap and presses on.`, 'reveal');
        // halt stays false — BFS walk keeps going
      }
    } else if (tr.type === 'pit') {
      tr.revealed = true;
      tr.triggered = true;          // sprung but persists — pits stay on the board
      hero.body = Math.max(0, hero.body - 1);
      hero.status.inPit = true;
      logEvent(room, `${hero.name} falls into a pit! -1 Body. Combat with -1 die until they climb out.`, 'death');
      halt = true;
    } else if (tr.type === 'block') {
      tr.triggered = true; tr.revealed = true;
      const dice = rollAttackDice(3);
      const dmg = dice.filter(f => f === 'skull').length;
      hero.body = Math.max(0, hero.body - dmg);
      logEvent(room, `Falling block on ${hero.name}: rolled ${dice.filter(f => f === 'skull').length} skull(s) — ${dmg} damage. The cell is now permanently blocked.`, 'death');
      // Mark the cell as a permanent obstruction so no one can pass it.
      // blockedKind = 'falling-block' tells the renderer to paint the red
      // canonical falling-block-trap tile (vs the stone-brick rubble).
      const t = tileAt(s, cell[0], cell[1]);
      if (t) { t.blocked = true; t.blockedKind = 'falling-block'; }
      halt = true;
    }
  }
  checkEndConditions(room);
  return { fired, halt, endsTurn };
}

module.exports = { triggerTrapsForCell };
