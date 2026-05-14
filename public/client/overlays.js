// HeroQuest — generic modal/overlay wiring + mobile tab switcher.
//
// Two small UI subsystems bundled together because they're both pure
// DOM event plumbing with no rendering / game-state interaction.
//
// 1. Hand overlays (items / spells)
//    Inventory and Spellbook panels open as a full-screen modal-style
//    overlay on click. Dismiss via:
//      - Click any element with data-dismiss="<overlay-id>"
//      - Click on the modal backdrop itself (when its parent has
//        data-dismissable)
//      - Press Escape
//
// 2. Mobile tabs (≤768px)
//    The right sidebar collapses into a bottom drawer. Each tab button
//    sets body[data-mtab] which CSS reads to reveal exactly one panel
//    (Board / Turn / Hero / Log).
//
// Public API (window.HQOverlays):
//   mountHandOverlays()        — wire items / spells open + close.
//                                Safe to call repeatedly; uses `_wired`
//                                flags on the buttons / document.
//   mountMobileTabs()          — wire the bottom tab bar. Once at boot.
//   setMobileTab(name)         — programmatic tab switch.

(function (global) {
  'use strict';

  function openOverlay(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('hidden');
  }
  function closeOverlay(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('hidden');
  }

  function mountHandOverlays() {
    const itemsBtn  = document.getElementById('btn-open-items');
    const spellsBtn = document.getElementById('btn-open-spells');
    if (itemsBtn && !itemsBtn._wired) {
      itemsBtn.addEventListener('click', () => openOverlay('items-overlay'));
      itemsBtn._wired = true;
    }
    if (spellsBtn && !spellsBtn._wired) {
      spellsBtn.addEventListener('click', () => openOverlay('spells-overlay'));
      spellsBtn._wired = true;
    }
    // Click outside the inner card, or click an element with data-dismiss,
    // closes the overlay. Wire once across the document.
    if (!document._handOverlayWired) {
      document.addEventListener('click', (ev) => {
        const dismissTarget = ev.target.closest('[data-dismiss]');
        if (dismissTarget) {
          closeOverlay(dismissTarget.dataset.dismiss);
          return;
        }
        // Click on the overlay backdrop itself (not on the inner card)
        const overlay = ev.target.closest('.modal[data-dismissable]');
        if (overlay && ev.target === overlay) {
          closeOverlay(overlay.id);
        }
      });
      document.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Escape') return;
        for (const id of ['items-overlay', 'spells-overlay']) {
          closeOverlay(id);
        }
      });
      document._handOverlayWired = true;
    }
  }

  function setMobileTab(name) {
    document.body.dataset.mtab = name;
    for (const b of document.querySelectorAll('#mobile-tabs button')) {
      b.classList.toggle('active', b.dataset.mtab === name);
    }
  }

  function mountMobileTabs() {
    document.body.dataset.mtab = 'board';
    for (const b of document.querySelectorAll('#mobile-tabs button')) {
      b.addEventListener('click', () => setMobileTab(b.dataset.mtab));
    }
  }

  global.HQOverlays = { mountHandOverlays, mountMobileTabs, setMobileTab };
})(typeof window !== 'undefined' ? window : globalThis);
