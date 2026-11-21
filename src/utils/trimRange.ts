export const MIN_TRIM_SEGMENT_SECONDS = 0.1;

export interface TrimRange {
  startSeconds: number;
  endSeconds: number;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

export function normalizeTrimRange(
  startSeconds: number,
  endSeconds: number,
  totalDurationSeconds: number
): TrimRange {
  const safeTotal = Number.isFinite(totalDurationSeconds) && totalDurationSeconds > 0
    ? round2(totalDurationSeconds)
    : MIN_TRIM_SEGMENT_SECONDS;

  if (safeTotal <= MIN_TRIM_SEGMENT_SECONDS) {
    return { startSeconds: 0, endSeconds: safeTotal };
  }

  const rawStart = Number.isFinite(startSeconds) ? startSeconds : 0;
  const rawEnd = Number.isFinite(endSeconds) ? endSeconds : safeTotal;

  let start = Math.max(0, Math.min(rawStart, safeTotal - MIN_TRIM_SEGMENT_SECONDS));
  let end = Math.max(start + MIN_TRIM_SEGMENT_SECONDS, Math.min(rawEnd, safeTotal));

  start = round2(start);
  end = round2(end);

  if (end - start < MIN_TRIM_SEGMENT_SECONDS) {
    end = round2(Math.min(safeTotal, start + MIN_TRIM_SEGMENT_SECONDS));
    if (end - start < MIN_TRIM_SEGMENT_SECONDS) {
      start = round2(Math.max(0, end - MIN_TRIM_SEGMENT_SECONDS));
    }
  }

  return { startSeconds: start, endSeconds: end };
}

export function setTrimStart(
  current: TrimRange,
  nextStartSeconds: number,
  totalDurationSeconds: number
): TrimRange {
  const normalized = normalizeTrimRange(current.startSeconds, current.endSeconds, totalDurationSeconds);
  const safeNext = Number.isFinite(nextStartSeconds) ? nextStartSeconds : 0;
  const maxAllowedStart = Math.max(0, normalized.endSeconds - MIN_TRIM_SEGMENT_SECONDS);
  const clampedStart = round2(Math.max(0, Math.min(safeNext, maxAllowedStart)));
  return {
    startSeconds: clampedStart,
    endSeconds: normalized.endSeconds,
  };
}

export function setTrimEnd(
  current: TrimRange,
  nextEndSeconds: number,
  totalDurationSeconds: number
): TrimRange {
  const normalized = normalizeTrimRange(current.startSeconds, current.endSeconds, totalDurationSeconds);
  const safeTotal = round2(Math.max(MIN_TRIM_SEGMENT_SECONDS, totalDurationSeconds));
  const safeNext = Number.isFinite(nextEndSeconds) ? nextEndSeconds : safeTotal;
  const minAllowedEnd = Math.min(safeTotal, normalized.startSeconds + MIN_TRIM_SEGMENT_SECONDS);
  const clampedEnd = round2(Math.max(minAllowedEnd, Math.min(safeNext, safeTotal)));
  return {
    startSeconds: normalized.startSeconds,
    endSeconds: clampedEnd,
  };
}

export function getTrimDurationSeconds(range: TrimRange): number {
  const diff = range.endSeconds - range.startSeconds;
  return round2(Math.max(MIN_TRIM_SEGMENT_SECONDS, Number.isFinite(diff) ? diff : MIN_TRIM_SEGMENT_SECONDS));
}

export function isTrimmedRange(range: TrimRange, totalDurationSeconds: number): boolean {
  if (!Number.isFinite(totalDurationSeconds) || totalDurationSeconds <= 0) return false;
  return range.startSeconds > 0.01 || Math.abs(range.endSeconds - totalDurationSeconds) > 0.01;
}

export function computeFrameTimestampMs(
  frameIndex: number,
  fps: number,
  startSeconds = 0
): number {
  const safeFrame = Math.max(0, frameIndex);
  const safeFps = fps > 0 ? fps : 30;
  const safeStart = Number.isFinite(startSeconds) && startSeconds > 0 ? startSeconds : 0;
  return (safeStart + safeFrame / safeFps) * 1000;
}

export function formatTrimFileSuffix(
  startSeconds: number,
  endSeconds: number,
  totalDurationSeconds?: number
): string {
  const safeStart = Math.max(0, round2(startSeconds));
  const safeEnd = Math.max(safeStart, round2(endSeconds));
  if (
    totalDurationSeconds !== undefined &&
    !isTrimmedRange({ startSeconds: safeStart, endSeconds: safeEnd }, totalDurationSeconds)
  ) {
    return '';
  }
  if (safeStart <= 0.01 && totalDurationSeconds === undefined) {
    return '';
  }
  const fmt = (v: number) => v.toFixed(2).replace(/\.?0+$/, '');
  return `_${fmt(safeStart)}s-${fmt(safeEnd)}s`;
}
