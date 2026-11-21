import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCbrRateController,
  padAvccChunkWithFiller,
  selectAvcCodecCandidates,
} from './h264CbrPadder';

test('selectAvcCodecCandidates picks appropriate H.264 level for 4K, 5K, and 8K', () => {
  const c4k30 = selectAvcCodecCandidates(3840, 2160, 30);
  assert.equal(c4k30[0], 'avc1.640034');

  const c4k60 = selectAvcCodecCandidates(3840, 2160, 60);
  assert.equal(c4k60[0], 'avc1.640034');

  const c8k = selectAvcCodecCandidates(7680, 4320, 30);
  assert.equal(c8k[0], 'avc1.64003e');

  const c1080 = selectAvcCodecCandidates(1920, 1080, 30);
  assert.equal(c1080[0], 'avc1.640033');
});

test('padAvccChunkWithFiller writes valid big-endian length prefix and NAL type 12 filler bytes', () => {
  const raw = new Uint8Array([0, 0, 0, 2, 0x65, 0x88]);
  const padded = padAvccChunkWithFiller(raw, 10);

  assert.equal(padded.byteLength, 16);
  // Original bytes untouched
  assert.deepEqual(Array.from(padded.slice(0, 6)), [0, 0, 0, 2, 0x65, 0x88]);
  // Length prefix = 10 - 4 = 6 (big-endian)
  const view = new DataView(padded.buffer, 6, 4);
  assert.equal(view.getUint32(0, false), 6);
  // NAL header 0x0C, 4 bytes of 0xFF, trailing 0x80
  assert.equal(padded[10], 0x0c);
  assert.deepEqual(Array.from(padded.slice(11, 15)), [0xff, 0xff, 0xff, 0xff]);
  assert.equal(padded[15], 0x80);

  // Below minimum 6 bytes returns unchanged
  assert.equal(padAvccChunkWithFiller(raw, 5).byteLength, raw.byteLength);
});

test('createCbrRateController maintains exact 60, 80, 100, and 120 Mbps cumulative bitrate', () => {
  for (const bitrateMbps of [60, 80, 100, 120]) {
    const fps = 30;
    const durationSec = 2;
    const totalFrames = fps * durationSec;
    const controller = createCbrRateController(bitrateMbps, fps);
    const smallFrame = new Uint8Array(25_000); // Simulate low-complexity HTML frame

    for (let i = 0; i < totalFrames; i++) {
      controller.padFrameChunk(smallFrame);
    }

    const measuredMbps = (controller.getEmittedBytes() * 8) / (durationSec * 1_000_000);
    assert.ok(
      Math.abs(measuredMbps - bitrateMbps) < 0.01,
      `Expected ${bitrateMbps} Mbps, got ${measuredMbps}`
    );
  }
});
