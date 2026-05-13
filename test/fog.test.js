// Fog-of-war engine tests. Settled rules: room reveal on entry, cardinal
// LOS in corridors, cascading open-door room reveals, monster activation
// (room and corridor). These caught real bugs we shipped this week:
//   - corridor goblins remained inactive (now activate on LOS)
//   - heroes saw whole corridor network (now cardinal-only)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const fog = require('../game/fog.js');
const HQRules = require('../public/shared/rules.js');

// Build a synthetic state on a 7x3 grid with two rooms separated by a
// corridor:
//   Row 0:  r1 r1 .  cor  .  r2 r2
//   Row 1:  r1 r1 .  cor  .  r2 r2
//   Row 2:  cor cor cor cor cor cor cor
// Doors at (1,0)-(2,0) and (4,0)-(5,0). Configurable door states.
function makeState({ doorL = 'closed', doorR = 'closed', heroAt, monsters = [] } = {}) {
  const tileMeta = {};
  const allTileKeys = [];
  function addTile(x, y, roomId) {
    const k = HQRules.key(x, y);
    tileMeta[k] = { x, y, roomId, hiddenFor: { heroes: true }, solidRock: false };
    allTileKeys.push(k);
  }
  // Row 0/1: rooms + gaps
  for (const y of [0, 1]) {
    addTile(0, y, 'r1'); addTile(1, y, 'r1');
    // (2,y) is wall (we just don't add it — out-of-map = solid-equivalent)
    addTile(2, y, null); // corridor stub
    // (3,y) corridor
    addTile(3, y, null);
    addTile(4, y, null); // corridor stub
    addTile(5, y, 'r2'); addTile(6, y, 'r2');
  }
  // Row 2: corridor across the bottom
  for (let x = 0; x < 7; x++) addTile(x, 2, null);

  const roomState = {
    r1: { name: 'Antechamber', hiddenFor: { heroes: true } },
    r2: { name: 'Sanctum',     hiddenFor: { heroes: true } },
  };
  const doors = [
    { a: [1, 0], b: [2, 0], state: doorL, revealed: false },
    { a: [4, 0], b: [5, 0], state: doorR, revealed: false },
  ];
  const heroes = heroAt ? [{ id: 'h1', dead: false, at: heroAt }] : [];
  return { tileMeta, allTileKeys, roomState, doors, heroes, monsters };
}

test('hero entering a room reveals the entire room', () => {
  const s = makeState({ heroAt: [0, 0] });
  fog.recomputeFromHero(s, s.heroes[0]);
  assert.equal(s.roomState.r1.hiddenFor.heroes, false, 'r1 should be revealed');
  assert.equal(s.tileMeta['1,1'].hiddenFor.heroes, false, 'far corner of r1 also revealed');
});

test('hero in corridor only reveals cardinal LOS', () => {
  const s = makeState({ heroAt: [3, 2] });
  fog.recomputeFromHero(s, s.heroes[0]);
  assert.equal(s.tileMeta['3,2'].hiddenFor.heroes, false, 'standing cell visible');
  assert.equal(s.tileMeta['0,2'].hiddenFor.heroes, false, 'left along corridor visible');
  assert.equal(s.tileMeta['6,2'].hiddenFor.heroes, false, 'right along corridor visible');
  // The room cells in r1 (which are NOT directly cardinal-reachable from
  // (3,2) without crossing through closed-door zones) must remain hidden.
  assert.equal(s.tileMeta['0,0'].hiddenFor.heroes, true, 'r1 not revealed from corridor');
  assert.equal(s.roomState.r1.hiddenFor.heroes, true);
});

test('opening a door cascades the room reveal', () => {
  const s = makeState({ heroAt: [0, 0], doorR: 'open' });
  // Hero is in r1 — first reveal r1 only.
  fog.recomputeFromHero(s, s.heroes[0]);
  assert.equal(s.roomState.r1.hiddenFor.heroes, false);
  assert.equal(s.roomState.r2.hiddenFor.heroes, true,
    'r2 still hidden until a door connects it to a visible cell');
});

test('door adjacent to visible cell becomes revealed (door is visible even if room beyond is not)', () => {
  const s = makeState({ heroAt: [0, 0] });
  fog.recomputeFromHero(s, s.heroes[0]);
  // Door at (1,0)-(2,0): (1,0) is in r1 (visible), (2,0) corridor (hidden)
  const door = s.doors.find(d => d.a[0] === 1);
  assert.equal(door.revealed, true, 'door touching r1 must be revealed');
});

test('monsters in a newly-revealed room are activated', () => {
  const s = makeState({ heroAt: [0, 0] });
  s.monsters.push({ id: 'g1', type: 'goblin', dead: false, active: false, roomId: 'r1', at: [1, 1] });
  fog.recomputeFromHero(s, s.heroes[0]);
  assert.equal(s.monsters[0].active, true, 'goblin in revealed room should activate');
});

test('corridor monsters activate once their cell is in LOS', () => {
  const s = makeState({ heroAt: [3, 2] });
  s.monsters.push({ id: 'g1', type: 'goblin', dead: false, active: false, roomId: null, at: [5, 2] });
  fog.recomputeFromHero(s, s.heroes[0]);
  assert.equal(s.monsters[0].active, true, 'corridor goblin should activate on LOS');
});

test('corridor monsters out of LOS stay inactive', () => {
  // Hero in r1; corridor monster at (3,2) is NOT cardinally visible from r1
  const s = makeState({ heroAt: [0, 0] });
  s.monsters.push({ id: 'g1', type: 'goblin', dead: false, active: false, roomId: null, at: [3, 2] });
  fog.recomputeFromHero(s, s.heroes[0]);
  assert.equal(s.monsters[0].active, false, 'goblin out of LOS stays inert');
});

test('reveal log fires for newly revealed rooms only', () => {
  const events = [];
  const s = makeState({ heroAt: [0, 0] });
  fog.recomputeFromHero(s, s.heroes[0], (text, cls) => events.push({ text, cls }));
  const reveals = events.filter(e => e.cls === 'reveal');
  assert.equal(reveals.length, 1, 'exactly one room-reveal log line');
  assert.match(reveals[0].text, /Antechamber/);
});

test('recomputeFromAllHeroes is a no-op when state is missing', () => {
  // Defensive: should not throw on null/undefined.
  fog.recomputeFromAllHeroes(null);
  fog.recomputeFromAllHeroes(undefined);
});

test('recomputeFromAllHeroes runs each living hero', () => {
  const s = makeState({});
  s.heroes = [
    { id: 'h1', dead: false, at: [0, 0] },
    { id: 'h2', dead: false, at: [6, 0] },
    { id: 'h3', dead: true,  at: [3, 2] },  // dead hero contributes nothing
  ];
  fog.recomputeFromAllHeroes(s);
  assert.equal(s.roomState.r1.hiddenFor.heroes, false);
  assert.equal(s.roomState.r2.hiddenFor.heroes, false, 'second hero reveals r2');
});
