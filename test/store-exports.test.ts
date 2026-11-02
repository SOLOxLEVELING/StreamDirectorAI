import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, Recorder } from '../src/store.ts';
import { Detector } from '../src/detector.ts';
import { settings } from '../src/types.ts';
import type { Input, Session } from '../src/types.ts';
import { exportCsv, exportJson, exportResolveEdl } from '../src/exports.ts';

const session = (overrides = {}): Session => ({ id: 'durable', mode: 'simulated', streamId: 'stream-123',
  startedAtMs: 1800000, streamStartedAtMs: 0, settings: settings(overrides) });
const input = (time: number, overrides: Partial<Input> = {}): Input => ({ type: 'manual',
  sourceId: 'mark', transportId: 'transport', sourceTimeMs: time, receivedAtMs: time, ...overrides });

test('confirmed bookmark survives a real SQLite close/reopen with complete session settings', () => {
  const directory = mkdtempSync(join(tmpdir(), 'streamdirector-'));
  const path = join(directory, 'session.sqlite');
  let now = 1800000;
  let store = new Store(path);
  try {
    const rec = new Recorder(store, session({ alignmentSeconds: 3600 }), () => now);
    const changes = rec.ingest(input(now));
    assert.equal(changes.bookmarks.length, 1);
    assert.equal(store.bookmarks('durable').length, 1); // saved before returning the result
    assert.equal(store.bookmarks('durable')[0]!.caption, 'Streamer marked this moment');
    store.close();
    store = new Store(path);
    now += 20000;
    const recovered = new Recorder(store, session({ alignmentSeconds: 3600 }), () => now, true);
    assert.equal(store.bookmarks('durable').length, 1);
    assert.equal(recovered.session.settings.alignmentSeconds, 3600);
    assert.equal(recovered.status().warm, false);
    assert.equal(store.gaps('durable')[0]!.reason, 'process restart; coverage unverified');
    assert.equal(recovered.ingest(input(now, { transportId: 'fresh' })).disposition, 'duplicate');
    recovered.ingest(input(now, { transportId: 'fresh2', sourceId: 'mark2' }));
    assert.deepEqual(store.bookmarks('durable').map(b => b.id), ['durable:1', 'durable:2']);
  } finally { store.close(); rmSync(directory, { recursive: true }); }
});
test('durable dedup survives bounded engine-cache eviction and a process restart', () => {
  const store = new Store(':memory:');
  let now = 1800000;
  try {
    let rec = new Recorder(store, session({ dedupLimit: 2 }), () => now);
    rec.ingest(input(now));
    rec.ingest(input(now, { sourceId: 'second', transportId: 'second' }));
    assert.equal(rec.ingest(input(now, { transportId: 'new' })).disposition, 'duplicate');
    now += 1000;
    rec = new Recorder(store, session(), () => now, true);
    assert.equal(rec.ingest(input(now, { transportId: 'new2' })).disposition, 'duplicate');
    assert.equal(store.bookmarks('durable').length, 2);
  } finally { store.close(); }
});
test('cheer aggregate updates overwrite a single durable bookmark without changing confirmation', () => {
  const store = new Store(':memory:');
  let now = 1800000;
  try {
    const rec = new Recorder(store, session(), () => now);
    rec.ingest(input(now, { type: 'cheer', amount: 100 }));
    now += 1000;
    rec.ingest(input(now, { type: 'cheer', amount: 50, sourceId: 'second', transportId: 'second' }));
    const [b] = store.bookmarks('durable');
    assert.equal(store.bookmarks('durable').length, 1);
    assert.equal(b!.metrics.bits, 150);
    assert.equal(b!.confirmedAtMs, 1800000);
  } finally { store.close(); }
});
test('failed SQLite commit rolls back in-memory state and can be retried without loss', () => {
  const store = new Store(':memory:');
  const rec = new Recorder(store, session(), () => 1800000);
  const original = store.commit.bind(store);
  try {
    store.commit = () => { throw new Error('simulated disk failure'); };
    assert.throws(() => rec.ingest(input(1800000)), /disk failure/);
    assert.equal(store.bookmarks('durable').length, 0);
    store.commit = original;
    const result = rec.ingest(input(1800000));
    assert.equal(result.bookmarks[0]!.id, 'durable:1');
    assert.equal(store.bookmarks('durable').length, 1);
  } finally { store.close(); }
});

// Independent CSV reader: verifies the actual serialized artifact, including embedded quotes/newlines.
function readCsv(text: string) {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if (c === '\r' && text[i + 1] === '\n' && !quoted) {
      row.push(cell); rows.push(row); row = []; cell = ''; i++;
    } else cell += c;
  }
  assert.equal(quoted, false);
  return rows;
}
test('CSV round-trips quotes, commas, newlines, readable timestamps, and neutralizes formula prefixes', () => {
  const store = new Store(':memory:');
  try {
    const rec = new Recorder(store, session(), () => 1800000);
    rec.ingest(input(1800000));
    const b = store.bookmarks('durable')[0]!;
    for (const caption of ['A "close", finish\nwith chat', '=HYPERLINK("bad")', ' +1+1', '@sum(A1)', '-1+2', '\t=1']) {
      const rows = readCsv(exportCsv([{ ...b, caption }]));
      assert.equal(rows.length, 2);
      assert.equal(rows[1]!.length, rows[0]!.length);
      const expected = caption.startsWith('A') ? caption : `'${caption}`;
      assert.equal(rows[1]![10], expected);
      assert.equal(rows[1]![3], '1970-01-01T00:30:00.000Z');
      assert.equal(rows[1]![7], '1800');
    }
  } finally { store.close(); }
});
test('JSON preserves full evidence, settings, provenance, and scoped editor verification', () => {
  const store = new Store(':memory:');
  try {
    const rec = new Recorder(store, session(), () => 1800000);
    rec.ingest(input(1800000));
    const bookmarks = store.bookmarks('durable');
    const parsed = JSON.parse(exportJson(rec.session, bookmarks, []));
    assert.deepEqual(parsed.bookmarks, bookmarks);
    assert.deepEqual(parsed.session, rec.session);
    assert.equal(parsed.session.mode, 'simulated');
    assert.equal(parsed.editorCompatibility, 'verified-for-resolve-marker-edl');
    assert.deepEqual(parsed.editorVerification.fps, [30, 60]);
    assert.equal(parsed.editorVerification.liveStreamAlignment, 'unverified');
    assert.equal(parsed.schemaVersion, 1);
    assert.throws(() => exportResolveEdl(bookmarks, { fps: 29.97, timelineStartTimecode: '01:00:00:00' }), /30 or 60/);
  } finally { store.close(); }
});
test('restart recovery discards a persisted partial chat candidate and preserves manual fallback', () => {
  const store = new Store(':memory:'); let now = 1800000;
  try {
    let rec = new Recorder(store, session(), () => now);
    for (let sec = 1800; sec <= 1863; sec++) {
      now = sec * 1000;
      if (sec >= 1860) for (let u = 0; u < 3; u++) rec.ingest(input(now, {
        type: 'chat', userId: `u${u}`, sourceId: `${sec}:${u}`, transportId: `${sec}:${u}`,
      }));
      rec.tick();
    }
    assert.equal(store.bookmarks('durable').length, 0);
    now = 1864000;
    rec = new Recorder(store, session(), () => now, true);
    for (let sec = 1864; sec < 1900; sec++) {
      now = sec * 1000;
      for (let u = 0; u < 3; u++) rec.ingest(input(now, {
        type: 'chat', userId: `u${u}`, sourceId: `${sec}:${u}`, transportId: `${sec}:${u}`,
      }));
      rec.tick();
    }
    assert.equal(store.bookmarks('durable').length, 0);
    rec.ingest(input(now));
    assert.equal(store.bookmarks('durable')[0]!.signal, 'manual');
  } finally { store.close(); }
});

test('legacy settings become revision zero; reconfiguration is atomic and does not rewrite old bookmarks', () => {
  const store = new Store(':memory:'); let now = 1800000;
  const original = session({ rewardId: 'old-reward', warmupSeconds: 0, allowedLatenessSeconds: 0, activitySeconds: 3 });
  try {
    // A pre-revision persisted record, including a bookmark without settingsRevision.
    const detector = new Detector(original, () => now, undefined, true); store.create(original);
    const mark = input(now), changes = detector.ingest(mark);
    delete changes.bookmarks[0]!.settingsRevision;
    store.commit(detector, changes, now, mark);
    const historical = store.bookmarks(original.id)[0]!;
    now += 1;
    const desired = { ...original, startedAtMs: now, settings: settings({ ...original.settings, rewardId: 'new-reward' }) };
    const commit = store.commit.bind(store);
    store.commit = () => { throw new Error('disk unavailable during configuration recovery'); };
    assert.throws(() => new Recorder(store, desired, () => now, true), /disk unavailable/);
    assert.deepEqual(store.session(original.id).session, original);
    assert.equal(store.gaps(original.id).length, 0);
    store.commit = commit;
    const recovered = new Recorder(store, desired, () => now, true);
    assert.deepEqual(recovered.session.settingsHistory!.map(x => [x.revision, x.settings.rewardId]), [[0, 'old-reward'], [1, 'new-reward']]);
    assert.equal(recovered.session.startedAtMs, original.startedAtMs);
    assert.equal(recovered.ingest(input(now, { transportId: 'new-transport' })).disposition, 'duplicate');
    // New chat evidence is close enough to the old manual marker to correlate absent revision isolation.
    for (let sec = 1801; sec <= 1803; sec++) {
      now = sec * 1000;
      for (const user of ['a', 'b', 'c']) recovered.ingest(input(now, { type: 'chat', userId: user,
        sourceId: `${sec}:${user}`, transportId: `${sec}:${user}` }));
    }
    now = 1804000; recovered.tick();
    const bookmarks = store.bookmarks(original.id);
    assert.equal(bookmarks.length, 2);
    assert.deepEqual(bookmarks[0], historical);
    assert.equal(bookmarks[1]!.signal, 'chat'); assert.equal(bookmarks[1]!.settingsRevision, 1);
    const exported = JSON.parse(exportJson(recovered.session, bookmarks, store.gaps(original.id)));
    assert.equal(exported.session.settingsHistory[0].settings.rewardId, 'old-reward');
    assert.equal(exported.session.settingsHistory[1].settings.rewardId, 'new-reward');
  } finally { store.close(); }
});

test('recovery refuses a changed broadcast origin or identity', () => {
  const store = new Store(':memory:');
  try {
    new Recorder(store, session(), () => 1800000);
    for (const changed of [{ streamStartedAtMs: 1000 }, { streamId: 'different-stream' }])
      assert.throws(() => new Recorder(store, { ...session(), ...changed }, () => 1800000, true), /identity and origin/);
    assert.equal(store.session('durable').session.streamStartedAtMs, 0);
  } finally { store.close(); }
});
