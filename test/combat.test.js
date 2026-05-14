// Unit tests for game/combat.js — dice, effective-dice, resolveAttack.
//
// resolveAttack is non-deterministic (rolls dice). We stub
// Math.random() per-test to drive the dice to specific faces, so the
// damage path is exercised without flake. The combat module pulls
// EQUIPMENT / ARTIFACTS / MONSTER_TYPES / logEvent / checkEndConditions
// from a deps arg, which we mock inline.

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const combat = require('../game/combat.js');

// ---- Helpers --------------------------------------------------------

// Drive Math.random() with a scripted sequence. After the sequence is
// exhausted, returns 0 (so any extra calls land on DICE_FACES[0] —
// 'skull'). Returns a restore function.
function stubRandom(seq) {
  const orig = Math.random;
  let i = 0;
  Math.random = () => (i < seq.length ? seq[i++] : 0);
  return () => { Math.random = orig; };
}

// Useful Math.random values that map to specific dice faces. Combat
// dice are DICE_FACES = [skull, skull, skull, heroShield, heroShield,
// monsterShield] indexed by Math.floor(random * 6).
const ROLL = {
  skull:        0.0,        // floor(0.0*6)   = 0 → skull
  heroShield:   0.5,        // floor(0.5*6)   = 3 → heroShield
  monsterShield: 0.9,       // floor(0.9*6)   = 5 → monsterShield
};

function makeHero(over = {}) {
  return {
    id: 'h1', name: 'Hero',
    body: 6, bodyMax: 6, mind: 4, mindMax: 4,
    attackBase: 2, defendBase: 2,
    inventory: [],
    equipped: { weapon: null, bodyArmour: null, helmet: null,
                shield: null, utility: null,
                artifactWeapon: null, artifactArmour: null, artifactItem: null },
    status: { bonusAttackOnce: 0, bonusDefendOnce: 0, courage: false,
              rockSkin: false, sleeping: false, inPit: false },
    at: [0, 0], dead: false,
    ...over,
  };
}

function makeMonster(over = {}) {
  return {
    id: 'm1', type: 'orc', name: null,
    body: 1, bodyMax: 1, mind: 2,
    attack: 3, defend: 2,
    status: { sleeping: false },
    at: [1, 0], dead: false,
    ...over,
  };
}

function makeRoom(stateOver = {}) {
  return {
    state: {
      heroes: [], monsters: [], log: [],
      combat: null, pendingSaveRoll: null, lostArtifacts: [],
      ...stateOver,
    },
  };
}

function noopDeps(over = {}) {
  return {
    EQUIPMENT: {}, ARTIFACTS: {}, MONSTER_TYPES: {},
    logEvent: () => {},
    checkEndConditions: () => false,
    ...over,
  };
}

// ---- Dice -----------------------------------------------------------

test('DICE_FACES — 3 skulls / 2 hero shields / 1 monster shield', () => {
  assert.equal(combat.DICE_FACES.filter(f => f === 'skull').length, 3);
  assert.equal(combat.DICE_FACES.filter(f => f === 'heroShield').length, 2);
  assert.equal(combat.DICE_FACES.filter(f => f === 'monsterShield').length, 1);
});

test('rollAttackDice — returns array of length n', () => {
  const restore = stubRandom([0, 0.5, 0.9, 0]);
  try {
    const r = combat.rollAttackDice(4);
    assert.equal(r.length, 4);
    assert.deepEqual(r, ['skull', 'heroShield', 'monsterShield', 'skull']);
  } finally { restore(); }
});

// ---- effectiveAttack ------------------------------------------------

test('effectiveAttack — base only', () => {
  const h = makeHero({ attackBase: 3 });
  assert.equal(combat.effectiveAttack(h, null, noopDeps()), 3);
});

test('effectiveAttack — weapon replaceAttack overrides base', () => {
  const h = makeHero({ attackBase: 2, equipped: { ...makeHero().equipped, weapon: 'broadsword' } });
  const deps = noopDeps({ EQUIPMENT: { broadsword: { replaceAttack: 4 } } });
  assert.equal(combat.effectiveAttack(h, null, deps), 4);
});

test('effectiveAttack — artifact attack stacks max with weapon', () => {
  const h = makeHero({
    attackBase: 2,
    equipped: { ...makeHero().equipped,
                weapon: 'broadsword', artifactWeapon: 'spirit-blade' },
  });
  const deps = noopDeps({
    EQUIPMENT: { broadsword: { replaceAttack: 4 } },
    ARTIFACTS: { 'spirit-blade': { attack: 5 } },
  });
  // Math.max(weapon=4, artifact.attack=5) = 5
  assert.equal(combat.effectiveAttack(h, null, deps), 5);
});

test('effectiveAttack — artifact bonusAttackVs adds dice vs matching type', () => {
  const h = makeHero({
    attackBase: 3,
    equipped: { ...makeHero().equipped, artifactWeapon: 'undead-bane' },
  });
  const deps = noopDeps({
    ARTIFACTS: { 'undead-bane': { attack: 3, bonusAttackVs: { targets: ['mummy', 'zombie'], extraDice: 2 } } },
  });
  assert.equal(combat.effectiveAttack(h, { type: 'mummy' }, deps), 5, 'matched');
  assert.equal(combat.effectiveAttack(h, { type: 'orc' }, deps),   3, 'no match');
});

test('effectiveAttack — courage adds +2, pit adds -1 (min 1)', () => {
  const h = makeHero({ attackBase: 3, status: { ...makeHero().status, courage: true } });
  assert.equal(combat.effectiveAttack(h, null, noopDeps()), 5);
  const pitted = makeHero({ attackBase: 1, status: { ...makeHero().status, inPit: true } });
  assert.equal(combat.effectiveAttack(pitted, null, noopDeps()), 1, 'pit floor is 1');
});

test('effectiveAttack — bonusAttackOnce stacks on top', () => {
  const h = makeHero({ attackBase: 3, status: { ...makeHero().status, bonusAttackOnce: 2 } });
  assert.equal(combat.effectiveAttack(h, null, noopDeps()), 5);
});

// ---- effectiveDefend ------------------------------------------------

test('effectiveDefend — base only', () => {
  const h = makeHero({ defendBase: 2 });
  assert.equal(combat.effectiveDefend(h, noopDeps()), 2);
});

test('effectiveDefend — body armour setDefend overrides base', () => {
  const h = makeHero({ defendBase: 2,
    equipped: { ...makeHero().equipped, bodyArmour: 'plate' } });
  const deps = noopDeps({ EQUIPMENT: { plate: { setDefend: 5, movePenalty: true } } });
  assert.equal(combat.effectiveDefend(h, deps), 5);
});

test('effectiveDefend — helmet / shield / utility / armour all stack', () => {
  const h = makeHero({ defendBase: 2,
    equipped: { ...makeHero().equipped,
                helmet: 'helm', shield: 'shield', utility: 'cloak',
                bodyArmour: 'chain' } });
  const deps = noopDeps({ EQUIPMENT: {
    helm:   { defendBonus: 1 },
    shield: { defendBonus: 1 },
    cloak:  { defendBonus: 1 },
    chain:  { defendBonus: 1, setDefend: null },
  }});
  // base 2 + 1 + 1 + 1 + 1 = 6
  assert.equal(combat.effectiveDefend(h, deps), 6);
});

test('effectiveDefend — rockSkin +2, bonusDefendOnce, pit -1', () => {
  const status = { ...makeHero().status, rockSkin: true, bonusDefendOnce: 1, inPit: true };
  const h = makeHero({ defendBase: 2, status });
  // base 2 + rockSkin 2 + bonus 1 = 5, then -1 from pit = 4
  assert.equal(combat.effectiveDefend(h, noopDeps()), 4);
});

// ---- effectiveMoveDice ---------------------------------------------

test('effectiveMoveDice — plate armour drops to 1', () => {
  const noArmour = makeHero();
  assert.equal(combat.effectiveMoveDice(noArmour, noopDeps()), 2);

  const heavy = makeHero({ equipped: { ...makeHero().equipped, bodyArmour: 'plate' } });
  const deps = noopDeps({ EQUIPMENT: { plate: { movePenalty: true } } });
  assert.equal(combat.effectiveMoveDice(heavy, deps), 1);
});

// ---- resolveAttack — damage + side effects -------------------------

test('resolveAttack — hero kills monster, snapshot written, checkEnd called', () => {
  // attacker rolls 3 skulls, defender (monster) rolls 0 monsterShields.
  // attacker effectiveAttack=3, defender.defend=2 → 5 random calls total.
  const restore = stubRandom([
    ROLL.skull, ROLL.skull, ROLL.skull,             // attacker
    ROLL.heroShield, ROLL.heroShield,               // defender (wrong shield kind)
  ]);
  try {
    const hero = makeHero({ attackBase: 3 });
    const orc = makeMonster({ body: 2, attack: 3, defend: 2 });
    const room = makeRoom({ heroes: [hero], monsters: [orc] });
    const logs = [];
    let endCalls = 0;
    combat.resolveAttack(
      room,
      { kind: 'hero',    ref: hero },
      { kind: 'monster', ref: orc },
      noopDeps({ logEvent: (_r, t) => logs.push(t), checkEndConditions: () => { endCalls++; } }),
    );
    assert.equal(orc.body, 0);
    assert.equal(orc.dead, true);
    assert.equal(room.state.combat.skulls, 3);
    assert.equal(room.state.combat.blocks, 0, 'heroShield ≠ monsterShield for monster defender');
    assert.equal(room.state.combat.damage, 3);
    assert.equal(room.state.combat.killed, true);
    assert.equal(endCalls, 1);
    assert.ok(logs.some(l => /slain/.test(l)));
  } finally { restore(); }
});

test('resolveAttack — monsterShield blocks hero attack', () => {
  // attacker rolls 3 skulls; defender rolls 2 monsterShields → 3-2=1 damage.
  const restore = stubRandom([
    ROLL.skull, ROLL.skull, ROLL.skull,
    ROLL.monsterShield, ROLL.monsterShield,
  ]);
  try {
    const hero = makeHero({ attackBase: 3 });
    const orc = makeMonster({ body: 5, attack: 3, defend: 2 });
    const room = makeRoom({ heroes: [hero], monsters: [orc] });
    combat.resolveAttack(room,
      { kind: 'hero', ref: hero }, { kind: 'monster', ref: orc },
      noopDeps());
    assert.equal(room.state.combat.blocks, 2);
    assert.equal(room.state.combat.damage, 1);
    assert.equal(orc.body, 4);
    assert.equal(orc.dead, false);
  } finally { restore(); }
});

test('resolveAttack — sleeping defender cannot block', () => {
  const restore = stubRandom([
    ROLL.skull, ROLL.skull, ROLL.skull,
    ROLL.monsterShield, ROLL.monsterShield,  // would block — but sleeping
  ]);
  try {
    const hero = makeHero({ attackBase: 3 });
    const orc = makeMonster({ body: 5, attack: 3, defend: 2,
                              status: { sleeping: true } });
    const room = makeRoom({ heroes: [hero], monsters: [orc] });
    combat.resolveAttack(room,
      { kind: 'hero', ref: hero }, { kind: 'monster', ref: orc },
      noopDeps());
    assert.equal(room.state.combat.blocks, 0, 'sleeping → 0 blocks');
    assert.equal(room.state.combat.damage, 3);
    assert.equal(orc.status.sleeping, false, 'monster awakens on attack');
  } finally { restore(); }
});

test('resolveAttack — drink-to-save: single heal potion auto-drinks', () => {
  // monster rolls 2 skulls vs hero with 2 body → kills, but hero has 1 potion.
  const restore = stubRandom([
    ROLL.skull, ROLL.skull,           // monster attacker
    ROLL.monsterShield, ROLL.monsterShield, // hero rolls wrong-side blocks → 0
  ]);
  try {
    const hero = makeHero({ body: 2, bodyMax: 6,
                            inventory: [{ name: 'Healing Potion', use: 'heal', amount: 4 }] });
    const orc = makeMonster({ attack: 2, defend: 2 });
    const room = makeRoom({ heroes: [hero], monsters: [orc] });
    combat.resolveAttack(room,
      { kind: 'monster', ref: orc }, { kind: 'hero', ref: hero },
      noopDeps());
    // hit for 2 damage → body 0 → auto-drink potion → restore to min(4, 6) = 4
    assert.equal(hero.body, 4);
    assert.equal(hero.dead, false);
    assert.equal(hero.inventory.length, 0, 'potion consumed');
  } finally { restore(); }
});

test('resolveAttack — drink-to-save: multiple potions surfaces pendingSaveRoll', () => {
  const restore = stubRandom([
    ROLL.skull, ROLL.skull,
    ROLL.monsterShield, ROLL.monsterShield,
  ]);
  try {
    const hero = makeHero({ body: 2,
      inventory: [
        { name: 'Healing Potion', use: 'heal', amount: 4 },
        { name: 'Greater Potion', use: 'heal', amount: 6 },
      ],
    });
    const orc = makeMonster();
    const room = makeRoom({ heroes: [hero], monsters: [orc] });
    combat.resolveAttack(room,
      { kind: 'monster', ref: orc }, { kind: 'hero', ref: hero },
      noopDeps());
    // Quirk: with multiple potions resolveAttack marks `dead: true`
    // AND surfaces a pendingSaveRoll. The modal's confirm-drink
    // handler revives the hero (clears dead + restores body). Single-
    // potion auto-drink (above) flows differently and never marks dead.
    assert.equal(hero.body, 0, 'still down — awaiting decision');
    assert.equal(hero.dead, true, 'marked dead pending modal revive');
    assert.ok(room.state.pendingSaveRoll, 'modal surfaced');
    assert.equal(room.state.pendingSaveRoll.options.length, 2);
  } finally { restore(); }
});

test('resolveAttack — hero death drops artifacts to lostArtifacts', () => {
  const restore = stubRandom([
    ROLL.skull, ROLL.skull, ROLL.skull,
    ROLL.monsterShield, ROLL.monsterShield,
  ]);
  try {
    const hero = makeHero({ body: 1,
      equipped: { ...makeHero().equipped,
                  artifactWeapon: 'spirit-blade', artifactArmour: 'borin-armour' } });
    const orc = makeMonster({ attack: 3, defend: 2 });
    const room = makeRoom({ heroes: [hero], monsters: [orc] });
    combat.resolveAttack(room,
      { kind: 'monster', ref: orc }, { kind: 'hero', ref: hero },
      noopDeps({ ARTIFACTS: { 'spirit-blade':  { name: 'Spirit Blade' },
                              'borin-armour': { name: 'Borin\'s Armour' } } }));
    assert.equal(hero.dead, true);
    assert.deepEqual(room.state.lostArtifacts.sort(), ['borin-armour', 'spirit-blade']);
    assert.equal(hero.equipped.artifactWeapon, null);
    assert.equal(hero.equipped.artifactArmour, null);
  } finally { restore(); }
});

test('resolveAttack — rockSkin breaks on hero damage', () => {
  const restore = stubRandom([
    ROLL.skull, ROLL.skull,
    ROLL.monsterShield, ROLL.monsterShield, ROLL.monsterShield, ROLL.monsterShield,
  ]);
  try {
    const hero = makeHero({ body: 6,
      status: { ...makeHero().status, rockSkin: true } });
    const orc = makeMonster({ attack: 2, defend: 2 });
    const room = makeRoom({ heroes: [hero], monsters: [orc] });
    combat.resolveAttack(room,
      { kind: 'monster', ref: orc }, { kind: 'hero', ref: hero },
      noopDeps());
    // hero rolls 4 heroShields (defendBase 2 + rockSkin 2) but
    // monster rolls all 'monsterShield' faces here so hero blocks 0,
    // takes 2 damage. rockSkin breaks.
    assert.equal(hero.status.rockSkin, false);
  } finally { restore(); }
});

test('resolveAttack — bonusAttackOnce / bonusDefendOnce consumed', () => {
  const restore = stubRandom([
    ROLL.skull, ROLL.skull, ROLL.skull, ROLL.skull, ROLL.skull,
    ROLL.heroShield, ROLL.heroShield, ROLL.heroShield, ROLL.heroShield,
  ]);
  try {
    const hero = makeHero({ attackBase: 3,
      status: { ...makeHero().status, bonusAttackOnce: 2, bonusDefendOnce: 2 } });
    const orc = makeMonster({ body: 5, defend: 2 });
    const room = makeRoom({ heroes: [hero], monsters: [orc] });
    combat.resolveAttack(room,
      { kind: 'hero', ref: hero }, { kind: 'monster', ref: orc },
      noopDeps());
    assert.equal(hero.status.bonusAttackOnce, 0, 'attacker one-shot consumed');
    // bonusDefendOnce only decays for the DEFENDER. Hero is attacking
    // here, so the one-shot defend bonus stays intact.
    assert.equal(hero.status.bonusDefendOnce, 2, 'defender one-shot untouched');
  } finally { restore(); }
});
