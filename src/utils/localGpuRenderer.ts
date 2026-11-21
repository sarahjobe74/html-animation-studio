import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { BitrateMbps, FrameRate, RenderJobStatus } from '../types';
import { createCbrRateController, selectAvcCodecCandidates } from './h264CbrPadder';
import { computeFrameTimestampMs, formatTrimFileSuffix } from './trimRange';

export interface LocalGpuCapabilities {
  supported: boolean;
  hardwareEncoderLikely: boolean;
  gpuName: string | null;
}

export interface LocalRenderProgress {
  status: RenderJobStatus;
  currentFrame: number;
  totalFrames: number;
  progress: number;
  elapsedMs: number;
  etaMs: number | null;
}

export interface LocalGpuRenderOptions {
  html: string;
  width: number;
  height: number;
  durationSeconds: number;
  startSeconds?: number;
  totalTimelineSeconds?: number;
  bitrateMbps: BitrateMbps;
  fps: FrameRate;
  fileNameBase?: string;
  signal?: AbortSignal;
  onProgress?: (p: LocalRenderProgress) => void;
}

export interface LocalGpuRenderResult {
  blob: Blob;
  fileName: string;
  fileSizeBytes: number;
  verifiedBitrateMbps: number;
  usedHardware: boolean;
  elapsedMs: number;
  width: number;
  height: number;
}

const ANIMATED_CSS_PROPS = [
  'transform',
  'transform-origin',
  'opacity',
  'filter',
  'backdrop-filter',
  'clip-path',
  'width',
  'height',
  'left',
  'top',
  'right',
  'bottom',
  'margin',
  'padding',
  'color',
  'background-color',
  'background-image',
  'background-position',
  'background-size',
  'border-color',
  'border-radius',
  'box-shadow',
  'text-shadow',
  'letter-spacing',
  'font-size',
  'fill',
  'stroke',
  'stroke-dashoffset',
  'stroke-dasharray',
  'stroke-opacity',
  'fill-opacity',
] as const;

const LOCAL_VIRTUAL_CLOCK_SCRIPT = `
<script data-frameforge-local-clock="true">
(() => {
  const realSetTimeout = window.setTimeout.bind(window);
  let virtualNow = 0;
  let rafIdCounter = 1;
  let timerIdCounter = 1;
  let initializedBaseAnims = false;
  const rafQueue = new Map();
  const timers = new Map();
  const animBirthMap = new WeakMap();

  function registerCurrentAnims(atMs) {
    try {
      const anims = document.getAnimations ? document.getAnimations({ subtree: true }) : [];
      for (const anim of anims) {
        if (!animBirthMap.has(anim)) {
          animBirthMap.set(anim, atMs);
        }
      }
    } catch (e) {}
  }

  Date.now = () => 1700000000000 + virtualNow;
  performance.now = () => virtualNow;

  window.requestAnimationFrame = (cb) => {
    const id = rafIdCounter++;
    rafQueue.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => rafQueue.delete(id);

  window.setTimeout = (fn, delay = 0, ...args) => {
    const id = timerIdCounter++;
    timers.set(id, {
      fn: typeof fn === 'function' ? () => fn(...args) : () => eval(String(fn)),
      runAt: virtualNow + Math.max(0, Number(delay) || 0),
      interval: null,
    });
    return id;
  };
  window.clearTimeout = (id) => timers.delete(id);

  window.setInterval = (fn, delay = 16, ...args) => {
    const id = timerIdCounter++;
    const step = Math.max(4, Number(delay) || 16);
    timers.set(id, {
      fn: typeof fn === 'function' ? () => fn(...args) : () => eval(String(fn)),
      runAt: virtualNow + step,
      interval: step,
    });
    return id;
  };
  window.clearInterval = (id) => timers.delete(id);

  function flushTick(targetTimeMs) {
    if (!initializedBaseAnims) {
      initializedBaseAnims = true;
      registerCurrentAnims(0);
    }
    virtualNow = targetTimeMs;
    for (const [id, entry] of Array.from(timers.entries())) {
      if (entry.runAt <= virtualNow) {
        try { entry.fn(); } catch (e) {}
        if (entry.interval !== null) {
          entry.runAt += entry.interval;
        } else {
          timers.delete(id);
        }
      }
    }
    const batch = Array.from(rafQueue.entries());
    rafQueue.clear();
    for (const [, cb] of batch) {
      try { cb(virtualNow); } catch (e) {}
    }
    registerCurrentAnims(virtualNow);
  }

  window.__FRAMEFORGE_LOCAL__ = {
    seekTo(targetTimeMs) {
      const stepMs = 1000 / 60;
      if (targetTimeMs > virtualNow) {
        while (virtualNow + stepMs < targetTimeMs) {
          flushTick(virtualNow + stepMs);
        }
      }
      flushTick(targetTimeMs);

      try {
        const anims = document.getAnimations ? document.getAnimations({ subtree: true }) : [];
        for (const anim of anims) {
          if (!animBirthMap.has(anim)) {
            animBirthMap.set(anim, 0);
          }
          const birthMs = animBirthMap.get(anim) || 0;
          anim.pause();
          anim.currentTime = Math.max(0, targetTimeMs - birthMs);
        }
      } catch (e) {}

      try {
        if (window.gsap && window.gsap.globalTimeline) {
          window.gsap.globalTimeline.pause(targetTimeMs / 1000, false);
        }
      } catch (e) {}
    },
    yieldTick() {
      return new Promise((resolve) => realSetTimeout(resolve, 0));
    }
  };
})();
</script>`;

function cleanGpuRendererString(raw: string): string {
  // e.g. "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)"
  const nvidiaMatch = /(NVIDIA\s+GeForce\s+[^,(]+|NVIDIA\s+RTX\s+[^,(]+|AMD\s+Radeon[^,(]+|Apple\s+M\d[^,(]*|Intel\s+(?:Arc|Iris|UHD)[^,(]*)/i.exec(
    raw
  );
  if (nvidiaMatch) {
    return nvidiaMatch[1].replace(/\s+Direct3D.*/i, '').trim();
  }
  return raw.replace(/^ANGLE\s*\(/i, '').replace(/\)$/, '').slice(0, 48).trim();
}

function detectWebGlGpuName(): string | null {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ||
      (canvas.getContext('webgl') as WebGLRenderingContext | null);
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return null;
    const raw = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    if (typeof raw === 'string' && raw.trim()) {
      const cleaned = cleanGpuRendererString(raw);
      return cleaned;
    }
    return null;
  } catch {
    return null;
  }
}

export async function detectLocalGpuCapabilities(): Promise<LocalGpuCapabilities> {
  if (
    typeof window === 'undefined' ||
    typeof VideoEncoder !== 'function' ||
    typeof VideoFrame !== 'function'
  ) {
    return { supported: false, hardwareEncoderLikely: false, gpuName: null };
  }

  const gpuName = detectWebGlGpuName();
  const isSoftwareGpu = gpuName ? /swiftshader|llvmpipe|software/i.test(gpuName) : false;

  try {
    const hwCheck = await VideoEncoder.isConfigSupported({
      codec: 'avc1.640034',
      width: 1920,
      height: 1080,
      bitrate: 60_000_000,
      framerate: 30,
      hardwareAcceleration: 'prefer-hardware',
    });
    if (hwCheck.supported) {
      return {
        supported: true,
        hardwareEncoderLikely: !isSoftwareGpu,
        gpuName,
      };
    }

    const swCheck = await VideoEncoder.isConfigSupported({
      codec: 'avc1.640033',
      width: 1920,
      height: 1080,
      bitrate: 60_000_000,
      framerate: 30,
      hardwareAcceleration: 'no-preference',
    });
    return {
      supported: Boolean(swCheck.supported),
      hardwareEncoderLikely: false,
      gpuName,
    };
  } catch {
    return { supported: false, hardwareEncoderLikely: false, gpuName };
  }
}

async function resolveSupportedEncoderConfig(
  width: number,
  height: number,
  fps: FrameRate,
  bitrateMbps: BitrateMbps
): Promise<{ config: VideoEncoderConfig; usedHardware: boolean }> {
  const codecs = selectAvcCodecCandidates(width, height, fps);
  const bitrateBps = bitrateMbps * 1_000_000;
  const fallbackBitrateBps = Math.min(bitrateBps, 50_000_000);

  const attempts: Array<{
    hardwareAcceleration: HardwareAcceleration;
    bitrateMode: VideoEncoderBitrateMode;
    latencyMode: LatencyMode;
    bitrate: number;
    isHardware: boolean;
  }> = [
    { hardwareAcceleration: 'prefer-hardware', bitrateMode: 'constant', latencyMode: 'quality', bitrate: bitrateBps, isHardware: true },
    { hardwareAcceleration: 'prefer-hardware', bitrateMode: 'variable', latencyMode: 'quality', bitrate: bitrateBps, isHardware: true },
    { hardwareAcceleration: 'prefer-hardware', bitrateMode: 'variable', latencyMode: 'realtime', bitrate: fallbackBitrateBps, isHardware: true },
    { hardwareAcceleration: 'no-preference', bitrateMode: 'constant', latencyMode: 'quality', bitrate: bitrateBps, isHardware: false },
    { hardwareAcceleration: 'no-preference', bitrateMode: 'variable', latencyMode: 'quality', bitrate: fallbackBitrateBps, isHardware: false },
    { hardwareAcceleration: 'prefer-software', bitrateMode: 'variable', latencyMode: 'realtime', bitrate: fallbackBitrateBps, isHardware: false },
  ];

  for (const attempt of attempts) {
    for (const codec of codecs) {
      const candidate: VideoEncoderConfig = {
        codec,
        width,
        height,
        bitrate: attempt.bitrate,
        framerate: fps,
        bitrateMode: attempt.bitrateMode,
        hardwareAcceleration: attempt.hardwareAcceleration,
        latencyMode: attempt.latencyMode,
        avc: { format: 'avc' },
      };
      try {
        const support = await VideoEncoder.isConfigSupported(candidate);
        if (support.supported && support.config) {
          return { config: support.config, usedHardware: attempt.isHardware };
        }
      } catch {
        // Try next codec / acceleration config
      }
    }
  }

  throw new Error(
    `Browser WebCodecs H.264 encoder does not support ${width}×${height} @ ${fps}fps. Switch to Server Render mode.`
  );
}

function prepareLocalRenderHtml(rawHtml: string, width: number, height: number): string {
  // Enforce explicit fixed dimensions on html, body, and all common stage containers
  // Viewport units (100vw/100vh) inside SVG foreignObject resolve against the host window,
  // NOT the foreignObject! Forcing explicit pixels fixes alignment and centering issues.
  const resetCss = `<style data-frameforge-local-reset="true">
    html, body, #stage, .stage, #viewport-container, [id*="stage"], [class*="stage"], [class*="container"] {
      width: ${width}px !important;
      height: ${height}px !important;
      min-width: ${width}px !important;
      min-height: ${height}px !important;
      max-width: ${width}px !important;
      max-height: ${height}px !important;
      box-sizing: border-box !important;
    }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
    }
  </style>`;
  if (/<head[^>]*>/i.test(rawHtml)) {
    return rawHtml.replace(/<head[^>]*>/i, (m) => `${m}\n${LOCAL_VIRTUAL_CLOCK_SCRIPT}\n${resetCss}`);
  }
  return `<!doctype html><html><head>${LOCAL_VIRTUAL_CLOCK_SCRIPT}${resetCss}</head><body>${rawHtml}</body></html>`;
}

async function inlineAccessibleStylesheets(doc: Document): Promise<void> {
  const links = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
  for (const link of links) {
    const href = link.href;
    if (!href) continue;
    try {
      const res = await fetch(href, { mode: 'cors' });
      if (!res.ok) continue;
      const cssText = await res.text();
      const styleEl = doc.createElement('style');
      styleEl.setAttribute('data-inlined-href', href);
      styleEl.textContent = cssText;
      link.replaceWith(styleEl);
    } catch {
      // Keep original link in live doc; clone strips external links before SVG rasterization
    }
  }

  // Inline CORS-accessible external images to data URLs once so SVG foreignObject stays untainted
  const imgs = Array.from(doc.querySelectorAll<HTMLImageElement>('img[src]'));
  for (const imgEl of imgs) {
    const src = imgEl.getAttribute('src') || '';
    if (!/^https?:\/\//i.test(src)) continue;
    try {
      const res = await fetch(src, { mode: 'cors' });
      if (!res.ok) continue;
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(blob);
      });
      if (dataUrl.startsWith('data:')) {
        imgEl.setAttribute('src', dataUrl);
      }
    } catch {
      // Ignore CORS-blocked images
    }
  }
}

function stripExternalResourceUrlsFromCss(css: string): string {
  return css
    .replace(/@import\s+(?:url\()?["']?https?:\/\/[^;)]+["']?\)?\s*;/gi, '')
    .replace(/url\(\s*["']?https?:\/\/[^)]+["']?\s*\)/gi, 'none');
}

function findPrimaryFullStageCanvas(
  doc: Document,
  width: number,
  height: number
): HTMLCanvasElement | null {
  const canvases = Array.from(doc.querySelectorAll('canvas'));
  if (canvases.length !== 1) return null;
  const canvas = canvases[0];
  const rect = canvas.getBoundingClientRect();
  const fillsStage = rect.width >= width * 0.9 && rect.height >= height * 0.9;
  if (!fillsStage) return null;

  // Ensure there are no sibling text/overlay DOM nodes on top of the canvas
  const bodyChildren = Array.from(doc.body.children).filter(
    (el) => el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE'
  );
  if (bodyChildren.length === 1 && (bodyChildren[0] === canvas || bodyChildren[0].contains(canvas))) {
    const nonCanvasText = (doc.body.textContent || '').trim();
    if (nonCanvasText.length === 0) {
      return canvas;
    }
  }
  return null;
}

async function captureDomToCanvas(
  doc: Document,
  win: Window,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  encWidth: number,
  encHeight: number
): Promise<void> {
  const anims = doc.getAnimations ? doc.getAnimations() : [];
  const animatedEls = new Set<HTMLElement>();
  const pseudoRules: string[] = [];

  // Assign stable marker ids so we can map live animated elements -> cloned elements in O(1)
  let markerCounter = 1;
  const elementSnapshots = new Map<string, string>();
  const canvasSnapshots = new Map<string, string>();

  for (const anim of anims) {
    const effect = anim.effect as KeyframeEffect | null;
    if (!effect || !effect.target || !(effect.target instanceof HTMLElement)) continue;
    const target = effect.target;

    if (effect.pseudoElement) {
      let id = target.getAttribute('data-ff-m');
      if (!id) {
        id = String(markerCounter++);
        target.setAttribute('data-ff-m', id);
      }
      const timing = effect.getComputedTiming();
      const origDelayMs = typeof timing.delay === 'number' ? timing.delay : 0;
      const curMs = typeof anim.currentTime === 'number' ? anim.currentTime : 0;
      const effectiveDelaySec = (origDelayMs - curMs) / 1000;
      pseudoRules.push(
        `[data-ff-m="${id}"]${effect.pseudoElement}{animation-play-state:paused!important;animation-delay:${effectiveDelaySec.toFixed(4)}s!important;}`
      );
      continue;
    }

    animatedEls.add(target);
  }

  for (const el of animatedEls) {
    let id = el.getAttribute('data-ff-m');
    if (!id) {
      id = String(markerCounter++);
      el.setAttribute('data-ff-m', id);
    }
    const cs = win.getComputedStyle(el);
    const parts: string[] = ['animation:none!important', 'transition:none!important'];
    for (const prop of ANIMATED_CSS_PROPS) {
      const val = cs.getPropertyValue(prop);
      if (val && !/url\(\s*["']?https?:\/\//i.test(val)) {
        parts.push(`${prop}:${val}`);
      }
    }
    elementSnapshots.set(id, parts.join(';'));
  }

  const canvases = Array.from(doc.querySelectorAll('canvas'));
  for (const cv of canvases) {
    let id = cv.getAttribute('data-ff-c');
    if (!id) {
      id = String(markerCounter++);
      cv.setAttribute('data-ff-c', id);
    }
    try {
      canvasSnapshots.set(id, cv.toDataURL('image/png'));
    } catch {
      // Ignore tainted canvas
    }
  }

  const cloneRoot = doc.documentElement.cloneNode(true) as HTMLElement;

  // Strip scripts and external <link> tags so SVG foreignObject is 100% self-contained & untainted
  for (const s of Array.from(cloneRoot.querySelectorAll('script, link'))) {
    s.remove();
  }

  // Strip external http(s) url() references inside cloned <style> blocks to prevent canvas tainting
  for (const st of Array.from(cloneRoot.querySelectorAll('style'))) {
    if (st.textContent && /https?:\/\//i.test(st.textContent)) {
      st.textContent = stripExternalResourceUrlsFromCss(st.textContent);
    }
  }

  // Remove any external http(s) <img> that couldn't be CORS-inlined so drawImage never taints
  for (const imgEl of Array.from(cloneRoot.querySelectorAll('img[src]'))) {
    const src = imgEl.getAttribute('src') || '';
    if (/^https?:\/\//i.test(src)) {
      imgEl.removeAttribute('src');
    }
  }

  // Apply frozen animated computed styles to cloned elements
  for (const [id, styleText] of elementSnapshots.entries()) {
    const cloneEl = cloneRoot.querySelector<HTMLElement>(`[data-ff-m="${id}"]`);
    if (cloneEl) {
      const existing = (cloneEl.getAttribute('style') || '').replace(/url\(\s*["']?https?:\/\/[^)]+["']?\s*\)/gi, 'none');
      cloneEl.setAttribute('style', `${existing};${styleText}`);
    }
  }

  // Replace cloned <canvas> nodes with their rendered bitmap snapshots
  for (const [id, dataUrl] of canvasSnapshots.entries()) {
    const cloneCv = cloneRoot.querySelector<HTMLCanvasElement>(`[data-ff-c="${id}"]`);
    if (cloneCv) {
      const img = doc.createElement('img');
      img.src = dataUrl;
      img.setAttribute(
        'style',
        `${cloneCv.getAttribute('style') || ''};width:${cloneCv.clientWidth || cloneCv.width}px;height:${cloneCv.clientHeight || cloneCv.height}px;display:block;`
      );
      cloneCv.replaceWith(img);
    }
  }

  if (pseudoRules.length > 0) {
    const st = doc.createElement('style');
    st.textContent = pseudoRules.join('\n');
    const head = cloneRoot.querySelector('head') || cloneRoot;
    head.appendChild(st);
  }

  const serializedXhtml = new XMLSerializer().serializeToString(cloneRoot);
  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject x="0" y="0" width="100%" height="100%">${serializedXhtml}</foreignObject></svg>`;

  // CRITICAL: Use data:image/svg+xml URI (NOT blob: URL) so Chromium never taints the 2D canvas
  // when creating WebCodecs VideoFrame objects from SVG <foreignObject>.
  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;

  const img = new Image();
  img.decoding = 'async';
  img.src = svgDataUrl;
  await img.decode();
  ctx.clearRect(0, 0, encWidth, encHeight);
  ctx.drawImage(img, 0, 0, encWidth, encHeight);
}

export async function renderLocallyWithGpu(
  options: LocalGpuRenderOptions
): Promise<LocalGpuRenderResult> {
  const startTime = performance.now();
  const {
    html,
    width,
    height,
    durationSeconds,
    startSeconds = 0,
    totalTimelineSeconds,
    bitrateMbps,
    fps,
    fileNameBase,
    signal,
    onProgress,
  } = options;

  if (typeof VideoEncoder !== 'function' || typeof VideoFrame !== 'function') {
    throw new Error('WebCodecs API is unavailable in this browser. Use Server Render mode.');
  }

  const safeStartSeconds = Number.isFinite(startSeconds) && startSeconds > 0 ? startSeconds : 0;
  const endSeconds = Number((safeStartSeconds + durationSeconds).toFixed(2));
  const encWidth = Math.max(2, Math.floor(width / 2) * 2);
  const encHeight = Math.max(2, Math.floor(height / 2) * 2);
  const totalFrames = Math.max(1, Math.round(durationSeconds * fps));

  const safeBase =
    (fileNameBase || 'animation')
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .slice(0, 48) || 'animation';
  const trimSuffix = formatTrimFileSuffix(safeStartSeconds, endSeconds, totalTimelineSeconds);
  const fileName = `${safeBase}_${encWidth}x${encHeight}_${bitrateMbps}Mbps${trimSuffix}.mp4`;

  onProgress?.({
    status: 'initializing',
    currentFrame: 0,
    totalFrames,
    progress: 1,
    elapsedMs: 0,
    etaMs: null,
  });

  const { config: encoderConfig, usedHardware } = await resolveSupportedEncoderConfig(
    encWidth,
    encHeight,
    fps,
    bitrateMbps
  );

  const muxerTarget = new ArrayBufferTarget();
  const muxer = new Muxer({
    target: muxerTarget,
    video: {
      codec: 'avc',
      width: encWidth,
      height: encHeight,
      frameRate: fps,
    },
    fastStart: 'in-memory',
  });

  const cbrController = createCbrRateController(bitrateMbps, fps);
  const frameDurationUs = Math.round(1_000_000 / fps);
  let encoderError: Error | null = null;

  const encoder = new VideoEncoder({
    output(chunk, meta) {
      try {
        const raw = new Uint8Array(chunk.byteLength);
        chunk.copyTo(raw);
        const padded = cbrController.padFrameChunk(raw);
        muxer.addVideoChunkRaw(
          padded,
          chunk.type,
          chunk.timestamp,
          chunk.duration ?? frameDurationUs,
          meta
        );
      } catch (err) {
        encoderError = err instanceof Error ? err : new Error('Muxing failed');
      }
    },
    error(err) {
      encoderError = err instanceof Error ? err : new Error(String(err));
    },
  });

  encoder.configure(encoderConfig);

  // Mount hidden full-resolution off-screen iframe in user's local browser (uses user's GPU!)
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  iframe.style.position = 'fixed';
  iframe.style.left = '-100000px';
  iframe.style.top = '0';
  iframe.style.width = `${width}px`;
  iframe.style.height = `${height}px`;
  iframe.style.border = 'none';
  iframe.style.pointerEvents = 'none';
  iframe.style.opacity = '0.01';
  document.body.appendChild(iframe);

  const captureCanvas = document.createElement('canvas');
  captureCanvas.width = encWidth;
  captureCanvas.height = encHeight;
  const ctx = captureCanvas.getContext('2d', { alpha: false, desynchronized: true });
  if (!ctx) {
    iframe.remove();
    encoder.close();
    throw new Error('Could not initialize 2D GPU canvas context.');
  }

  try {
    const loadPromise = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('HTML scene load timed out.')), 20000);
      iframe.onload = () => {
        window.clearTimeout(timeout);
        resolve();
      };
    });

    iframe.srcdoc = prepareLocalRenderHtml(html, width, height);
    await loadPromise;

    const iframeWin = iframe.contentWindow as
      | (Window & {
          __FRAMEFORGE_LOCAL__?: {
            seekTo: (ms: number) => void;
            yieldTick: () => Promise<void>;
          };
        })
      | null;
    const iframeDoc = iframe.contentDocument;

    if (!iframeWin || !iframeDoc || !iframeWin.__FRAMEFORGE_LOCAL__) {
      throw new Error('Could not access local render sandbox.');
    }

    if (iframeDoc.fonts && iframeDoc.fonts.ready) {
      await iframeDoc.fonts.ready.catch(() => {});
    }
    await inlineAccessibleStylesheets(iframeDoc);

    const directCanvas = findPrimaryFullStageCanvas(iframeDoc, width, height);
    const captureStart = performance.now();

    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      if (signal?.aborted) {
        throw new DOMException('Render cancelled', 'AbortError');
      }
      if (encoderError) {
        throw encoderError;
      }

      const timeMs = computeFrameTimestampMs(frameIdx, fps, safeStartSeconds);
      iframeWin.__FRAMEFORGE_LOCAL__.seekTo(timeMs);
      await iframeWin.__FRAMEFORGE_LOCAL__.yieldTick();

      const timestampUs = Math.round((frameIdx * 1_000_000) / fps);
      let videoFrame: VideoFrame;

      if (directCanvas) {
        // Zero-copy direct GPU texture from WebGL / Canvas 2D -> NVENC
        if (directCanvas.width === encWidth && directCanvas.height === encHeight) {
          videoFrame = new VideoFrame(directCanvas, {
            timestamp: timestampUs,
            duration: frameDurationUs,
          });
        } else {
          ctx.drawImage(directCanvas, 0, 0, encWidth, encHeight);
          videoFrame = new VideoFrame(captureCanvas, {
            timestamp: timestampUs,
            duration: frameDurationUs,
          });
        }
      } else {
        await captureDomToCanvas(iframeDoc, iframeWin, ctx, width, height, encWidth, encHeight);
        videoFrame = new VideoFrame(captureCanvas, {
          timestamp: timestampUs,
          duration: frameDurationUs,
        });
      }

      // Backpressure wait so GPU encoder queue stays saturated without excessive VRAM
      while (encoder.encodeQueueSize > 6) {
        if (signal?.aborted) {
          videoFrame.close();
          throw new DOMException('Render cancelled', 'AbortError');
        }
        await new Promise((r) => window.setTimeout(r, 4));
      }

      const isKeyFrame = frameIdx === 0 || frameIdx % fps === 0;
      encoder.encode(videoFrame, { keyFrame: isKeyFrame });
      videoFrame.close();

      const captured = frameIdx + 1;
      const elapsedMs = Math.round(performance.now() - startTime);
      const captureElapsed = Math.max(1, performance.now() - captureStart);
      const avgPerFrame = captureElapsed / captured;
      const etaMs = Math.max(0, Math.round(avgPerFrame * (totalFrames - captured)));
      const progress = Math.min(96, Math.round((captured / totalFrames) * 96));

      onProgress?.({
        status: 'capturing',
        currentFrame: captured,
        totalFrames,
        progress,
        elapsedMs,
        etaMs,
      });
    }

    onProgress?.({
      status: 'encoding',
      currentFrame: totalFrames,
      totalFrames,
      progress: 98,
      elapsedMs: Math.round(performance.now() - startTime),
      etaMs: 0,
    });

    await encoder.flush();
    if (encoderError) {
      throw encoderError;
    }

    muxer.finalize();
    const blob = new Blob([muxerTarget.buffer], { type: 'video/mp4' });
    const actualDurationSec = totalFrames / fps;
    const verifiedBitrateMbps = Number(
      ((blob.size * 8) / (Math.max(0.1, actualDurationSec) * 1_000_000)).toFixed(2)
    );

    return {
      blob,
      fileName,
      fileSizeBytes: blob.size,
      verifiedBitrateMbps,
      usedHardware,
      elapsedMs: Math.round(performance.now() - startTime),
      width: encWidth,
      height: encHeight,
    };
  } finally {
    if (encoder.state !== 'closed') {
      try {
        encoder.close();
      } catch {
        // ignore
      }
    }
    iframe.remove();
  }
}
