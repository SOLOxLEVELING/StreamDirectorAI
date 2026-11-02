import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store, Recorder } from './store.ts';
import { exportCsv, exportJson } from './exports.ts';
import { settings } from './types.ts';
import type { Input, Session } from './types.ts';

export interface Fixture {
  name: string;
  streamStartedAtMs: number;
  startedAtMs: number;
  endAtMs: number;
  settings?: Parameters<typeof settings>[0];
  events: (Input | { type: 'gap'; startMs: number; receivedAtMs: number })[];
  expected: { signal: string; onsetMs: number; confirmedAtMs: number; tier: string }[];
}
export function replay(fixture: Fixture, store: Store, id = fixture.name) {
  if (fixture.events.some(e => e.receivedAtMs < fixture.startedAtMs || e.receivedAtMs > fixture.endAtMs) ||
      !Number.isSafeInteger(fixture.endAtMs) || fixture.endAtMs < fixture.startedAtMs)
    throw new Error('Invalid replay interval');
  let now = fixture.startedAtMs;
  const session: Session = { id, mode: 'simulated', streamId: `replay:${fixture.name}`,
    streamStartedAtMs: fixture.streamStartedAtMs, startedAtMs: now, settings: settings(fixture.settings) };
  const recorder = new Recorder(store, session, () => now);
  const events = [...fixture.events].sort((a, b) => a.receivedAtMs - b.receivedAtMs);
  let index = 0;
  // Explicit one-second ticks, including zero-message buckets, never advance via message arrival alone.
  for (let tick = Math.floor(now / 1000) * 1000; tick <= fixture.endAtMs; tick += 1000) {
    while (index < events.length && events[index]!.receivedAtMs <= tick) {
      const event = events[index++]!;
      now = event.receivedAtMs;
      if (event.type === 'gap') recorder.connectionGap(event.startMs, now);
      else recorder.ingest(event);
    }
    if (tick >= fixture.startedAtMs) { now = tick; recorder.tick(); }
  }
  while (index < events.length) {
    const event = events[index++]!;
    now = event.receivedAtMs;
    if (event.type === 'gap') recorder.connectionGap(event.startMs, now);
    else recorder.ingest(event);
  }
  now = fixture.endAtMs;
  recorder.tick();
  return { session: recorder.session, bookmarks: store.bookmarks(session.id), gaps: store.gaps(session.id), status: recorder.status() };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const fixturePath = resolve(process.argv[2] ?? 'test/fixtures/sustained-burst.json');
  const output = resolve(process.argv[3] ?? 'output/replay');
  mkdirSync(output, { recursive: true });
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;
  const store = new Store(join(output, 'replay.sqlite'));
  try {
    const result = replay(fixture, store, `${fixture.name}:${Date.now()}`);
    writeFileSync(join(output, 'bookmarks.csv'), exportCsv(result.bookmarks));
    writeFileSync(join(output, 'bookmarks.json'), exportJson(result.session, result.bookmarks, result.gaps));
    console.log(JSON.stringify({ mode: 'SIMULATED', fixture: fixture.name, bookmarks: result.bookmarks.length,
      output, editorCompatibility: 'unverified', status: result.status }, null, 2));
  } finally { store.close(); }
}
