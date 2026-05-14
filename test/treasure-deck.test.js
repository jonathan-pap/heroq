// Unit tests for game/treasure-deck.js — drawTreasureCard +
// applyTreasureCard + adjacentFreeCells.

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const td = require('../game/treasure-deck.js');

function makeHero(over = {}) {
  return {
    id: 'h1', name: 'Hero', body: 6, bodyMax: 6,
    gold: 0, inventory: [],
    at: [3, 3],
    status: { skipNextTurn: false },
    ...over,
  };
}

function makeRoom(stateOver = {}) {
  return {
    state: {
      heroes: [], monsters: [], log: [],
      treasureDeck: [], treasureDiscard: [],
      revealedTreasureCard: null,
      wanderingMonster: 'goblin',
      tileMeta: {},
      doors: [],
      ...stateOver,
    },
  };
}

function noopDeps(over = {}) {
  return {
    logEvent: () => {},
    MONSTER_TYPES: {},
    resolveAttack: () => {},
    checkEndConditions: () => false,
    ...over,
  };
}

// ---- drawTreasureCard ----------------------------------------------

test('drawTreasureCard — null when deck and discard both empty', () => {
  const hero = makeHero();
  const room = makeRoom();
  assert.equal(td.drawTreasureCard(room, hero, noopDeps()), null);
});

test('drawTreasureCard — pops next card, records revealed, calls applyTreasureCard', () => {
  const hero = makeHero();
  const card = { id: 'c1', name: 'Gold Pile', effect: 'gold', amount: 50 };
  const room = makeRoom({ treasureDeck: [card] });
  const drawn = td.drawTreasureCard(room, hero, noopDeps());
  assert.equal(drawn, card);
  assert.equal(room.state.revealedTreasureCard.id, 'c1');
  assert.equal(room.state.revealedTreasureCard.drawnBy, 'h1');
  assert.equal(hero.gold, 50);
  assert.equal(room.state.treasureDeck.length, 0);
  // Default (no card.keep, no card.returnToDeck): discard pile picks it up.
  assert.equal(room.state.treasureDiscard.length, 1);
});

test('drawTreasureCard — reshuffles discard when deck empties', () => {
  const hero = makeHero();
  const card = { id: 'c1', name: 'Empty', effect: 'nothing' };
  const room = makeRoom({ treasureDeck: [], treasureDiscard: [card] });
  const drawn = td.drawTreasureCard(room, hero, noopDeps());
  assert.equal(drawn, card, 'discard reshuffled into deck and drawn');
  assert.equal(room.state.treasureDiscard.length, 1, 're-discarded after draw');
});

// ---- applyTreasureCard — effects -----------------------------------

test('gold — adds amount, logs', () => {
  const hero = makeHero();
  const room = makeRoom();
  const lines = [];
  td.applyTreasureCard(
    room, hero,
    { name: 'Gold Pile', effect: 'gold', amount: 30 },
    noopDeps({ logEvent: (_r, t) => lines.push(t) }),
  );
  assert.equal(hero.gold, 30);
  assert.ok(lines.some(l => /30 gold/.test(l)));
});

test('goldDiceTimesTen — rolls d6, multiplies by 10', () => {
  const orig = Math.random; Math.random = () => 0.5;   // → floor(0.5*6)+1 = 4
  try {
    const hero = makeHero();
    const room = makeRoom();
    td.applyTreasureCard(
      room, hero,
      { name: 'Riches', effect: 'goldDiceTimesTen', sideEffect: 'missNextTurn' },
      noopDeps(),
    );
    assert.equal(hero.gold, 40);
    assert.equal(hero.status.skipNextTurn, true);
  } finally { Math.random = orig; }
});

test('keepPotion — pushes to inventory', () => {
  const hero = makeHero();
  const room = makeRoom();
  td.applyTreasureCard(
    room, hero,
    { id: 'pot', name: 'Healing Potion', effect: 'keepPotion',
      use: 'heal', amount: 4 },
    noopDeps(),
  );
  assert.equal(hero.inventory.length, 1);
  assert.equal(hero.inventory[0].use, 'heal');
});

test('nothing — no-op', () => {
  const hero = makeHero();
  const room = makeRoom();
  td.applyTreasureCard(room, hero,
    { name: 'Dust', effect: 'nothing' }, noopDeps());
  assert.equal(hero.gold, 0);
  assert.equal(hero.inventory.length, 0);
});

test('trapArrow — -damage body', () => {
  const hero = makeHero({ body: 4 });
  const room = makeRoom();
  td.applyTreasureCard(room, hero,
    { name: 'Arrow Trap', effect: 'trapArrow', damage: 2 }, noopDeps());
  assert.equal(hero.body, 2);
});

test('trapPit — -damage body AND skipNextTurn', () => {
  const hero = makeHero({ body: 4 });
  const room = makeRoom();
  td.applyTreasureCard(room, hero,
    { name: 'Pit', effect: 'trapPit', damage: 1 }, noopDeps());
  assert.equal(hero.body, 3);
  assert.equal(hero.status.skipNextTurn, true);
});

test('card.returnToDeck → discard pile (always so)', () => {
  const hero = makeHero();
  const room = makeRoom();
  td.applyTreasureCard(room, hero,
    { name: 'Returning', effect: 'nothing', returnToDeck: true },
    noopDeps());
  assert.equal(room.state.treasureDiscard.length, 1);
});

test('card.keep — not added to discard', () => {
  const hero = makeHero();
  const room = makeRoom();
  td.applyTreasureCard(room, hero,
    { name: 'Permanent', effect: 'keepPotion', use: 'heal', keep: true },
    noopDeps());
  assert.equal(room.state.treasureDiscard.length, 0);
});

// ---- wanderingMonster -----------------------------------------------

test('wanderingMonster — spawns adjacent if free, calls resolveAttack', () => {
  const hero = makeHero({ at: [3, 3] });
  // Build a small open room around the hero so adjacentFreeCells has options.
  const tileMeta = {};
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      tileMeta[`${3 + dx},${3 + dy}`] = { x: 3 + dx, y: 3 + dy, roomId: 'r1', blocked: false, furnitureId: null };
  const room = makeRoom({ heroes: [hero], tileMeta });
  let attackCalls = 0;
  td.applyTreasureCard(
    room, hero,
    { name: 'Wandering', effect: 'wanderingMonster' },
    noopDeps({
      MONSTER_TYPES: { goblin: { name: 'Goblin', body: 1, mind: 1, attack: 2, defend: 1, move: 10 } },
      resolveAttack: () => { attackCalls++; },
    }),
  );
  assert.equal(room.state.monsters.length, 1, 'spawn');
  assert.equal(attackCalls, 1, 'immediately attacks');
});

test('wanderingMonster — no free cell, just logs and bails', () => {
  const hero = makeHero({ at: [3, 3] });
  // Block all neighbours with `blocked: true`.
  const tileMeta = {
    '3,3': { x: 3, y: 3, roomId: 'r1' },
    '4,3': { x: 4, y: 3, roomId: 'r1', blocked: true },
    '2,3': { x: 2, y: 3, roomId: 'r1', blocked: true },
    '3,4': { x: 3, y: 4, roomId: 'r1', blocked: true },
    '3,2': { x: 3, y: 2, roomId: 'r1', blocked: true },
  };
  const room = makeRoom({ heroes: [hero], tileMeta });
  let attackCalls = 0;
  td.applyTreasureCard(
    room, hero,
    { name: 'Wandering', effect: 'wanderingMonster' },
    noopDeps({
      MONSTER_TYPES: { goblin: { name: 'Goblin', body: 1, mind: 1, attack: 2, defend: 1, move: 10 } },
      resolveAttack: () => { attackCalls++; },
    }),
  );
  assert.equal(room.state.monsters.length, 0);
  assert.equal(attackCalls, 0);
});

// ---- adjacentFreeCells ----------------------------------------------

test('adjacentFreeCells — blocked / furniture / occupied / different-room all excluded', () => {
  const at = [3, 3];
  const tileMeta = {
    '3,3': { roomId: 'r1' },
    '4,3': { roomId: 'r1' },                  // free
    '2,3': { roomId: 'r1', blocked: true },   // blocked
    '3,4': { roomId: 'r1', furnitureId: 'f1' },// furniture
    '3,2': { roomId: 'r2' },                  // different room
  };
  const s = { heroes: [], monsters: [], tileMeta, doors: [] };
  const free = td.adjacentFreeCells(s, at);
  assert.equal(free.length, 1);
  assert.deepEqual(free[0], [4, 3]);
});

test('adjacentFreeCells — closed door blocks, open door allows', () => {
  const at = [3, 3];
  const tileMeta = {
    '3,3': { roomId: 'r1' },
    '4,3': { roomId: 'r2' },  // different room
  };
  // Closed door → no spawn.
  let s = { heroes: [], monsters: [], tileMeta,
            doors: [{ a: [3, 3], b: [4, 3], state: 'closed' }] };
  assert.equal(td.adjacentFreeCells(s, at).length, 0);
  // Open door → spawn allowed.
  s = { heroes: [], monsters: [], tileMeta,
        doors: [{ a: [3, 3], b: [4, 3], state: 'open' }] };
  assert.equal(td.adjacentFreeCells(s, at).length, 1);
});
