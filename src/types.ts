export type BitrateMbps = 60 | 80 | 100 | 120;

export type VideoContainerFormat = 'mp4' | 'mov' | 'webm';

export type RenderEngineMode = 'local-gpu' | 'server';

export type FrameRate = 24 | 30 | 60;

export type LanguageCode = 'bn' | 'en';

export type FormatCategory =
  | '4k-horizontal'
  | '4k-vertical'
  | 'ultrawide'
  | 'super-ultrawide'
  | 'fhd-horizontal'
  | 'fhd-vertical'
  | 'custom';

export interface UploadedSourceFile {
  name: string;
  content: string;
  type: 'html' | 'css' | 'js' | 'asset';
  mimeType?: string;
  size: number;
}

export interface DimensionDetectionResult {
  width: number;
  height: number;
  source: string;
  category: FormatCategory;
  formatLabel: string;
  formatLabelBn: string;
  aspectRatioLabel: string;
  isExplicit: boolean;
}

export interface AnimationTimingEntry {
  name: string;
  durationSeconds: number;
  delaySeconds: number;
  iterations: number | 'infinite';
  totalSeconds: number;
  source: 'css' | 'waapi' | 'gsap' | 'svg' | 'js' | 'runtime' | 'meta';
}

export interface DurationDetectionResult {
  durationSeconds: number;
  source: string;
  breakdown: AnimationTimingEntry[];
  hasInfiniteOnly: boolean;
  isFallback: boolean;
}

export interface HtmlAnalysisResult {
  dimensions: DimensionDetectionResult;
  duration: DurationDetectionResult;
  bundledHtml: string;
  entryFileName: string;
}

export type RenderJobStatus =
  | 'queued'
  | 'initializing'
  | 'capturing'
  | 'encoding'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface RenderJobState {
  id: string;
  status: RenderJobStatus;
  width: number;
  height: number;
  durationSeconds: number;
  startSeconds?: number;
  endSeconds?: number;
  bitrateMbps: BitrateMbps;
  fps: FrameRate;
  format: VideoContainerFormat;
  currentFrame: number;
  totalFrames: number;
  progress: number;
  elapsedMs: number;
  etaMs: number | null;
  fileSizeBytes: number | null;
  verifiedBitrateMbps: number | null;
  outputFileName: string | null;
  error: string | null;
}

export interface AnimationPreset {
  id: string;
  title: string;
  titleBn: string;
  subtitle: string;
  subtitleBn: string;
  category: FormatCategory;
  width: number;
  height: number;
  durationSeconds: number;
  html: string;
}
