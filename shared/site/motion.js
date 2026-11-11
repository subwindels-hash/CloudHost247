/* =============================================================================
   CloudHost247 — shared motion controller
   -----------------------------------------------------------------------------
   CANONICAL SOURCE. `node scripts/site/generate.mjs` copies this file to
   `templates/cloudhost247/js/motion.js` for the WHMCS/PHP surface. The SPA
   imports it directly. Never edit the copy.

   One small, dependency-free controller for the whole site. It uses event
   delegation (so SPA route changes need no re-binding), requestAnimationFrame
   coalescing, IntersectionObserver, and GPU-friendly CSS custom properties.
   There is no animation loop: when nothing moves, nothing runs.

   Contract with metals.css:
     [data-tilt]         -> --tilt-x / --tilt-y, .is-tilting
     [data-parallax]     -> --parallax-y
     [data-reveal]       -> .is-revealed
     .ch247-main         -> data-route-transition (SPA, set by Layout.tsx)

   Hard off switches: prefers-reduced-motion, coarse pointer, width < 1024px.
   ========================================================================== */
(function () {
  'use strict';

  var ROOT = document.documentElement;
  if (ROOT.dataset.motionReady === '1') return;
  ROOT.dataset.motionReady = '1';

  var reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  var desktopQuery = window.matchMedia('(min-width: 1024px)');
  var fineQuery = window.matchMedia('(hover: hover) and (pointer: fine)');

  function motionAllowed() {
    return !reduceQuery.matches && desktopQuery.matches && fineQuery.matches;
  }

  /* --- 1. Pointer-driven 3D tilt ------------------------------------------- */
  var active = null;
  var tiltFrame = 0;
  var pending = null;

  function resetTilt() {
    pending = null;
    if (tiltFrame) { window.cancelAnimationFrame(tiltFrame); tiltFrame = 0; }
    if (!active) return;
    active.classList.remove('is-tilting');
    active.style.setProperty('--tilt-x', '0deg');
    active.style.setProperty('--tilt-y', '0deg');
    active = null;
  }

  function applyTilt() {
    tiltFrame = 0;
    if (!pending || !motionAllowed()) return;
    var el = pending.el;
    var rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var nx = ((pending.x - rect.left) / rect.width - 0.5) * 2;
    var ny = ((pending.y - rect.top) / rect.height - 0.5) * 2;
    var max = parseFloat(el.getAttribute('data-tilt-max') || '6');
    if (!isFinite(max)) max = 6;
    max = Math.min(Math.max(max, 0), 10);
    nx = Math.min(Math.max(nx, -1), 1);
    ny = Math.min(Math.max(ny, -1), 1);
    el.classList.add('is-tilting');
    el.style.setProperty('--tilt-y', (nx * max).toFixed(2) + 'deg');
    el.style.setProperty('--tilt-x', (-ny * max).toFixed(2) + 'deg');
  }

  function onPointerMove(event) {
    if (!motionAllowed() || event.pointerType === 'touch') return;
    var el = event.target && event.target.closest ? event.target.closest('[data-tilt]') : null;
    if (el !== active) resetTilt();
    if (!el) return;
    active = el;
    pending = { el: el, x: event.clientX, y: event.clientY };
    if (!tiltFrame) tiltFrame = window.requestAnimationFrame(applyTilt);
  }

  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerleave', resetTilt, { passive: true });
  document.addEventListener('pointercancel', resetTilt, { passive: true });
  window.addEventListener('blur', resetTilt);

  /* --- 2. Subtle parallax, hero layers only -------------------------------- */
  var parallaxNodes = [];
  var visibleParallax = new Set();
  var scrollFrame = 0;

  function parallaxStep() {
    scrollFrame = 0;
    if (!motionAllowed() || !visibleParallax.size) return;
    var middle = window.innerHeight / 2;
    visibleParallax.forEach(function (el) {
      var rect = el.getBoundingClientRect();
      var offset = (rect.top + rect.height / 2 - middle) / middle; /* roughly -1 .. 1 */
      var strength = parseFloat(el.getAttribute('data-parallax') || '0.10');
      if (!isFinite(strength)) strength = 0.1;
      strength = Math.min(Math.max(strength, 0), 0.25);
      var shift = Math.min(Math.max(-offset * strength * 26, -14), 14);
      el.style.setProperty('--parallax-y', shift.toFixed(1) + 'px');
    });
  }

  function onScroll() {
    if (!scrollFrame) scrollFrame = window.requestAnimationFrame(parallaxStep);
  }

  /* --- 3. One-shot section reveal (additive: no hidden default) ------------ */
  var revealObserver = null;
  if ('IntersectionObserver' in window) {
    revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-revealed');
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.06, rootMargin: '0px 0px -6% 0px' });
  }

  var parallaxObserver = null;
  if ('IntersectionObserver' in window) {
    parallaxObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) visibleParallax.add(entry.target);
        else visibleParallax.delete(entry.target);
      });
    }, { rootMargin: '10% 0px' });
  }

  function scan() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-parallax]'), function (el) {
      if (parallaxNodes.indexOf(el) !== -1) return;
      parallaxNodes.push(el);
      if (parallaxObserver) parallaxObserver.observe(el);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-reveal]:not(.is-revealed)'), function (el) {
      if (!revealObserver) { el.classList.add('is-revealed'); return; }
      revealObserver.observe(el);
    });
  }

  /* SPA route changes replace the page body; re-scan newly mounted nodes. */
  var scanFrame = 0;
  function scheduleScan() {
    if (scanFrame) return;
    scanFrame = window.requestAnimationFrame(function () { scanFrame = 0; scan(); });
  }

  function start() {
    ROOT.dataset.motion = motionAllowed() ? 'on' : 'off';
    if (!motionAllowed()) {
      /* Content is visible by default; just mark every reveal as done. */
      Array.prototype.forEach.call(document.querySelectorAll('[data-reveal]'), function (el) {
        el.classList.add('is-revealed');
      });
      return;
    }
    scan();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onScroll();
    if ('MutationObserver' in window) {
      var body = document.body;
      if (body) {
        new MutationObserver(scheduleScan).observe(body, { childList: true, subtree: true });
      }
    }
  }

  /* A preference can change mid-session (OS setting, accessibility toggle). */
  function onPreferenceChange() {
    resetTilt();
    ROOT.dataset.motion = motionAllowed() ? 'on' : 'off';
    if (!motionAllowed()) {
      visibleParallax.clear();
      Array.prototype.forEach.call(parallaxNodes, function (el) {
        el.style.setProperty('--parallax-y', '0px');
      });
    } else {
      scan();
      onScroll();
    }
  }
  [reduceQuery, desktopQuery, fineQuery].forEach(function (q) {
    if (q.addEventListener) q.addEventListener('change', onPreferenceChange);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
