// Monster activation invariants — the "wakes up when seen" rule.
// Separate from fog.test because we want focused regressions on the
// activation conditions, not the LOS algorithm itself.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const fog = require('../game/fog.js');
const HQRules = require('../public/shared/rules.js');

function tinyState({ doorState = 'closed', monsters = [], heroAt = [0, 0] } = {}) {
  // 4x1 line: r1 r1 | r2 r2 with one door at (1,0)-(2,0).
  const tileMeta = {};
  const allTileKeys = [];
  for (let x = 0; x < 4; x++) {
    const k = HQRules.key(x, 0);
    tileMeta[k] = { x, y: 0, roomId: x < 2 ? 'r1' : 'r2', hiddenFor: { heroes: true }, solidRock: false };
    allTileKeys.push(k);
  }
  const roomState = {
    r1: { name: 'Vestibule', hiddenFor: { heroes: true } },
    r2: { name: 'Inner', hiddenFor: { heroes: true } },
  };
  const doors = [{ a: [1, 0], b: [2, 0], state: doorState, revealed: false }];
  const heroes = [{ id: 'h1', dead: false, at: heroAt }];
  return { tileMeta, allTileKeys, roomState, doors, heroes, monsters };
}

test('a dead monster is never activated', () => {
  const s = tinyState({
    monsters: [{ id: 'm1', type: 'orc', dead: true, active: false, roomId: 'r1', at: [0, 0] }],
  });
  fog.recomputeFromHero(s, s.heroes[0]);
  assert.equal(s.monsters[0].active, false);
});

test('an already-active monster stays active after re-recompute', () => {
  const s = tinyState({
    monsters: [{ id: 'm1', type: 'orc', dead: false, active: true, roomId: 'r1', at: [0, 0] }],
  });
  fog.recomputeFromHero(s, s.heroes[0]);
  assert.equal(s.monsters[0].active, true);
});

test('hidden room → monster stays inert', () => {
  // Hero in r1, door closed. Monster in r2 must not activate.
  const s = tinyState({
    monsters: [{ id: 'm1', type: 'orc', dead: false, active: false, roomId: 'r2', at: [3, 0] }],
  });
  fog.recomputeFromHero(s, s.heroes[0]);
  assert.equal(s.monsters[0].active, false, 'monster behind closed door stays inert');
});

test('open-door cascade activates monster in revealed back-room', () => {
  const s = tinyState({
    doorState: 'open',
    monsters: [{ id: 'm1', type: 'orc', dead: false, active: false, roomId: 'r2', at: [3, 0] }],
  });
  fog.recomputeFromHero(s, s.heroes[0]);
  assert.equal(s.monsters[0].active, true, 'open door cascades reveal → activate');
});

test('reveal log fires for corridor monster activation', () => {
  // Build a corridor-only state so the monster has roomId === null.
  const tileMeta = {};
  const allTileKeys = [];
  for (let x = 0; x < 4; x++) {
    const k = HQRules.key(x, 0);
    tileMeta[k] = { x, y: 0, roomId: null, hiddenFor: { heroes: true }, solidRock: false };
    allTileKeys.push(k);
  }
  const s = {
    tileMeta, allTileKeys, roomState: {}, doors: [],
    heroes: [{ id: 'h1', dead: false, at: [0, 0] }],
    monsters: [{ id: 'g1', type: 'goblin', dead: false, active: false, roomId: null, at: [3, 0] }],
  };
  const events = [];
  fog.recomputeFromHero(s, s.heroes[0], (text, cls) => events.push({ text, cls }));
  assert.equal(s.monsters[0].active, true);
  const stir = events.find(e => /goblin stirs/.test(e.text));
  assert.ok(stir, 'should log "A goblin stirs in the corridor!"');
});
