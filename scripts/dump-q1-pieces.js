// Dumps every piece in sandbox-canonical-q01-the-trial.json with its
// current cell list, formatted as L#T# labels for direct comparison
// against the canonical map. Run after each YAML/converter change to
// see exactly where things land.

const fs = require('fs');
const path = require('path');

const Q = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'data', 'quests', 'sandbox',
            'sandbox-canonical-q01-the-trial.json'), 'utf8'));

function lt(c, r) { return `L${c + 1}T${r + 1}`; }

console.log('FURNITURE');
console.log('---------');
for (const f of Q.furniture) {
  const cells = f.cells.map(([c, r]) => lt(c, r)).join(' ');
  const minX = Math.min(...f.cells.map(c => c[0]));
  const minY = Math.min(...f.cells.map(c => c[1]));
  const maxX = Math.max(...f.cells.map(c => c[0]));
  const maxY = Math.max(...f.cells.map(c => c[1]));
  const w = maxX - minX + 1, h = maxY - minY + 1;
  console.log(`${f.id.padEnd(22)} ${f.type.padEnd(18)} ${w}W×${h}H  ${cells}`);
}

console.log('\nDOORS');
console.log('-----');
for (const d of Q.doors) {
  console.log(`${(d._rot || '').padEnd(10)}  ${lt(d.a[0], d.a[1])} ↔ ${lt(d.b[0], d.b[1])}`);
}

console.log('\nRUBBLE (blocked cells)');
console.log('----------------------');
for (const c of Q.blocked) {
  console.log(`  ${lt(c[0], c[1])}`);
}

console.log('\nSTAIRWAY');
console.log('--------');
console.log('  ' + Q.stairCells.map(c => lt(c[0], c[1])).join(' '));

console.log(`\n(${Q.dark.length} dark cells, ${Q.monsters.length} monsters)`);
