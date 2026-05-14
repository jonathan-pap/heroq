// =====================================================================
// game/treasure-deck.js — treasure-deck draw + card resolution
//
// `drawTreasureCard(room, hero, deps)` is the only external entry
// point. It pops the next card off the shuffled deck, applies the
// effect (gold / potion / trap / wandering monster / etc.), updates
// the discard pile, and runs `checkEndConditions`.
//
// `adjacentFreeCells` is a small helper used by the wandering-monster
// effect; exported for testability.
//
// Side effects: hero gold / body / inventory / status, monsters list
// (wandering spawn), revealedTreasureCard, treasureDiscard, log,
// end conditions.
//
// See game/treasure-deck.md for the public API + deps contract.
// =====================================================================
'use strict';

const HQRules = require('../public/shared/rules.js');
const { wallBetween, doorBetween } = HQRules;
const { shuffle, rollD6 } = require('./util');
const { tileAt, occupantAt } = require('./los');

// adjacentFreeCells(s, at)
//   Same room/corridor segment as `at`, no wall (or closed door)
//   between. Used for wandering-monster placement — canonical rule
//   is "adjacent to a hero", which the rulebook scopes to the same
//   room or unbroken corridor.
function adjacentFreeCells(s, at) {
  const out = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const c = [at[0] + dx, at[1] + dy];
    const t = tileAt(s, c[0], c[1]);
    if (!t) continue;
    if (t.blocked) continue;
    if (t.furnitureId) continue;
    if (occupantAt(s, c)) continue;
    if (wallBetween(s, at, c)) continue;          // different room, no door
    const door = doorBetween(s, at, c);
    if (door && door.state !== 'open') continue;  // closed door = no spawn
    out.push(c);
  }
  return out;
}

// drawTreasureCard(room, hero, deps)
//   Re-shuffles the discard pile back into the deck if empty, pops
//   the next card, records it as `revealedTreasureCard`, applies the
//   effect. Returns the card object (or `null` if both deck and
//   discard are empty).
function drawTreasureCard(room, hero, deps) {
  const s = room.state;
  if (s.treasureDeck.length === 0) {
    s.treasureDeck = shuffle(s.treasureDiscard);
    s.treasureDiscard = [];
  }
  if (s.treasureDeck.length === 0) return null;
  const card = s.treasureDeck.shift();
  s.revealedTreasureCard = { ...card, drawnBy: hero.id };
  applyTreasureCard(room, hero, card, deps);
  return card;
}

// applyTreasureCard(room, hero, card, deps)
//   Per-effect mutation. Effects covered (see data/cards/treasure.yaml):
//     gold, goldDiceTimesTen, keepPotion, keepConsumable, nothing,
//     trapArrow, trapPit, wanderingMonster.
function applyTreasureCard(room, hero, card, deps) {
  const { logEvent, MONSTER_TYPES, resolveAttack, checkEndConditions } = deps;
  const s = room.state;
  switch (card.effect) {
    case 'gold': {
      hero.gold += card.amount || 0;
      logEvent(room, `${hero.name} draws ${card.name}: +${card.amount} gold.`, 'treasure');
      break;
    }
    case 'goldDiceTimesTen': {
      const r = rollD6() * 10;
      hero.gold += r;
      hero.status.skipNextTurn = (card.sideEffect === 'missNextTurn');
      logEvent(room, `${hero.name} draws ${card.name}: rolled ${r / 10}, +${r} gold (will miss next turn).`, 'treasure');
      break;
    }
    case 'keepPotion':
    case 'keepConsumable': {
      hero.inventory.push({ id: card.id, name: card.name, use: card.use, amount: card.amount, bonus: card.bonus });
      logEvent(room, `${hero.name} pockets a ${card.name}.`, 'treasure');
      break;
    }
    case 'nothing':
      logEvent(room, `${hero.name} searches but finds nothing.`);
      break;
    case 'trapArrow': {
      hero.body = Math.max(0, hero.body - (card.damage || 1));
      logEvent(room, `${hero.name} springs an arrow trap! -${card.damage || 1} Body.`, 'death');
      break;
    }
    case 'trapPit': {
      hero.body = Math.max(0, hero.body - (card.damage || 1));
      hero.status.skipNextTurn = true;
      logEvent(room, `${hero.name} falls into a pit! -${card.damage || 1} Body, miss next turn.`, 'death');
      break;
    }
    case 'wanderingMonster': {
      // GM places: spawn quest's wandering monster adjacent to hero on a free cell
      const proto = MONSTER_TYPES[s.wanderingMonster] || MONSTER_TYPES.goblin;
      const free = adjacentFreeCells(s, hero.at);
      if (free.length === 0) {
        logEvent(room, `A wandering monster lurks but finds no space.`);
        break;
      }
      const cell = free[Math.floor(Math.random() * free.length)];
      const newId = `wm-${Date.now()}-${Math.floor(Math.random() * 999)}`;
      s.monsters.push({
        id: newId, type: s.wanderingMonster, name: null,
        bodyMax: proto.body, body: proto.body,
        mindMax: proto.mind, mind: proto.mind,
        attack: proto.attack, defend: proto.defend,
        moveSquares: proto.move,
        at: cell, roomId: tileAt(s, cell[0], cell[1])?.roomId || null,
        dead: false, active: true,
        status: { skipNextTurn: false, sleeping: false },
      });
      logEvent(room, `A wandering ${proto.name} appears next to ${hero.name}!`, 'reveal');
      // The card says "attacks immediately". Resolve a single attack now.
      const newM = s.monsters[s.monsters.length - 1];
      resolveAttack(room, { kind: 'monster', ref: newM }, { kind: 'hero', ref: hero });
      break;
    }
  }
  if (card.returnToDeck) {
    s.treasureDiscard.push(card);
  } else if (!card.keep) {
    s.treasureDiscard.push(card);
  }
  checkEndConditions(room);
}

module.exports = { drawTreasureCard, applyTreasureCard, adjacentFreeCells };
