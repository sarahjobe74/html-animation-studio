import type { VideoContainerFormat } from '../types';

export const DOWNLOAD_CHUNK_BYTES = 8 * 1024 * 1024; // 8 MiB chunks (safely below Cloud Run 32 MiB cap)

export interface ByteRange {
  start: number;
  end: number; // inclusive
}

export function buildByteRanges(
  totalBytes: number,
  chunkSizeBytes: number = DOWNLOAD_CHUNK_BYTES
): ByteRange[] {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return [];
  const step = Math.max(1, Math.floor(chunkSizeBytes));
  const ranges: ByteRange[] = [];
  for (let start = 0; start < totalBytes; start += step) {
    const end = Math.min(totalBytes - 1, start + step - 1);
    ranges.push({ start, end });
  }
  return ranges;
}

export function getVideoMimeType(format: VideoContainerFormat): string {
  if (format === 'webm') return 'video/webm';
  if (format === 'mov') return 'video/quicktime';
  return 'video/mp4';
}

export interface DownloadVideoOptions {
  jobId: string;
  fileName: string;
  totalBytes: number | null;
  format: VideoContainerFormat;
  onProgress?: (percent: number) => void;
}

/**
 * Fetches the rendered video inside the authenticated app context in <=8 MiB chunks
 * via standard 200 OK requests, assembles a local Blob, and triggers a browser save
 * using a blob: URL. Avoids cross-origin iframe cookie loss (403) and Cloud Run's
 * 32 MiB single-response limit.
 */
export async function downloadRenderedVideo(options: DownloadVideoOptions): Promise<Blob> {
  const { jobId, fileName, totalBytes, format, onProgress } = options;
  const mimeType = getVideoMimeType(format);
  const baseUrl = `/api/render/${encodeURIComponent(jobId)}/video`;

  let blob: Blob;

  if (totalBytes && totalBytes > 0) {
    const ranges = buildByteRanges(totalBytes, DOWNLOAD_CHUNK_BYTES);
    const chunks: ArrayBuffer[] = [];
    let receivedBytes = 0;

    for (const range of ranges) {
      const url = `${baseUrl}?start=${range.start}&end=${range.end}`;
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`Download failed (HTTP ${res.status})`);
      }
      const buf = await res.arrayBuffer();
      chunks.push(buf);
      receivedBytes += buf.byteLength;
      if (onProgress) {
        onProgress(Math.min(100, Math.round((receivedBytes / totalBytes) * 100)));
      }
    }

    blob = new Blob(chunks, { type: mimeType });
  } else {
    const res = await fetch(baseUrl, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(`Download failed (HTTP ${res.status})`);
    }
    blob = await res.blob();
    if (onProgress) onProgress(100);
  }

  triggerBlobSave(blob, fileName);
  return blob;
}

export function triggerBlobSave(blob: Blob, fileName: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => {
    URL.revokeObjectURL(blobUrl);
  }, 60_000);
}
