// Unit tests for game/spells.js — applySpellEffect + resolveTarget.

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const spells = require('../game/spells.js');

// ---- Helpers --------------------------------------------------------

function stubRandom(seq) {
  const orig = Math.random;
  let i = 0;
  Math.random = () => (i < seq.length ? seq[i++] : 0);
  return () => { Math.random = orig; };
}
const ROLL = { skull: 0.0, heroShield: 0.5, monsterShield: 0.9 };

function makeHero(over = {}) {
  return {
    id: 'h1', name: 'Wizard',
    body: 4, bodyMax: 4, mind: 6,
    attackBase: 1, defendBase: 2,
    at: [0, 0], dead: false,
    inventory: [], equipped: {},
    status: { doubleNextMovement: false, passWalls: false, passOccupants: false,
              rockSkin: false, courage: false, skipNextTurn: false,
              sleeping: false, inPit: false,
              bonusAttackOnce: 0, bonusDefendOnce: 0 },
    ...over,
  };
}
function makeMonster(over = {}) {
  return {
    id: 'm1', type: 'orc', name: null,
    body: 2, bodyMax: 2, mind: 2,
    attack: 3, defend: 2, defendBase: 2,
    at: [3, 0], dead: false,
    status: { sleeping: false },
    ...over,
  };
}
function makeRoom(stateOver = {}) {
  // tileMeta shape used by los.lineOfSight: roomId per cell.
  // Two-cell room "r1" — wizard at (0,0), orc at (3,0) both in r1 so
  // LoS is trivially clear (no walls / doors between).
  const tileMeta = {};
  for (let x = 0; x <= 5; x++) tileMeta[`${x},0`] = { x, y: 0, roomId: 'r1', hiddenFor: {} };
  return {
    state: {
      heroes: [], monsters: [], log: [], doors: [],
      tileMeta, combat: null,
      ...stateOver,
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

// ---- resolveTarget --------------------------------------------------

test('resolveTarget — hero by id, skips dead', () => {
  const live = makeHero({ id: 'h1' });
  const dead = makeHero({ id: 'h2', dead: true });
  const s = { heroes: [live, dead], monsters: [] };
  assert.deepEqual(spells.resolveTarget(s, 'hero', { kind: 'hero', id: 'h1' }), { kind: 'hero', ref: live });
  assert.equal(spells.resolveTarget(s, 'hero', { kind: 'hero', id: 'h2' }), null);
  assert.equal(spells.resolveTarget(s, 'hero', { kind: 'hero', id: 'h3' }), null);
});

test('resolveTarget — monster by id', () => {
  const orc = makeMonster({ id: 'm1' });
  const s = { heroes: [], monsters: [orc] };
  assert.deepEqual(spells.resolveTarget(s, 'monster', { kind: 'monster', id: 'm1' }), { kind: 'monster', ref: orc });
});

test('resolveTarget — null payload returns null', () => {
  assert.equal(spells.resolveTarget({ heroes: [], monsters: [] }, 'hero', null), null);
});

// ---- Status / buff spells (no random) ------------------------------

test('applySpellEffect — healBody clamped to bodyMax', () => {
  const hero = makeHero({ body: 2, bodyMax: 4 });
  const spell = { name: 'Healing', target: 'ally', effect: 'healBody', amount: 4 };
  const room = makeRoom({ heroes: [hero] });
  const ok = spells.applySpellEffect(room, hero, spell, { kind: 'hero', id: 'h1' }, noopDeps());
  assert.equal(ok, true);
  assert.equal(hero.body, 4);
});

test('applySpellEffect — heal cannot target monster', () => {
  const hero = makeHero();
  const orc = makeMonster();
  const room = makeRoom({ heroes: [hero], monsters: [orc] });
  const spell = { name: 'Healing', target: 'ally', effect: 'healBody', amount: 4 };
  const ok = spells.applySpellEffect(room, hero, spell, { kind: 'monster', id: 'm1' }, noopDeps());
  assert.equal(ok, false);
});

test('applySpellEffect — buff statuses flip flags', () => {
  const hero = makeHero();
  const room = makeRoom({ heroes: [hero] });
  const cases = [
    ['doubleNextMovement', 'doubleNextMovement'],
    ['passWalls',          'passWalls'],
    ['passOccupants',      'passOccupants'],
    ['bonusDefendUntilWounded', 'rockSkin'],
    ['bonusAttackUntilSafe',    'courage'],
  ];
  for (const [effect, flag] of cases) {
    hero.status[flag] = false;
    const ok = spells.applySpellEffect(
      room, hero,
      { name: effect, target: 'ally', effect },
      { kind: 'hero', id: 'h1' },
      noopDeps());
    assert.equal(ok, true, effect);
    assert.equal(hero.status[flag], true, effect);
  }
});

test('applySpellEffect — skipNextTurn works on monster too', () => {
  const hero = makeHero();
  const orc = makeMonster();
  orc.status.skipNextTurn = false;
  const room = makeRoom({ heroes: [hero], monsters: [orc] });
  const spell = { name: 'Sleep-like', target: 'enemy', effect: 'skipNextTurn', range: 'anywhere' };
  const ok = spells.applySpellEffect(room, hero, spell, { kind: 'monster', id: 'm1' }, noopDeps());
  assert.equal(ok, true);
  assert.equal(orc.status.skipNextTurn, true);
});

// ---- Damage spells --------------------------------------------------

test('applySpellEffect — directDamage with defenceDice rolls + writes state.combat', () => {
  // damage=3, defenceDice=2. Roll 2 monsterShields → blocks=2 → taken=1.
  const restore = stubRandom([ROLL.monsterShield, ROLL.monsterShield]);
  try {
    const hero = makeHero();
    const orc = makeMonster({ body: 5 });
    const room = makeRoom({ heroes: [hero], monsters: [orc] });
    const spell = { name: 'Tempest', target: 'enemy', effect: 'directDamage', damage: 3, defenceDice: 2 };
    const ok = spells.applySpellEffect(room, hero, spell, { kind: 'monster', id: 'm1' }, noopDeps());
    assert.equal(ok, true);
    assert.equal(orc.body, 4, '5 - (3 - 2) = 4');
    assert.ok(room.state.combat, 'state.combat written');
    assert.equal(room.state.combat.skulls, 3);
    assert.equal(room.state.combat.blocks, 2);
    assert.equal(room.state.combat.damage, 1);
  } finally { restore(); }
});

test('applySpellEffect — directDamage with 0 defenceDice = full damage', () => {
  const hero = makeHero();
  const orc = makeMonster({ body: 2 });
  const room = makeRoom({ heroes: [hero], monsters: [orc] });
  const spell = { name: 'Fire of Wrath', target: 'enemy', effect: 'directDamage', damage: 2, defenceDice: 0 };
  const ok = spells.applySpellEffect(room, hero, spell, { kind: 'monster', id: 'm1' }, noopDeps());
  assert.equal(ok, true);
  assert.equal(orc.body, 0);
  assert.equal(orc.dead, true);
});

test('applySpellEffect — directDamage breaks rockSkin on hero defender', () => {
  const target = makeHero({ id: 'h2', name: 'Barb',
                            status: { ...makeHero().status, rockSkin: true } });
  const caster = makeHero();
  const room = makeRoom({ heroes: [caster, target] });
  const spell = { name: 'Mind Strike', target: 'anyone', effect: 'directDamage', damage: 2, defenceDice: 0 };
  spells.applySpellEffect(room, caster, spell, { kind: 'hero', id: 'h2' }, noopDeps());
  assert.equal(target.status.rockSkin, false);
});

// ---- summonGenie ---------------------------------------------------

test('applySpellEffect — summonGenie rolls 5 attack dice vs defend', () => {
  // 5 skulls vs 2 monsterShields → 3 damage.
  const restore = stubRandom([
    ROLL.skull, ROLL.skull, ROLL.skull, ROLL.skull, ROLL.skull,
    ROLL.monsterShield, ROLL.monsterShield,
  ]);
  try {
    const hero = makeHero();
    const orc = makeMonster({ body: 5, defend: 2 });
    const room = makeRoom({ heroes: [hero], monsters: [orc] });
    const spell = { name: 'Genie', target: 'enemy', effect: 'summonGenie', range: 'anywhere' };
    const ok = spells.applySpellEffect(room, hero, spell, { kind: 'monster', id: 'm1' }, noopDeps());
    assert.equal(ok, true);
    assert.equal(orc.body, 2);
    assert.equal(room.state.combat.attacker.name, 'Genie');
  } finally { restore(); }
});

// ---- sleep ----------------------------------------------------------

test('applySpellEffect — sleep negated when defender rolls block face', () => {
  // monster mind=2, defender rolls 2 dice. Hero block face? No — monster
  // defender → 'monsterShield' block face.
  const restore = stubRandom([ROLL.monsterShield, ROLL.skull]);
  try {
    const hero = makeHero();
    const orc = makeMonster({ mind: 2 });
    const room = makeRoom({ heroes: [hero], monsters: [orc] });
    const spell = { name: 'Sleep', target: 'enemy', effect: 'sleep' };
    spells.applySpellEffect(room, hero, spell, { kind: 'monster', id: 'm1' }, noopDeps());
    assert.equal(orc.status.sleeping, false, 'resisted — one monsterShield');
  } finally { restore(); }
});

test('applySpellEffect — sleep succeeds when no block face rolled', () => {
  const restore = stubRandom([ROLL.skull, ROLL.skull]);
  try {
    const hero = makeHero();
    const orc = makeMonster({ mind: 2 });
    const room = makeRoom({ heroes: [hero], monsters: [orc] });
    const spell = { name: 'Sleep', target: 'enemy', effect: 'sleep' };
    spells.applySpellEffect(room, hero, spell, { kind: 'monster', id: 'm1' }, noopDeps());
    assert.equal(orc.status.sleeping, true);
  } finally { restore(); }
});

// ---- LoS gate ------------------------------------------------------

test('applySpellEffect — range:anywhere bypasses LoS', () => {
  const hero = makeHero();
  const orc = makeMonster({ at: [5, 0] });
  // Drop a wall between them by changing the orc's roomId.
  const room = makeRoom({ heroes: [hero], monsters: [orc] });
  room.state.tileMeta['5,0'].roomId = 'r2';  // different room → wall
  const spell = { name: 'Genie', target: 'enemy', effect: 'summonGenie', range: 'anywhere' };
  // Stub random: 5 skulls, 2 monsterShields
  const restore = stubRandom([
    ROLL.skull, ROLL.skull, ROLL.skull, ROLL.skull, ROLL.skull,
    ROLL.monsterShield, ROLL.monsterShield,
  ]);
  try {
    const ok = spells.applySpellEffect(room, hero, spell, { kind: 'monster', id: 'm1' }, noopDeps());
    assert.equal(ok, true, 'range:anywhere ignores LoS');
  } finally { restore(); }
});

test('applySpellEffect — non-anywhere spell blocked by no LoS', () => {
  const hero = makeHero();
  const orc = makeMonster({ at: [5, 0] });
  const room = makeRoom({ heroes: [hero], monsters: [orc] });
  // Different room → wallBetween will trip LoS unless we have a door.
  room.state.tileMeta['5,0'].roomId = 'r2';
  // No doors between rooms → losEdgeBlocked returns true at the seam.
  const spell = { name: 'Tempest', target: 'enemy', effect: 'directDamage', damage: 3, defenceDice: 0 };
  let logged = '';
  const ok = spells.applySpellEffect(room, hero, spell, { kind: 'monster', id: 'm1' },
    noopDeps({ logEvent: (_r, t) => { logged = t; } }));
  assert.equal(ok, false, 'no LoS → false');
  assert.match(logged, /line of sight/i);
});

// ---- Unknown effect ------------------------------------------------

test('applySpellEffect — unknown effect returns false', () => {
  const hero = makeHero();
  const room = makeRoom({ heroes: [hero] });
  const ok = spells.applySpellEffect(
    room, hero,
    { name: 'X', target: 'self', effect: 'totally-unknown-effect' },
    null,
    noopDeps(),
  );
  assert.equal(ok, false);
});
