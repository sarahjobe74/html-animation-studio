import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { chromium, type Browser } from 'playwright-core';
import type {
  BitrateMbps,
  FrameRate,
  RenderJobState,
  VideoContainerFormat,
} from '../src/types';
import {
  buildFfmpegArgs,
  parseFfprobeBitrateMbps,
  partitionFrameRanges,
} from './ffmpegConfig.ts';
import { computeFrameTimestampMs, formatTrimFileSuffix } from '../src/utils/trimRange.ts';

const execFileAsync = promisify(execFile);

export interface StartRenderInput {
  html: string;
  width: number;
  height: number;
  durationSeconds: number;
  startSeconds?: number;
  totalTimelineSeconds?: number;
  bitrateMbps: BitrateMbps;
  fps: FrameRate;
  format: VideoContainerFormat;
  fileNameBase?: string;
}

interface InternalJob extends RenderJobState {
  startSeconds: number;
  endSeconds: number;
  outputPath: string;
  tempDir: string;
  cancelled: boolean;
  ffmpegProc?: ChildProcess;
  browsers: Browser[];
  createdAt: number;
}

const CHROME_CANDIDATES = [
  process.env.CHROMIUM_EXECUTABLE_PATH,
  '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell',
  '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter((p): p is string => Boolean(p));

function resolveChromiumPath(): string {
  for (const candidate of CHROME_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error('Headless Chromium binary not found in container.');
}

async function probeActualBitrateMbps(outputPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', outputPath],
      { timeout: 10000 }
    );
    return parseFfprobeBitrateMbps(stdout);
  } catch {
    return null;
  }
}

const VIRTUAL_CLOCK_INIT_SCRIPT = `
(() => {
  const realDateNow = Date.now.bind(Date);
  const realPerfNow = performance.now.bind(performance);
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
  window.cancelAnimationFrame = (id) => {
    rafQueue.delete(id);
  };

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

  window.__FRAMEFORGE_RENDER__ = {
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
    async settle() {
      if (document.fonts && document.fonts.ready) {
        try { await document.fonts.ready; } catch (e) {}
      }
    },
    yieldPaint() {
      return new Promise((resolve) => realSetTimeout(resolve, 0));
    }
  };

  void realDateNow;
  void realPerfNow;
})();
`;

export class RenderManager {
  private jobs = new Map<string, InternalJob>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, job] of this.jobs.entries()) {
        const ageMs = now - job.createdAt;
        const finished =
          job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
        if (finished && ageMs > 30 * 60 * 1000) {
          void fsp.rm(job.tempDir, { recursive: true, force: true }).catch(() => {});
          this.jobs.delete(id);
        }
      }
    }, 5 * 60 * 1000);
    this.cleanupInterval.unref();
  }

  public getJob(id: string): RenderJobState | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    return this.toPublicState(job);
  }

  public getJobFile(
    id: string
  ): { outputPath: string; fileName: string; format: VideoContainerFormat } | null {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'completed' || !job.outputFileName) return null;
    if (!fs.existsSync(job.outputPath)) return null;
    return {
      outputPath: job.outputPath,
      fileName: job.outputFileName,
      format: job.format,
    };
  }

  public cancelJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.cancelled = true;
    if (job.ffmpegProc && !job.ffmpegProc.killed) {
      job.ffmpegProc.kill('SIGKILL');
    }
    for (const browser of job.browsers) {
      void browser.close().catch(() => {});
    }
    if (job.status !== 'completed' && job.status !== 'failed') {
      job.status = 'cancelled';
    }
    return true;
  }

  public async startJob(input: StartRenderInput): Promise<RenderJobState> {
    const id = `ff_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), `frameforge-${id}-`));
    const safeBase =
      (input.fileNameBase || 'animation')
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .slice(0, 48) || 'animation';

    const safeStartSeconds =
      Number.isFinite(input.startSeconds) && Number(input.startSeconds) > 0
        ? Number(Number(input.startSeconds).toFixed(2))
        : 0;
    const endSeconds = Number((safeStartSeconds + input.durationSeconds).toFixed(2));
    const ext = input.format === 'webm' ? 'webm' : input.format === 'mov' ? 'mov' : 'mp4';
    const trimSuffix = formatTrimFileSuffix(safeStartSeconds, endSeconds, input.totalTimelineSeconds);
    const outputFileName = `${safeBase}_${input.width}x${input.height}_${input.bitrateMbps}Mbps${trimSuffix}.${ext}`;
    const outputPath = path.join(tempDir, outputFileName);
    const totalFrames = Math.max(1, Math.round(input.durationSeconds * input.fps));

    const job: InternalJob = {
      id,
      status: 'queued',
      width: input.width,
      height: input.height,
      durationSeconds: input.durationSeconds,
      startSeconds: safeStartSeconds,
      endSeconds,
      bitrateMbps: input.bitrateMbps,
      fps: input.fps,
      format: input.format,
      currentFrame: 0,
      totalFrames,
      progress: 0,
      elapsedMs: 0,
      etaMs: null,
      fileSizeBytes: null,
      verifiedBitrateMbps: null,
      outputFileName,
      error: null,
      outputPath,
      tempDir,
      cancelled: false,
      browsers: [],
      createdAt: Date.now(),
    };

    this.jobs.set(id, job);

    // Run asynchronously in background without blocking the POST response
    void this.executeJob(job, input.html);

    return this.toPublicState(job);
  }

  private toPublicState(job: InternalJob): RenderJobState {
    return {
      id: job.id,
      status: job.status,
      width: job.width,
      height: job.height,
      durationSeconds: job.durationSeconds,
      startSeconds: job.startSeconds,
      endSeconds: job.endSeconds,
      bitrateMbps: job.bitrateMbps,
      fps: job.fps,
      format: job.format,
      currentFrame: job.currentFrame,
      totalFrames: job.totalFrames,
      progress: job.progress,
      elapsedMs: job.elapsedMs,
      etaMs: job.etaMs,
      fileSizeBytes: job.fileSizeBytes,
      verifiedBitrateMbps: job.verifiedBitrateMbps,
      outputFileName: job.outputFileName,
      error: job.error,
    };
  }

  private async executeJob(job: InternalJob, rawHtml: string): Promise<void> {
    const startTime = Date.now();
    const browsers: Browser[] = [];
    job.browsers = browsers;

    try {
      job.status = 'initializing';
      const htmlPath = path.join(job.tempDir, 'scene.html');

      // Enforce exact viewport size without scrollbars
      const injectedReset = `<style data-frameforge-render-reset="true">html,body{margin:0!important;padding:0!important;width:${job.width}px!important;height:${job.height}px!important;overflow:hidden!important;}</style>`;
      const preparedHtml = /<head[^>]*>/i.test(rawHtml)
        ? rawHtml.replace(/<head[^>]*>/i, (m) => `${m}\n${injectedReset}`)
        : `${injectedReset}\n${rawHtml}`;

      await fsp.writeFile(htmlPath, preparedHtml, 'utf8');

      const executablePath = resolveChromiumPath();
      const maxWorkers = Math.min(2, Math.max(1, os.cpus().length));
      const ranges = partitionFrameRanges(job.totalFrames, maxWorkers);
      const launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-gpu-compositing',
        `--window-size=${job.width},${job.height}`,
      ];

      // Spawn FFmpeg immediately so encoding runs concurrently with parallel frame capture
      const ffmpegArgs = buildFfmpegArgs({
        bitrateMbps: job.bitrateMbps,
        fps: job.fps,
        format: job.format,
        outputPath: job.outputPath,
      });
      const ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'ignore', 'pipe'] });
      job.ffmpegProc = ffmpeg;

      let ffmpegStderr = '';
      ffmpeg.stderr.on('data', (chunk: Buffer) => {
        ffmpegStderr += chunk.toString();
        if (ffmpegStderr.length > 8000) {
          ffmpegStderr = ffmpegStderr.slice(-4000);
        }
      });

      const ffmpegExitPromise = new Promise<void>((resolve, reject) => {
        ffmpeg.on('error', (err) => reject(err));
        ffmpeg.on('close', (code) => {
          if (job.cancelled) {
            resolve();
          } else if (code === 0) {
            resolve();
          } else {
            reject(new Error(`FFmpeg exited with code ${code}: ${ffmpegStderr.slice(-500)}`));
          }
        });
      });

      // Launch parallel Chromium worker processes
      const workers = await Promise.all(
        ranges.map(async (range) => {
          const browser = await chromium.launch({
            executablePath,
            headless: true,
            args: launchArgs,
          });
          browsers.push(browser);

          const context = await browser.newContext({
            viewport: { width: job.width, height: job.height },
            deviceScaleFactor: 1,
          });
          const page = await context.newPage();
          await page.addInitScript(VIRTUAL_CLOCK_INIT_SCRIPT);
          await page.goto(`file://${htmlPath}`, { waitUntil: 'load', timeout: 30000 });
          await page.evaluate(() =>
            (
              window as unknown as { __FRAMEFORGE_RENDER__: { settle: () => Promise<void> } }
            ).__FRAMEFORGE_RENDER__.settle()
          );
          const cdp = await context.newCDPSession(page);
          return { browser, page, cdp, range };
        })
      );

      if (job.cancelled) {
        ffmpeg.stdin.end();
        await ffmpegExitPromise.catch(() => {});
        return;
      }

      job.status = 'capturing';
      const captureStartTime = Date.now();

      // In-order frame buffer + concurrent FFmpeg pipe drainer
      const frameBuffers = new Map<number, Buffer>();
      let nextFrameToWrite = 0;
      let capturedFrames = 0;
      let draining = false;
      let drainError: Error | null = null;
      let drainPromise: Promise<void> = Promise.resolve();

      const scheduleDrain = () => {
        if (draining || drainError) return;
        draining = true;
        drainPromise = (async () => {
          try {
            while (!job.cancelled && frameBuffers.has(nextFrameToWrite)) {
              const buf = frameBuffers.get(nextFrameToWrite)!;
              frameBuffers.delete(nextFrameToWrite);
              nextFrameToWrite += 1;
              const ok = ffmpeg.stdin.write(buf);
              if (!ok) {
                await once(ffmpeg.stdin, 'drain');
              }
            }
          } catch (err) {
            drainError = err instanceof Error ? err : new Error('FFmpeg stdin write failed');
          } finally {
            draining = false;
            if (!job.cancelled && !drainError && frameBuffers.has(nextFrameToWrite)) {
              scheduleDrain();
            }
          }
        })();
      };

      // Run all parallel worker chunks simultaneously
      await Promise.all(
        workers.map(async (worker) => {
          const { page, cdp, range } = worker;
          for (let frameIdx = range.start; frameIdx <= range.end; frameIdx++) {
            if (job.cancelled || drainError) break;

            const timeMs = computeFrameTimestampMs(frameIdx, job.fps, job.startSeconds);
            await page.evaluate((t: number) => {
              const api = (
                window as unknown as {
                  __FRAMEFORGE_RENDER__: {
                    seekTo: (ms: number) => void;
                    yieldPaint: () => Promise<void>;
                  };
                }
              ).__FRAMEFORGE_RENDER__;
              api.seekTo(t);
              return api.yieldPaint();
            }, timeMs);

            const shot = await cdp.send('Page.captureScreenshot', {
              format: 'jpeg',
              quality: 92,
              fromSurface: true,
              optimizeForSpeed: true,
            });

            frameBuffers.set(frameIdx, Buffer.from(shot.data, 'base64'));
            capturedFrames += 1;

            job.currentFrame = capturedFrames;
            job.elapsedMs = Date.now() - startTime;
            const captureElapsed = Date.now() - captureStartTime;
            job.progress = Math.min(96, Math.round((capturedFrames / job.totalFrames) * 96));
            const avgPerFrame = captureElapsed / capturedFrames;
            job.etaMs = Math.max(0, Math.round(avgPerFrame * (job.totalFrames - capturedFrames)));

            if (frameIdx === nextFrameToWrite) {
              scheduleDrain();
            }
          }
        })
      );

      // Flush remaining buffered frames in strict sequence
      scheduleDrain();
      await drainPromise;
      while (!job.cancelled && !drainError && nextFrameToWrite < job.totalFrames) {
        if (!frameBuffers.has(nextFrameToWrite)) break;
        scheduleDrain();
        await drainPromise;
      }

      if (drainError) {
        throw drainError;
      }

      if (job.cancelled) {
        ffmpeg.stdin.end();
        await ffmpegExitPromise.catch(() => {});
        return;
      }

      job.status = 'encoding';
      job.progress = 98;
      ffmpeg.stdin.end();
      await ffmpegExitPromise;

      const stats = await fsp.stat(job.outputPath);
      job.fileSizeBytes = stats.size;
      const probedBitrate = await probeActualBitrateMbps(job.outputPath);
      const actualDuration = job.totalFrames / job.fps;
      job.verifiedBitrateMbps =
        probedBitrate ??
        Number(((stats.size * 8) / (Math.max(0.1, actualDuration) * 1_000_000)).toFixed(2));
      job.elapsedMs = Date.now() - startTime;
      job.etaMs = 0;
      job.progress = 100;
      job.status = 'completed';
    } catch (err) {
      if (!job.cancelled) {
        job.status = 'failed';
        job.error = err instanceof Error ? err.message : 'Unknown render error';
      }
    } finally {
      await Promise.all(browsers.map((b) => b.close().catch(() => {})));
    }
  }
}
