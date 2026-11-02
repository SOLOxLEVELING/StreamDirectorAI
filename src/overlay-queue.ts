import type { Alert } from './presentation.ts';

export class OverlayQueue {
  private queue: Alert[] = [];
  private seen = new Set<string>();
  private cursor = 0;
  private nextAt = 0;
  reset(cursor: number) { this.queue = []; this.seen.clear(); this.cursor = cursor; this.nextAt = 0; }
  accept(alert: Alert, now: number) {
    if (alert.sequence <= this.cursor || this.seen.has(alert.id) || now - alert.sentAtMs > 15000 || alert.sentAtMs > now + 2000) return;
    this.cursor = alert.sequence; this.seen.add(alert.id);
    while (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!);
    // A crowded animation queue can suppress visuals; it never reaches back into persistence.
    if (this.queue.length >= 6) {
      const corner = this.queue.findIndex(item => item.tier === 'corner');
      if (alert.tier !== 'banner' || corner < 0) return;
      this.queue.splice(corner, 1);
    }
    this.queue.push(structuredClone(alert));
  }
  next(now: number): Alert | null {
    this.queue = this.queue.filter(item => now - item.sentAtMs <= 15000);
    if (now < this.nextAt || !this.queue.length) return null;
    const banner = this.queue.findIndex(item => item.tier === 'banner');
    const [item] = this.queue.splice(banner < 0 ? 0 : banner, 1);
    this.nextAt = now + (item!.tier === 'banner' ? 4500 : 2800);
    return item!;
  }
  size() { return this.queue.length; }
}

// A suspended renderer must not consume the entire display lifetime before painting a frame.
// The 15-second wall-age limit still prevents an old alert from appearing after a long suspension.
export class ReactionPlayer {
  private queue = new OverlayQueue();
  private active: { alert: Alert; remainingMs: number } | null = null;
  private lastFrame: number | null = null;
  reset(cursor: number) { this.queue.reset(cursor); this.active = null; this.lastFrame = null; }
  accept(alert: Alert, now: number) { this.queue.accept(alert, now); }
  step(now: number): Alert | null {
    const elapsed = this.lastFrame === null ? 0 : Math.max(0, Math.min(100, now - this.lastFrame));
    this.lastFrame = now;
    if (this.active) {
      this.active.remainingMs -= elapsed;
      if (this.active.remainingMs <= 0 || now - this.active.alert.sentAtMs > 15000) this.active = null;
    }
    if (!this.active) {
      const alert = this.queue.next(now);
      if (alert) this.active = { alert, remainingMs: alert.tier === 'banner' ? 3800 : 2200 };
    }
    return this.active?.alert ?? null;
  }
}
