import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFfmpegArgs,
  computeVbvBufsizeKbps,
  partitionFrameRanges,
  parseFfprobeBitrateMbps,
} from './ffmpegConfig';

test('computeVbvBufsizeKbps computes tight 3-frame VBV buffer for exact CBR', () => {
  assert.equal(computeVbvBufsizeKbps(60, 30), 6000);
  assert.equal(computeVbvBufsizeKbps(80, 30), 8000);
  assert.equal(computeVbvBufsizeKbps(100, 30), 10000);
  assert.equal(computeVbvBufsizeKbps(120, 60), 6000);
});

test('partitionFrameRanges splits frames cleanly without gaps or overlaps', () => {
  const ranges = partitionFrameRanges(120, 4);
  assert.equal(ranges.length, 4);
  assert.deepEqual(ranges, [
    { start: 0, end: 29 },
    { start: 30, end: 59 },
    { start: 60, end: 89 },
    { start: 90, end: 119 },
  ]);

  const small = partitionFrameRanges(7, 4);
  assert.deepEqual(small, [{ start: 0, end: 6 }]);

  const uneven = partitionFrameRanges(61, 4);
  assert.equal(uneven[0].start, 0);
  assert.equal(uneven[uneven.length - 1].end, 60);
  for (let i = 1; i < uneven.length; i++) {
    assert.equal(uneven[i].start, uneven[i - 1].end + 1);
  }
});

test('buildFfmpegArgs configures strict CBR libx264 parameters and mjpeg input', () => {
  const args = buildFfmpegArgs({
    bitrateMbps: 100,
    fps: 30,
    format: 'mp4',
    outputPath: '/tmp/out.mp4',
  });
  assert.ok(args.includes('mjpeg'));
  assert.ok(args.includes('100000k'));
  assert.ok(args.includes('10000k'));
  assert.ok(args.includes('nal-hrd=cbr:force-cfr=1:filler=1:vbv-init=1.0:ratetol=0.01'));
  assert.ok(args.includes('superfast'));
  assert.ok(args.includes('zerolatency'));
});

test('parseFfprobeBitrateMbps reads stream bitrate and falls back to format bitrate', () => {
  const streamProbe = JSON.stringify({
    streams: [{ codec_type: 'video', bit_rate: '80002400' }],
    format: { bit_rate: '80015000' },
  });
  assert.equal(parseFfprobeBitrateMbps(streamProbe), 80);

  const formatOnly = JSON.stringify({
    streams: [{ codec_type: 'video' }],
    format: { bit_rate: '120010000' },
  });
  assert.equal(parseFfprobeBitrateMbps(formatOnly), 120.01);

  assert.equal(parseFfprobeBitrateMbps('not-json'), null);
});
