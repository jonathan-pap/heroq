// HeroQuest — spell/equipment card hover-preview popover.
//
// Single body-level <img> that pops up next to a thumbnail on hover and
// hides on mouseleave. Pinned to <body> so no ancestor overflow / clip
// can swallow it. Position: prefer right of the thumb; flip to the left
// if it would clip off-screen; vertically clamped to the viewport.
//
// Public API (window.HQCardPreview):
//   attach(thumb, url) — wire mouseenter / mouseleave on a thumbnail
//                        element. The popover image src is set on enter
//                        and shown the next animation frame.

(function (global) {
  'use strict';

  let _cardPreviewEl = null;

  function getCardPreview() {
    if (_cardPreviewEl) return _cardPreviewEl;
    const el = document.createElement('img');
    el.className = 'card-preview-popover';
    el.alt = '';
    el.draggable = false;
    document.body.appendChild(el);
    _cardPreviewEl = el;
    return el;
  }

  function positionCardPreview(thumb, el) {
    const rect = thumb.getBoundingClientRect();
    const pw = el.offsetWidth || 220;
    const ph = el.offsetHeight || 308;
    const gap = 10;
    // Prefer right of thumbnail; flip left if it would clip off-screen.
    let x = rect.right + gap;
    if (x + pw > window.innerWidth - 4) x = rect.left - gap - pw;
    if (x < 4) x = 4;
    // Vertical: align centre to thumbnail; clamp inside viewport.
    let y = rect.top + rect.height / 2 - ph / 2;
    y = Math.max(4, Math.min(y, window.innerHeight - ph - 4));
    el.style.left = `${Math.round(x)}px`;
    el.style.top  = `${Math.round(y)}px`;
  }

  function attach(thumb, url) {
    thumb.addEventListener('mouseenter', () => {
      const el = getCardPreview();
      el.src = url;
      el.style.display = 'block';
      // Wait a frame so the popover has natural dimensions, then place it.
      requestAnimationFrame(() => positionCardPreview(thumb, el));
    });
    thumb.addEventListener('mouseleave', () => {
      if (_cardPreviewEl) _cardPreviewEl.style.display = 'none';
    });
  }

  global.HQCardPreview = { attach };
})(typeof window !== 'undefined' ? window : globalThis);
