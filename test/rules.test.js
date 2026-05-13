// Truth-table tests for shared wall / door / melee rules. These are the
// canonical answers — the server-side `passable` and bot BFS, and the
// client-side reachable-tile preview, must all agree with these.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const R = require('../public/shared/rules.js');

// Tiny 3x1 fixture: r1 | r2 with a single edge between (1,0) and (2,0).
function makeState(opts = {}) {
  const tileMeta = {
    '0,0': { roomId: 'r1' },
    '1,0': { roomId: 'r1' },
    '2,0': { roomId: 'r2' },
    '3,0': { roomId: 'r2' },
  };
  const doors = opts.door ? [{ a: [1, 0], b: [2, 0], state: opts.door }] : [];
  return { tileMeta, doors };
}

test('adjacent — orthogonal only', () => {
  assert.equal(R.adjacent([0, 0], [1, 0]), true);
  assert.equal(R.adjacent([0, 0], [0, 1]), true);
  assert.equal(R.adjacent([0, 0], [1, 1]), false, 'diagonal not adjacent');
  assert.equal(R.adjacent([0, 0], [2, 0]), false, 'two cells apart not adjacent');
  assert.equal(R.adjacent([0, 0], [0, 0]), false, 'same cell not adjacent');
});

test('adjacentDiag — includes diagonals, excludes self', () => {
  assert.equal(R.adjacentDiag([0, 0], [1, 1]), true);
  assert.equal(R.adjacentDiag([0, 0], [1, 0]), true);
  assert.equal(R.adjacentDiag([0, 0], [0, 0]), false);
  assert.equal(R.adjacentDiag([0, 0], [2, 1]), false);
});

test('chebyshev — king-move distance', () => {
  assert.equal(R.chebyshev([0, 0], [3, 4]), 4);
  assert.equal(R.chebyshev([2, 2], [2, 2]), 0);
});

test('wallBetween — same room, no wall', () => {
  const s = makeState();
  assert.equal(R.wallBetween(s, [0, 0], [1, 0]), false);
});

test('wallBetween — different rooms, wall present', () => {
  const s = makeState();
  assert.equal(R.wallBetween(s, [1, 0], [2, 0]), true);
});

test('wallBetween — different rooms with door, no wall', () => {
  const s = makeState({ door: 'closed' });
  assert.equal(R.wallBetween(s, [1, 0], [2, 0]), false);
});

test('wallBetween — open door, no wall', () => {
  const s = makeState({ door: 'open' });
  assert.equal(R.wallBetween(s, [1, 0], [2, 0]), false);
});

test('wallBetween — off-map cell counts as wall', () => {
  const s = makeState();
  assert.equal(R.wallBetween(s, [1, 0], [99, 99]), true);
});

test('meleeBlocked — wall blocks melee', () => {
  const s = makeState();
  assert.equal(R.meleeBlocked(s, [1, 0], [2, 0]), true);
});

test('meleeBlocked — closed door blocks melee', () => {
  const s = makeState({ door: 'closed' });
  assert.equal(R.meleeBlocked(s, [1, 0], [2, 0]), true);
});

test('meleeBlocked — open door allows melee', () => {
  const s = makeState({ door: 'open' });
  assert.equal(R.meleeBlocked(s, [1, 0], [2, 0]), false);
});

test('meleeBlocked — same-room adjacent, never blocked', () => {
  const s = makeState();
  assert.equal(R.meleeBlocked(s, [0, 0], [1, 0]), false);
});

test('doorBetween — direction-agnostic match', () => {
  const s = makeState({ door: 'closed' });
  assert.ok(R.doorBetween(s, [1, 0], [2, 0]));
  assert.ok(R.doorBetween(s, [2, 0], [1, 0]), 'reverse direction also matches');
  assert.equal(R.doorBetween(s, [0, 0], [1, 0]), undefined);
});

test('tileAt — works with object dict and Map', () => {
  const objState = { tileMeta: { '5,5': { roomId: 'rX' } } };
  assert.equal(R.tileAt(objState, 5, 5).roomId, 'rX');
  const mapState = { tileMeta: new Map([['5,5', { roomId: 'rY' }]]) };
  assert.equal(R.tileAt(mapState, 5, 5).roomId, 'rY');
  assert.equal(R.tileAt(objState, 99, 99), null);
});

test('edgeKey — canonicalises to lower endpoint first', () => {
  assert.equal(R.edgeKey([0, 0], [1, 0]), '0,0|1,0');
  assert.equal(R.edgeKey([1, 0], [0, 0]), '0,0|1,0');
  assert.equal(R.edgeKey([2, 3], [2, 4]), '2,3|2,4');
  assert.equal(R.edgeKey([2, 4], [2, 3]), '2,3|2,4');
});
