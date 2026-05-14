// HeroQuest — canvas hover/click handling + floating tooltip.
//
// Wires three things on the board canvas:
//   - mousemove → updates hoverCell (a [x, y] grid coord), picks a
//     CSS cursor based on what's under the pointer, paints a small
//     floating tooltip with the monster/hero stats or move cost,
//     and triggers a redraw so the path preview follows the pointer.
//   - mouseleave → clears hover state + tooltip.
//   - click → dispatches the right server action: spell target (when
//     a spell is armed), trap disarm, monster attack, hero move; in
//     GM-human mode, monster move / attack.
//
// The tooltip element (`.hover-tip`) is lazily created and lives at
// document.body so no ancestor's overflow can clip it.
//
// Public API (window.HQBoardInput):
//   init({
//     canvas, screenToCell, drawBoard,
//     getLastView, getLastReachable,
//     getPendingSpell, setPendingSpell,
//     getHoverCell,   setHoverCell,
//     getSelectedGMMonsterId,
//     sendCast, action, send,
//   })  — once at boot. All of these are owned by client.js because
//        the same state is read by the canvas renderer; the input
//        module just borrows them via thin accessors.

(function (global) {
  'use strict';

  const D = {};   // late-bound deps, populated in init()

  // ----- Stat line helper --------------------------------------------
  function statLine(o) {
    // "B 1/1 · A2 D1 M10" for a monster, similar for a hero
    const bm = (o.bodyMax != null) ? `${o.body}/${o.bodyMax}` : `${o.body}`;
    const parts = [`Body ${bm}`];
    if (o.mind != null && o.mindMax != null) parts.push(`Mind ${o.mind}/${o.mindMax}`);
    if (o.attack != null) parts.push(`A${o.attack}`);
    if (o.defend != null) parts.push(`D${o.defend}`);
    if (o.moveSquares != null) parts.push(`Mv${o.moveSquares}`);
    return parts.join(' · ');
  }

  // ----- Floating tooltip --------------------------------------------
  let _tipEl = null;
  function tipEl() {
    if (!_tipEl) {
      _tipEl = document.createElement('div');
      _tipEl.className = 'hover-tip';
      document.body.appendChild(_tipEl);
    }
    return _tipEl;
  }
  function showTooltip(e, text) {
    const t = tipEl();
    t.textContent = text;
    t.style.display = 'block';
    moveTooltip(e);
  }
  function moveTooltip(e) {
    if (!_tipEl || _tipEl.style.display === 'none') return;
    _tipEl.style.left = (e.clientX + 14) + 'px';
    _tipEl.style.top  = (e.clientY + 14) + 'px';
  }
  function hideTooltip() { if (_tipEl) _tipEl.style.display = 'none'; }

  // ----- Hover cursor picker -----------------------------------------
  function updateHoverCursor(e) {
    const lastView = D.getLastView();
    const hoverCell = D.getHoverCell();
    if (!lastView || !hoverCell) return;
    const cur = lastView.currentTurn;
    let cursorStyle = 'default';
    let label = '';
    const [x, y] = hoverCell;

    // Inspection tooltips work even when it's NOT your turn — hovering a
    // monster or ally shows their stats card-equivalent.
    const monster = lastView.monsters.find(m => m.at[0] === x && m.at[1] === y);
    const heroOnCell = lastView.heroes.find(hh => !hh.dead && hh.at[0] === x && hh.at[1] === y);

    if (lastView.myTurn && cur?.kind === 'hero') {
      const h = lastView.heroes.find(hh => hh.id === cur.heroId);
      if (h) {
        const trap = (lastView.traps || []).find(t => t.at[0] === x && t.at[1] === y && t.revealed);
        if (monster && (Math.abs(h.at[0]-x) + Math.abs(h.at[1]-y) === 1)) {
          cursorStyle = 'crosshair';
          label = `Attack ${monster.name} — ${statLine(monster)}`;
        } else if (monster) {
          // Non-adjacent monster: inspect tooltip (no cursor for click — server
          // will validate range/LOS if they click)
          cursorStyle = 'help';
          label = `${monster.name} — ${statLine(monster)}`;
        } else if (heroOnCell && heroOnCell.id !== h.id) {
          cursorStyle = 'help';
          label = `${heroOnCell.name} — ${statLine(heroOnCell)}`;
        } else if (trap && (Math.abs(h.at[0]-x) + Math.abs(h.at[1]-y) <= 1)) {
          cursorStyle = 'help';
          label = `Disarm ${trap.type} trap`;
        } else {
          const lr = D.getLastReachable();
          if (lr && lr.dist.has(`${x},${y}`)) {
            const d = lr.dist.get(`${x},${y}`);
            if (d === 0) { cursorStyle = 'default'; label = ''; }
            else { cursorStyle = 'pointer'; label = `Move (${d} sq)`; }
          } else {
            cursorStyle = 'not-allowed';
          }
        }
      }
    } else {
      // Spectator / GM-AI turn / your hero waiting — still let hovering
      // monsters and heroes surface their stats. No cursor change.
      if (monster) {
        cursorStyle = 'help';
        label = `${monster.name} — ${statLine(monster)}`;
      } else if (heroOnCell) {
        cursorStyle = 'help';
        label = `${heroOnCell.name} — ${statLine(heroOnCell)}`;
      }
    }
    D.canvas.style.cursor = cursorStyle;
    if (label) showTooltip(e, label); else hideTooltip();
  }

  // ----- Listeners ----------------------------------------------------
  function init(deps) {
    Object.assign(D, deps);
    const { canvas, screenToCell, drawBoard } = D;

    canvas.addEventListener('mousemove', (e) => {
      const lastView = D.getLastView();
      if (!lastView) return;
      const [x, y] = screenToCell(e);
      const hoverCell = D.getHoverCell();
      if (hoverCell && hoverCell[0] === x && hoverCell[1] === y) {
        moveTooltip(e); return;
      }
      D.setHoverCell([x, y]);
      updateHoverCursor(e);
      drawBoard(lastView);
    });
    canvas.addEventListener('mouseleave', () => {
      D.setHoverCell(null);
      canvas.style.cursor = 'default';
      hideTooltip();
      const lastView = D.getLastView();
      if (lastView) drawBoard(lastView);
    });

    canvas.addEventListener('click', (e) => {
      const lastView = D.getLastView();
      if (!lastView) return;
      const [x, y] = screenToCell(e);
      if (!lastView.myTurn) return;

      const cur = lastView.currentTurn;

      // Spell-target picker mode
      const pendingSpell = D.getPendingSpell();
      if (pendingSpell) {
        const targetMonster = lastView.monsters.find(m => m.at[0] === x && m.at[1] === y);
        const targetHero = lastView.heroes.find(h => !h.dead && h.at[0] === x && h.at[1] === y);
        if (targetMonster && (pendingSpell.target === 'enemy' || pendingSpell.target === 'anyone' || pendingSpell.target === 'line')) {
          D.sendCast(pendingSpell.id, { kind: 'monster', id: targetMonster.id });
          return;
        }
        if (targetHero && (pendingSpell.target === 'ally' || pendingSpell.target === 'anyone' || pendingSpell.target === 'line')) {
          D.sendCast(pendingSpell.id, { kind: 'hero', id: targetHero.id });
          return;
        }
        // Click elsewhere cancels
        D.setPendingSpell(null);
        drawBoard(lastView);
        return;
      }

      if (cur?.kind === 'hero') {
        const h = lastView.heroes.find(h => h.id === cur.heroId);
        if (!h) return;
        // Click a revealed trap when adjacent → disarm (Dwarf or Tool Kit)
        const trap = (lastView.traps || []).find(t => t.at[0] === x && t.at[1] === y && t.revealed);
        if (trap && (Math.abs(h.at[0]-x) + Math.abs(h.at[1]-y) <= 1)) {
          if (confirm(`Attempt to disarm ${trap.type} trap?`)) {
            D.send({ type: 'action', action: 'disarmTrap', trapId: trap.id });
            return;
          }
        }
        // Click a monster → attack. Range / diagonal allowed depends on
        // the equipped weapon — the server validates and rejects out-of-
        // range. We send the action for any monster click and let server
        // be the source of truth.
        const targetMonster = lastView.monsters.find(m => m.at[0] === x && m.at[1] === y);
        if (targetMonster) {
          D.action('attack', { targetMonsterId: targetMonster.id });
          return;
        }
        // Otherwise pathfind: server walks the BFS path one cell at a time,
        // halting on traps / new monster encounters / out-of-MP.
        D.action('moveTo', { target: [x, y] });
        return;
      }

      if (cur?.kind === 'gm' && lastView.config.gmMode === 'human') {
        const selId = D.getSelectedGMMonsterId();
        if (!selId) return;
        const m = lastView.monsters.find(x => x.id === selId);
        if (!m) return;
        const targetHero = lastView.heroes.find(h => !h.dead && h.at[0] === x && h.at[1] === y);
        if (targetHero && Math.abs(m.at[0]-x) + Math.abs(m.at[1]-y) === 1) {
          D.send({ type: 'action', action: 'gmAttack', monsterId: m.id, heroId: targetHero.id });
          return;
        }
        D.send({ type: 'action', action: 'gmMove', monsterId: m.id, target: [x, y] });
        return;
      }
    });
  }

  global.HQBoardInput = { init, statLine, showTooltip, moveTooltip, hideTooltip };
})(typeof window !== 'undefined' ? window : globalThis);
