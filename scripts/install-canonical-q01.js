// =====================================================================
// install-canonical-q01.js
//
// Takes the auto-generated sandbox-canonical-q01-the-trial.json (from
// scripts/build-quest1-from-xml.js HQBase-01-TheTrial_US.xml) and
// installs it as the main quest1-trial.json with canonical metadata
// applied:
//
//   - id, title, subtitle, intro (rulebook text)
//   - category: 'main' (so it appears in the main quest list)
//   - Mummy at C-letter position → 4 attack dice (Fellmarg's Guardian)
//   - Treasure chest amounts from canonical (D = 84g, E = 120g, B empty)
//   - Objective: slay Verag
//   - Wandering monster: Orc
//
// Re-run any time you regenerate the sandbox copy from the XML.
//
// Run:  node scripts/install-canonical-q01.js
// =====================================================================

const fs = require('fs');
const path = require('path');

const SANDBOX = path.join(__dirname, '..', 'data', 'quests', 'sandbox',
                         'sandbox-canonical-q01-the-trial.json');
const MAIN    = path.join(__dirname, '..', 'data', 'quests', 'quest1-trial.json');

if (!fs.existsSync(SANDBOX)) {
  throw new Error(
    `${SANDBOX} not found. Run scripts/build-quest1-from-xml.js first.`
  );
}

const q = JSON.parse(fs.readFileSync(SANDBOX, 'utf8'));

// ---- 1. Quest metadata --------------------------------------------------
q.id = 'quest1-trial';
q.title = 'The Trial';
q.subtitle = 'Quest 1';
q.category = 'main';
q.intro =
  "Mentor sends the heroes into the catacombs that contain Fellmarg's tomb " +
  "to seek out and destroy a foul gargoyle named Verag. This is their first " +
  "trial — survival depends on working together.";
q._canonical_notes =
  "Auto-generated from canonical HeroScribe XML " +
  "(assets/maps/HQBase-01-TheTrial_US.xml) via scripts/build-quest1-from-xml.js, " +
  "then promoted to the main quest list by scripts/install-canonical-q01.js. " +
  "Per the 2021 rulebook: NO traps, NO secret doors. The mummy guarding " +
  "Fellmarg's tomb (the 'C' mummy) rolls 4 Attack dice instead of 3. " +
  "Treasure chest D = 84g, chest E = 120g, chest B = empty. Wandering monster: Orc.";
q.wanderingMonster = 'orc';

// ---- 2. Mummy 'C' override — Fellmarg's Guardian (4 attack) ------------
// XML LetterC is at (8, 3) → 0-based (7, 2). The adjacent mummy is at
// XML (7, 3) → 0-based (6, 2). It's the one closest to the C label.
const mummyC = q.monsters.find(
  m => m.type === 'mummy' && m.at[0] === 6 && m.at[1] === 2
);
if (mummyC) {
  mummyC.name = "Fellmarg's Guardian";
  mummyC.attack = 4;
  mummyC._note = "C: rolls 4 Attack dice instead of 3 (canonical override)";
}

// ---- 3. Treasure chest amounts -----------------------------------------
// XML letters tag chest contents:
//   D at (12, 6)  → adjacent chest at (11, 6)  → 0-based (10, 5) → 84g
//   E at (11, 8)  → adjacent chest at (12, 8)  → 0-based (11, 7) → 120g
//   B at (18, 16) → adjacent chest at (18, 17) → 0-based (17, 16) → empty
const treasureOverrides = {
  '10,5':  { amount: 84,  _note: "D: 84 gold (first searcher only)" },
  '11,7':  { amount: 120, _note: "E: 120 gold (first searcher only) — Verag's lair" },
  '17,16': { amount: 0,   _note: "B: empty chest" },
};
q.treasure = q.treasure.map(t => {
  const key = `${t.at[0]},${t.at[1]}`;
  const override = treasureOverrides[key];
  return override ? { ...t, ...override } : t;
});

// ---- 4. Objective ------------------------------------------------------
const verag = q.monsters.find(m => m.type === 'verag');
const veragId = verag ? verag.id : 'verag1';

q.objective = {
  kind: 'kill',
  monsterId: veragId,
  text: "Slay Verag, the gargoyle of Fellmarg's tomb.",
};
q.objectives = [
  { id: 'slay-verag', kind: 'kill', monsterId: veragId,
    text: 'Slay Verag the gargoyle' },
  ...(mummyC ? [{
    id: 'slay-mummy', kind: 'kill', monsterId: mummyC.id,
    text: "Defeat the mummy guarding Fellmarg's tomb",
    optional: true,
  }] : []),
  ...(treasureOverrides['10,5'] ? [{
    id: 'claim-84',  kind: 'reach', cell: [10, 5],
    text: 'Reach chest D in the tomb chamber (84g)',
    optional: true,
  }] : []),
  ...(treasureOverrides['11,7'] ? [{
    id: 'claim-120', kind: 'reach', cell: [11, 7],
    text: "Reach chest E in Verag's lair (120g)",
    optional: true,
  }] : []),
];
q.defeat = {
  kind: 'all-dead',
  text: 'All heroes have fallen — the catacombs swallow another company.',
};

// ---- 5. Write ----------------------------------------------------------
fs.writeFileSync(MAIN, JSON.stringify(q, null, 2) + '\n');

console.log(`wrote ${MAIN}`);
console.log(`  id=${q.id}  title=${q.title}  category=${q.category}`);
console.log(`  ${q.monsters.length} monsters, ${q.furniture.length} furniture pieces, ` +
            `${q.treasure.length} treasures`);
if (mummyC) console.log(`  Fellmarg's Guardian (mummy) at L${mummyC.at[0] + 1}T${mummyC.at[1] + 1}: attack=${mummyC.attack}`);
console.log(`  Verag id: ${veragId}`);
