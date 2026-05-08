/* ==========================================================
   AI GM — scripted Evil Wizard
   Decides one action at a time for the currently-acting monster.
   Strategy (scripted, not tactical):
     - If adjacent to a living hero and haven't attacked yet, attack the
       lowest-Body hero in range.
     - Otherwise BFS through passable cells to the nearest hero, take one
       step along that path. Closed doors are treated as blocking — heroes
       open doors, monsters generally don't (matches scripted GM behavior).
     - When out of MP and out of attack, end this monster's turn.
   Caller passes the live game state and a helpers object so we don't
   duplicate the wall/door/occupant rules from server.js.
   ========================================================== */

const BOT_NAMES = [
  'Skarn','Vorgath','Mortis','Grimskull','Thrak','Drogar',
  'Karruk','Vexxis','Morgoth','Ulgar','Bezzix','Drask',
];

function pickBotName(takenLowerSet) {
  for (const n of BOT_NAMES) {
    if (!takenLowerSet.has(n.toLowerCase())) return n;
  }
  return `Bot-${Math.floor(Math.random() * 999)}`;
}

/**
 * Decide one action for the current monster.
 * @param s        full game state
 * @param current  { id, mp, attacked } for the monster acting now
 * @param helpers  { adjacent, passable, occupantAt, key, tileAt }
 * @returns { type:'move', to:[x,y] } | { type:'attack', heroId } | { type:'end' }
 */
function decideMonsterTurn(s, current, helpers) {
  const m = s.monsters.find(x => x.id === current.id);
  if (!m || m.dead) return { type: 'end' };

  // Adjacent hero attack
  if (!current.attacked) {
    const targets = s.heroes
      .filter(h => !h.dead && helpers.adjacent(m.at, h.at))
      .sort((a, b) => a.body - b.body); // pick most wounded
    if (targets.length > 0) {
      return { type: 'attack', heroId: targets[0].id };
    }
  }

  // 2021 rule: a monster that already moved AND attacked is done — it
  // can't keep walking. Action-first monsters can still move (the
  // typical case is "moved up + attacked", which ends here).
  if (current.attacked && current.movedBeforeAttack) return { type: 'end' };

  // No MP left and no attack to make — done
  if (current.mp <= 0) return { type: 'end' };

  // BFS to nearest living hero
  const path = bfsToNearestHero(s, m, helpers);
  if (!path || path.length < 2) return { type: 'end' };

  // First step along the path
  return { type: 'move', to: path[1] };
}

function bfsToNearestHero(s, monster, helpers) {
  const start = monster.at;
  const startK = `${start[0]},${start[1]}`;
  const visited = new Map();      // "x,y" -> previous "x,y" or null
  visited.set(startK, null);
  const queue = [start];

  // Heroes' cells set for quick goal check
  const heroCells = new Set();
  for (const h of s.heroes) {
    if (!h.dead) heroCells.add(`${h.at[0]},${h.at[1]}`);
  }

  while (queue.length > 0) {
    const cur = queue.shift();
    const curK = `${cur[0]},${cur[1]}`;

    // Goal: a cell adjacent to a hero (we want to STAND next to a hero,
    // not on top — heroes occupy their cells)
    if (cur !== start) {
      for (const h of s.heroes) {
        if (!h.dead && helpers.adjacent(cur, h.at)) {
          // Reconstruct path
          const path = [];
          let k = curK;
          while (k != null) {
            const [x, y] = k.split(',').map(Number);
            path.unshift([x, y]);
            k = visited.get(k);
          }
          return path;
        }
      }
    }

    // Expand neighbors
    const [x, y] = cur;
    const neighbors = [[x+1,y],[x-1,y],[x,y+1],[x,y-1]];
    for (const n of neighbors) {
      const nK = `${n[0]},${n[1]}`;
      if (visited.has(nK)) continue;
      // Goal-cell exception: a hero's cell is the goal-adjacent target,
      // but to traverse INTO it we'd need it walkable — skip into hero cells.
      // Use passable() but with a dummy "monster" mover to respect walls/doors/occupants.
      const result = helpers.passable(s, cur, n, { kind: 'monster', id: monster.id });
      // Closed doors are treated as blocking for the AI: result === false (already)
      // because door.state !== 'open' returns { needsOpenDoor: ... }, which is truthy.
      // We DON'T want the AI to treat that as passable — only fully open paths.
      const trulyOpen = result === true;
      if (!trulyOpen) continue;
      visited.set(nK, curK);
      queue.push(n);
    }
  }
  return null; // no path
}

module.exports = {
  decideMonsterTurn,
  pickBotName,
};
