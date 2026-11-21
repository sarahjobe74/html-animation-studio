import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeHtmlBundle,
  bundleUploadedFiles,
  classifyVideoFormat,
  detectAnimationDuration,
  detectHtmlDimensions,
  estimateFileSizeMB,
  mergeStaticAndRuntimeDuration,
  parseTimeToSeconds,
} from './htmlAnalyzer';

test('parseTimeToSeconds handles s, ms, and decimals', () => {
  assert.equal(parseTimeToSeconds('6s'), 6);
  assert.equal(parseTimeToSeconds('2500ms'), 2.5);
  assert.equal(parseTimeToSeconds('.75s'), 0.75);
  assert.equal(parseTimeToSeconds('-0.5s'), -0.5);
  assert.equal(parseTimeToSeconds('invalid'), null);
});

test('detectHtmlDimensions identifies 4K Horizontal, 4K Vertical, Ultrawide, and Super Ultrawide', () => {
  const html4kH = `<!doctype html><html><head><style>body { width: 3840px; height: 2160px; margin: 0; }</style></head><body></body></html>`;
  const d4kH = detectHtmlDimensions(html4kH);
  assert.equal(d4kH.width, 3840);
  assert.equal(d4kH.height, 2160);
  assert.equal(d4kH.category, '4k-horizontal');

  const html4kV = `<!doctype html><html><head><style>.stage { width: 2160px; height: 3840px; }</style></head><body><div class="stage"></div></body></html>`;
  const d4kV = detectHtmlDimensions(html4kV);
  assert.equal(d4kV.width, 2160);
  assert.equal(d4kV.height, 3840);
  assert.equal(d4kV.category, '4k-vertical');

  const htmlUW = `<!doctype html><html><head><style>#scene { width: 3440px; height: 1440px; }</style></head><body><div id="scene"></div></body></html>`;
  const dUW = detectHtmlDimensions(htmlUW);
  assert.equal(dUW.width, 3440);
  assert.equal(dUW.height, 1440);
  assert.equal(dUW.category, 'ultrawide');

  const htmlSUW = `<!doctype html><html><head><style>.canvas { width: 5120px; height: 1440px; }</style></head><body><div class="canvas"></div></body></html>`;
  const dSUW = detectHtmlDimensions(htmlSUW);
  assert.equal(dSUW.width, 5120);
  assert.equal(dSUW.height, 1440);
  assert.equal(dSUW.category, 'super-ultrawide');
});

test('detectHtmlDimensions handles aspect-ratio, canvas, and svg viewBox', () => {
  const arHtml = `<style>.stage { width: 3840px; aspect-ratio: 16 / 9; }</style>`;
  const arDim = detectHtmlDimensions(arHtml);
  assert.equal(arDim.width, 3840);
  assert.equal(arDim.height, 2160);

  const svgHtml = `<svg viewBox="0 0 2560 1080"></svg>`;
  const svgDim = detectHtmlDimensions(svgHtml);
  assert.equal(svgDim.width, 2560);
  assert.equal(svgDim.height, 1080);
  assert.equal(svgDim.category, 'ultrawide');
});

test('detectAnimationDuration calculates exact finite timelines and staggered delays', () => {
  const html = `
    <style>
      .title { animation: slideIn 2.5s cubic-bezier(0.16, 1, 0.3, 1) 0.5s forwards; }
      .badge {
        animation-name: pop;
        animation-duration: 1.5s;
        animation-delay: 5s;
        animation-iteration-count: 2;
      }
      @keyframes slideIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes pop { from { transform: scale(0.8); } to { transform: scale(1); } }
    </style>
  `;
  const dur = detectAnimationDuration(html);
  // 5s delay + 1.5s * 2 iterations = 8.0s
  assert.equal(dur.durationSeconds, 8);
  assert.equal(dur.isFallback, false);
  assert.equal(dur.hasInfiniteOnly, false);
});

test('detectAnimationDuration handles CSS vars, negative infinite delays, and ignores generic --duration UI tokens', () => {
  const html = `
    <style>
      :root { --duration: 0.25s; --hero-time: 9s; }
      .btn { transition: opacity var(--duration) ease; }
      .hero { animation: reveal var(--hero-time) ease-out forwards; }
      .orb { animation: spin 10s -3s linear infinite; }
    </style>
  `;
  const dur = detectAnimationDuration(html);
  // Finite hero animation is 9s (never hijacked by --duration: 0.25s or slower ambient infinite orb!)
  assert.equal(dur.durationSeconds, 9);
  assert.equal(dur.isFallback, false);

  // When ONLY infinite animations exist, negative delay does not shorten 1 full cycle
  const infiniteNegHtml = `<style>.orb { animation: spin 10s -3s linear infinite; }</style>`;
  assert.equal(detectAnimationDuration(infiniteNegHtml).durationSeconds, 10);
});

test('detectAnimationDuration does NOT over-detect from ambient infinite loops, rAF divisors, parallel GSAP, or :hover', () => {
  // 10s finite main animation + 45s ambient infinite background + 60s :hover + 999 pseudo-infinite + Math.sin(now / 30000)
  const complexHtml = `
    <style>
      .bg-stars { animation: drift 45s linear infinite; }
      .bg-pulse { animation: pulse 4s ease 999; }
      .btn:hover { animation: wobble 60s linear forwards; }
      .scene-main { animation: intro 2s ease 0s forwards; }
      .scene-end { animation: outro 2s ease 8s forwards; }
    </style>
    <script>
      function draw(now) {
        const angle = Math.sin(now / 30000);
        requestAnimationFrame(draw);
      }
    </script>
  `;
  const dur = detectAnimationDuration(complexHtml);
  assert.equal(dur.durationSeconds, 10);

  // Parallel GSAP timelines: tl1 = 6s, tl2 = 10s -> must be 10s (NOT 16s!)
  const parallelGsapHtml = `
    <script>
      const tl1 = gsap.timeline();
      tl1.to('.a', { x: 100, duration: 3 }).to('.b', { y: 50, duration: 3 });
      const tl2 = gsap.timeline();
      tl2.to('.c', { opacity: 1, duration: 4 }).to('.d', { scale: 1.2, duration: 6 });
    </script>
  `;
  assert.equal(detectAnimationDuration(parallelGsapHtml).durationSeconds, 10);

  // Replay timer `setTimeout(restart, 10000)` + 3s CSS transition -> must be 10s (NOT 13s!)
  const replayHtml = `
    <style>.panel { transition: opacity 3s ease; }</style>
    <script>
      function restart() {
        setTimeout(() => show(1), 3000);
        setTimeout(() => show(2), 6000);
        setTimeout(restart, 10000);
      }
    </script>
  `;
  assert.equal(detectAnimationDuration(replayHtml).durationSeconds, 10);
});

test('detectAnimationDuration handles SVG SMIL, GSAP sequential timelines, and JS choreography', () => {
  const smilHtml = `<svg><rect><animate attributeName="x" begin="2s" dur="6s" /></rect></svg>`;
  assert.equal(detectAnimationDuration(smilHtml).durationSeconds, 8);

  const gsapTlHtml = `
    <script>
      const tl = gsap.timeline();
      tl.to('.a', { x: 100, duration: 2 })
        .to('.b', { y: 50, duration: 3.5 })
        .to('.c', { opacity: 0, duration: 2.5 }, '-=0.5');
    </script>
  `;
  // 2 + 3.5 + (2.5 - 0.5) = 7.5s
  assert.equal(detectAnimationDuration(gsapTlHtml).durationSeconds, 7.5);

  const setTimeoutHtml = `
    <style>.card { transition: transform 1.5s ease; }</style>
    <script>
      setTimeout(() => document.body.classList.add('step-2'), 3000);
      setTimeout(() => document.body.classList.add('step-3'), 8000);
    </script>
  `;
  // 8s latest timer + 1.5s transition = 9.5s
  assert.equal(detectAnimationDuration(setTimeoutHtml).durationSeconds, 9.5);

  const asyncSleepHtml = `
    <script>
      async function run() {
        await sleep(2500);
        await sleep(3500);
        await sleep(4000);
      }
    </script>
  `;
  assert.equal(detectAnimationDuration(asyncSleepHtml).durationSeconds, 10);

  const scenesHtml = `
    <script>
      const scenes = [
        { title: 'Intro', duration: 3000 },
        { title: 'Main', duration: 4500 },
        { title: 'Outro', duration: 2500 },
      ];
    </script>
  `;
  assert.equal(detectAnimationDuration(scenesHtml).durationSeconds, 10);

  const rafCycleHtml = `
    <script>
      function loop(now) {
        const progress = (now % 12000) / 12000;
        requestAnimationFrame(loop);
      }
    </script>
  `;
  assert.equal(detectAnimationDuration(rafCycleHtml).durationSeconds, 12);
});

test('mergeStaticAndRuntimeDuration trusts runtime 1-cycle loop & shorter live DOM while respecting explicit metadata', () => {
  const staticShortCss = detectAnimationDuration(
    `<style>.letter { animation: pop 1s forwards; }</style>`
  );
  assert.equal(staticShortCss.durationSeconds, 1);

  const mergedStaggered = mergeStaticAndRuntimeDuration(staticShortCss, {
    durationSeconds: 7.4,
    source: 'Measured live DOM & JS animations (runtime)',
    breakdown: [
      {
        name: 'pop',
        durationSeconds: 1,
        delaySeconds: 6.4,
        iterations: 1,
        totalSeconds: 7.4,
        source: 'runtime',
      },
    ],
    hasInfiniteOnly: false,
    confidence: 'high',
    hadDynamicDomAnimations: true,
  });
  assert.equal(mergedStaggered.durationSeconds, 7.4);

  // Static over-estimated 35s from unused CSS / transition heuristic; runtime measured exact 10s 1-cycle loop
  const staticInflated = detectAnimationDuration(
    `<style>.unused { animation: long 35s forwards; }</style>`
  );
  const mergedLoop = mergeStaticAndRuntimeDuration(staticInflated, {
    durationSeconds: 10,
    source: 'Measured 1 full animation cycle (10.00s)',
    breakdown: [],
    hasInfiniteOnly: false,
    confidence: 'high',
    hadDetectedLoopCycle: true,
  });
  assert.equal(mergedLoop.durationSeconds, 10);

  // Explicit metadata always wins
  const explicitMeta = detectAnimationDuration(`<body data-duration="14s"></body>`);
  const mergedMeta = mergeStaticAndRuntimeDuration(explicitMeta, {
    durationSeconds: 3,
    source: 'Measured live DOM & JS animations (runtime)',
    breakdown: [],
    hasInfiniteOnly: false,
    confidence: 'high',
  });
  assert.equal(mergedMeta.durationSeconds, 14);
});

test('detectAnimationDuration handles infinite loop cycle and Web Animations API', () => {
  const loopHtml = `<style>.orb { animation: orbit 6.5s linear infinite; }</style>`;
  const loopDur = detectAnimationDuration(loopHtml);
  assert.equal(loopDur.durationSeconds, 6.5);
  assert.equal(loopDur.hasInfiniteOnly, true);

  const waapiHtml = `<script>el.animate([{opacity:0},{opacity:1}], { duration: 4200, delay: 800 });</script>`;
  const waapiDur = detectAnimationDuration(waapiHtml);
  assert.equal(waapiDur.durationSeconds, 5);
});

test('bundleUploadedFiles inlines linked CSS and JS into HTML entry', () => {
  const bundled = bundleUploadedFiles([
    {
      name: 'index.html',
      type: 'html',
      size: 100,
      content: `<html><head><link rel="stylesheet" href="styles.css"></head><body><script src="./anim.js"></script></body></html>`,
    },
    {
      name: 'styles.css',
      type: 'css',
      size: 60,
      content: `body { width: 3840px; height: 2160px; } .box { animation: fade 9s forwards; }`,
    },
    {
      name: 'anim.js',
      type: 'js',
      size: 20,
      content: `console.log("ready");`,
    },
  ]);

  const analysis = analyzeHtmlBundle([
    {
      name: 'index.html',
      type: 'html',
      size: 100,
      content: `<html><head><link rel="stylesheet" href="styles.css"></head><body><script src="./anim.js"></script></body></html>`,
    },
    {
      name: 'styles.css',
      type: 'css',
      size: 60,
      content: `body { width: 3840px; height: 2160px; } .box { animation: fade 9s forwards; }`,
    },
  ]);

  assert.match(bundled.bundledHtml, /<style data-source="styles\.css">/);
  assert.match(bundled.bundledHtml, /<script data-source="anim\.js">/);
  assert.equal(analysis.dimensions.width, 3840);
  assert.equal(analysis.dimensions.height, 2160);
  assert.equal(analysis.duration.durationSeconds, 9);
});

test('estimateFileSizeMB and classifyVideoFormat return accurate calculations', () => {
  assert.equal(estimateFileSizeMB(80, 10), 100);
  assert.equal(estimateFileSizeMB(120, 6), 90);
  assert.equal(classifyVideoFormat(5120, 1440).category, 'super-ultrawide');
  assert.equal(classifyVideoFormat(3440, 1440).category, 'ultrawide');
});
