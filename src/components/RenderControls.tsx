import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Film,
  Loader2,
  RotateCcw,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react';
import type {
  BitrateMbps,
  DimensionDetectionResult,
  DurationDetectionResult,
  FrameRate,
  LanguageCode,
  RenderEngineMode,
  RenderJobState,
  VideoContainerFormat,
} from '../types';
import { ALLOWED_BITRATES, estimateFileSizeMB } from '../utils/htmlAnalyzer';
import { getStrings } from '../utils/i18n';
import type { LocalGpuCapabilities } from '../utils/localGpuRenderer';
import { downloadRenderedVideo, triggerBlobSave } from '../utils/videoDownload';

interface RenderControlsProps {
  dimensions: DimensionDetectionResult;
  duration: DurationDetectionResult;
  isProbingDuration?: boolean;
  effectiveWidth: number;
  effectiveHeight: number;
  effectiveDuration: number;
  trimStart: number;
  trimEnd: number;
  renderDurationSeconds: number;
  isRangeTrimmed: boolean;
  isManualOverride: boolean;
  onToggleOverride: (enabled: boolean) => void;
  onChangeManualDimensions: (w: number, h: number) => void;
  onChangeManualDuration: (seconds: number) => void;
  onResetAuto: () => void;
  bitrateMbps: BitrateMbps;
  onChangeBitrate: (bitrate: BitrateMbps) => void;
  fps: FrameRate;
  onChangeFps: (fps: FrameRate) => void;
  format: VideoContainerFormat;
  onChangeFormat: (format: VideoContainerFormat) => void;
  renderEngine: RenderEngineMode;
  onChangeRenderEngine: (mode: RenderEngineMode) => void;
  gpuCapabilities: LocalGpuCapabilities;
  localVideoUrl: string | null;
  localVideoBlob: Blob | null;
  renderJob: RenderJobState | null;
  renderError: string | null;
  onStartRender: () => void;
  onCancelRender: () => void;
  hasHtml: boolean;
  lang: LanguageCode;
}

function formatDurationMs(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function RenderControls({
  dimensions,
  duration,
  isProbingDuration = false,
  effectiveWidth,
  effectiveHeight,
  effectiveDuration,
  trimStart,
  trimEnd,
  renderDurationSeconds,
  isRangeTrimmed,
  isManualOverride,
  onToggleOverride,
  onChangeManualDimensions,
  onChangeManualDuration,
  onResetAuto,
  bitrateMbps,
  onChangeBitrate,
  fps,
  onChangeFps,
  format,
  onChangeFormat,
  renderEngine,
  onChangeRenderEngine,
  gpuCapabilities,
  localVideoUrl,
  localVideoBlob,
  renderJob,
  renderError,
  onStartRender,
  onCancelRender,
  hasHtml,
  lang,
}: RenderControlsProps) {
  const t = getStrings(lang);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const cachedDownloadRef = useRef<{ jobId: string; blob: Blob } | null>(null);

  useEffect(() => {
    setIsDownloading(false);
    setDownloadProgress(0);
    setDownloadError(null);
    if (cachedDownloadRef.current && cachedDownloadRef.current.jobId !== renderJob?.id) {
      cachedDownloadRef.current = null;
    }
  }, [renderJob?.id, renderJob?.status]);

  const handleDownloadVideo = async () => {
    if (!renderJob || renderJob.status !== 'completed' || isDownloading) return;
    const fileName =
      renderJob.outputFileName ||
      `animation_${renderJob.width}x${renderJob.height}_${renderJob.bitrateMbps}Mbps.${renderJob.format}`;

    // Local GPU renders already hold the complete MP4 Blob in memory — instant save!
    if (localVideoBlob) {
      triggerBlobSave(localVideoBlob, fileName);
      return;
    }

    if (cachedDownloadRef.current?.jobId === renderJob.id) {
      triggerBlobSave(cachedDownloadRef.current.blob, fileName);
      return;
    }

    setIsDownloading(true);
    setDownloadProgress(0);
    setDownloadError(null);

    try {
      const blob = await downloadRenderedVideo({
        jobId: renderJob.id,
        fileName,
        totalBytes: renderJob.fileSizeBytes,
        format: renderJob.format,
        onProgress: (pct) => setDownloadProgress(pct),
      });
      cachedDownloadRef.current = { jobId: renderJob.id, blob };
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setIsDownloading(false);
    }
  };

  const isRendering =
    renderJob !== null &&
    (renderJob.status === 'queued' ||
      renderJob.status === 'initializing' ||
      renderJob.status === 'capturing' ||
      renderJob.status === 'encoding');

  const estimatedMb = estimateFileSizeMB(bitrateMbps, renderDurationSeconds);

  return (
    <aside className="flex flex-col gap-5">
      {/* 01. Detected Canvas & Duration */}
      <section className="rounded-xl border border-white/[0.08] bg-[#12151C] p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-semibold text-slate-100">
            {t.detectedSpecsHeading}
          </h2>
          <button
            type="button"
            onClick={() => onToggleOverride(!isManualOverride)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t.manualOverrideToggle}</span>
          </button>
        </div>

        <p className="mt-1 text-xs text-slate-400">{t.autoDetectedTag}</p>

        {/* Key Metrics Table */}
        <dl className="mt-4 divide-y divide-white/[0.06] border-y border-white/[0.06] text-xs">
          <div className="flex items-center justify-between py-2.5">
            <dt className="text-slate-400">{t.resolutionLabel}</dt>
            <dd
              data-testid="detected-resolution"
              className="font-mono font-semibold text-slate-100 tabular-nums"
            >
              {effectiveWidth} × {effectiveHeight} px
            </dd>
          </div>
          <div className="flex items-center justify-between py-2.5">
            <dt className="text-slate-400">{t.formatLabel}</dt>
            <dd data-testid="detected-format" className="font-medium text-slate-200">
              {lang === 'en' ? dimensions.formatLabel : dimensions.formatLabelBn}
            </dd>
          </div>
          <div className="flex items-center justify-between py-2.5">
            <dt className="text-slate-400">{t.aspectLabel}</dt>
            <dd className="font-mono text-slate-300 tabular-nums">
              {dimensions.aspectRatioLabel}
            </dd>
          </div>
          <div className="flex items-center justify-between py-2.5">
            <dt className="text-slate-400">{t.durationLabel}</dt>
            <dd
              data-testid="detected-duration"
              className="inline-flex items-center gap-1.5 font-mono font-semibold text-blue-400 tabular-nums"
            >
              {isProbingDuration && (
                <Loader2 className="h-3 w-3 animate-spin text-blue-300" aria-hidden="true" />
              )}
              <span>
                {effectiveDuration.toFixed(2)} {t.secondsUnit}
              </span>
            </dd>
          </div>
          {isRangeTrimmed && (
            <div className="flex items-center justify-between py-2.5">
              <dt className="text-slate-400">{t.renderRangeHeading}</dt>
              <dd
                data-testid="selected-render-range"
                className="font-mono font-semibold text-emerald-400 tabular-nums"
              >
                {trimStart.toFixed(2)}s → {trimEnd.toFixed(2)}s ({renderDurationSeconds.toFixed(2)}s)
              </dd>
            </div>
          )}
        </dl>

        {/* Detection Source Note */}
        <div className="mt-3 text-[11px] text-slate-400 leading-relaxed">
          <span>{dimensions.source}</span>
          <span aria-hidden="true" className="mx-1.5 text-slate-600">
            ·
          </span>
          <span>{duration.source}</span>
        </div>

        {/* Manual Override Inputs (hidden unless toggled) */}
        {isManualOverride && (
          <div className="mt-4 space-y-4 border-t border-white/[0.08] pt-4">
            {/* Quick Dimension Presets */}
            <div>
              <span className="block text-[11px] font-medium text-slate-300 mb-2">
                {lang === 'en' ? 'Quick Resolution Presets' : 'কুইক রেজোলিউশন প্রিসেট'}
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {[
                  { label: '4K Horizontal', sub: '3840×2160 (16:9)', w: 3840, h: 2160 },
                  { label: '4K Vertical', sub: '2160×3840 (9:16)', w: 2160, h: 3840 },
                  { label: '4K Square', sub: '2160×2160 (1:1)', w: 2160, h: 2160 },
                  { label: 'Ultrawide', sub: '3440×1440 (21:9)', w: 3440, h: 1440 },
                  { label: 'Super Ultrawide', sub: '5120×1440 (32:9)', w: 5120, h: 1440 },
                  { label: 'Full HD', sub: '1920×1080 (16:9)', w: 1920, h: 1080 },
                ].map((preset) => {
                  const isSelected = effectiveWidth === preset.w && effectiveHeight === preset.h;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => onChangeManualDimensions(preset.w, preset.h)}
                      className={`flex flex-col items-start rounded-lg border px-2.5 py-1.5 text-left transition-colors cursor-pointer ${
                        isSelected
                          ? 'border-blue-500 bg-blue-500/15 text-blue-300 ring-1 ring-blue-500'
                          : 'border-white/10 bg-[#0B0D11] text-slate-300 hover:border-white/20 hover:bg-white/5'
                      }`}
                    >
                      <span className="text-[11px] font-semibold tracking-tight">{preset.label}</span>
                      <span className="text-[9px] font-mono text-slate-400">{preset.sub}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom Width & Height Inputs */}
            <div>
              <span className="block text-[11px] font-medium text-slate-300 mb-1.5">
                {lang === 'en' ? 'Custom Resolution (Width × Height)' : 'কাস্টম রেজোলিউশন (প্রস্থ × উচ্চতা)'}
              </span>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="override-width" className="block text-[10px] text-slate-400 mb-1">
                    {t.widthPx}
                  </label>
                  <input
                    id="override-width"
                    type="number"
                    min={16}
                    max={7680}
                    value={effectiveWidth}
                    onChange={(e) =>
                      onChangeManualDimensions(
                        Math.max(16, Number(e.target.value) || effectiveWidth),
                        effectiveHeight
                      )
                    }
                    className="w-full rounded-lg border border-white/15 bg-[#0B0D11] px-3 py-1.5 font-mono text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="override-height" className="block text-[10px] text-slate-400 mb-1">
                    {t.heightPx}
                  </label>
                  <input
                    id="override-height"
                    type="number"
                    min={16}
                    max={4320}
                    value={effectiveHeight}
                    onChange={(e) =>
                      onChangeManualDimensions(
                        effectiveWidth,
                        Math.max(16, Number(e.target.value) || effectiveHeight)
                      )
                    }
                    className="w-full rounded-lg border border-white/15 bg-[#0B0D11] px-3 py-1.5 font-mono text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Quick Duration Presets */}
            <div>
              <span className="block text-[11px] font-medium text-slate-300 mb-2">
                {lang === 'en' ? 'Quick Duration Presets' : 'কুইক ডিউরেশন প্রিসেট'}
              </span>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: '5s', val: 5 },
                  { label: '10s', val: 10 },
                  { label: '15s', val: 15 },
                  { label: '20s', val: 20 },
                  { label: '30s', val: 30 },
                  { label: '60s', val: 60 },
                ].map((durPreset) => {
                  const isSelected = Math.abs(effectiveDuration - durPreset.val) < 0.05;
                  return (
                    <button
                      key={durPreset.label}
                      type="button"
                      onClick={() => onChangeManualDuration(durPreset.val)}
                      className={`rounded-lg border px-3 py-1 text-xs font-mono font-medium transition-colors cursor-pointer ${
                        isSelected
                          ? 'border-blue-500 bg-blue-500/15 text-blue-300 ring-1 ring-blue-500'
                          : 'border-white/10 bg-[#0B0D11] text-slate-300 hover:border-white/20 hover:bg-white/5'
                      }`}
                    >
                      {durPreset.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom Duration Input */}
            <div>
              <label htmlFor="override-duration" className="block text-[11px] font-medium text-slate-300 mb-1">
                {lang === 'en' ? 'Custom Duration' : 'কাস্টম ডিউরেশন'} ({t.secondsUnit})
              </label>
              <input
                id="override-duration"
                type="number"
                min={0.5}
                max={180}
                step={0.1}
                value={effectiveDuration}
                onChange={(e) =>
                  onChangeManualDuration(Math.max(0.5, Number(e.target.value) || effectiveDuration))
                }
                className="w-full rounded-lg border border-white/15 bg-[#0B0D11] px-3 py-1.5 font-mono text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={onResetAuto}
              className="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-white cursor-pointer pt-1"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t.resetToDetected}</span>
            </button>
          </div>
        )}

        {/* Animation Timeline Breakdown */}
        {duration.breakdown.length > 0 && (
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer select-none text-slate-400 hover:text-slate-200">
              {t.timelineBreakdown} ({duration.breakdown.length})
            </summary>
            <ul className="mt-2 space-y-1.5 border-t border-white/[0.06] pt-2 font-mono text-[11px] text-slate-400">
              {duration.breakdown.map((entry, idx) => (
                <li key={`${entry.name}-${idx}`} className="flex items-center justify-between gap-2">
                  <span className="truncate text-slate-300">{entry.name}</span>
                  <span className="shrink-0 tabular-nums">
                    {entry.delaySeconds > 0 ? `+${entry.delaySeconds}s · ` : ''}
                    {entry.durationSeconds}s
                    {entry.iterations === 'infinite'
                      ? ' (loop)'
                      : entry.iterations > 1
                        ? ` ×${entry.iterations}`
                        : ''}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* 02. Bitrate Selection (60, 80, 100, 120 Mbps) */}
      <section className="rounded-xl border border-white/[0.08] bg-[#12151C] p-5">
        <h2 className="font-display text-sm font-semibold text-slate-100">{t.bitrateHeading}</h2>
        <div
          role="radiogroup"
          aria-label={t.bitrateHeading}
          className="mt-3 grid grid-cols-2 gap-2.5"
        >
          {ALLOWED_BITRATES.map((rate) => {
            const selected = bitrateMbps === rate;
            return (
              <button
                key={rate}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={isRendering}
                onClick={() => onChangeBitrate(rate)}
                className={`flex flex-col items-start rounded-lg border px-3.5 py-2.5 text-left transition-colors cursor-pointer disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  selected
                    ? 'border-blue-500 bg-blue-600/15 text-white'
                    : 'border-white/[0.08] bg-[#0F1218] text-slate-300 hover:border-white/20 hover:bg-[#171B24]'
                }`}
              >
                <span className="font-mono text-base font-semibold tabular-nums">
                  {rate} Mbps
                </span>
                <span className="mt-0.5 text-[11px] text-slate-400">
                  {t.bitrateDesc[rate]}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 03. Encoding & Output + Render Action */}
      <section className="rounded-xl border border-white/[0.08] bg-[#12151C] p-5 space-y-4">
        <h2 className="font-display text-sm font-semibold text-slate-100">{t.encodingHeading}</h2>

        {/* Render Engine Selector (Local GPU Hardware vs Server FFmpeg) */}
        <div className="space-y-1.5">
          <label htmlFor="engine-select" className="block text-[11px] text-slate-400">
            {t.renderEngineLabel}
          </label>
          <select
            id="engine-select"
            value={renderEngine}
            disabled={isRendering}
            onChange={(e) => onChangeRenderEngine(e.target.value as RenderEngineMode)}
            className="w-full rounded-lg border border-white/15 bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
          >
            {gpuCapabilities.supported && (
              <option value="local-gpu">{t.engineLocalGpu}</option>
            )}
            <option value="server">{t.engineServer}</option>
          </select>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {!gpuCapabilities.supported
              ? t.gpuUnsupportedNote
              : renderEngine === 'local-gpu'
                ? gpuCapabilities.hardwareEncoderLikely && gpuCapabilities.gpuName
                  ? `${gpuCapabilities.gpuName} · WebCodecs H.264 Hardware`
                  : t.localMp4Note
                : 'Cloud FFmpeg · H.264 / MOV / WebM'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="fps-select" className="block text-[11px] text-slate-400 mb-1.5">
              {t.fpsLabel}
            </label>
            <select
              id="fps-select"
              value={fps}
              disabled={isRendering}
              onChange={(e) => onChangeFps(Number(e.target.value) as FrameRate)}
              className="w-full rounded-lg border border-white/15 bg-[#0B0D11] px-3 py-2 font-mono text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
            >
              <option value={24}>24 fps</option>
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </select>
          </div>

          <div>
            <label htmlFor="format-select" className="block text-[11px] text-slate-400 mb-1.5">
              {t.containerLabel}
            </label>
            <select
              id="format-select"
              value={renderEngine === 'local-gpu' ? 'mp4' : format}
              disabled={isRendering || renderEngine === 'local-gpu'}
              onChange={(e) => onChangeFormat(e.target.value as VideoContainerFormat)}
              className="w-full rounded-lg border border-white/15 bg-[#0B0D11] px-3 py-2 font-mono text-xs text-slate-100 focus:border-blue-500 focus:outline-none disabled:opacity-75"
            >
              <option value="mp4">MP4 (H.264 Exact CBR)</option>
              {renderEngine === 'server' && <option value="mov">MOV (H.264 Exact CBR)</option>}
              {renderEngine === 'server' && <option value="webm">WebM (VP9)</option>}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-white/[0.06] pt-3 text-xs">
          <span className="text-slate-400">
            {t.estimatedSizeLabel}{' '}
            {isRangeTrimmed && (
              <span className="font-mono text-[11px] text-emerald-400">
                ({renderDurationSeconds.toFixed(2)}s)
              </span>
            )}
          </span>
          <span
            data-testid="estimated-file-size"
            className="font-mono font-medium text-slate-200 tabular-nums"
          >
            ~{estimatedMb} MB
          </span>
        </div>

        {/* Render Button / Active Progress */}
        {!isRendering ? (
          <button
            type="button"
            disabled={!hasHtml}
            onClick={onStartRender}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-500 active:bg-blue-700 disabled:opacity-40 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            <Film className="h-4 w-4" aria-hidden="true" />
            <span>
              {renderJob?.status === 'completed' ? t.renderAgainBtn : t.renderStartBtn}
            </span>
          </button>
        ) : (
          <div className="space-y-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-2 font-medium text-blue-200">
                <Loader2 className="h-4 w-4 animate-spin text-blue-400" aria-hidden="true" />
                <span>
                  {renderJob.status === 'initializing' &&
                    (renderEngine === 'local-gpu' ? t.statusInitializingGpu : t.statusInitializing)}
                  {renderJob.status === 'capturing' && t.statusCapturing}
                  {renderJob.status === 'encoding' && t.statusEncoding}
                  {renderJob.status === 'queued' &&
                    (renderEngine === 'local-gpu' ? t.statusInitializingGpu : t.statusInitializing)}
                </span>
              </span>
              <span className="font-mono font-semibold text-blue-300 tabular-nums">
                {renderJob.progress}%
              </span>
            </div>

            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-blue-500 transition-[width] duration-200"
                style={{ width: `${renderJob.progress}%` }}
              />
            </div>

            <div className="flex items-center justify-between font-mono text-[11px] text-slate-300 tabular-nums">
              <span>
                {t.frameProgress} {renderJob.currentFrame} / {renderJob.totalFrames}
              </span>
              {renderJob.etaMs !== null && (
                <span>
                  {t.etaLabel}: {formatDurationMs(renderJob.etaMs)}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={onCancelRender}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-white/15 bg-black/30 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-black/50 cursor-pointer"
            >
              <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t.cancelRenderBtn}</span>
            </button>
          </div>
        )}

        {/* Error Banner */}
        {(renderError || renderJob?.status === 'failed') && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-red-500/35 bg-red-500/10 p-3 text-xs text-red-200"
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" aria-hidden="true" />
            <div>
              <p className="font-semibold">{t.statusFailed}</p>
              <p className="mt-0.5 text-red-300/90">{renderError || renderJob?.error}</p>
            </div>
          </div>
        )}

        {/* Cancelled Note */}
        {renderJob?.status === 'cancelled' && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {t.statusCancelled}
          </div>
        )}

        {/* Completed Output Card */}
        {renderJob?.status === 'completed' && (
          <div
            id="render-output-panel"
            data-testid="render-completed-panel"
            className="space-y-3 border-t border-white/[0.08] pt-4"
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              <span>{t.statusCompleted}</span>
            </div>

            <video
              controls
              playsInline
              muted
              preload="auto"
              onLoadedData={(e) => {
                const video = e.currentTarget;
                if (video.currentTime === 0 && Number.isFinite(video.duration) && video.duration > 0.2) {
                  video.currentTime = Math.min(0.6, video.duration * 0.4);
                }
              }}
              src={localVideoUrl || `/api/render/${renderJob.id}/video`}
              className="w-full rounded-lg border border-white/10 bg-black"
            />

            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-white/[0.06] bg-[#0B0D11] px-3 py-2">
                <dt className="text-[11px] text-slate-400">{t.verifiedBitrateLabel}</dt>
                <dd className="mt-0.5 font-mono font-semibold text-slate-100 tabular-nums">
                  {renderJob.verifiedBitrateMbps ?? renderJob.bitrateMbps} Mbps
                </dd>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-[#0B0D11] px-3 py-2">
                <dt className="text-[11px] text-slate-400">{t.actualSizeLabel}</dt>
                <dd className="mt-0.5 font-mono font-semibold text-slate-100 tabular-nums">
                  {renderJob.fileSizeBytes ? formatBytes(renderJob.fileSizeBytes) : '—'}
                </dd>
              </div>
            </dl>

            <button
              type="button"
              onClick={handleDownloadVideo}
              disabled={isDownloading}
              data-testid="download-video-btn"
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-600/20 px-4 py-2.5 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-600/30 disabled:opacity-60 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              {isDownloading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span className="tabular-nums">
                    {t.downloadingVideoBtn} {downloadProgress}%
                  </span>
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" aria-hidden="true" />
                  <span>{t.downloadVideoBtn}</span>
                </>
              )}
            </button>

            {downloadError && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs text-red-200"
              >
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" aria-hidden="true" />
                <span>{downloadError}</span>
              </div>
            )}
          </div>
        )}
      </section>
    </aside>
  );
}
