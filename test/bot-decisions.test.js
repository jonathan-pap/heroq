// Tests the AI GM's per-monster decision function. These are SETTLED
// rules — adjacent attacks must respect walls and closed doors, and a
// monster shouldn't oscillate next to a target it's already adjacent to.
// AI *strategy* (which target to pick when, when to flee, etc.) is left
// untested because it's still volatile.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { decideMonsterTurn } = require('../bots.js');
const HQRules = require('../public/shared/rules.js');

// Fixture builder. 6x1 corridor with a wall at x=3 (rooms r1 [0..2] and
// r2 [3..5]). One hero, one monster, configurable door at the wall.
function fixture({ heroAt, monAt, attacked = false, mp = 6, door = null, monType = 'goblin' }) {
  const tileMeta = {};
  for (let x = 0; x < 6; x++) {
    tileMeta[`${x},0`] = { roomId: x < 3 ? 'r1' : 'r2' };
  }
  const doors = door ? [{ a: [2, 0], b: [3, 0], state: door }] : [];
  const heroes = [{ id: 'h1', body: 8, dead: false, at: heroAt }];
  const monsters = [{ id: 'm1', type: monType, dead: false, at: monAt }];
  const s = { tileMeta, doors, heroes, monsters };
  const helpers = {
    adjacent: HQRules.adjacent,
    meleeBlocked: HQRules.meleeBlocked,
    passable: (st, a, b /* mover */) => {
      if (!HQRules.adjacent(a, b)) return false;
      if (HQRules.wallBetween(st, a, b)) return false;
      const d = HQRules.doorBetween(st, a, b);
      if (d && d.state !== 'open') return { needsOpenDoor: d };
      return true;
    },
    occupantAt: (st, c) => {
      for (const h of st.heroes) if (!h.dead && h.at[0] === c[0] && h.at[1] === c[1]) return { kind: 'hero', ref: h };
      for (const m of st.monsters) if (!m.dead && m.at[0] === c[0] && m.at[1] === c[1]) return { kind: 'monster', ref: m };
      return null;
    },
    key: HQRules.key,
    tileAt: HQRules.tileAt,
  };
  return { s, helpers, current: { id: 'm1', mp, mpInitial: mp, attacked, movedBeforeAttack: false } };
}

test('attacks an adjacent hero in the same room', () => {
  const { s, helpers, current } = fixture({ heroAt: [1, 0], monAt: [0, 0] });
  const action = decideMonsterTurn(s, current, helpers);
  assert.equal(action.type, 'attack');
  assert.equal(action.heroId, 'h1');
});

test('does NOT attack through a wall (no door)', () => {
  // Monster at (3,0) in r2, hero at (2,0) in r1 — orthogonally adjacent
  // BUT a wall stands between them. The bot must not propose attack.
  const { s, helpers, current } = fixture({ heroAt: [2, 0], monAt: [3, 0] });
  const action = decideMonsterTurn(s, current, helpers);
  assert.notEqual(action.type, 'attack', 'wall-attack must be rejected');
});

test('does NOT attack through a closed door', () => {
  const { s, helpers, current } = fixture({ heroAt: [2, 0], monAt: [3, 0], door: 'closed' });
  const action = decideMonsterTurn(s, current, helpers);
  assert.notEqual(action.type, 'attack');
});

test('attacks through an open door', () => {
  const { s, helpers, current } = fixture({ heroAt: [2, 0], monAt: [3, 0], door: 'open' });
  const action = decideMonsterTurn(s, current, helpers);
  assert.equal(action.type, 'attack');
});

test('after attacking, ends turn if still adjacent (no oscillation)', () => {
  const { s, helpers, current } = fixture({
    heroAt: [1, 0], monAt: [0, 0], attacked: true, mp: 5,
  });
  const action = decideMonsterTurn(s, current, helpers);
  assert.equal(action.type, 'end',
    'bot must not waste MP wandering next to a hero it already attacked');
});

test('paths toward a reachable hero across an open door', () => {
  const { s, helpers, current } = fixture({
    heroAt: [5, 0], monAt: [0, 0], door: 'open', mp: 6,
  });
  const action = decideMonsterTurn(s, current, helpers);
  assert.equal(action.type, 'move');
  assert.deepEqual(action.to, [1, 0], 'first step toward hero');
});

test('ends turn when no hero is reachable (all closed doors)', () => {
  const { s, helpers, current } = fixture({
    heroAt: [5, 0], monAt: [0, 0], door: 'closed', mp: 6,
  });
  const action = decideMonsterTurn(s, current, helpers);
  // Fallback BFS allows closed-door traversal in pathfinding; first
  // step is still gated by real passability so closed doors block.
  // Either 'move' to (1,0) (approach door) or 'end' (already at door)
  // is acceptable — but never an attack and never a step through wall.
  assert.notEqual(action.type, 'attack');
  if (action.type === 'move') {
    // Must be a real ortho neighbor with no wall.
    const m = s.monsters[0];
    assert.ok(HQRules.adjacent(m.at, action.to), 'move must be to adjacent cell');
    assert.equal(HQRules.wallBetween(s, m.at, action.to), false, 'move must not cross a wall');
  }
});
