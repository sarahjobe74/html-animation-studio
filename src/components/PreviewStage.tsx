import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Grid3X3, Pause, Play, RotateCcw, Scissors } from 'lucide-react';
import type { DimensionDetectionResult, LanguageCode } from '../types';
import { getStrings } from '../utils/i18n';
import { buildPreviewHtml } from '../utils/previewBridge';
import {
  getTrimDurationSeconds,
  isTrimmedRange,
  MIN_TRIM_SEGMENT_SECONDS,
  setTrimEnd,
  setTrimStart,
} from '../utils/trimRange';

interface PreviewStageProps {
  html: string;
  width: number;
  height: number;
  durationSeconds: number;
  trimStart: number;
  trimEnd: number;
  onChangeTrimRange: (startSeconds: number, endSeconds: number) => void;
  onResetTrim: () => void;
  dimensions: DimensionDetectionResult | null;
  lang: LanguageCode;
  onRuntimeDurationDetected?: (seconds: number, hasInfinite: boolean, isGsap?: boolean) => void;
}

type DragMode = 'playhead' | 'start' | 'end' | null;

export function PreviewStage({
  html,
  width,
  height,
  durationSeconds,
  trimStart,
  trimEnd,
  onChangeTrimRange,
  onResetTrim,
  dimensions,
  lang,
  onRuntimeDurationDetected,
}: PreviewStageProps) {
  const t = getStrings(lang);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const [boxSize, setBoxSize] = useState({ w: 800, h: 450 });
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [showMatteGrid, setShowMatteGrid] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [dragMode, setDragMode] = useState<DragMode>(null);

  const safeDuration = Math.max(MIN_TRIM_SEGMENT_SECONDS, durationSeconds);
  const trimRange = useMemo(
    () => ({ startSeconds: trimStart, endSeconds: trimEnd }),
    [trimStart, trimEnd]
  );
  const renderLengthSec = getTrimDurationSeconds(trimRange);
  const trimmed = isTrimmedRange(trimRange, safeDuration);

  const previewHtml = useMemo(
    () => (html ? buildPreviewHtml(html, width, height) : ''),
    [html, width, height]
  );

  // Measure outer stage box for exact aspect-ratio scaling
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setBoxSize({ w: rect.width, h: rect.height });
      }
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Listen to live metrics from iframe bridge
  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      if (ev.data && ev.data.type === 'frameforge:metrics') {
        const ms = Number(ev.data.detectedMs);
        const gsapMs = Number(ev.data.gsapMs) || 0;
        if (Number.isFinite(ms) && ms > 0 && onRuntimeDurationDetected) {
          onRuntimeDurationDetected(
            Number((ms / 1000).toFixed(2)),
            Boolean(ev.data.hasInfinite),
            gsapMs > 0
          );
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onRuntimeDurationDetected]);

  // Reset playhead when HTML or duration changes
  useEffect(() => {
    setCurrentTime(0);
    setIsPlaying(Boolean(html));
  }, [html, width, height, durationSeconds, reloadNonce]);

  // Lightweight playback clock synced to timeline and bounded by [trimStart, trimEnd]
  useEffect(() => {
    if (!html || !isPlaying || safeDuration <= 0) return;
    let lastTick = performance.now();
    let timerId: number;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const now = performance.now();
      const deltaSec = (now - lastTick) / 1000;
      lastTick = now;

      let reachedEnd = false;
      setCurrentTime((prev) => {
        const next = prev + deltaSec;
        if (next >= trimEnd) {
          reachedEnd = true;
          return trimEnd;
        }
        return next;
      });

      if (reachedEnd) {
        setIsPlaying(false);
        iframeRef.current?.contentWindow?.postMessage({ type: 'frameforge:pause' }, '*');
        return;
      }
      timerId = window.setTimeout(tick, 50);
    };

    timerId = window.setTimeout(tick, 50);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [html, isPlaying, safeDuration, trimEnd]);

  const sendIframeMessage = (payload: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(payload, '*');
  };

  const seekPreviewTo = (seconds: number, paused: boolean) => {
    const clamped = Math.max(0, Math.min(safeDuration, seconds));
    setCurrentTime(clamped);
    setIsPlaying(!paused);
    sendIframeMessage({
      type: 'frameforge:seek',
      timeMs: clamped * 1000,
      paused,
    });
  };

  const handleTogglePlay = () => {
    if (!html) return;
    if (isPlaying) {
      setIsPlaying(false);
      sendIframeMessage({ type: 'frameforge:pause' });
    } else {
      if (currentTime >= trimEnd - 0.02 || currentTime < trimStart - 0.02) {
        if (trimStart <= 0.01) {
          setCurrentTime(0);
          setReloadNonce((n) => n + 1);
          setIsPlaying(true);
        } else {
          seekPreviewTo(trimStart, false);
        }
      } else {
        setIsPlaying(true);
        sendIframeMessage({ type: 'frameforge:play' });
      }
    }
  };

  const handleRestart = () => {
    if (!html) return;
    if (trimStart <= 0.01) {
      setCurrentTime(0);
      setIsPlaying(true);
      setReloadNonce((n) => n + 1);
    } else {
      seekPreviewTo(trimStart, false);
    }
  };

  const clientXToSeconds = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Number((ratio * safeDuration).toFixed(2));
  };

  const applyDragAtClientX = (mode: DragMode, clientX: number) => {
    if (!mode || !html) return;
    const sec = clientXToSeconds(clientX);
    if (mode === 'playhead') {
      seekPreviewTo(sec, true);
    } else if (mode === 'start') {
      const next = setTrimStart(trimRange, sec, safeDuration);
      onChangeTrimRange(next.startSeconds, next.endSeconds);
      seekPreviewTo(next.startSeconds, true);
    } else if (mode === 'end') {
      const next = setTrimEnd(trimRange, sec, safeDuration);
      onChangeTrimRange(next.startSeconds, next.endSeconds);
      seekPreviewTo(next.endSeconds, true);
    }
  };

  const handleTrackPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!html) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragMode('playhead');
    applyDragAtClientX('playhead', e.clientX);
  };

  const handleHandlePointerDown = (mode: 'start' | 'end') => (e: PointerEvent<HTMLButtonElement>) => {
    if (!html) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragMode(mode);
    applyDragAtClientX(mode, e.clientX);
  };

  const handlePointerMove = (e: PointerEvent<HTMLElement>) => {
    if (!dragMode) return;
    applyDragAtClientX(dragMode, e.clientX);
  };

  const handlePointerUp = () => {
    setDragMode(null);
  };

  const handleStartKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!html) return;
    const step = e.shiftKey ? 0.5 : 0.1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = setTrimStart(trimRange, trimStart + step, safeDuration);
      onChangeTrimRange(next.startSeconds, next.endSeconds);
      seekPreviewTo(next.startSeconds, true);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = setTrimStart(trimRange, trimStart - step, safeDuration);
      onChangeTrimRange(next.startSeconds, next.endSeconds);
      seekPreviewTo(next.startSeconds, true);
    }
  };

  const handleEndKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!html) return;
    const step = e.shiftKey ? 0.5 : 0.1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = setTrimEnd(trimRange, trimEnd + step, safeDuration);
      onChangeTrimRange(next.startSeconds, next.endSeconds);
      seekPreviewTo(next.endSeconds, true);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = setTrimEnd(trimRange, trimEnd - step, safeDuration);
      onChangeTrimRange(next.startSeconds, next.endSeconds);
      seekPreviewTo(next.endSeconds, true);
    }
  };

  const handleStartInputChange = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return;
    const next = setTrimStart(trimRange, parsed, safeDuration);
    onChangeTrimRange(next.startSeconds, next.endSeconds);
    seekPreviewTo(next.startSeconds, true);
  };

  const handleEndInputChange = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return;
    const next = setTrimEnd(trimRange, parsed, safeDuration);
    onChangeTrimRange(next.startSeconds, next.endSeconds);
    seekPreviewTo(next.endSeconds, true);
  };

  const handleSetInAtPlayhead = () => {
    if (!html) return;
    const next = setTrimStart(trimRange, currentTime, safeDuration);
    onChangeTrimRange(next.startSeconds, next.endSeconds);
  };

  const handleSetOutAtPlayhead = () => {
    if (!html) return;
    const next = setTrimEnd(trimRange, currentTime, safeDuration);
    onChangeTrimRange(next.startSeconds, next.endSeconds);
  };

  const startPct = Math.max(0, Math.min(100, (trimStart / safeDuration) * 100));
  const endPct = Math.max(startPct, Math.min(100, (trimEnd / safeDuration) * 100));
  const playheadPct = Math.max(0, Math.min(100, (currentTime / safeDuration) * 100));

  const pad = 24;
  const availW = Math.max(120, boxSize.w - pad * 2);
  const availH = Math.max(120, boxSize.h - pad * 2);
  const scale = Math.min(availW / Math.max(1, width), availH / Math.max(1, height));
  const scaledW = Math.max(1, Math.round(width * scale));
  const scaledH = Math.max(1, Math.round(height * scale));
  const zoomPercent = Math.round(scale * 100);

  return (
    <section
      aria-label="Preview Stage"
      className="flex flex-col rounded-xl border border-white/[0.08] bg-[#12151C] overflow-hidden"
    >
      {/* Stage Top Telemetry Strip (unboxed clean metadata) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2.5 text-slate-300">
          <span className="font-mono font-semibold text-slate-100 tabular-nums">
            {width} × {height} px
          </span>
          <span aria-hidden="true" className="text-slate-600">
            ·
          </span>
          <span>
            {dimensions
              ? lang === 'en'
                ? dimensions.formatLabel
                : dimensions.formatLabelBn
              : '16:9'}
          </span>
          <span aria-hidden="true" className="text-slate-600">
            ·
          </span>
          <span className="font-mono text-blue-400 tabular-nums">
            {trimmed
              ? `${trimStart.toFixed(2)}s–${trimEnd.toFixed(2)}s (${renderLengthSec.toFixed(2)}s)`
              : `${durationSeconds.toFixed(2)}s`}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="font-mono text-slate-400 tabular-nums">{zoomPercent}% scale</span>
          <button
            type="button"
            onClick={() => setShowMatteGrid((v) => !v)}
            aria-pressed={showMatteGrid}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              showMatteGrid
                ? 'border-white/20 bg-white/10 text-slate-100'
                : 'border-white/10 bg-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Grid3X3 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t.matteGridLabel}</span>
          </button>
        </div>
      </div>

      {/* Viewport Stage Canvas */}
      <div
        ref={containerRef}
        data-testid="preview-stage-viewport"
        className={`relative flex h-[380px] sm:h-[460px] lg:h-[520px] w-full items-center justify-center overflow-hidden ${
          showMatteGrid ? 'studio-checkerboard' : 'bg-[#080A0E]'
        }`}
      >
        {html ? (
          <div
            data-testid="scaled-canvas-frame"
            data-canvas-width={width}
            data-canvas-height={height}
            style={{ width: `${scaledW}px`, height: `${scaledH}px` }}
            className="relative shrink-0 overflow-hidden border border-white/15 bg-black shadow-2xl"
          >
            <iframe
              key={`${width}x${height}-${reloadNonce}`}
              ref={iframeRef}
              title="HTML Animation Preview"
              sandbox="allow-scripts"
              srcDoc={previewHtml}
              style={{
                width: `${width}px`,
                height: `${height}px`,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                border: 'none',
                display: 'block',
                pointerEvents: 'none',
              }}
            />
          </div>
        ) : (
          <div className="max-w-md px-6 text-center">
            <p className="text-sm font-medium text-slate-200">{t.emptyPreviewTitle}</p>
            <p className="mt-1.5 text-xs text-slate-400">{t.emptyPreviewHint}</p>
          </div>
        )}
      </div>

      {/* Row 1: Transport & Dual-Handle Interactive Trim Track */}
      <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.08] bg-[#0F1218] px-4 py-2.5">
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleTogglePlay}
            disabled={!html}
            aria-label={isPlaying ? t.pauseLabel : t.playLabel}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-[#181C26] text-slate-100 transition-colors hover:border-white/25 hover:bg-[#222836] disabled:opacity-40 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {isPlaying ? (
              <Pause className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={handleRestart}
            disabled={!html}
            aria-label={t.restartLabel}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-[#181C26] text-slate-300 transition-colors hover:border-white/25 hover:bg-[#222836] hover:text-white disabled:opacity-40 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        {/* Interactive NLE Dual-Handle Timeline Track */}
        <div
          ref={trackRef}
          data-testid="timeline-trim-track"
          onPointerDown={handleTrackPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={`relative flex flex-1 h-8 items-center min-w-[200px] select-none touch-none ${
            html ? 'cursor-pointer' : 'opacity-40 pointer-events-none'
          }`}
        >
          {/* Full Background Track */}
          <div className="relative h-2.5 w-full rounded bg-white/[0.08] overflow-hidden border border-white/[0.06]">
            {/* Excluded Left Region */}
            {startPct > 0 && (
              <div
                style={{ width: `${startPct}%` }}
                className="absolute inset-y-0 left-0 bg-black/55"
              />
            )}
            {/* Excluded Right Region */}
            {endPct < 100 && (
              <div
                style={{ left: `${endPct}%`, right: 0 }}
                className="absolute inset-y-0 bg-black/55"
              />
            )}
            {/* Selected Active Render Segment */}
            <div
              data-testid="timeline-active-range"
              style={{ left: `${startPct}%`, width: `${Math.max(0.5, endPct - startPct)}%` }}
              className="absolute inset-y-0 bg-blue-500/40 border-y border-blue-400/80"
            />
          </div>

          {/* Playhead Indicator */}
          <div
            style={{ left: `${playheadPct}%` }}
            className="pointer-events-none absolute top-1 bottom-1 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_6px_rgba(255,255,255,0.85)]"
          >
            <span className="absolute -top-0.5 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-white" />
          </div>

          {/* Draggable Start (In) Handle */}
          <button
            type="button"
            role="slider"
            aria-label={`${t.renderRangeHeading} ${t.trimStartLabel}`}
            aria-valuemin={0}
            aria-valuemax={Number(Math.max(0, trimEnd - MIN_TRIM_SEGMENT_SECONDS).toFixed(2))}
            aria-valuenow={trimStart}
            aria-valuetext={`${trimStart.toFixed(2)}s`}
            data-testid="trim-start-handle"
            disabled={!html}
            onPointerDown={handleHandlePointerDown('start')}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onKeyDown={handleStartKeyDown}
            style={{ left: `${startPct}%` }}
            title={`${t.trimStartLabel}: ${trimStart.toFixed(2)}s`}
            className={`absolute top-0.5 bottom-0.5 z-10 flex w-3 -translate-x-1/2 items-center justify-center rounded-sm border transition-transform cursor-ew-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
              dragMode === 'start'
                ? 'scale-110 border-emerald-200 bg-emerald-400'
                : 'border-emerald-300 bg-emerald-500 hover:bg-emerald-400'
            }`}
          >
            <span className="h-3.5 w-[1.5px] rounded-full bg-[#09120E]" />
          </button>

          {/* Draggable End (Out) Handle */}
          <button
            type="button"
            role="slider"
            aria-label={`${t.renderRangeHeading} ${t.trimEndLabel}`}
            aria-valuemin={Number(Math.min(safeDuration, trimStart + MIN_TRIM_SEGMENT_SECONDS).toFixed(2))}
            aria-valuemax={Number(safeDuration.toFixed(2))}
            aria-valuenow={trimEnd}
            aria-valuetext={`${trimEnd.toFixed(2)}s`}
            data-testid="trim-end-handle"
            disabled={!html}
            onPointerDown={handleHandlePointerDown('end')}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onKeyDown={handleEndKeyDown}
            style={{ left: `${endPct}%` }}
            title={`${t.trimEndLabel}: ${trimEnd.toFixed(2)}s`}
            className={`absolute top-0.5 bottom-0.5 z-10 flex w-3 -translate-x-1/2 items-center justify-center rounded-sm border transition-transform cursor-ew-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
              dragMode === 'end'
                ? 'scale-110 border-amber-200 bg-amber-400'
                : 'border-amber-300 bg-amber-500 hover:bg-amber-400'
            }`}
          >
            <span className="h-3.5 w-[1.5px] rounded-full bg-[#1C1205]" />
          </button>
        </div>

        <div className="font-mono text-xs text-slate-300 tabular-nums shrink-0">
          {currentTime.toFixed(2)}s <span className="text-slate-500">/</span>{' '}
          {durationSeconds.toFixed(2)}s
        </div>
      </div>

      {/* Row 2: Precision Render Range (In / Out) Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-white/[0.06] bg-[#0B0E14] px-4 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-300">
            <Scissors className="h-3.5 w-3.5 text-blue-400" aria-hidden="true" />
            <span>{t.renderRangeHeading}</span>
          </span>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!html}
              onClick={handleSetInAtPlayhead}
              title={t.setInTooltip}
              data-testid="set-trim-in-btn"
              className="rounded border border-emerald-500/35 bg-emerald-500/10 px-2 py-1 font-mono text-[11px] font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-40 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              [ {t.trimStartLabel}
            </button>
            <button
              type="button"
              disabled={!html}
              onClick={handleSetOutAtPlayhead}
              title={t.setOutTooltip}
              data-testid="set-trim-out-btn"
              className="rounded border border-amber-500/35 bg-amber-500/10 px-2 py-1 font-mono text-[11px] font-medium text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-40 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              {t.trimEndLabel} ]
            </button>
          </div>
        </div>

        {/* Exact Numeric In / Out Inputs */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="text-emerald-400 font-medium">{t.trimStartLabel}</span>
            <input
              id="trim-start-input"
              data-testid="trim-start-input"
              type="number"
              min={0}
              max={Number(Math.max(0, trimEnd - MIN_TRIM_SEGMENT_SECONDS).toFixed(2))}
              step={0.1}
              disabled={!html}
              value={trimStart}
              onChange={(e) => handleStartInputChange(e.target.value)}
              className="w-16 rounded border border-white/15 bg-[#12151C] px-2 py-1 font-mono text-xs text-slate-100 tabular-nums focus:border-emerald-400 focus:outline-none disabled:opacity-40"
            />
            <span>s</span>
          </label>

          <span aria-hidden="true" className="text-slate-600">
            →
          </span>

          <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="text-amber-400 font-medium">{t.trimEndLabel}</span>
            <input
              id="trim-end-input"
              data-testid="trim-end-input"
              type="number"
              min={Number(Math.min(safeDuration, trimStart + MIN_TRIM_SEGMENT_SECONDS).toFixed(2))}
              max={Number(safeDuration.toFixed(2))}
              step={0.1}
              disabled={!html}
              value={trimEnd}
              onChange={(e) => handleEndInputChange(e.target.value)}
              className="w-16 rounded border border-white/15 bg-[#12151C] px-2 py-1 font-mono text-xs text-slate-100 tabular-nums focus:border-amber-400 focus:outline-none disabled:opacity-40"
            />
            <span>s</span>
          </label>
        </div>

        {/* Active Render Length & Reset */}
        <div className="flex items-center gap-2.5">
          <span
            data-testid="timeline-render-length"
            className={`font-mono text-xs font-semibold tabular-nums ${
              trimmed ? 'text-blue-400' : 'text-slate-300'
            }`}
          >
            {t.selectedRenderDurationLabel}: {renderLengthSec.toFixed(2)} {t.secondsUnit}
          </span>

          {trimmed && (
            <button
              type="button"
              onClick={onResetTrim}
              data-testid="reset-trim-btn"
              className="inline-flex items-center gap-1 rounded border border-white/15 bg-white/[0.04] px-2 py-1 text-[11px] font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              <span>{t.resetTrimBtn}</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
