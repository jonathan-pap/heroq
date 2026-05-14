// HeroQuest — sidebar tab panes (Spells / Items / Log).
//
// The right rail collapses into one panel at a time. This module owns:
//
//   - The Spells pane: cards in the current hero's spellHand, with a
//     hand→target flow handled by the host's onSpellClick callback.
//   - The Items pane: the current hero's inventory, with click→useItem.
//   - The tab counts: badges on the tab buttons + on the action-panel
//     "open Inventory / Spellbook" buttons (dimmed if empty).
//   - The Log pane: append-only event feed; auto-scrolls to bottom.
//   - The sidebar tab switcher (Actions / Spells / Items / Log) —
//     purely visual class toggling on `#sidebar-tabs button` +
//     `[data-stab-content]` panes.
//
// Public API (window.HQSidebar):
//   init({ getPendingSpell, onSpellClick, action })  — once at boot
//     getPendingSpell — () => the currently-armed spell (or null), used
//                       to highlight the matching spell card.
//     onSpellClick    — (spell, hero, view) handler when a hand card is
//                       clicked. Owned by client.js because the
//                       target-pick flow walks the canvas.
//     action          — (name, extra?) → send a server action. Used
//                       by the Items pane for "useItem".
//   renderSpells(view)         — paint #spells-body
//   renderItems(view)          — paint #items-body
//   renderLog(view)            — paint #log + auto-scroll
//   updateTabCounts(view)      — refresh badges on tabs + open buttons
//   setSidebarTab(name)        — programmatic tab switch

(function (global) {
  'use strict';

  let _getPendingSpell = () => null;
  let _onSpellClick = () => {};
  let _action = () => {};

  function renderSpells(view) {
    const el = document.getElementById('spells-body');
    if (!el) return;
    el.innerHTML = '';
    const cur = view.currentTurn;
    if (cur?.kind !== 'hero' || !view.myTurn) {
      el.innerHTML = '<p class="muted small">No spells available right now.</p>';
      return;
    }
    const h = view.heroes.find(x => x.id === cur.heroId);
    if (!h || !h.spellHand || h.spellHand.length === 0) {
      el.innerHTML = '<p class="muted small">No spells in hand.</p>';
      return;
    }
    const pending = _getPendingSpell();
    const sg = document.createElement('div');
    sg.className = 'spell-grid';
    for (const sp of h.spellHand) {
      const b = document.createElement('button');
      b.className = `spell-card el-${sp.element}`;
      if (pending && pending.id === sp.id) b.classList.add('active');
      b.innerHTML = `<div class="sp-name">${sp.name}</div><div class="sp-el">${sp.element.toUpperCase()}</div>`;
      b.title = sp.text || '';
      b.disabled = view.actionUsed && !(h.equipped.artifactItem === 'wand-of-recall');
      b.addEventListener('click', () => _onSpellClick(sp, h, view));
      sg.appendChild(b);
    }
    el.appendChild(sg);
  }

  function renderItems(view) {
    const el = document.getElementById('items-body');
    if (!el) return;
    el.innerHTML = '';
    const cur = view.currentTurn;
    if (cur?.kind !== 'hero' || !view.myTurn) {
      el.innerHTML = '<p class="muted small">No inventory available right now.</p>';
      return;
    }
    const h = view.heroes.find(x => x.id === cur.heroId);
    if (!h || !h.inventory || h.inventory.length === 0) {
      el.innerHTML = '<p class="muted small">Inventory is empty.</p>';
      return;
    }
    for (const it of h.inventory) {
      const ib = document.createElement('button');
      ib.className = 'inv-row';
      ib.textContent = it.name;
      ib.title = `Use ${it.name}`;
      ib.addEventListener('click', () => _action('useItem', { itemIndex: it.idx }));
      el.appendChild(ib);
    }
  }

  function updateTabCounts(view) {
    const sc = document.getElementById('spells-count');
    const ic = document.getElementById('items-count');
    const cur = view.currentTurn;
    let spells = 0, items = 0;
    if (cur?.kind === 'hero') {
      const h = view.heroes.find(x => x.id === cur.heroId);
      if (h) {
        spells = (h.spellHand || []).length;
        items = (h.inventory || []).length;
      }
    }
    if (sc) sc.textContent = spells > 0 ? `(${spells})` : '';
    if (ic) ic.textContent = items > 0 ? `(${items})` : '';
    // Mirror the counts onto the action-panel buttons that open the
    // Inventory / Spellbook overlays.
    const bi = document.getElementById('btn-items-count');
    const bs = document.getElementById('btn-spells-count');
    if (bi) bi.textContent = items;
    if (bs) bs.textContent = spells;
    // Dim the buttons when there's nothing inside (still clickable, but
    // visually quiet — your hero might not have anything yet).
    const btnItems  = document.getElementById('btn-open-items');
    const btnSpells = document.getElementById('btn-open-spells');
    if (btnItems)  btnItems.classList.toggle('empty', items === 0);
    if (btnSpells) btnSpells.classList.toggle('empty', spells === 0);
  }

  function setSidebarTab(name) {
    for (const b of document.querySelectorAll('#sidebar-tabs button')) {
      b.classList.toggle('active', b.dataset.stab === name);
    }
    for (const p of document.querySelectorAll('[data-stab-content]')) {
      p.classList.toggle('hidden', p.dataset.stabContent !== name);
    }
  }

  function renderLog(view) {
    const log = document.getElementById('log');
    log.innerHTML = '';
    for (const e of view.log) {
      const div = document.createElement('div');
      div.className = `entry ${e.cls || ''}`;
      div.textContent = e.text;
      log.appendChild(div);
    }
    log.scrollTop = log.scrollHeight;
  }

  function init(deps) {
    if (deps.getPendingSpell) _getPendingSpell = deps.getPendingSpell;
    if (deps.onSpellClick)    _onSpellClick   = deps.onSpellClick;
    if (deps.action)          _action         = deps.action;
    for (const b of document.querySelectorAll('#sidebar-tabs button')) {
      b.addEventListener('click', () => setSidebarTab(b.dataset.stab));
    }
  }

  global.HQSidebar = {
    init,
    renderSpells, renderItems, updateTabCounts, renderLog, setSidebarTab,
  };
})(typeof window !== 'undefined' ? window : globalThis);
