// HeroQuest — modal dialogs.
//
// Owns the combat-result, treasure-card, end-of-quest, and save-or-die
// modals — i.e. anything that pops over the board to confirm an event
// and gets dismissed with a button click. The renderer just hands a
// view-supplied combat / card object to showCombatModal /
// showTreasureCardModal; this module handles painting and the dismiss
// action that talks back to the server.
//
// Public API (window.HQModals):
//   showCombatModal(combat)        — paint + reveal the attack-resolution modal
//   showTreasureCardModal(card)    — paint + reveal the drawn-treasure modal
//   init({ send, getLastView })    — wire all the dismiss buttons. Call
//                                    once at boot. `send` is the WS
//                                    sender. `getLastView` returns the
//                                    current view (used by the
//                                    end-of-quest restart button).

(function (global) {
  'use strict';

  let _send = null;
  let _getLastView = null;

  // Cached element refs. Resolved on init() so the script can load
  // before the DOM is fully parsed without exploding.
  let $cmodal, $catt, $cdef, $ctitle, $csum;

  function diceGlyph(face) {
    if (face === 'skull') return '☠';        // ☠
    if (face === 'heroShield') return '❖';   // ❖ (hero shield placeholder)
    return '◆';                              // ◆ (monster shield placeholder)
  }

  function showCombatModal(combat) {
    $ctitle.textContent = `${combat.attacker.name} attacks ${combat.defender.name}`;
    $catt.innerHTML = '';
    $cdef.innerHTML = '';
    for (const f of combat.attackDice) {
      const d = document.createElement('div');
      d.className = `die ${f}`;
      d.textContent = diceGlyph(f);
      $catt.appendChild(d);
    }
    for (const f of combat.defendDice) {
      const d = document.createElement('div');
      d.className = `die ${f}`;
      d.textContent = diceGlyph(f);
      $cdef.appendChild(d);
    }
    $csum.classList.toggle('killed', !!combat.killed);
    $csum.textContent = `${combat.skulls} skull${combat.skulls===1?'':'s'} − ${combat.blocks} block${combat.blocks===1?'':'s'} = ${combat.damage} damage` +
                        (combat.killed ? ` — ${combat.defender.name} slain!` : '');
    $cmodal.classList.remove('hidden');
  }

  function showTreasureCardModal(card) {
    const m = document.getElementById('treasure-modal');
    document.getElementById('treasure-card-name').textContent = card.name;
    document.getElementById('treasure-card-flavour').textContent = card.flavour || '';
    m.classList.remove('hidden');
  }

  function init(deps) {
    _send = deps.send;
    _getLastView = deps.getLastView;

    $cmodal = document.getElementById('combat-modal');
    $catt   = document.getElementById('combat-attack-dice');
    $cdef   = document.getElementById('combat-defend-dice');
    $ctitle = document.getElementById('combat-title');
    $csum   = document.getElementById('combat-summary');

    document.getElementById('combat-ok').addEventListener('click', () => {
      $cmodal.classList.add('hidden');
      _send({ type: 'action', action: 'dismissCombat' });
    });

    document.getElementById('treasure-card-ok')?.addEventListener('click', () => {
      document.getElementById('treasure-modal').classList.add('hidden');
      _send({ type: 'action', action: 'dismissTreasureCard' });
    });

    // End modal: back to lobby
    document.getElementById('end-ok').addEventListener('click', () => {
      const view = _getLastView && _getLastView();
      if (view?.isHost) _send({ type: 'restart' });
      document.getElementById('end-modal').classList.add('hidden');
    });

    // Save modal "Accept death" — sends a -1 idx to take the death.
    document.getElementById('save-decline')?.addEventListener('click', () => {
      _send({ type: 'action', action: 'choosePotion', idx: -1 });
    });

    document.getElementById('btn-restart').addEventListener('click', () => {
      _send({ type: 'restart' });
    });
  }

  global.HQModals = { showCombatModal, showTreasureCardModal, init };
})(typeof window !== 'undefined' ? window : globalThis);
