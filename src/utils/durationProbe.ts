import type { AnimationTimingEntry } from '../types';
import type { RuntimeDurationProbeResult } from './htmlAnalyzer';

const MAX_VIRTUAL_PROBE_MS = 90_000;
const REAL_WALL_BUDGET_MS = 380;

const VIRTUAL_PROBE_SCRIPT = `
<script data-frameforge-probe="true">
(() => {
  const realSetTimeout = window.setTimeout.bind(window);
  const realPerfNow = performance.now.bind(performance);

  let virtualNow = 0;
  let timerIdSeq = 1;
  let rafIdSeq = 1;

  const timers = new Map();
  const rafQueue = new Map();
  const observedWaapi = [];

  // Track function references & repeat patterns so looping animations stop cleanly after 1 cycle!
  const fnScheduleInfo = new Map(); // rawFn -> { count, firstScheduledAt, lastDelay }
  const fnFireTimes = new Map(); // rawFn -> number[]
  const sleepDelayHistory = []; // delays from Promise-resolve timers (await sleep(ms))
  const domStateHistory = []; // { sig, timeMs }
  let hasChangedDomState = false;
  let initialDomSig = '';
  let detectedLoopCycleMs = null;

  let sawAnyRaf = false;
  let lastRafExecMs = 0;
  let rafStoppedAtMs = null;
  let maxOneShotTimerMs = 0;
  let firedOneShotTimers = 0;
  let insideAmbientInterval = false;

  Date.now = () => 1700000000000 + virtualNow;
  performance.now = () => virtualNow;

  function getDomFingerprint() {
    try {
      const body = document.body;
      if (!body) return '';
      const parts = [body.className || ''];
      const els = body.querySelectorAll('*');
      const limit = Math.min(els.length, 60);
      for (let i = 0; i < limit; i++) {
        const el = els[i];
        const tag = el.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE') continue;
        const cls = typeof el.className === 'string' ? el.className : '';
        const st = el.getAttribute('style') || '';
        // Include lightweight visibility/scene indicators
        const shortText = el.children.length === 0 ? (el.textContent || '').trim().slice(0, 16) : '';
        parts.push(tag + ':' + el.id + ':' + cls + ':' + st.slice(0, 48) + ':' + shortText);
      }
      return parts.join('|');
    } catch {
      return '';
    }
  }

  function detectRepeatingSleepPeriod(history) {
    // Check if the tail of sleepDelayHistory repeats a full cycle of length k (k >= 1)
    // e.g. [3000, 3000, 4000, 3000, 3000, 4000] -> period k=3, sum = 10000ms
    const n = history.length;
    if (n < 2) return null;
    for (let k = 1; k <= Math.floor(n / 2); k++) {
      let match = true;
      for (let i = 0; i < k; i++) {
        if (Math.abs(history[n - 1 - i] - history[n - 1 - k - i]) > 15) {
          match = false;
          break;
        }
      }
      if (match) {
        let sum = 0;
        for (let i = n - k; i < n; i++) sum += history[i];
        // Require either k >= 2 or single repeated delay >= 2000ms (avoid matching [500, 500] mid-sequence!)
        if (k >= 2 && sum >= 1000) {
          return sum;
        }
        if (k === 1 && n >= 3 && Math.abs(history[n - 1] - history[n - 3]) <= 15 && sum >= 2000) {
          return sum;
        }
      }
    }
    return null;
  }

  function isNativeResolveFn(fn) {
    if (typeof fn !== 'function') return false;
    try {
      const src = Function.prototype.toString.call(fn);
      return src.indexOf('[native code]') !== -1;
    } catch {
      return false;
    }
  }

  function looksLikeReplayFn(fn) {
    if (typeof fn !== 'function') return false;
    try {
      const name = fn.name || '';
      if (/^(?:restart|replay|reset|loop|play|start|run|init|cycle|animate|begin|showAll)/i.test(name)) {
        return true;
      }
      const src = Function.prototype.toString.call(fn);
      if (/\\bsetTimeout\\s*\\(\\s*(?:restart|replay|reset|loop|play|start|run|init|cycle|animate)/i.test(src)) {
        return true;
      }
      if (/\\b(?:classList\\.remove|innerHTML\\s*=|currentTime\\s*=\\s*0|reset|restart|replay)\\b/i.test(src)) {
        return true;
      }
    } catch {}
    return false;
  }

  window.requestAnimationFrame = (cb) => {
    sawAnyRaf = true;
    const id = rafIdSeq++;
    rafQueue.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    rafQueue.delete(id);
  };

  window.setTimeout = (fn, delay = 0, ...args) => {
    const d = Math.max(0, Number(delay) || 0);
    const id = timerIdSeq++;
    if (insideAmbientInterval) {
      // Do not chase timers spawned by fast ambient setInterval tickers
      return id;
    }

    const isNative = isNativeResolveFn(fn);
    const runAt = virtualNow + d;

    if (!isNative && typeof fn === 'function') {
      const info = fnScheduleInfo.get(fn) || { count: 0, firstScheduledAt: virtualNow, lastDelay: d };
      info.count += 1;
      info.lastDelay = d;
      fnScheduleInfo.set(fn, info);

      // If the EXACT same custom function schedules itself again after a cycle (>= 1500ms)
      // AND it already fired once, that's a repeating loop — stop before Cycle 2!
      const priorFires = fnFireTimes.get(fn) || [];
      if (priorFires.length >= 1 && d >= 1500 && looksLikeReplayFn(fn)) {
        if (detectedLoopCycleMs === null && virtualNow >= 1000) {
          detectedLoopCycleMs = virtualNow;
        }
        return id;
      }
      if (info.count > 25) {
        return id;
      }
    }

    timers.set(id, {
      rawFn: typeof fn === 'function' ? fn : null,
      fn: typeof fn === 'function' ? () => fn(...args) : () => {},
      runAt,
      scheduledAt: virtualNow,
      delay: d,
      interval: null,
      isNative,
    });
    return id;
  };
  window.clearTimeout = (id) => {
    timers.delete(id);
  };

  window.setInterval = (fn, delay = 16, ...args) => {
    const id = timerIdSeq++;
    const step = Math.max(16, Number(delay) || 16);
    const isAmbient = step < 1000;
    timers.set(id, {
      rawFn: typeof fn === 'function' ? fn : null,
      fn: typeof fn === 'function' ? () => fn(...args) : () => {},
      runAt: virtualNow + step,
      scheduledAt: virtualNow,
      delay: step,
      interval: step,
      isAmbient,
      fires: 0,
    });
    return id;
  };
  window.clearInterval = (id) => {
    timers.delete(id);
  };

  // Intercept Element.prototype.animate so even completed WAAPI animations are accounted for
  if (typeof Element !== 'undefined' && Element.prototype && Element.prototype.animate) {
    const origAnimate = Element.prototype.animate;
    Element.prototype.animate = function(keyframes, options) {
      try {
        if (!insideAmbientInterval) {
          let dur = 0;
          let delay = 0;
          let iters = 1;
          if (typeof options === 'number') {
            dur = options;
          } else if (options && typeof options === 'object') {
            dur = Number(options.duration) || 0;
            delay = Number(options.delay) || 0;
            iters = options.iterations === Infinity ? Infinity : Math.max(1, Number(options.iterations) || 1);
          }
          if (iters !== Infinity && iters >= 20 && dur * iters > 60000) {
            iters = Infinity;
          }
          if (dur > 0) {
            const endMs = iters === Infinity
              ? virtualNow + Math.max(0, delay) + dur
              : virtualNow + Math.max(0, delay + dur * iters);
            observedWaapi.push({
              durMs: dur,
              delayMs: delay,
              startMs: virtualNow,
              endMs,
              infinite: iters === Infinity,
            });
          }
        }
      } catch {}
      return origAnimate.apply(this, arguments);
    };
  }

  function snapshotDomAnimations(atVirtualMs, seenMap) {
    let anims = [];
    try {
      anims = document.getAnimations ? document.getAnimations({ subtree: true }) : [];
    } catch {
      try {
        anims = document.getAnimations ? document.getAnimations() : [];
      } catch {}
    }

    for (let i = 0; i < anims.length; i++) {
      const anim = anims[i];
      try {
        const eff = anim.effect;
        if (!eff || !eff.getComputedTiming) continue;
        const timing = eff.getComputedTiming();
        const dur = typeof timing.duration === 'number' && Number.isFinite(timing.duration) ? timing.duration : 0;
        if (dur <= 0) continue;
        const delay = typeof timing.delay === 'number' && Number.isFinite(timing.delay) ? timing.delay : 0;
        let iters = timing.iterations;
        let isInfinite = iters === Infinity;
        if (!isInfinite && typeof iters === 'number' && iters >= 20 && dur * iters > 60000) {
          isInfinite = true;
        }
        const activeDur = isInfinite ? dur : dur * (typeof iters === 'number' && iters > 0 ? iters : 1);
        const key = anim;
        let record = seenMap.get(key);
        if (!record) {
          const isTransition = typeof CSSTransition !== 'undefined' && anim instanceof CSSTransition;
          const animName =
            (typeof CSSAnimation !== 'undefined' && anim instanceof CSSAnimation && anim.animationName) ||
            (isTransition && anim.transitionProperty ? 'transition:' + anim.transitionProperty : '') ||
            anim.id ||
            (isTransition ? 'CSS Transition' : 'DOM Animation');
          const logicalStartMs = atVirtualMs > 0 ? atVirtualMs : 0;
          const totalFromStart = isInfinite
            ? (delay > 0 ? delay + dur : dur)
            : Math.max(0, delay + activeDur);
          record = {
            name: String(animName).slice(0, 32),
            durationMs: dur,
            delayMs: delay,
            iterations: isInfinite ? 'infinite' : (typeof iters === 'number' && iters > 0 ? iters : 1),
            endMs: logicalStartMs + totalFromStart,
            isTransition,
            infinite: isInfinite,
          };
          seenMap.set(key, record);
        }
      } catch {}
    }
  }

  function readGsapTimeline() {
    try {
      const g = window.gsap;
      if (!g || !g.globalTimeline || typeof g.globalTimeline.getChildren !== 'function') {
        return null;
      }
      const children = g.globalTimeline.getChildren(false, true, true) || [];
      if (children.length === 0) return null;

      let maxFiniteEndSec = 0;
      let maxCycleSec = 0;
      let anyFinite = false;
      let anyInfinite = false;

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (!child || typeof child.totalDuration !== 'function') continue;
        const startSec = typeof child.startTime === 'function' ? Math.max(0, child.startTime()) : 0;
        const totalDur = child.totalDuration();
        const singleDur = typeof child.duration === 'function' ? child.duration() : 0;
        const rep = typeof child.repeat === 'function' ? child.repeat() : 0;

        if (rep === -1 || rep >= 20 || !Number.isFinite(totalDur) || totalDur > 3600) {
          anyInfinite = true;
          if (Number.isFinite(singleDur) && singleDur > 0 && singleDur <= 600) {
            maxCycleSec = Math.max(maxCycleSec, startSec + singleDur);
          }
        } else if (totalDur > 0 && totalDur <= 600) {
          anyFinite = true;
          maxFiniteEndSec = Math.max(maxFiniteEndSec, startSec + totalDur);
        }
      }

      // Finite GSAP timelines always take priority over ambient infinite tweens!
      if (anyFinite && maxFiniteEndSec > 0) {
        return { durationSeconds: maxFiniteEndSec, hasInfiniteOnly: false };
      }
      if (anyInfinite && maxCycleSec > 0) {
        return { durationSeconds: maxCycleSec, hasInfiniteOnly: true };
      }
    } catch {}
    return null;
  }

  function readGlobalDurationHint() {
    const keys = ['ANIMATION_DURATION', 'VIDEO_DURATION', 'TOTAL_DURATION', 'DURATION'];
    for (const k of keys) {
      const val = window[k];
      if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
        const sec = val >= 100 ? val / 1000 : val;
        if (sec >= 0.5 && sec <= 600) {
          return { key: k, seconds: sec };
        }
      }
    }
    return null;
  }

  async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  async function runProbe(maxVirtualMs, wallBudgetMs) {
    const startWall = realPerfNow();
    const seenDomAnims = new Map();

    // Allow initial microtasks & scripts to settle at t = 0
    await new Promise((r) => realSetTimeout(r, 30));
    snapshotDomAnimations(0, seenDomAnims);
    initialDomSig = getDomFingerprint();
    domStateHistory.push({ sig: initialDomSig, timeMs: 0 });

    const globalHint = readGlobalDurationHint();
    const gsapInitial = readGsapTimeline();

    // Step virtual time forward to observe 1 full cycle (never 2+ cycles!)
    let stepMs = 50;
    let rafWasActive = sawAnyRaf && rafQueue.size > 0;
    let loopDetected = false;

    while (virtualNow < maxVirtualMs && realPerfNow() - startWall < wallBudgetMs && !loopDetected) {
      // Find earliest scheduled timer
      let nextTimerAt = Infinity;
      for (const entry of timers.values()) {
        if (entry.interval !== null) {
          if (entry.isAmbient && entry.fires >= 1) continue;
          if (!entry.isAmbient && entry.fires >= 12) continue;
        }
        if (entry.runAt < nextTimerAt) nextTimerAt = entry.runAt;
      }

      const hasActiveRaf = rafQueue.size > 0;

      if (!hasActiveRaf && nextTimerAt === Infinity) {
        if (rafWasActive && rafStoppedAtMs === null && lastRafExecMs > 0) {
          rafStoppedAtMs = lastRafExecMs;
        }
        break;
      }

      if (!hasActiveRaf && nextTimerAt < Infinity) {
        if (nextTimerAt > maxVirtualMs) break;
        virtualNow = nextTimerAt;
      } else {
        const tickStart = realPerfNow();
        const nextVirtual = Math.min(maxVirtualMs, Math.min(virtualNow + stepMs, nextTimerAt));
        virtualNow = nextVirtual;

        const batch = Array.from(rafQueue.entries());
        rafQueue.clear();
        if (batch.length > 0) {
          lastRafExecMs = virtualNow;
          for (let i = 0; i < batch.length; i++) {
            try { batch[i][1](virtualNow); } catch {}
          }
        }
        const tickCost = realPerfNow() - tickStart;
        if (tickCost > 2 && stepMs < 100) {
          stepMs = Math.min(100, stepMs * 2);
        }
      }

      // Fire any timers due at virtualNow
      let firedNonAmbientTimer = false;
      for (const [id, entry] of Array.from(timers.entries())) {
        if (entry.runAt > virtualNow) continue;

        if (entry.interval !== null) {
          if (entry.isAmbient) {
            // Fast ambient interval (< 1s): run at most once inside ambient guard, never extend timeline
            entry.fires++;
            timers.delete(id);
            insideAmbientInterval = true;
            try { entry.fn(); } catch {}
            insideAmbientInterval = false;
            continue;
          }

          // Multi-second setInterval (e.g. setInterval(restart, 10000) or setInterval(nextScene, 2500))
          entry.fires++;
          const prevSig = getDomFingerprint();
          if (entry.fires === 1 && entry.delay >= 3000 && looksLikeReplayFn(entry.rawFn)) {
            // Replay interval reached its exact 1-cycle boundary (e.g. 10,000ms)!
            detectedLoopCycleMs = virtualNow;
            loopDetected = true;
            timers.delete(id);
            break;
          }

          if (entry.fires <= 12) {
            try { entry.fn(); } catch {}
            await flushMicrotasks();
            const afterSig = getDomFingerprint();
            if (afterSig && afterSig !== initialDomSig) {
              hasChangedDomState = true;
            }
            if (
              afterSig &&
              afterSig === initialDomSig &&
              (hasChangedDomState || (entry.fires === 1 && entry.delay >= 2000 && prevSig === initialDomSig))
            ) {
              // DOM returned to its exact t=0 initial state -> 1 full cycle complete!
              detectedLoopCycleMs = virtualNow;
              loopDetected = true;
              timers.delete(id);
              break;
            }
            entry.runAt += entry.interval;
            firedNonAmbientTimer = true;
          } else {
            timers.delete(id);
          }
          continue;
        }

        // One-shot setTimeout
        timers.delete(id);

        // Check if this one-shot timer is actually the replay trigger for Cycle 2!
        // e.g. function play() { ... setTimeout(play, 10000); } play();
        if (
          !entry.isNative &&
          entry.scheduledAt === 0 &&
          entry.delay >= 2000 &&
          looksLikeReplayFn(entry.rawFn) &&
          (firedOneShotTimers > 0 || seenDomAnims.size > 0)
        ) {
          detectedLoopCycleMs = virtualNow;
          loopDetected = true;
          break;
        }

        // Check if this exact non-native function already fired earlier and is looping back
        if (!entry.isNative && entry.rawFn) {
          const fires = fnFireTimes.get(entry.rawFn) || [];
          if (fires.length >= 1 && entry.delay >= 1500 && looksLikeReplayFn(entry.rawFn)) {
            detectedLoopCycleMs = virtualNow;
            loopDetected = true;
            break;
          }
          fires.push(virtualNow);
          fnFireTimes.set(entry.rawFn, fires);
        }

        // Track Promise sleep(ms) delays to detect repeating async while(true) loops
        if (entry.isNative && entry.delay >= 100) {
          sleepDelayHistory.push(entry.delay);
        }

        const beforeSig = getDomFingerprint();
        try { entry.fn(); } catch {}
        await flushMicrotasks();
        const afterSig = getDomFingerprint();

        if (afterSig && afterSig !== initialDomSig) {
          hasChangedDomState = true;
        }

        // If DOM transitioned through other scenes and just returned to its initial t=0 state -> 1 cycle complete!
        if (
          hasChangedDomState &&
          afterSig &&
          afterSig === initialDomSig &&
          beforeSig !== initialDomSig &&
          virtualNow >= 1000
        ) {
          detectedLoopCycleMs = virtualNow;
          loopDetected = true;
          break;
        }

        // Check for repeating async sleep() pattern (even on Canvas-only loops with unchanging DOM)
        if (entry.isNative) {
          const sleepCycle = detectRepeatingSleepPeriod(sleepDelayHistory);
          if (sleepCycle !== null) {
            detectedLoopCycleMs = sleepCycle;
            loopDetected = true;
            break;
          }
        }

        firedNonAmbientTimer = true;
        firedOneShotTimers++;
        if (entry.runAt > maxOneShotTimerMs && entry.delay >= 50) {
          maxOneShotTimerMs = entry.runAt;
        }
      }

      if (loopDetected) {
        break;
      }

      if (firedNonAmbientTimer) {
        try { void document.body && document.body.offsetHeight; } catch {}
        snapshotDomAnimations(virtualNow, seenDomAnims);
      }

      if (rafWasActive && rafQueue.size === 0) {
        if (rafStoppedAtMs === null && lastRafExecMs > 0) {
          rafStoppedAtMs = lastRafExecMs;
        }
      } else if (rafQueue.size > 0) {
        rafWasActive = true;
        rafStoppedAtMs = null;
      }
    }

    if (!loopDetected) {
      snapshotDomAnimations(virtualNow, seenDomAnims);
    }
    const gsapFinal = readGsapTimeline() || gsapInitial;

    return {
      globalHint,
      gsap: gsapFinal,
      detectedLoopCycleMs,
      domEntries: Array.from(seenDomAnims.values()),
      observedWaapi,
      maxOneShotTimerMs,
      firedOneShotTimers,
      sawAnyRaf,
      rafStoppedAtMs,
      rafStillRunning: rafQueue.size > 0,
      virtualNowReached: virtualNow,
    };
  }

  window.__FRAMEFORGE_PROBE__ = { runProbe };
})();
</script>`;

function injectProbeScript(rawHtml: string, width: number, height: number): string {
  const resetCss = `<style data-frameforge-probe-reset="true">html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;}</style>`;
  if (/<head[^>]*>/i.test(rawHtml)) {
    return rawHtml.replace(/<head[^>]*>/i, (m) => `${m}\n${VIRTUAL_PROBE_SCRIPT}\n${resetCss}`);
  }
  return `<!doctype html><html><head>${VIRTUAL_PROBE_SCRIPT}${resetCss}</head><body>${rawHtml}</body></html>`;
}

interface RawProbePayload {
  globalHint: { key: string; seconds: number } | null;
  gsap: { durationSeconds: number; hasInfiniteOnly: boolean } | null;
  detectedLoopCycleMs: number | null;
  domEntries: Array<{
    name: string;
    durationMs: number;
    delayMs: number;
    iterations: number | 'infinite';
    endMs: number;
    isTransition: boolean;
    infinite: boolean;
  }>;
  observedWaapi: Array<{
    durMs: number;
    delayMs: number;
    startMs: number;
    endMs: number;
    infinite: boolean;
  }>;
  maxOneShotTimerMs: number;
  firedOneShotTimers: number;
  sawAnyRaf: boolean;
  rafStoppedAtMs: number | null;
  rafStillRunning: boolean;
  virtualNowReached: number;
}

export async function probeRuntimeAnimationDuration(
  html: string,
  width: number,
  height: number,
  signal?: AbortSignal
): Promise<RuntimeDurationProbeResult | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !html.trim()) {
    return null;
  }

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  iframe.style.position = 'fixed';
  iframe.style.left = '-100000px';
  iframe.style.top = '0';
  iframe.style.width = `${Math.max(320, Math.min(width, 3840))}px`;
  iframe.style.height = `${Math.max(240, Math.min(height, 2160))}px`;
  iframe.style.border = 'none';
  iframe.style.pointerEvents = 'none';
  iframe.style.opacity = '0';
  document.body.appendChild(iframe);

  try {
    const loaded = await new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => resolve(false), 3500);
      const onAbort = () => {
        window.clearTimeout(timer);
        resolve(false);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      iframe.onload = () => {
        window.clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(true);
      };
      iframe.srcdoc = injectProbeScript(html, width, height);
    });

    if (!loaded || signal?.aborted) {
      return null;
    }

    const win = iframe.contentWindow as
      | (Window & {
          __FRAMEFORGE_PROBE__?: {
            runProbe: (maxMs: number, wallBudgetMs: number) => Promise<RawProbePayload>;
          };
        })
      | null;

    if (!win || !win.__FRAMEFORGE_PROBE__) {
      return null;
    }

    const raw = await win.__FRAMEFORGE_PROBE__.runProbe(
      MAX_VIRTUAL_PROBE_MS,
      REAL_WALL_BUDGET_MS
    );

    if (signal?.aborted || !raw) {
      return null;
    }

    const breakdown: AnimationTimingEntry[] = [];

    // 1. Live GSAP Timeline (highest precision for GSAP scenes)
    if (raw.gsap && raw.gsap.durationSeconds > 0) {
      const sec = Number(raw.gsap.durationSeconds.toFixed(2));
      breakdown.push({
        name: 'GSAP Global Timeline (runtime)',
        durationSeconds: sec,
        delaySeconds: 0,
        iterations: raw.gsap.hasInfiniteOnly ? 'infinite' : 1,
        totalSeconds: sec,
        source: 'gsap',
      });
      return {
        durationSeconds: sec,
        source: raw.gsap.hasInfiniteOnly
          ? 'Live GSAP timeline (1 full cycle)'
          : 'Live GSAP timeline (runtime exact)',
        breakdown,
        hasInfiniteOnly: raw.gsap.hasInfiniteOnly,
        confidence: 'high',
        hadExactGsapTimeline: true,
      };
    }

    // 2. Exact 1-cycle JS loop boundary detected (setTimeout replay, setInterval cycle, or repeating async sleep)
    if (raw.detectedLoopCycleMs !== null && raw.detectedLoopCycleMs >= 500) {
      const cycleSec = Number((raw.detectedLoopCycleMs / 1000).toFixed(2));
      breakdown.push({
        name: 'Detected 1-Cycle Loop (runtime)',
        durationSeconds: cycleSec,
        delaySeconds: 0,
        iterations: 'infinite',
        totalSeconds: cycleSec,
        source: 'runtime',
      });
      return {
        durationSeconds: cycleSec,
        source: `Measured 1 full animation cycle (${cycleSec.toFixed(2)}s)`,
        breakdown,
        hasInfiniteOnly: false,
        confidence: 'high',
        hadDetectedLoopCycle: true,
      };
    }

    // 3. Explicit global window duration hint
    if (raw.globalHint && raw.globalHint.seconds > 0) {
      const sec = Number(raw.globalHint.seconds.toFixed(2));
      breakdown.push({
        name: `window.${raw.globalHint.key}`,
        durationSeconds: sec,
        delaySeconds: 0,
        iterations: 1,
        totalSeconds: sec,
        source: 'runtime',
      });
    }

    // 4. Live DOM CSS animations & transitions (finite vs ambient infinite strictly separated!)
    let maxFiniteDomSec = 0;
    let maxInfiniteDomSec = 0;
    let finiteDomCount = 0;
    let infiniteDomCount = 0;

    for (const entry of raw.domEntries) {
      const endSec = Number((entry.endMs / 1000).toFixed(2));
      const durSec = Number((entry.durationMs / 1000).toFixed(2));
      const delaySec = Number((entry.delayMs / 1000).toFixed(2));
      if (endSec <= 0 || endSec > 600) continue;

      if (entry.infinite) {
        infiniteDomCount++;
        maxInfiniteDomSec = Math.max(maxInfiniteDomSec, endSec);
      } else {
        finiteDomCount++;
        maxFiniteDomSec = Math.max(maxFiniteDomSec, endSec);
      }

      if (breakdown.length < 8) {
        breakdown.push({
          name: entry.name,
          durationSeconds: durSec,
          delaySeconds: delaySec,
          iterations: entry.iterations,
          totalSeconds: endSec,
          source: 'runtime',
        });
      }
    }

    // 5. Observed Web Animations API calls
    for (const w of raw.observedWaapi) {
      const endSec = Number((w.endMs / 1000).toFixed(2));
      if (endSec <= 0 || endSec > 600) continue;
      if (w.infinite) {
        infiniteDomCount++;
        maxInfiniteDomSec = Math.max(maxInfiniteDomSec, endSec);
      } else {
        finiteDomCount++;
        maxFiniteDomSec = Math.max(maxFiniteDomSec, endSec);
      }
      if (breakdown.length < 10) {
        breakdown.push({
          name: 'WAAPI (runtime)',
          durationSeconds: Number((w.durMs / 1000).toFixed(2)),
          delaySeconds: Number((w.delayMs / 1000).toFixed(2)),
          iterations: w.infinite ? 'infinite' : 1,
          totalSeconds: endSec,
          source: 'waapi',
        });
      }
    }

    // 6. Finite requestAnimationFrame natural completion
    let finiteRafSec = 0;
    const hadFiniteRafStop =
      raw.sawAnyRaf &&
      !raw.rafStillRunning &&
      raw.rafStoppedAtMs !== null &&
      raw.rafStoppedAtMs >= 400 &&
      raw.rafStoppedAtMs < MAX_VIRTUAL_PROBE_MS - 500;
    if (hadFiniteRafStop && raw.rafStoppedAtMs !== null) {
      finiteRafSec = Number((raw.rafStoppedAtMs / 1000).toFixed(2));
      breakdown.push({
        name: 'Canvas / rAF completion (runtime)',
        durationSeconds: finiteRafSec,
        delaySeconds: 0,
        iterations: 1,
        totalSeconds: finiteRafSec,
        source: 'runtime',
      });
    }

    // 7. One-shot setTimeout / async sleep timeline completion (non-looping)
    let timerSec = 0;
    if (raw.maxOneShotTimerMs >= 400 && raw.maxOneShotTimerMs < MAX_VIRTUAL_PROBE_MS - 500) {
      timerSec = Number((raw.maxOneShotTimerMs / 1000).toFixed(2));
      breakdown.push({
        name: `JS Timer Sequence (${raw.firedOneShotTimers} steps)`,
        durationSeconds: timerSec,
        delaySeconds: 0,
        iterations: 1,
        totalSeconds: timerSec,
        source: 'runtime',
      });
    }

    const hintSec = raw.globalHint?.seconds ?? 0;
    const maxFiniteSec = Math.max(hintSec, maxFiniteDomSec, finiteRafSec, timerSec);

    if (maxFiniteSec >= 0.5) {
      const sourceLabel =
        hadFiniteRafStop && finiteRafSec >= maxFiniteSec - 0.05
          ? 'Measured Canvas / rAF completion (runtime)'
          : timerSec >= maxFiniteSec - 0.05 && timerSec > maxFiniteDomSec
            ? 'Measured JS timer choreography (runtime)'
            : 'Measured live DOM & JS animations (runtime)';

      return {
        durationSeconds: Number(maxFiniteSec.toFixed(2)),
        source: sourceLabel,
        breakdown,
        hasInfiniteOnly: false,
        confidence: 'high',
        hadFiniteRafStop,
        hadDynamicDomAnimations: finiteDomCount > 0 || raw.observedWaapi.length > 0,
      };
    }

    if (maxInfiniteDomSec >= 0.5) {
      return {
        durationSeconds: Number(maxInfiniteDomSec.toFixed(2)),
        source: `Measured ${infiniteDomCount} looping DOM animation(s) — 1 full cycle`,
        breakdown,
        hasInfiniteOnly: true,
        confidence: 'medium',
        hadDynamicDomAnimations: true,
      };
    }

    return null;
  } catch {
    return null;
  } finally {
    iframe.remove();
  }
}
