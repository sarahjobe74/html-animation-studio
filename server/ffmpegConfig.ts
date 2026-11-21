import type { BitrateMbps, FrameRate, VideoContainerFormat } from '../src/types';

export interface FfmpegBuildOptions {
  bitrateMbps: BitrateMbps;
  fps: FrameRate;
  format: VideoContainerFormat;
  outputPath: string;
}

export interface FrameRange {
  start: number;
  end: number; // inclusive
}

/**
 * Computes a tight 3-frame VBV buffer in kbps so libx264 nal-hrd=cbr
 * locks tightly onto the exact requested bitrate (60/80/100/120 Mbps)
 * even on short 1s–4s clips while keeping ample headroom for crisp 4K I-frames.
 */
export function computeVbvBufsizeKbps(bitrateMbps: number, fps: number): number {
  const safeFps = Math.max(1, fps);
  const bitrateKbps = bitrateMbps * 1000;
  return Math.max(2000, Math.round((bitrateKbps * 3) / safeFps));
}

/**
 * Splits [0, totalFrames - 1] into balanced contiguous chunks for parallel workers.
 * Contiguous chunks allow each worker to advance JS virtual time linearly up to its
 * start frame once and then capture frames sequentially without redundant JS replays.
 */
export function partitionFrameRanges(totalFrames: number, maxWorkers: number): FrameRange[] {
  if (totalFrames <= 0) return [];
  const desiredWorkers =
    totalFrames < 10
      ? 1
      : Math.min(Math.max(1, maxWorkers), Math.max(1, Math.floor(totalFrames / 6)));

  const ranges: FrameRange[] = [];
  const baseSize = Math.floor(totalFrames / desiredWorkers);
  const remainder = totalFrames % desiredWorkers;

  let cursor = 0;
  for (let i = 0; i < desiredWorkers; i++) {
    const count = baseSize + (i < remainder ? 1 : 0);
    if (count <= 0) continue;
    ranges.push({ start: cursor, end: cursor + count - 1 });
    cursor += count;
  }
  return ranges;
}

/**
 * Builds fast, exact-CBR FFmpeg arguments reading high-quality MJPEG frames from stdin.
 */
export function buildFfmpegArgs(options: FfmpegBuildOptions): string[] {
  const bitrateKbps = options.bitrateMbps * 1000;
  const bitrateStr = `${bitrateKbps}k`;
  const bufsizeStr = `${computeVbvBufsizeKbps(options.bitrateMbps, options.fps)}k`;

  const commonInput = [
    '-y',
    '-f',
    'image2pipe',
    '-vcodec',
    'mjpeg',
    '-framerate',
    String(options.fps),
    '-i',
    '-',
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2',
  ];

  if (options.format === 'webm') {
    return [
      ...commonInput,
      '-c:v',
      'libvpx-vp9',
      '-b:v',
      bitrateStr,
      '-minrate',
      bitrateStr,
      '-maxrate',
      bitrateStr,
      '-bufsize',
      bufsizeStr,
      '-undershoot-pct',
      '0',
      '-overshoot-pct',
      '0',
      '-qmin',
      '0',
      '-qmax',
      '4',
      '-deadline',
      'realtime',
      '-cpu-used',
      '8',
      '-row-mt',
      '1',
      '-tile-columns',
      '2',
      '-threads',
      '0',
      '-pix_fmt',
      'yuv420p',
      options.outputPath,
    ];
  }

  // MP4 and MOV use strict H.264 High Profile CBR with NAL HRD filler so
  // measured stream bitrate locks within ~0.1% of 60/80/100/120 Mbps.
  return [
    ...commonInput,
    '-c:v',
    'libx264',
    '-preset',
    'superfast',
    '-tune',
    'zerolatency',
    '-profile:v',
    'high',
    '-b:v',
    bitrateStr,
    '-minrate',
    bitrateStr,
    '-maxrate',
    bitrateStr,
    '-bufsize',
    bufsizeStr,
    '-x264-params',
    'nal-hrd=cbr:force-cfr=1:filler=1:vbv-init=1.0:ratetol=0.01',
    '-pix_fmt',
    'yuv420p',
    '-threads',
    '0',
    '-movflags',
    '+faststart',
    options.outputPath,
  ];
}

/**
 * Extracts actual video stream bitrate in Mbps from ffprobe JSON output.
 */
export function parseFfprobeBitrateMbps(probeJson: string): number | null {
  try {
    const parsed = JSON.parse(probeJson) as {
      streams?: Array<{ codec_type?: string; bit_rate?: string }>;
      format?: { bit_rate?: string };
    };
    const videoStream = parsed.streams?.find((s) => s.codec_type === 'video') || parsed.streams?.[0];
    const rawRate = videoStream?.bit_rate || parsed.format?.bit_rate;
    if (!rawRate) return null;
    const bps = Number(rawRate);
    if (!Number.isFinite(bps) || bps <= 0) return null;
    return Number((bps / 1_000_000).toFixed(2));
  } catch {
    return null;
  }
}
