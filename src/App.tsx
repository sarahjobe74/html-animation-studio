import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CodeEditorPanel } from './components/CodeEditorPanel';
import { PreviewStage } from './components/PreviewStage';
import { RenderControls } from './components/RenderControls';
import { TopBar, type WorkspaceSection } from './components/TopBar';
import { UploadZone } from './components/UploadZone';
import { ANIMATION_PRESETS } from './data/presets';
import type {
  AnimationPreset,
  BitrateMbps,
  FrameRate,
  HtmlAnalysisResult,
  LanguageCode,
  RenderEngineMode,
  RenderJobState,
  UploadedSourceFile,
  VideoContainerFormat,
} from './types';
import {
  analyzeHtmlBundle,
  classifyVideoFormat,
  detectAnimationDuration,
  detectHtmlDimensions,
  mergeStaticAndRuntimeDuration,
  type RuntimeDurationProbeResult,
} from './utils/htmlAnalyzer';
import { probeRuntimeAnimationDuration } from './utils/durationProbe';
import { getStrings } from './utils/i18n';
import {
  detectLocalGpuCapabilities,
  renderLocallyWithGpu,
  type LocalGpuCapabilities,
} from './utils/localGpuRenderer';
import {
  getTrimDurationSeconds,
  isTrimmedRange,
  normalizeTrimRange,
  type TrimRange,
} from './utils/trimRange';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function classifyFileType(fileName: string): UploadedSourceFile['type'] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'js';
  return 'asset';
}

export default function App() {
  const [lang, setLang] = useState<LanguageCode>('bn');
  const [activeSection, setActiveSection] = useState<WorkspaceSection>('workbench');
  const [showCodeEditor, setShowCodeEditor] = useState(false);

  const initialPreset = ANIMATION_PRESETS[0];
  const initialAnalysis = useMemo<HtmlAnalysisResult>(
    () => ({
      bundledHtml: initialPreset.html,
      entryFileName: `${initialPreset.id}.html`,
      dimensions: detectHtmlDimensions(initialPreset.html),
      duration: detectAnimationDuration(initialPreset.html),
    }),
    [initialPreset]
  );

  const [sourceFiles, setSourceFiles] = useState<UploadedSourceFile[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(initialPreset.id);
  const [analysis, setAnalysis] = useState<HtmlAnalysisResult>(initialAnalysis);
  const [runtimeProbe, setRuntimeProbe] = useState<RuntimeDurationProbeResult | null>(null);
  const [isProbingDuration, setIsProbingDuration] = useState(false);

  const [isManualOverride, setIsManualOverride] = useState(false);
  const [manualWidth, setManualWidth] = useState(initialAnalysis.dimensions.width);
  const [manualHeight, setManualHeight] = useState(initialAnalysis.dimensions.height);
  const [manualDuration, setManualDuration] = useState(initialAnalysis.duration.durationSeconds);
  const [trimRange, setTrimRange] = useState<TrimRange>({
    startSeconds: 0,
    endSeconds: initialAnalysis.duration.durationSeconds,
  });
  const hasUserTrimmedRef = useRef(false);

  const [bitrateMbps, setBitrateMbps] = useState<BitrateMbps>(80);
  const [fps, setFps] = useState<FrameRate>(30);
  const [format, setFormat] = useState<VideoContainerFormat>('mp4');
  const [renderEngine, setRenderEngine] = useState<RenderEngineMode>('local-gpu');
  const [gpuCapabilities, setGpuCapabilities] = useState<LocalGpuCapabilities>({
    supported: typeof VideoEncoder === 'function' && typeof VideoFrame === 'function',
    hardwareEncoderLikely: false,
    gpuName: null,
  });

  const [renderJob, setRenderJob] = useState<RenderJobState | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [localVideoBlob, setLocalVideoBlob] = useState<Blob | null>(null);
  const [localVideoUrl, setLocalVideoUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const presetsRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLDivElement>(null);
  const localAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    void detectLocalGpuCapabilities().then((caps) => {
      if (!active) return;
      setGpuCapabilities(caps);
      if (!caps.supported) {
        setRenderEngine('server');
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (localVideoUrl) {
        URL.revokeObjectURL(localVideoUrl);
      }
    };
  }, [localVideoUrl]);

  const clearLocalOutput = useCallback(() => {
    setLocalVideoBlob(null);
    setLocalVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const t = getStrings(lang);

  // Run fast virtual-clock runtime probe whenever the loaded HTML changes
  useEffect(() => {
    const html = analysis.bundledHtml;
    if (!html.trim()) {
      setRuntimeProbe(null);
      setIsProbingDuration(false);
      return;
    }

    // Skip runtime probe if explicit user metadata (`data-duration` / `<!-- duration: -->`) was provided
    if (analysis.duration.breakdown[0]?.source === 'meta') {
      setRuntimeProbe(null);
      setIsProbingDuration(false);
      return;
    }

    const controller = new AbortController();
    setIsProbingDuration(true);

    void probeRuntimeAnimationDuration(
      html,
      analysis.dimensions.width,
      analysis.dimensions.height,
      controller.signal
    ).then((probeResult) => {
      if (controller.signal.aborted) return;
      setRuntimeProbe(probeResult);
      setIsProbingDuration(false);
    });

    return () => {
      controller.abort();
    };
  }, [analysis.bundledHtml, analysis.dimensions.width, analysis.dimensions.height, analysis.duration.breakdown]);

  const effectiveDurationResult = useMemo(
    () => mergeStaticAndRuntimeDuration(analysis.duration, runtimeProbe),
    [analysis.duration, runtimeProbe]
  );

  // Keep manualDuration synced to auto-detected duration until user toggles manual override
  useEffect(() => {
    if (!isManualOverride) {
      setManualDuration(effectiveDurationResult.durationSeconds);
    }
  }, [effectiveDurationResult.durationSeconds, isManualOverride]);

  const effectiveWidth = isManualOverride ? manualWidth : analysis.dimensions.width;
  const effectiveHeight = isManualOverride ? manualHeight : analysis.dimensions.height;
  const detectedDuration = effectiveDurationResult.durationSeconds;
  const effectiveDuration = isManualOverride ? manualDuration : detectedDuration;

  // Keep trimRange synced when total duration updates (preserve user trim if already customized, otherwise expand to full)
  useEffect(() => {
    setTrimRange((prev) => {
      if (!hasUserTrimmedRef.current) {
        return normalizeTrimRange(0, effectiveDuration, effectiveDuration);
      }
      return normalizeTrimRange(prev.startSeconds, prev.endSeconds, effectiveDuration);
    });
  }, [effectiveDuration]);

  const normalizedTrim = useMemo(
    () => normalizeTrimRange(trimRange.startSeconds, trimRange.endSeconds, effectiveDuration),
    [trimRange.startSeconds, trimRange.endSeconds, effectiveDuration]
  );
  const renderDurationSeconds = getTrimDurationSeconds(normalizedTrim);
  const isRangeTrimmed = isTrimmedRange(normalizedTrim, effectiveDuration);

  const handleChangeTrimRange = useCallback(
    (startSeconds: number, endSeconds: number) => {
      const next = normalizeTrimRange(startSeconds, endSeconds, effectiveDuration);
      hasUserTrimmedRef.current = isTrimmedRange(next, effectiveDuration);
      setTrimRange(next);
    },
    [effectiveDuration]
  );

  const handleResetTrim = useCallback(() => {
    hasUserTrimmedRef.current = false;
    setTrimRange(normalizeTrimRange(0, effectiveDuration, effectiveDuration));
  }, [effectiveDuration]);

  const effectiveDimensions = useMemo(() => {
    if (!isManualOverride) return analysis.dimensions;
    const classified = classifyVideoFormat(manualWidth, manualHeight);
    return {
      ...analysis.dimensions,
      width: manualWidth,
      height: manualHeight,
      ...classified,
      source: 'Manual override',
    };
  }, [analysis.dimensions, isManualOverride, manualWidth, manualHeight]);

  const applyNewAnalysis = useCallback((next: HtmlAnalysisResult, presetId: string | null) => {
    setAnalysis(next);
    setActivePresetId(presetId);
    setRuntimeProbe(null);
    setIsManualOverride(false);
    setManualWidth(next.dimensions.width);
    setManualHeight(next.dimensions.height);
    setManualDuration(next.duration.durationSeconds);
    hasUserTrimmedRef.current = false;
    setTrimRange(normalizeTrimRange(0, next.duration.durationSeconds, next.duration.durationSeconds));
    setRenderError(null);
    setRenderJob(null);
    clearLocalOutput();
  }, [clearLocalOutput]);

  const handleFilesSelected = useCallback(
    async (fileList: FileList | File[]) => {
      const list = Array.from(fileList);
      if (list.length === 0) return;

      try {
        const parsed: UploadedSourceFile[] = await Promise.all(
          list.map(async (file) => {
            const type = classifyFileType(file.name);
            const content =
              type === 'asset' ? await readFileAsDataUrl(file) : await file.text();
            return {
              name: file.name,
              content,
              type,
              mimeType: file.type,
              size: file.size,
            };
          })
        );

        setSourceFiles(parsed);
        const result = analyzeHtmlBundle(parsed);
        applyNewAnalysis(result, null);
        setActiveSection('workbench');
      } catch (err) {
        setRenderError(err instanceof Error ? err.message : 'Failed to read uploaded files.');
      }
    },
    [applyNewAnalysis]
  );

  const handleSelectPreset = useCallback(
    (preset: AnimationPreset) => {
      setSourceFiles([]);
      const result: HtmlAnalysisResult = {
        bundledHtml: preset.html,
        entryFileName: `${preset.id}.html`,
        dimensions: detectHtmlDimensions(preset.html),
        duration: detectAnimationDuration(preset.html),
      };
      applyNewAnalysis(result, preset.id);
    },
    [applyNewAnalysis]
  );

  const handleApplyEditedHtml = useCallback(
    (updatedHtml: string) => {
      const result: HtmlAnalysisResult = {
        bundledHtml: updatedHtml,
        entryFileName: analysis.entryFileName,
        dimensions: detectHtmlDimensions(updatedHtml),
        duration: detectAnimationDuration(updatedHtml),
      };
      applyNewAnalysis(result, activePresetId);
    },
    [analysis.entryFileName, activePresetId, applyNewAnalysis]
  );

  const handleRuntimeDurationDetected = useCallback(
    (seconds: number, hasInfinite: boolean, isGsap?: boolean) => {
      if (seconds <= 0) return;
      setRuntimeProbe((prev) => {
        if (prev && prev.hadExactGsapTimeline && !isGsap) return prev;
        // Preserve high-confidence virtual-clock probe results (e.g. detected 1-cycle loop or finite DOM/rAF)
        if (prev && prev.confidence === 'high' && !isGsap) return prev;
        if (prev && prev.durationSeconds >= seconds - 0.05 && !isGsap) return prev;
        return {
          durationSeconds: seconds,
          source: isGsap
            ? 'Live GSAP timeline (preview runtime)'
            : 'Measured live preview DOM animations',
          breakdown: [
            {
              name: isGsap ? 'GSAP Global Timeline' : 'Live DOM Animation',
              durationSeconds: seconds,
              delaySeconds: 0,
              iterations: hasInfinite ? 'infinite' : 1,
              totalSeconds: seconds,
              source: isGsap ? 'gsap' : 'runtime',
            },
          ],
          hasInfiniteOnly: hasInfinite,
          confidence: isGsap ? 'high' : 'medium',
          hadExactGsapTimeline: Boolean(isGsap),
          hadDynamicDomAnimations: true,
        };
      });
    },
    []
  );

  // Poll active server render job status (skip local GPU jobs)
  useEffect(() => {
    if (!renderJob || renderJob.id.startsWith('local_')) return;
    const isActive =
      renderJob.status === 'queued' ||
      renderJob.status === 'initializing' ||
      renderJob.status === 'capturing' ||
      renderJob.status === 'encoding';

    if (!isActive) return;

    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/render/${encodeURIComponent(renderJob.id)}`);
        if (!res.ok) return;
        const nextState = (await res.json()) as RenderJobState;
        setRenderJob(nextState);
      } catch {
        // Keep polling gracefully on transient network hiccup
      }
    }, 350);

    return () => window.clearInterval(timer);
  }, [renderJob?.id, renderJob?.status]);

  const handleStartRender = async () => {
    if (!analysis.bundledHtml.trim()) return;
    setRenderError(null);
    clearLocalOutput();

    const renderStart = normalizedTrim.startSeconds;
    const renderEnd = normalizedTrim.endSeconds;
    const renderDur = renderDurationSeconds;

    if (renderEngine === 'local-gpu' && gpuCapabilities.supported) {
      const localId = `local_${Date.now().toString(36)}`;
      const totalFrames = Math.max(1, Math.round(renderDur * fps));
      const controller = new AbortController();
      localAbortRef.current = controller;

      setRenderJob({
        id: localId,
        status: 'initializing',
        width: effectiveWidth,
        height: effectiveHeight,
        durationSeconds: renderDur,
        startSeconds: renderStart,
        endSeconds: renderEnd,
        bitrateMbps,
        fps,
        format: 'mp4',
        currentFrame: 0,
        totalFrames,
        progress: 1,
        elapsedMs: 0,
        etaMs: null,
        fileSizeBytes: null,
        verifiedBitrateMbps: null,
        outputFileName: null,
        error: null,
      });

      try {
        const result = await renderLocallyWithGpu({
          html: analysis.bundledHtml,
          width: effectiveWidth,
          height: effectiveHeight,
          durationSeconds: renderDur,
          startSeconds: renderStart,
          totalTimelineSeconds: effectiveDuration,
          bitrateMbps,
          fps,
          fileNameBase: analysis.entryFileName,
          signal: controller.signal,
          onProgress: (p) => {
            setRenderJob((prev) =>
              prev && prev.id === localId
                ? {
                    ...prev,
                    status: p.status,
                    currentFrame: p.currentFrame,
                    totalFrames: p.totalFrames,
                    progress: p.progress,
                    elapsedMs: p.elapsedMs,
                    etaMs: p.etaMs,
                  }
                : prev
            );
          },
        });

        const objectUrl = URL.createObjectURL(result.blob);
        setLocalVideoBlob(result.blob);
        setLocalVideoUrl(objectUrl);
        setRenderJob({
          id: localId,
          status: 'completed',
          width: result.width,
          height: result.height,
          durationSeconds: renderDur,
          startSeconds: renderStart,
          endSeconds: renderEnd,
          bitrateMbps,
          fps,
          format: 'mp4',
          currentFrame: totalFrames,
          totalFrames,
          progress: 100,
          elapsedMs: result.elapsedMs,
          etaMs: 0,
          fileSizeBytes: result.fileSizeBytes,
          verifiedBitrateMbps: result.verifiedBitrateMbps,
          outputFileName: result.fileName,
          error: null,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setRenderJob((prev) => (prev && prev.id === localId ? { ...prev, status: 'cancelled' } : prev));
        } else {
          const message = err instanceof Error ? err.message : 'Local GPU render failed.';
          setRenderError(message);
          setRenderJob((prev) =>
            prev && prev.id === localId ? { ...prev, status: 'failed', error: message } : prev
          );
        }
      } finally {
        if (localAbortRef.current === controller) {
          localAbortRef.current = null;
        }
      }
      return;
    }

    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html: analysis.bundledHtml,
          width: effectiveWidth,
          height: effectiveHeight,
          durationSeconds: renderDur,
          startSeconds: renderStart,
          totalTimelineSeconds: effectiveDuration,
          bitrateMbps,
          fps,
          format,
          fileNameBase: analysis.entryFileName,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setRenderError(data.error || 'Failed to start render.');
        return;
      }
      setRenderJob(data as RenderJobState);
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : 'Network error starting render.');
    }
  };

  const handleCancelRender = async () => {
    if (!renderJob) return;
    if (renderJob.id.startsWith('local_')) {
      localAbortRef.current?.abort();
      setRenderJob((prev) => (prev ? { ...prev, status: 'cancelled' } : null));
      return;
    }
    try {
      await fetch(`/api/render/${encodeURIComponent(renderJob.id)}`, {
        method: 'DELETE',
      });
      setRenderJob((prev) => (prev ? { ...prev, status: 'cancelled' } : null));
    } catch {
      // ignore
    }
  };

  const handleSelectSection = (section: WorkspaceSection) => {
    setActiveSection(section);
    if (section === 'source') {
      setShowCodeEditor(true);
      window.setTimeout(() => {
        sourceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
    } else if (section === 'presets') {
      presetsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (section === 'output') {
      const outputEl = document.getElementById('render-output-panel');
      if (outputEl) {
        outputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div id="top" className="min-h-screen bg-[#0B0D11] text-[#F1F5F9]">
      <TopBar
        activeSection={activeSection}
        onSelectSection={handleSelectSection}
        onTriggerUpload={() => fileInputRef.current?.click()}
        lang={lang}
      />

      <main className="mx-auto max-w-[1440px] px-4 sm:px-6 py-6 space-y-6">
        {/* Workspace Lead Strip */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/[0.06] pb-5">
          <div className="max-w-3xl">
            <h1 className="font-display text-xl sm:text-2xl font-semibold tracking-tight text-white text-balance">
              {lang === 'en'
                ? 'HTML & CSS Animation Video Renderer'
                : 'HTML / CSS ওয়েব অ্যানিমেশন ভিডিও রেন্ডার স্টুডিও'}
            </h1>
            <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">{t.heroSubtitle}</p>
          </div>

          {/* Language Toggle in Workspace Toolbar */}
          <div
            role="group"
            aria-label="Language switch"
            className="inline-flex items-center self-start rounded-lg border border-white/10 bg-[#12151C] p-1 shrink-0"
          >
            <button
              type="button"
              onClick={() => setLang('bn')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                lang === 'bn' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              বাংলা
            </button>
            <button
              type="button"
              onClick={() => setLang('en')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                lang === 'en' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              English
            </button>
          </div>
        </div>

        {/* Upload & Format Presets */}
        <div ref={presetsRef}>
          <UploadZone
            files={sourceFiles}
            presets={ANIMATION_PRESETS}
            activePresetId={activePresetId}
            onFilesSelected={handleFilesSelected}
            onSelectPreset={handleSelectPreset}
            lang={lang}
            fileInputRef={fileInputRef}
          />
        </div>

        {/* Main 2-Column Studio Workbench */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-8 space-y-5 min-w-0">
            <PreviewStage
              html={analysis.bundledHtml}
              width={effectiveWidth}
              height={effectiveHeight}
              durationSeconds={effectiveDuration}
              trimStart={normalizedTrim.startSeconds}
              trimEnd={normalizedTrim.endSeconds}
              onChangeTrimRange={handleChangeTrimRange}
              onResetTrim={handleResetTrim}
              dimensions={effectiveDimensions}
              lang={lang}
              onRuntimeDurationDetected={handleRuntimeDurationDetected}
            />

            {/* Toggleable Source Code Inspector */}
            <div ref={sourceRef} className="space-y-3">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setShowCodeEditor((v) => !v)}
                  aria-expanded={showCodeEditor}
                  className="text-xs font-medium text-slate-300 hover:text-white underline underline-offset-4 cursor-pointer"
                >
                  {showCodeEditor
                    ? lang === 'en'
                      ? 'Hide HTML / CSS Source Code'
                      : 'HTML / CSS সোর্স কোড লুকান'
                    : lang === 'en'
                      ? 'Inspect or Edit HTML / CSS Source Code'
                      : 'HTML / CSS সোর্স কোড দেখুন বা এডিট করুন'}
                </button>
              </div>

              {showCodeEditor && (
                <CodeEditorPanel
                  html={analysis.bundledHtml}
                  entryFileName={analysis.entryFileName}
                  onApplyHtml={handleApplyEditedHtml}
                  lang={lang}
                />
              )}
            </div>
          </div>

          <div className="lg:col-span-4 min-w-0">
            <RenderControls
              dimensions={effectiveDimensions}
              duration={effectiveDurationResult}
              isProbingDuration={isProbingDuration}
              effectiveWidth={effectiveWidth}
              effectiveHeight={effectiveHeight}
              effectiveDuration={effectiveDuration}
              trimStart={normalizedTrim.startSeconds}
              trimEnd={normalizedTrim.endSeconds}
              renderDurationSeconds={renderDurationSeconds}
              isRangeTrimmed={isRangeTrimmed}
              isManualOverride={isManualOverride}
              onToggleOverride={setIsManualOverride}
              onChangeManualDimensions={(w, h) => {
                setManualWidth(w);
                setManualHeight(h);
              }}
              onChangeManualDuration={setManualDuration}
              onResetAuto={() => {
                setIsManualOverride(false);
                setManualWidth(analysis.dimensions.width);
                setManualHeight(analysis.dimensions.height);
                setManualDuration(detectedDuration);
                hasUserTrimmedRef.current = false;
                setTrimRange(normalizeTrimRange(0, detectedDuration, detectedDuration));
              }}
              bitrateMbps={bitrateMbps}
              onChangeBitrate={setBitrateMbps}
              fps={fps}
              onChangeFps={setFps}
              format={format}
              onChangeFormat={setFormat}
              renderEngine={renderEngine}
              onChangeRenderEngine={setRenderEngine}
              gpuCapabilities={gpuCapabilities}
              localVideoUrl={localVideoUrl}
              localVideoBlob={localVideoBlob}
              renderJob={renderJob}
              renderError={renderError}
              onStartRender={handleStartRender}
              onCancelRender={handleCancelRender}
              hasHtml={Boolean(analysis.bundledHtml.trim())}
              lang={lang}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
