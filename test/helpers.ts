import { Detector } from '../src/detector.ts';
import { settings } from '../src/types.ts';
import type { Input, Session, Settings, Bookmark } from '../src/types.ts';
export function harness(overrides: Partial<Settings> = {}, start = 0) {
  let now = start;
  let seq = 0;
  const session: Session = { id: 'test', mode: 'simulated', streamId: 'stream', startedAtMs: start,
    streamStartedAtMs: 0, settings: settings(overrides) };
  const engine = new Detector(session, () => now);
  const bookmarks = new Map<string, Bookmark>();
  const save = (result: ReturnType<Detector['ingest']>) => {
    for (const b of result.bookmarks) bookmarks.set(b.id, b);
    return result;
  };
  const event = (type: Input['type'], at: number, extras: Partial<Input> = {}) => {
    now = at;
    return save(engine.ingest({ type, receivedAtMs: at, sourceTimeMs: at,
      transportId: `t${++seq}`, sourceId: `s${seq}`, ...extras }));
  };
  return { engine, session, bookmarks, event,
    at(time: number) { now = time; return save(engine.tick()); },
    advance(from: number, to: number) { for (let t = from; t <= to; t += 1000) { now = t; save(engine.tick()); } },
    traffic(fromSecond: number, toSecond: number, usersPerSecond: number) {
      for (let sec = fromSecond; sec <= toSecond; sec++) {
        for (let u = 0; u < usersPerSecond; u++) event('chat', sec * 1000, { userId: `user${u}` });
        now = sec * 1000; save(engine.tick());
      }
    },
    clock: () => now,
  };
}
