import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFrameTimestampMs,
  formatTrimFileSuffix,
  getTrimDurationSeconds,
  isTrimmedRange,
  normalizeTrimRange,
  setTrimEnd,
  setTrimStart,
} from './trimRange';

test('normalizeTrimRange clamps values cleanly and enforces minimum 0.1s segment', () => {
  assert.deepEqual(normalizeTrimRange(0, 10, 10), { startSeconds: 0, endSeconds: 10 });
  assert.deepEqual(normalizeTrimRange(-2, 15, 10), { startSeconds: 0, endSeconds: 10 });
  assert.deepEqual(normalizeTrimRange(4, 3, 10), { startSeconds: 4, endSeconds: 4.1 });
  assert.deepEqual(normalizeTrimRange(9.98, 10, 10), { startSeconds: 9.9, endSeconds: 10 });
});

test('setTrimStart and setTrimEnd respect opposite handle without crossing', () => {
  const initial = { startSeconds: 2, endSeconds: 7 };
  assert.deepEqual(setTrimStart(initial, 8.5, 10), { startSeconds: 6.9, endSeconds: 7 });
  assert.deepEqual(setTrimStart(initial, -1, 10), { startSeconds: 0, endSeconds: 7 });
  assert.deepEqual(setTrimStart(initial, 3.25, 10), { startSeconds: 3.25, endSeconds: 7 });

  assert.deepEqual(setTrimEnd(initial, 1, 10), { startSeconds: 2, endSeconds: 2.1 });
  assert.deepEqual(setTrimEnd(initial, 12, 10), { startSeconds: 2, endSeconds: 10 });
  assert.deepEqual(setTrimEnd(initial, 5.5, 10), { startSeconds: 2, endSeconds: 5.5 });
});

test('getTrimDurationSeconds and isTrimmedRange reflect selected segment accurately', () => {
  const full = { startSeconds: 0, endSeconds: 10 };
  assert.equal(getTrimDurationSeconds(full), 10);
  assert.equal(isTrimmedRange(full, 10), false);

  const trimmed = { startSeconds: 1.5, endSeconds: 6.25 };
  assert.equal(getTrimDurationSeconds(trimmed), 4.75);
  assert.equal(isTrimmedRange(trimmed, 10), true);

  const endTrimmed = { startSeconds: 0, endSeconds: 5 };
  assert.equal(isTrimmedRange(endTrimmed, 10), true);
});

test('computeFrameTimestampMs offsets frame timestamps by startSeconds accurately', () => {
  assert.equal(computeFrameTimestampMs(0, 30, 0), 0);
  assert.equal(computeFrameTimestampMs(0, 30, 2.5), 2500);
  assert.equal(Math.round(computeFrameTimestampMs(15, 30, 2.5)), 3000);
  assert.equal(Math.round(computeFrameTimestampMs(60, 60, 1.25)), 2250);
});

test('formatTrimFileSuffix appends clean segment tag only when trimmed', () => {
  assert.equal(formatTrimFileSuffix(0, 10, 10), '');
  assert.equal(formatTrimFileSuffix(1.5, 4.75, 10), '_1.5s-4.75s');
  assert.equal(formatTrimFileSuffix(0, 5, 10), '_0s-5s');
});
