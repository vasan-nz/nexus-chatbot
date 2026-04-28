/**
 * nexus-magnet.js — Cursor-magnet effect for floating buttons.
 *
 * Exposes one global: createMagnetEffect(element, options) → { destroy }
 *
 * Load this script before nexus.js so the global is available when
 * NexusChatbot initialises.
 */
(function () {
  'use strict';

  /**
   * Attach a cursor-magnet effect to any fixed/absolute-positioned element.
   *
   * The button glides toward the cursor when it enters the detection radius,
   * then springs smoothly back when the cursor leaves. Motion is driven by an
   * exponential-decay lerp inside a requestAnimationFrame loop — the element
   * never fully "catches" the cursor, giving natural magnetic resistance.
   *
   * @param {HTMLElement} el
   * @param {object}   [opts]
   * @param {number}   [opts.radius=140]       Detection radius in px
   * @param {number}   [opts.maxShift=10]      Max px the button can drift from rest
   * @param {number}   [opts.damping=0.12]     Lerp factor per frame (lower = more lag)
   * @param {number}   [opts.scaleFactor=1.05] Scale at cursor centre (1 = no scale)
   * @param {Function} [opts.isActive]         Return false to pause without destroying
   * @returns {{ destroy: Function }}
   */
  function createMagnetEffect(el, opts) {
    opts = opts || {};

    // — Guards: bail immediately on touch devices or reduced-motion pref —
    // Returning a no-op keeps call-sites simple; no conditional needed outside.
    if (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      navigator.maxTouchPoints > 0 ||
      'ontouchstart' in window
    ) {
      return { destroy: function () {} };
    }

    var radius      = opts.radius      !== undefined ? opts.radius      : 140;
    var maxShift    = opts.maxShift    !== undefined ? opts.maxShift    : 10;
    var damping     = opts.damping     !== undefined ? opts.damping     : 0.12;
    var scaleFactor = opts.scaleFactor !== undefined ? opts.scaleFactor : 1.05;
    var isActive    = typeof opts.isActive === 'function'
                        ? opts.isActive
                        : function () { return true; };

    // — Interpolated state (values the element is at right now) —
    var curX = 0, curY = 0, curS = 1, curGlow = 0;

    // — Target state (where the lerp aims each frame) —
    var tgtX = 0, tgtY = 0, tgtS = 1, tgtGlow = 0;

    var isNear     = false;
    var rafId      = null;
    var loopActive = false;

    // ─── Helpers ─────────────────────────────────────────────────────────────

    // Read button centre once per mousemove — not inside the rAF tick — so we
    // never force a layout recalc inside the animation loop.
    function getCenter() {
      var r = el.getBoundingClientRect();
      return [r.left + r.width * 0.5, r.top + r.height * 0.5];
    }

    // ─── rAF loop ─────────────────────────────────────────────────────────────

    function tick() {
      // Exponential-decay lerp toward targets each frame.
      // The gap halves by `damping` every tick, so the element asymptotically
      // approaches but never fully reaches the target — this IS the "resistance".
      curX    += (tgtX    - curX)    * damping;
      curY    += (tgtY    - curY)    * damping;
      curS    += (tgtS    - curS)    * damping;
      curGlow += (tgtGlow - curGlow) * damping;

      // Single transform write: translate3d promotes the element to its own GPU
      // layer; compositing translate + scale in one property avoids two separate
      // compositor passes.
      el.style.transform =
        'translate3d(' + curX.toFixed(3) + 'px,' +
                         curY.toFixed(3) + 'px,0) ' +
        'scale('       + curS.toFixed(4) + ')';

      // Glow: interpolate box-shadow intensity from zero to the accent colour.
      // Only write the property when it has a non-negligible value to avoid
      // triggering constant repaints at rest.
      if (curGlow > 0.005) {
        var ring    = (curGlow * 0.45).toFixed(3);       // tight accent ring
        var diffuse = (curGlow * 0.28).toFixed(3);       // outer halo
        var blur    = (8 + curGlow * 24).toFixed(1);     // halo blur radius
        el.style.boxShadow =
          '0 0 0 1px rgba(100,108,255,' + ring + '),' +
          '0 8px ' + blur + 'px rgba(100,108,255,' + diffuse + ')';
      } else if (el.style.boxShadow) {
        el.style.boxShadow = '';
      }

      // — Settle check: stop the loop once the element is visually at rest —
      var settled =
        !isNear &&
        Math.abs(curX)     < 0.05  &&
        Math.abs(curY)     < 0.05  &&
        Math.abs(curS - 1) < 0.001 &&
        curGlow            < 0.005;

      if (settled) {
        // Hand control back to CSS — clearing inline overrides lets the
        // stylesheet's transition, animation, and box-shadow rules resume.
        el.style.transform  = '';
        el.style.boxShadow  = '';
        el.style.transition = '';
        el.style.animation  = '';
        loopActive = false;
        rafId      = null;
        return;
      }

      rafId = requestAnimationFrame(tick);
    }

    function startLoop() {
      if (loopActive) return;
      loopActive = true;

      // Disable CSS transition so our per-frame writes are applied immediately.
      // Without this, each rAF tick would trigger a new 250 ms transition,
      // causing stuttering and double-easing.
      el.style.transition = 'none';

      // CSS animations sit ABOVE inline styles in the cascade — the breathe
      // animation's transform would override el.style.transform if left running.
      // Setting animation:none via inline style wins over the stylesheet rule.
      el.style.animation = 'none';

      rafId = requestAnimationFrame(tick);
    }

    // ─── Mouse handler ────────────────────────────────────────────────────────

    function onMouseMove(e) {
      // isActive() allows the host to pause the effect (e.g. when panel is open)
      // without destroying the listener. Targets return to zero; loop settles.
      if (!isActive()) {
        if (isNear) {
          isNear  = false;
          tgtX    = tgtY = 0;
          tgtS    = 1;
          tgtGlow = 0;
        }
        return;
      }

      var center = getCenter();
      var dx     = e.clientX - center[0];
      var dy     = e.clientY - center[1];
      var dist   = Math.sqrt(dx * dx + dy * dy); // Math.hypot polyfilled via sqrt

      if (dist < radius) {
        // pull: 0 at the edge of the radius → 1 at the button centre.
        // Dividing dx/dy by radius (not dist) gives a directional vector
        // scaled to maxShift, so the button always drifts *toward* the cursor
        // but never more than maxShift px regardless of direction.
        var pull = 1 - dist / radius;

        isNear  = true;
        tgtX    = (dx / radius) * maxShift;
        tgtY    = (dy / radius) * maxShift;
        tgtS    = 1 + (scaleFactor - 1) * pull;
        tgtGlow = pull;

        startLoop();
      } else if (isNear) {
        // Cursor left the radius — set targets to rest; tick() animates return.
        isNear  = false;
        tgtX    = tgtY = 0;
        tgtS    = 1;
        tgtGlow = 0;
        // Do NOT stop the loop here — it needs to run until settled.
      }
    }

    // passive:true is required — never block scroll events on mousemove.
    document.addEventListener('mousemove', onMouseMove, { passive: true });

    // ─── Public API ───────────────────────────────────────────────────────────

    return {
      destroy: function () {
        document.removeEventListener('mousemove', onMouseMove);
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        el.style.transform  = '';
        el.style.boxShadow  = '';
        el.style.transition = '';
        el.style.animation  = '';
      }
    };
  }

  window.createMagnetEffect = createMagnetEffect;

})();
