// Unit tests for game/traps.js — triggerTrapsForCell.

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const traps = require('../game/traps.js');

function stubRandom(seq) {
  const orig = Math.random;
  let i = 0;
  Math.random = () => (i < seq.length ? seq[i++] : 0);
  return () => { Math.random = orig; };
}
const ROLL = { skull: 0.0, heroShield: 0.5, monsterShield: 0.9 };

function makeHero(over = {}) {
  return {
    id: 'h1', name: 'Hero', body: 6, bodyMax: 6,
    at: [5, 5], dead: false,
    status: { inPit: false, skipNextTurn: false },
    ...over,
  };
}

function makeRoom(traps, tiles = {}) {
  return {
    state: {
      traps: traps.map(t => ({ revealed: false, triggered: false, disarmed: false, ...t })),
      tileMeta: tiles, log: [],
    },
  };
}

function noopDeps(over = {}) {
  return {
    logEvent: () => {},
    checkEndConditions: () => false,
    ...over,
  };
}

// ---- No-match -----------------------------------------------------

test('triggerTrapsForCell — no trap at cell → fired:false', () => {
  const hero = makeHero();
  const room = makeRoom([{ id: 't1', type: 'spear', at: [1, 1] }]);
  const r = traps.triggerTrapsForCell(room, hero, [5, 5], noopDeps());
  assert.deepEqual(r, { fired: false, halt: false, endsTurn: false });
  assert.equal(hero.body, 6, 'unchanged');
});

test('triggerTrapsForCell — disarmed trap is skipped', () => {
  const hero = makeHero();
  const room = makeRoom([{ id: 't1', type: 'spear', at: [5, 5], disarmed: true }]);
  const r = traps.triggerTrapsForCell(room, hero, [5, 5], noopDeps());
  assert.equal(r.fired, false);
});

test('triggerTrapsForCell — triggered trap is skipped', () => {
  const hero = makeHero();
  const room = makeRoom([{ id: 't1', type: 'pit', at: [5, 5], triggered: true }]);
  const r = traps.triggerTrapsForCell(room, hero, [5, 5], noopDeps());
  assert.equal(r.fired, false);
});

// ---- Spear --------------------------------------------------------

test('triggerTrapsForCell — spear skull: -1 body, halt + endsTurn', () => {
  const restore = stubRandom([ROLL.skull]);
  try {
    const hero = makeHero({ body: 4 });
    const room = makeRoom([{ id: 't1', type: 'spear', at: [5, 5] }]);
    const r = traps.triggerTrapsForCell(room, hero, [5, 5], noopDeps());
    assert.deepEqual(r, { fired: true, halt: true, endsTurn: true });
    assert.equal(hero.body, 3, '-1 body');
    assert.equal(room.state.traps[0].triggered, true);
    assert.equal(room.state.traps[0].revealed, true);
  } finally { restore(); }
});

test('triggerTrapsForCell — spear shield: dodge, disarm permanently, no halt', () => {
  const restore = stubRandom([ROLL.heroShield]);
  try {
    const hero = makeHero({ body: 4 });
    const room = makeRoom([{ id: 't1', type: 'spear', at: [5, 5] }]);
    const r = traps.triggerTrapsForCell(room, hero, [5, 5], noopDeps());
    assert.deepEqual(r, { fired: true, halt: false, endsTurn: false });
    assert.equal(hero.body, 4, 'no damage on dodge');
    assert.equal(room.state.traps[0].triggered, true);
    assert.equal(room.state.traps[0].disarmed, true, 'spear-dodge disarms it forever');
  } finally { restore(); }
});

// ---- Pit ----------------------------------------------------------

test('triggerTrapsForCell — pit: -1 body, status.inPit set, halt', () => {
  const hero = makeHero({ body: 4 });
  const room = makeRoom([{ id: 't1', type: 'pit', at: [5, 5] }]);
  const r = traps.triggerTrapsForCell(room, hero, [5, 5], noopDeps());
  assert.deepEqual(r, { fired: true, halt: true, endsTurn: false });
  assert.equal(hero.body, 3);
  assert.equal(hero.status.inPit, true);
  // Pits SPRING but persist on the board (not disarmed).
  assert.equal(room.state.traps[0].triggered, true);
  assert.equal(room.state.traps[0].disarmed, false);
});

// ---- Block --------------------------------------------------------

test('triggerTrapsForCell — block: 3 dice, each skull = damage, no defence', () => {
  // 2 skulls + 1 heroShield → 2 damage. No defence dice.
  const restore = stubRandom([ROLL.skull, ROLL.skull, ROLL.heroShield]);
  try {
    const hero = makeHero({ body: 5 });
    const tile = { x: 5, y: 5, blocked: false };
    const room = makeRoom(
      [{ id: 't1', type: 'block', at: [5, 5] }],
      { '5,5': tile });
    const r = traps.triggerTrapsForCell(room, hero, [5, 5], noopDeps());
    assert.deepEqual(r, { fired: true, halt: true, endsTurn: false });
    assert.equal(hero.body, 3, '5 - 2 skulls');
    // Cell becomes permanently rubble.
    assert.equal(tile.blocked, true);
    assert.equal(tile.blockedKind, 'falling-block');
  } finally { restore(); }
});

test('triggerTrapsForCell — block with 0 skulls still locks the cell', () => {
  const restore = stubRandom([ROLL.heroShield, ROLL.heroShield, ROLL.heroShield]);
  try {
    const hero = makeHero({ body: 6 });
    const tile = { x: 5, y: 5, blocked: false };
    const room = makeRoom(
      [{ id: 't1', type: 'block', at: [5, 5] }],
      { '5,5': tile });
    traps.triggerTrapsForCell(room, hero, [5, 5], noopDeps());
    assert.equal(hero.body, 6);
    assert.equal(tile.blocked, true);
  } finally { restore(); }
});

// ---- Side effects -------------------------------------------------

test('triggerTrapsForCell — calls checkEndConditions once at the end', () => {
  let calls = 0;
  const hero = makeHero();
  const room = makeRoom([{ id: 't1', type: 'pit', at: [5, 5] }]);
  traps.triggerTrapsForCell(room, hero, [5, 5],
    noopDeps({ checkEndConditions: () => { calls++; } }));
  assert.equal(calls, 1);
});

test('triggerTrapsForCell — logs the spear trigger', () => {
  const restore = stubRandom([ROLL.skull]);
  try {
    const hero = makeHero();
    const room = makeRoom([{ id: 't1', type: 'spear', at: [5, 5] }]);
    const lines = [];
    traps.triggerTrapsForCell(room, hero, [5, 5],
      noopDeps({ logEvent: (_r, t) => lines.push(t) }));
    assert.ok(lines.some(l => /spear/i.test(l)));
  } finally { restore(); }
});
