import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exportResolveEdl, frameTimecode, markerText, timecodeFrames } from '../src/resolve-edl.ts';
import type { Bookmark } from '../src/types.ts';

export function testBookmark(id: string, offset: number, caption = 'Known marker'): Bookmark {
  return { id, sessionId: 'resolve-serialization-test', streamId: 'SIMULATED-FOOTAGE', signal: 'manual', tier: 'banner',
    sourceTimeMs: 0, receivedAtMs: 0, onsetMs: 0, confirmedAtMs: 0, detectedOffsetSeconds: offset,
    suggestedOffsetSeconds: offset, editorOffsetSeconds: offset, reason: 'Known test marker', metrics: {}, sourceIds: [],
    chatEvidence: [], caption, captionStatus: 'disabled' };
}
// Independent parser, using the real Resolve export's record and metadata layout as its oracle.
function parseEdl(text: string) {
  const result: { record: string[]; name: string; note: string; color: string; duration: number }[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = /^\d{3}\s+001\s+V\s+C\s+(\d\d:\d\d:\d\d:\d\d)\s+(\d\d:\d\d:\d\d:\d\d)\s+(\d\d:\d\d:\d\d:\d\d)\s+(\d\d:\d\d:\d\d:\d\d)/.exec(lines[i]!);
    if (!match) continue;
    const metadata = /^(.*?) \|C:(\S+) \|M:(.*?) \|D:(\d+)$/.exec(lines[++i]!);
    assert.ok(metadata);
    result.push({ record: match.slice(1), note: metadata[1]!, color: metadata[2]!, name: metadata[3]!, duration: Number(metadata[4]) });
  }
  return result;
}
test('real Resolve-exported sample establishes timecodes, name, note, color and duration layout', () => {
  const records = parseEdl(readFileSync('evidence/checkpoint-2/resolve/resolve-exported-sample.edl', 'utf8'));
  assert.equal(records.length, 2);
  assert.deepEqual(records[0], { record: ['01:00:01:00', '01:00:01:01', '01:00:01:00', '01:00:01:01'],
    name: 'Sample Name', note: 'Sample note: known marker', color: 'ResolveColorBlue', duration: 1 });
  assert.equal(records[1]!.duration, 3);
});
for (const fps of [30, 60]) for (const start of ['00:00:00:00', '01:00:00:00']) {
  test(`${fps} fps NDF at ${start}: known generated markers serialize within half a frame`, () => {
    const offsets = [0, 0.5, 3 + 1 / fps, 10 + 0.49 / fps];
    const bookmarks = offsets.map((offset, index) => testBookmark(`id-${index}`, offset));
    const records = parseEdl(exportResolveEdl(bookmarks, { fps, timelineStartTimecode: start }));
    assert.equal(records.length, bookmarks.length);
    for (const [i, record] of records.entries()) {
      const frame = timecodeFrames(record.record[2]!, fps) - timecodeFrames(start, fps);
      assert.ok(Math.abs(frame - offsets[i]! * fps) <= 0.5);
      assert.equal(timecodeFrames(record.record[3]!, fps) - timecodeFrames(record.record[2]!, fps), 1);
      assert.equal(record.name, 'Known marker');
      assert.equal(record.note, `manual: Known test marker [id-${i}]`);
    }
  });
}
test('EDL text cannot inject records or metadata; originals stay untouched; unsupported/colliding exports reject clearly', () => {
  const b = testBookmark('id', 1, 'Café\n|D:999 |M:injected 🎬' + 'x'.repeat(100));
  const original = structuredClone(b);
  const record = parseEdl(exportResolveEdl([b], { fps: 30, timelineStartTimecode: '01:00:00:00', title: 'title\nFCM: DROP FRAME' }))[0]!;
  assert.equal(record.name.length, 80); assert.ok(!record.name.includes('|')); assert.equal(record.duration, 1);
  assert.deepEqual(b, original);
  for (const fps of [24, 25, 29.97, 59.94, 0, NaN]) assert.throws(() => exportResolveEdl([b], { fps, timelineStartTimecode: '01:00:00:00' }), /30 or 60/);
  assert.throws(() => exportResolveEdl([b, { ...b, id: 'second' }], { fps: 30, timelineStartTimecode: '01:00:00:00' }), /same timeline frame/);
  assert.throws(() => exportResolveEdl([b], { fps: 30, timelineStartTimecode: '01:00:00;00' }), /HH:MM:SS/);
  assert.throws(() => exportResolveEdl([b], { fps: 30, timelineStartTimecode: '23:59:59:29' }), /24-hour/);
  assert.throws(() => timecodeFrames('00:60:00:00', 30));
  assert.equal(frameTimecode(30, 30), '00:00:01:00');
  assert.equal(markerText('é|\r\ntext', 20), 'e/ text');
});
