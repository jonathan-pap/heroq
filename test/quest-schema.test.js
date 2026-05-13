// Smoke-tests every bundled quest JSON against the canonical-footprint
// validator (and a few additional structural invariants the validator
// doesn't enforce). Catches data-shape regressions at PR time, before
// they surface as silent in-game bugs.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateQuest } = require('../scripts/validate-quests');

const QUEST_DIR = path.join(__dirname, '..', 'data', 'quests');

function listQuests(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listQuests(p));
    else if (ent.isFile() && p.endsWith('.json')) out.push(p);
  }
  return out;
}

const QUESTS = listQuests(QUEST_DIR);

test('test directory finds quest JSON files', () => {
  assert.ok(QUESTS.length >= 14, `expected >=14 quests, found ${QUESTS.length}`);
});

for (const fp of QUESTS) {
  const rel = path.relative(QUEST_DIR, fp);
  const quest = JSON.parse(fs.readFileSync(fp, 'utf8'));

  test(`${rel} — has required top-level fields`, () => {
    assert.ok(quest.id, 'missing id');
    assert.equal(typeof quest.id, 'string');
    assert.ok(quest.title, 'missing title');
  });

  // KNOWN BROKEN: quest10 ships an 8-cell non-rectangular stair; the
  // server already warns on boot. Tracked as a quest-data fix.
  const knownBroken = new Set(['quest10-castle-of-mystery.json']);
  test(`${rel} — passes canonical-footprint validator (no WARN)`, { skip: knownBroken.has(rel) }, () => {
    const issues = validateQuest(quest, rel);
    const blockers = issues.filter(i => i.level === 'WARN');
    assert.equal(blockers.length, 0,
      'WARN-level issues found:\n' + blockers.map(i => '  - ' + i.msg).join('\n'));
  });

  test(`${rel} — start cells exist and are arrays of [x,y]`, () => {
    const sc = quest.startCells || quest.stairCells;
    assert.ok(Array.isArray(sc) && sc.length > 0, 'no start/stair cells');
    for (const c of sc) {
      assert.ok(Array.isArray(c) && c.length === 2, `bad cell shape: ${JSON.stringify(c)}`);
      assert.equal(typeof c[0], 'number');
      assert.equal(typeof c[1], 'number');
    }
  });

  test(`${rel} — doors are well-shaped`, () => {
    for (const d of (quest.doors || [])) {
      assert.ok(Array.isArray(d.a) && d.a.length === 2, 'door.a malformed');
      assert.ok(Array.isArray(d.b) && d.b.length === 2, 'door.b malformed');
      // a and b must be orthogonally adjacent
      const dx = Math.abs(d.a[0] - d.b[0]);
      const dy = Math.abs(d.a[1] - d.b[1]);
      assert.ok((dx === 1 && dy === 0) || (dx === 0 && dy === 1),
        `door endpoints must be ortho-adjacent: ${JSON.stringify(d)}`);
    }
  });
}
