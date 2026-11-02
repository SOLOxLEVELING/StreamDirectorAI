import { randomUUID } from 'node:crypto';
import { Recorder, Store } from './store.ts';
import { settings } from './types.ts';
import type { Input } from './types.ts';

export class Simulation {
  private store: Store;
  private recorder: Recorder | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private receipt: number | null = null;
  constructor(store: Store) { this.store = store; }
  private clock = () => this.receipt ?? Date.now();
  start() {
    this.close(); const now = Math.floor(Date.now() / 1000) * 1000;
    this.recorder = new Recorder(this.store, { id: `simulated:${randomUUID()}`, mode: 'simulated', streamId: 'SIMULATED-DEMO',
      streamStartedAtMs: now, startedAtMs: now, settings: settings({ warmupSeconds: 0, allowedLatenessSeconds: 0,
        leadInSeconds: 0, rewardId: 'demo-mark' }) }, this.clock);
    let count = 0;
    const step = () => {
      if (!this.recorder) return;
      if (count < 5) for (let i = 0; i < 3; i++) this.input('chat', { userId: `simulated-viewer-${i}` });
      this.recorder.tick(); count++;
      if (count >= 8) { if (this.timer) clearInterval(this.timer); this.timer = null; }
    };
    step(); this.timer = setInterval(step, 1000); this.timer.unref();
    return this.recorder.session.id;
  }
  platform(type: string) {
    if (!['raid', 'subscription', 'gift', 'resubscription', 'cheer', 'redemption', 'manual'].includes(type)) throw new Error('Invalid simulated event');
    if (!this.recorder) this.start();
    this.input(type as Input['type'], { amount: type === 'raid' ? 25 : type === 'gift' ? 5 : 100, isGift: false, rewardId: 'demo-mark' });
    return this.recorder!.session.id;
  }
  private input(type: Input['type'], fields: Partial<Input>) {
    const now = Date.now(), id = randomUUID(); this.receipt = now;
    try { this.recorder!.ingest({ type, ...fields, sourceId: id, transportId: id, sourceTimeMs: now, receivedAtMs: now }); }
    finally { this.receipt = null; }
  }
  close() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
