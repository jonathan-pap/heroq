// =====================================================================
// game/objectives.js — quest-objective evaluation
//
// Pure functions over the server's `state` shape. `evaluateObjectives`
// builds the checklist the UI shows (and the array form of
// `checkEndConditions` uses to flip `objectiveMet`). Auto-appends the
// "All living heroes return to a staircase" row that always closes a
// quest.
//
// State-mutating end-condition logic (`checkEndConditions` —
// objective→winner promotion, between-quest hero restoration) stays
// in server.js because it touches HEROES / SPELLS_BY_ELEMENT and
// emits log events. This module supplies it the pure evaluator.
//
// See game/objectives.md for the public API.
// =====================================================================
'use strict';

// _evalObjectiveOne(s, o) — true when `o` is satisfied by the
// current state. Supports the kinds:
//   kill        — monster `monsterId` is dead
//   kill-all    — every monster on the board is dead (and at least one existed)
//   reach       — any living hero stands on `cell`
//   gave-item   — any hero gave an item to another this quest (sets s._gaveItem)
//   survive     — at least one hero alive (optionally with monsterId dead)
// Unknown kinds report incomplete (objective falls back through
// `o.fallbackKind` / `o.fallbackCell` if provided).
function _evalObjectiveOne(s, o) {
  let kind = o.kind;
  let cell = o.cell;
  let monsterId = o.monsterId;
  const knownKinds = ['kill', 'kill-all', 'reach', 'gave-item', 'survive'];
  if (!knownKinds.includes(kind) && o.fallbackKind) {
    kind = o.fallbackKind;
    cell = o.fallbackCell || cell;
  }
  if (kind === 'kill') {
    const m = s.monsters.find(x => x.id === monsterId);
    return !!(m && m.dead);
  }
  if (kind === 'kill-all') {
    return s.monsters.length > 0 && s.monsters.every(m => m.dead);
  }
  if (kind === 'reach') {
    return !!(cell && s.heroes.some(h =>
      !h.dead && h.at[0] === cell[0] && h.at[1] === cell[1]));
  }
  if (kind === 'gave-item') {
    return !!s._gaveItem;
  }
  if (kind === 'survive') {
    const anyAlive = s.heroes.some(h => !h.dead);
    if (!anyAlive) return false;
    if (monsterId) {
      const m = s.monsters.find(x => x.id === monsterId);
      return !!(m && m.dead);
    }
    return true;
  }
  return false;
}

// evaluateObjectives(s) — checklist for the live UI. Each entry is
// `{ id, text, done, optional, locked? }`. Always appends an auto
// "All living heroes return to a staircase" row that is LOCKED until
// every required earlier row is `done`, then completes when every
// living hero stands on a stair cell.
function evaluateObjectives(s) {
  const list = (Array.isArray(s.objectives) && s.objectives.length)
    ? s.objectives
    : (s.objective ? [s.objective] : []);

  const out = [];
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    // Strip a trailing "...return to the staircase." style suffix so
    // the auto-appended stairs row covers that. Keeps the panel
    // reading clean for legacy single-objective quests.
    let text = (o.text || `Objective ${i + 1}`);
    text = text.replace(
      /[.,;:!\s]*(then|and|,)?\s*return(ing)?\s+to\s+(the\s+)?stair(case|s|way)\.?\s*$/i,
      ''
    ).trim();
    if (!text) text = o.text || `Objective ${i + 1}`;
    out.push({
      id: o.id || `o${i}`,
      text,
      done: _evalObjectiveOne(s, o),
      optional: !!o.optional,
    });
  }

  // Auto-stairs row: every living hero on a stair cell.
  const required = out.filter(o => !o.optional);
  const allRequiredDone = required.length > 0 && required.every(o => o.done);
  const stairCells = (s.stairCells && s.stairCells.length)
    ? s.stairCells
    : (s._startCells || []);
  const livingHeroes = s.heroes.filter(h => !h.dead);
  const heroesOnStair = livingHeroes.filter(h =>
    stairCells.some(c => c[0] === h.at[0] && c[1] === h.at[1])
  ).length;
  const stairsDone = allRequiredDone
    && livingHeroes.length > 0
    && stairCells.length > 0
    && heroesOnStair === livingHeroes.length;
  let stairText = 'All living heroes return to a staircase';
  if (livingHeroes.length > 0) stairText += ` (${heroesOnStair}/${livingHeroes.length})`;
  out.push({
    id: '_stairs',
    text: stairText,
    done: stairsDone,
    optional: false,
    locked: !allRequiredDone,
  });

  return out;
}

// requiredObjectivesMet(s) — boolean. True when every non-optional
// objective in the rich `objectives` array (or the singleton
// `objective`) is satisfied. Used by server.js `checkEndConditions`
// to decide when to flip `s.objectiveMet`.
function requiredObjectivesMet(s) {
  const arr = (Array.isArray(s.objectives) && s.objectives.length)
    ? s.objectives
    : null;
  if (arr) {
    const required = arr.filter(o => !o.optional);
    return required.length > 0 && required.every(o => _evalObjectiveOne(s, o));
  }
  if (s.objective) return _evalObjectiveOne(s, s.objective);
  return false;
}

module.exports = {
  _evalObjectiveOne,
  evaluateObjectives,
  requiredObjectivesMet,
};
