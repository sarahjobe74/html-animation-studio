import test from 'node:test';
import assert from 'node:assert/strict';
import { buildByteRanges, getVideoMimeType } from './videoDownload';

test('buildByteRanges splits large files into contiguous non-overlapping chunks', () => {
  const chunk = 8 * 1024 * 1024; // 8 MiB
  const total = 25 * 1024 * 1024 + 123; // ~25 MiB
  const ranges = buildByteRanges(total, chunk);

  assert.equal(ranges.length, 4);
  assert.equal(ranges[0].start, 0);
  assert.equal(ranges[0].end, chunk - 1);
  assert.equal(ranges[ranges.length - 1].end, total - 1);

  let covered = 0;
  for (let i = 0; i < ranges.length; i++) {
    if (i > 0) {
      assert.equal(ranges[i].start, ranges[i - 1].end + 1);
    }
    covered += ranges[i].end - ranges[i].start + 1;
  }
  assert.equal(covered, total);
});

test('buildByteRanges handles small and empty sizes safely', () => {
  assert.deepEqual(buildByteRanges(0), []);
  assert.deepEqual(buildByteRanges(-10), []);
  assert.deepEqual(buildByteRanges(1024, 8 * 1024 * 1024), [{ start: 0, end: 1023 }]);
});

test('getVideoMimeType maps mp4, mov, and webm properly', () => {
  assert.equal(getVideoMimeType('mp4'), 'video/mp4');
  assert.equal(getVideoMimeType('mov'), 'video/quicktime');
  assert.equal(getVideoMimeType('webm'), 'video/webm');
});
