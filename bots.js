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
 * @param helpers  { adjacent, passable, occupantAt, key, tileAt, meleeBlocked }
 * @returns { type:'move', to:[x,y] } | { type:'attack', heroId } | { type:'end' }
 */
function decideMonsterTurn(s, current, helpers) {
  const m = s.monsters.find(x => x.id === current.id);
  if (!m || m.dead) return { type: 'end' };

  const canMelee = (mAt, hAt) =>
    helpers.adjacent(mAt, hAt) &&
    !(helpers.meleeBlocked && helpers.meleeBlocked(s, mAt, hAt));

  // Adjacent hero attack — but only if there's no wall or closed door
  // between us and the target.
  if (!current.attacked) {
    const targets = s.heroes
      .filter(h => !h.dead && canMelee(m.at, h.at))
      .sort((a, b) => a.body - b.body); // pick most wounded
    if (targets.length > 0) {
      return { type: 'attack', heroId: targets[0].id };
    }
  }

  // 2021 rule: a monster that already moved AND attacked is done — it
  // can't keep walking. Action-first monsters can still move (the
  // typical case is "moved up + attacked", which ends here).
  if (current.attacked && current.movedBeforeAttack) return { type: 'end' };

  // After attacking from a stationary position, don't wander off if we
  // still have a living hero in melee — the AI was oscillating between
  // two cells next to its target and burning through its whole MP pool.
  if (current.attacked) {
    const stillAdj = s.heroes.some(h => !h.dead && canMelee(m.at, h.at));
    if (stillAdj) return { type: 'end' };
  }

  // No MP left and no attack to make — done
  if (current.mp <= 0) return { type: 'end' };

  // BFS to nearest living hero (paths through OPEN cells only).
  let path = bfsToNearestHero(s, m, helpers);
  // Fallback: heroes may be locked behind closed doors. Re-plan a path
  // that allows traversal *through* closed doors so we at least walk up
  // to the threshold and wait there. The first step is still gated by
  // real passability below — if a closed door is in the way of step 1,
  // we end the turn rather than no-op-loop.
  if (!path || path.length < 2) {
    path = bfsToNearestHero(s, m, helpers, /* allowClosedDoors */ true);
  }
  if (!path || path.length < 2) return { type: 'end' };

  // Validate the first step is actually walkable right now. If the
  // fallback path's first step is through a closed door, we can't take
  // it — end instead of bouncing.
  const step1 = path[1];
  const okNow = helpers.passable(s, m.at, step1, { kind: 'monster', id: m.id });
  if (okNow !== true) return { type: 'end' };

  return { type: 'move', to: step1 };
}

function bfsToNearestHero(s, monster, helpers, allowClosedDoors = false) {
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

  // The goal isn't "ortho-adjacent to a hero" — it's "able to actually
  // strike a hero from here". Otherwise the AI walks up to the wrong
  // side of a wall, decides it's adjacent, fails to attack, and
  // oscillates between two equally-useless cells next to its target.
  const isGoalCell = (cell) => {
    for (const h of s.heroes) {
      if (h.dead) continue;
      if (!helpers.adjacent(cell, h.at)) continue;
      if (helpers.meleeBlocked && helpers.meleeBlocked(s, cell, h.at)) continue;
      return true;
    }
    return false;
  };

  while (queue.length > 0) {
    const cur = queue.shift();
    const curK = `${cur[0]},${cur[1]}`;

    // Goal: a cell from which we could melee a living hero.
    if (cur !== start && isGoalCell(cur)) {
      const path = [];
      let k = curK;
      while (k != null) {
        const [x, y] = k.split(',').map(Number);
        path.unshift([x, y]);
        k = visited.get(k);
      }
      return path;
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
      // result === true   → fully open
      // result === false  → wall / blocked / occupant
      // result === object → closed door in the way
      let pass;
      if (result === true) pass = true;
      else if (result && result.needsOpenDoor) pass = allowClosedDoors;
      else pass = false;
      if (!pass) continue;
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
