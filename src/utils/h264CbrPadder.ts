/**
 * Pure H.264 / AVCC codec level selection and ISO/IEC 14496-10 NAL Unit Type 12
 * (Filler Data) CBR rate controller for WebCodecs VideoEncoder + mp4-muxer.
 */

export function selectAvcCodecCandidates(
  width: number,
  height: number,
  fps: number
): string[] {
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const mbPerSec = macroblocks * Math.max(1, fps);

  // H.264 levels:
  // Level 5.1 (0x33): max 36,864 MBs, 983,040 MB/s (4K @ 30fps)
  // Level 5.2 (0x34): max 36,864 MBs, 2,073,600 MB/s (4K @ 60fps, 5120x1440 @ 60fps)
  // Level 6.0 (0x3c): max 139,264 MBs, 4,177,920 MB/s
  // Level 6.2 (0x3e): max 139,264 MBs, 16,711,680 MB/s (8K @ 60fps)
  if (macroblocks > 36864 || mbPerSec > 2073600) {
    return [
      'avc1.64003e', // High Profile Level 6.2
      'avc1.64003c', // High Profile Level 6.0
      'avc1.4d003e', // Main Profile Level 6.2
      'avc1.42003e', // Baseline Profile Level 6.2
      'avc1.640034', // High Profile Level 5.2 fallback
    ];
  }

  if (macroblocks > 8192 || mbPerSec > 983040) {
    return [
      'avc1.640034', // High Profile Level 5.2 (4K60 / 5K)
      'avc1.64003e', // High Profile Level 6.2
      'avc1.4d0034', // Main Profile Level 5.2
      'avc1.420034', // Baseline Profile Level 5.2
      'avc1.640033', // High Profile Level 5.1
    ];
  }

  return [
    'avc1.640033', // High Profile Level 5.1 (4K30 / 1080p60)
    'avc1.640034', // High Profile Level 5.2
    'avc1.4d0033', // Main Profile Level 5.1
    'avc1.420033', // Baseline Profile Level 5.1
  ];
}

/**
 * Appends a standards-compliant H.264 AVCC (4-byte length-prefixed) Filler Data
 * NAL unit (nal_unit_type = 12, byte 0x0C, payload 0xFF..., rbsp trailing 0x80).
 * Minimum valid AVCC filler packet is 6 bytes (4-byte length = 2, 0x0C, 0x80).
 */
export function padAvccChunkWithFiller(
  chunkBytes: Uint8Array,
  extraBytes: number
): Uint8Array {
  const padTotal = Math.floor(extraBytes);
  if (padTotal < 6) {
    return chunkBytes;
  }

  const nalPayloadLen = padTotal - 4; // excludes 4-byte AVCC length prefix
  const out = new Uint8Array(chunkBytes.byteLength + padTotal);
  out.set(chunkBytes, 0);

  const offset = chunkBytes.byteLength;
  const view = new DataView(out.buffer, out.byteOffset + offset, 4);
  view.setUint32(0, nalPayloadLen, false); // big-endian AVCC NAL length

  out[offset + 4] = 0x0c; // forbidden_zero_bit=0, nal_ref_idc=0, nal_unit_type=12 (Filler)
  if (nalPayloadLen > 2) {
    out.fill(0xff, offset + 5, offset + 4 + nalPayloadLen - 1);
  }
  out[offset + 4 + nalPayloadLen - 1] = 0x80; // rbsp_trailing_bits

  return out;
}

export interface CbrRateController {
  padFrameChunk(rawChunk: Uint8Array): Uint8Array;
  getEmittedBytes(): number;
  getFrameCount(): number;
}

/**
 * Cumulative CBR byte-budget controller so WebCodecs H.264 streams hit the exact
 * selected bitrate (60 / 80 / 100 / 120 Mbps) regardless of scene simplicity.
 */
export function createCbrRateController(
  bitrateMbps: number,
  fps: number
): CbrRateController {
  const bytesPerFrame = (bitrateMbps * 1_000_000) / 8 / Math.max(1, fps);
  let frameCount = 0;
  let emittedBytes = 0;

  return {
    padFrameChunk(rawChunk: Uint8Array): Uint8Array {
      frameCount += 1;
      const targetCumulative = Math.round(frameCount * bytesPerFrame);
      const projected = emittedBytes + rawChunk.byteLength;
      const deficit = targetCumulative - projected;

      if (deficit >= 6) {
        const padded = padAvccChunkWithFiller(rawChunk, deficit);
        emittedBytes += padded.byteLength;
        return padded;
      }

      emittedBytes += rawChunk.byteLength;
      return rawChunk;
    },
    getEmittedBytes(): number {
      return emittedBytes;
    },
    getFrameCount(): number {
      return frameCount;
    },
  };
}
