/**
 * Injects a lightweight playback & inspection bridge into HTML solely for the
 * live preview iframe so Play / Pause / Restart / Seek controls work seamlessly
 * across CSS animations and Web Animations API, and reports live DOM metrics.
 */
export function buildPreviewHtml(rawHtml: string, targetWidth: number, targetHeight: number): string {
  const bridgeScript = `
<script data-frameforge-bridge="true">
(function() {
  var isPaused = false;
  var virtualElapsedMs = 0;

  function getAllAnims() {
    try {
      return document.getAnimations ? document.getAnimations({ subtree: true }) : [];
    } catch (e) {
      return [];
    }
  }

  function reportMetrics() {
    try {
      var anims = getAllAnims();
      var maxFiniteMs = 0;
      var maxInfiniteMs = 0;
      var hasFinite = false;
      var hasInfinite = false;
      for (var i = 0; i < anims.length; i++) {
        var eff = anims[i].effect;
        if (eff && eff.getComputedTiming) {
          var t = eff.getComputedTiming();
          var dur = typeof t.duration === 'number' && isFinite(t.duration) ? t.duration : 0;
          var delay = typeof t.delay === 'number' && isFinite(t.delay) ? t.delay : 0;
          var iters = t.iterations;
          if (dur <= 0) continue;
          if (iters === Infinity) {
            hasInfinite = true;
            maxInfiniteMs = Math.max(maxInfiniteMs, delay > 0 ? delay + dur : dur);
          } else {
            hasFinite = true;
            maxFiniteMs = Math.max(maxFiniteMs, Math.max(0, delay + dur * (iters || 1)));
          }
        }
      }

      var gsapFiniteMs = 0;
      var gsapInfiniteMs = 0;
      try {
        if (window.gsap && window.gsap.globalTimeline && window.gsap.globalTimeline.getChildren) {
          var children = window.gsap.globalTimeline.getChildren(false, true, true) || [];
          for (var g = 0; g < children.length; g++) {
            var ch = children[g];
            if (!ch || !ch.totalDuration) continue;
            var st = ch.startTime ? Math.max(0, ch.startTime()) : 0;
            var td = ch.totalDuration();
            var sd = ch.duration ? ch.duration() : 0;
            var rep = ch.repeat ? ch.repeat() : 0;
            if (rep === -1 || rep >= 20 || !isFinite(td) || td > 3600) {
              if (sd > 0 && sd <= 600) gsapInfiniteMs = Math.max(gsapInfiniteMs, (st + sd) * 1000);
            } else if (td > 0 && td <= 600) {
              gsapFiniteMs = Math.max(gsapFiniteMs, (st + td) * 1000);
            }
          }
        }
      } catch (ge) {}

      var gsapMs = gsapFiniteMs > 0 ? gsapFiniteMs : gsapInfiniteMs;
      var effectiveFiniteMs = Math.max(maxFiniteMs, gsapFiniteMs);
      var effectiveInfiniteMs = Math.max(maxInfiniteMs, gsapInfiniteMs);
      var maxMs = effectiveFiniteMs > 0 ? effectiveFiniteMs : effectiveInfiniteMs;
      var onlyInfinite = effectiveFiniteMs === 0 && effectiveInfiniteMs > 0;
      var docEl = document.documentElement;
      var body = document.body;
      var rectW = Math.max(docEl ? docEl.scrollWidth : 0, body ? body.scrollWidth : 0);
      var rectH = Math.max(docEl ? docEl.scrollHeight : 0, body ? body.scrollHeight : 0);
      window.parent.postMessage({
        type: 'frameforge:metrics',
        detectedMs: maxMs,
        gsapMs: gsapMs,
        hasInfinite: onlyInfinite,
        animCount: anims.length,
        scrollWidth: rectW,
        scrollHeight: rectH
      }, '*');
    } catch (err) {}
  }

  window.addEventListener('message', function(ev) {
    var data = ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'frameforge:seek') {
      var timeMs = Number(data.timeMs) || 0;
      virtualElapsedMs = timeMs;
      var anims = getAllAnims();
      for (var i = 0; i < anims.length; i++) {
        try {
          anims[i].currentTime = timeMs;
          if (data.paused) {
            anims[i].pause();
          } else {
            anims[i].play();
          }
        } catch (e) {}
      }
      try {
        if (window.gsap && window.gsap.globalTimeline) {
          window.gsap.globalTimeline.time(timeMs / 1000, false);
          if (data.paused) {
            window.gsap.globalTimeline.pause();
          } else {
            window.gsap.globalTimeline.play();
          }
        }
      } catch (e) {}
      isPaused = !!data.paused;
    } else if (data.type === 'frameforge:play') {
      isPaused = false;
      var anims = getAllAnims();
      for (var i = 0; i < anims.length; i++) {
        try { anims[i].play(); } catch (e) {}
      }
      try { if (window.gsap && window.gsap.globalTimeline) window.gsap.globalTimeline.play(); } catch (e) {}
    } else if (data.type === 'frameforge:pause') {
      isPaused = true;
      var anims = getAllAnims();
      for (var i = 0; i < anims.length; i++) {
        try { anims[i].pause(); } catch (e) {}
      }
      try { if (window.gsap && window.gsap.globalTimeline) window.gsap.globalTimeline.pause(); } catch (e) {}
    } else if (data.type === 'frameforge:restart') {
      isPaused = false;
      var anims = getAllAnims();
      for (var i = 0; i < anims.length; i++) {
        try {
          anims[i].currentTime = 0;
          anims[i].play();
        } catch (e) {}
      }
      try { if (window.gsap && window.gsap.globalTimeline) window.gsap.globalTimeline.restart(); } catch (e) {}
    }
  });

  window.addEventListener('load', function() {
    setTimeout(reportMetrics, 150);
    setTimeout(reportMetrics, 900);
  });
})();
</script>`;

  const baseReset = `
<style data-frameforge-reset="true">
  html, body {
    margin: 0;
    padding: 0;
    width: ${targetWidth}px;
    height: ${targetHeight}px;
    overflow: hidden;
  }
</style>`;

  let out = rawHtml;
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, (m) => `${m}\n${baseReset}`);
  } else {
    out = `${baseReset}\n${out}`;
  }

  if (/<\/body>/i.test(out)) {
    out = out.replace(/<\/body>/i, `${bridgeScript}\n</body>`);
  } else {
    out = `${out}\n${bridgeScript}`;
  }
  return out;
}
