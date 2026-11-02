import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { StoreEvent } from './store.ts';
import type { Bookmark } from './types.ts';

export interface Alert { id: string; caption: string; signal: Bookmark['signal']; tier: Bookmark['tier']; mode: 'live' | 'simulated'; sentAtMs: number; sequence: number }
interface Client { response: ServerResponse; scope: 'dashboard' | 'live' | 'simulated' }
// No history/replay buffer: a reconnect receives a new cursor, never historical animations.
export class EventHub {
  private clients = new Set<Client>();
  private sequence = 0;
  private epoch = randomUUID();
  constructor(privateClock: () => number = Date.now) { this.clock = privateClock; }
  private clock: () => number;
  add(response: ServerResponse, scope: Client['scope']) {
    if (this.clients.size >= 12) { response.writeHead(503); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const client = { response, scope }; this.clients.add(client);
    response.on('close', () => this.clients.delete(client));
    this.send(client, 'ready', { epoch: this.epoch, cursor: this.sequence, serverTimeMs: this.clock() });
  }
  private send(client: Client, event: string, data: unknown) {
    try {
      if (client.response.destroyed || client.response.writableLength > 65536 ||
          !client.response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) {
        client.response.destroy(); this.clients.delete(client);
      }
    } catch { client.response.destroy(); this.clients.delete(client); }
  }
  status(data: unknown) { for (const client of this.clients) if (client.scope === 'dashboard') this.send(client, 'status', data); }
  changes(event: StoreEvent, mode: 'live' | 'simulated') {
    for (const client of this.clients) if (client.scope === 'dashboard') this.send(client, 'changes', event);
    for (const { bookmark, created } of event.bookmarks) if (created) {
      const alert: Alert = { id: bookmark.id, caption: bookmark.caption, signal: bookmark.signal,
        tier: bookmark.tier, mode, sentAtMs: this.clock(), sequence: ++this.sequence };
      for (const client of this.clients) if (client.scope === mode) this.send(client, 'alert', alert);
    }
  }
  heartbeat() { for (const client of this.clients) this.send(client, 'heartbeat', { serverTimeMs: this.clock() }); }
  close() { for (const client of this.clients) client.response.end(); this.clients.clear(); }
  count() { return this.clients.size; }
}
