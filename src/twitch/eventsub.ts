import { envelope, object, string } from './schema.ts';
import type { Envelope } from './schema.ts';

export interface Socket {
  addEventListener(type: string, listener: (event: any) => void): void;
  close(): void;
}
interface Connection { socket: Socket; lastMessageMs: number; timeoutMs: number; welcomed: boolean; migration: boolean; retired: boolean }
export interface EventSubOptions {
  subscribe: (sessionId: string) => Promise<void>;
  notification: (message: Envelope, receivedAtMs: number) => void;
  gap: (startMs: number, endMs: number, reason: string) => void;
  revocation: (type: string, reason: string) => void;
  status: (status: string) => void;
  failure?: (operation:'notification'|'coverage'|'subscription',error:unknown)=>void;
  clock?: () => number;
  socketFactory?: (url: string) => Socket;
  endpoint?: string;
  simulated?: boolean;
}

export class EventSubClient {
  private options: EventSubOptions;
  private current: Connection | null = null;
  private pending: Connection | null = null;
  private running = false;
  private gapStart: number | null = null;
  private retryAt = 0;
  private backoffMs = 1000;
  private clock: () => number;
  private seenControl = new Set<string>();
  constructor(options: EventSubOptions) { this.options = options; this.clock = options.clock ?? Date.now; }
  private report(operation:'notification'|'coverage'|'subscription',error:unknown){try{this.options.failure?.(operation,error);}catch{}}
  private status(value:string){try{this.options.status(value);}catch(error){this.report('notification',error);}}
  private gap(start:number,end:number,reason:string){try{this.options.gap(start,end,reason);}catch(error){this.report('coverage',error);}}
  private close(connection:Connection){try{connection.socket.close();}catch(error){this.report('notification',error);}}
  private safeUrl(url: string) {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.hash) throw new Error('Invalid EventSub URL');
    const twitch = parsed.protocol === 'wss:' && parsed.hostname === 'eventsub.wss.twitch.tv' && (!parsed.port || parsed.port === '443');
    const localSimulation = this.options.simulated && parsed.protocol === 'ws:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname);
    if (!twitch && !localSimulation) throw new Error('Untrusted EventSub URL');
    return url;
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.open(this.options.endpoint ?? 'wss://eventsub.wss.twitch.tv/ws', false);
  }
  stop() {
    this.running = false;
    for (const connection of [this.current, this.pending]) if (connection) { connection.retired = true; this.close(connection); }
    this.current = null; this.pending = null;
  }
  interruptForVerification(seconds = 8) {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 30 || !this.current) throw new Error('Active EventSub connection required');
    this.fail(this.current, 'controlled verification interruption');
    this.retryAt = this.clock() + seconds * 1000;
  }
  private open(url: string, migration: boolean) {
    if (!this.running) return;
    try {
      const socket = (this.options.socketFactory ?? (url => new WebSocket(url)))(this.safeUrl(url));
      const connection: Connection = { socket, lastMessageMs: this.clock(), timeoutMs: 15000, welcomed: false, migration, retired: false };
      if (migration) this.pending = connection; else this.current = connection;
      socket.addEventListener('message', event => { void this.message(connection, event.data).catch(error => {this.report('notification',error);this.fail(connection, 'EventSub processing failed');}); });
      socket.addEventListener('close', () => this.fail(connection, 'EventSub disconnected unexpectedly'));
      socket.addEventListener('error', () => this.fail(connection, 'EventSub network error'));
      this.status(migration ? 'reconnecting with Twitch handover' : 'connecting');
    } catch { this.retryAt = this.clock() + this.backoffMs; this.status('connection failed; retry pending'); }
  }
  private fail(connection: Connection, reason: string) {
    if (connection.retired || !this.running) return;
    connection.retired = true; this.close(connection);
    if (this.pending === connection) this.pending = null;
    else if (this.current === connection) this.current = null;
    this.gapStart ??= connection.lastMessageMs;
    // If either side fails mid-handover, establish a fresh session and resubscribe conservatively.
    for (const other of [this.current, this.pending]) if (other) { other.retired = true; this.close(other); }
    this.current = null; this.pending = null;
    this.retryAt = this.clock() + this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 30000);
    // Recovery state is established before any fallible observer/persistence callback.
    this.gap(this.gapStart, this.clock(), `${reason}; coverage incomplete`);
    this.status(reason);
  }
  tick() {
    if (!this.running) return;
    for (const connection of [this.current, this.pending])
      if (connection && this.clock() - connection.lastMessageMs > connection.timeoutMs) this.fail(connection, 'EventSub keepalive/welcome timeout');
    if (!this.current && this.clock() >= this.retryAt) this.open(this.options.endpoint ?? 'wss://eventsub.wss.twitch.tv/ws', false);
  }
  private async message(connection: Connection, raw: unknown) {
    if (connection.retired || !this.running || typeof raw !== 'string' || Buffer.byteLength(raw) > 1048576) return;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return; }
    const message = envelope(parsed);
    if (!message) return;
    const now = this.clock();
    connection.lastMessageMs = now;
    const type = message.metadata.message_type;
    if (type === 'session_welcome') {
      if (connection.welcomed) return;
      const session = object(message.payload.session);
      if (!string(session?.id) || !Number.isSafeInteger(session.keepalive_timeout_seconds) || Number(session.keepalive_timeout_seconds) < 1) return;
      connection.welcomed = true;
      connection.timeoutMs = Number(session.keepalive_timeout_seconds) * 1000;
      if (connection.migration) {
        const old = this.current;
        this.current = connection; this.pending = null;
        if (old) { old.retired = true; this.close(old); }
      } else {
        try{await this.options.subscribe(session.id);}catch(error){if(connection.retired||!this.running)return;this.report('subscription',error);this.fail(connection,'EventSub subscription setup failed');return;}
        if (connection.retired || !this.running) return;
      }
      if (this.gapStart !== null) { this.gap(this.gapStart, this.clock(), 'unexpected EventSub gap; missed events are not replayed'); this.gapStart = null; }
      this.backoffMs = 1000;
      this.status('connected');
    } else if (!connection.welcomed) return;
    else if (type === 'notification') this.options.notification(message, now);
    else if (type === 'session_reconnect') {
      const id = String(message.metadata.message_id);
      if (this.seenControl.has(id) || this.pending || this.current !== connection) return;
      this.seenControl.add(id);
      while (this.seenControl.size > 1000) this.seenControl.delete(this.seenControl.values().next().value!);
      const session = object(message.payload.session);
      if (!string(session?.reconnect_url)) { this.fail(connection, 'invalid reconnect URL'); return; }
      try { this.safeUrl(session.reconnect_url); } catch { this.fail(connection, 'untrusted reconnect URL'); return; }
      // Twitch requires brief overlap until the replacement welcome; never duplicate subscriptions.
      this.open(session.reconnect_url, true);
    } else if (type === 'revocation') {
      const subscription = object(message.payload.subscription);
      if (string(subscription?.type) && string(subscription.status)) this.options.revocation(subscription.type, subscription.status);
    }
  }
}
