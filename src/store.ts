import { DatabaseSync } from 'node:sqlite';
import { Detector } from './detector.ts';
import type { Changes } from './detector.ts';
import { parseInput, settings } from './types.ts';
import type { Bookmark, CoverageGap, Session } from './types.ts';

export interface StoreEvent { sessionId: string; bookmarks: { bookmark: Bookmark; created: boolean }[]; gaps: CoverageGap[] }

export class Store {
  private db: DatabaseSync;
  private observers = new Set<(event: StoreEvent) => void>();
  observerFailures = 0;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, record TEXT NOT NULL, state TEXT, updated_ms INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS bookmarks(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS source_ids(session_id TEXT NOT NULL REFERENCES sessions(id), kind TEXT NOT NULL, value TEXT NOT NULL,
        PRIMARY KEY(session_id,kind,value));
      CREATE TABLE IF NOT EXISTS coverage_gaps(id INTEGER PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), record TEXT NOT NULL);`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS integration_events(id INTEGER PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS app_configuration(id TEXT PRIMARY KEY,record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS caption_jobs(bookmark_id TEXT PRIMARY KEY REFERENCES bookmarks(id),session_id TEXT NOT NULL,
        due_ms INTEGER NOT NULL,status TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS bookmarks_session ON bookmarks(session_id);`);
  }
  hasSession(id: string) { return Boolean(this.db.prepare('SELECT 1 FROM sessions WHERE id=?').get(id)); }
  subscribe(observer: (event: StoreEvent) => void) { this.observers.add(observer); return () => { this.observers.delete(observer); }; }
  private notify(event: StoreEvent) {
    for (const observer of this.observers) try { observer(structuredClone(event)); } catch { this.observerFailures++; }
  }
  bookmark(id: string): Bookmark | null {
    const row = this.db.prepare('SELECT record FROM bookmarks WHERE id=?').get(id);
    return row ? JSON.parse(String(row.record)) : null;
  }
  setCaption(id: string, caption: string | null, status: Bookmark['captionStatus']) {
    // This is the caption worker's only write surface. Evidence and routing fields are not accepted.
    this.db.prepare("UPDATE bookmarks SET record=json_set(record,'$.caption',COALESCE(?,json_extract(record,'$.caption')),'$.captionStatus',?) WHERE id=?")
      .run(caption, status, id);
    const bookmark = this.bookmark(id);
    if (bookmark) this.notify({ sessionId: bookmark.sessionId, bookmarks: [{ bookmark, created: false }], gaps: [] });
  }
  enqueueCaption(id: string, dueMs: number, budget: number) {
    const bookmark = this.bookmark(id); if (!bookmark) return;
    const count = Number(this.db.prepare('SELECT COUNT(*) AS count FROM caption_jobs WHERE session_id=?').get(bookmark.sessionId)!.count);
    if (count >= budget) return;
    const result = this.db.prepare("INSERT OR IGNORE INTO caption_jobs(bookmark_id,session_id,due_ms,status) VALUES(?,?,?,'queued')")
      .run(id, bookmark.sessionId, dueMs);
    if (result.changes) this.setCaption(id, null, 'pending');
  }
  recoverCaptionJobs(enabled: boolean) {
    const rows = this.db.prepare(enabled ? "SELECT bookmark_id FROM caption_jobs WHERE status='running'" :
      "SELECT bookmark_id FROM caption_jobs WHERE status IN ('queued','running')").all();
    for (const row of rows) { this.finishCaption(String(row.bookmark_id), null, 'failed'); }
  }
  claimCaption(now: number): string | null {
    const row = this.db.prepare("SELECT bookmark_id FROM caption_jobs WHERE status='queued' AND due_ms<=? ORDER BY due_ms,bookmark_id LIMIT 1").get(now);
    if (!row) return null;
    this.db.prepare("UPDATE caption_jobs SET status='running' WHERE bookmark_id=? AND status='queued'").run(row.bookmark_id);
    return String(row.bookmark_id);
  }
  finishCaption(id: string, caption: string | null, status: 'complete' | 'failed') {
    this.db.prepare('UPDATE caption_jobs SET status=? WHERE bookmark_id=?').run(status, id);
    this.setCaption(id, caption, status);
  }
  captionUsage(sessionId: string) { return Number(this.db.prepare('SELECT COUNT(*) AS count FROM caption_jobs WHERE session_id=?').get(sessionId)!.count); }
  bookmarkPage(sessionId: string, limit = 200): { total: number; bookmarks: Bookmark[] } {
    const total = Number(this.db.prepare('SELECT COUNT(*) AS count FROM bookmarks WHERE session_id=?').get(sessionId)!.count);
    const bookmarks = this.db.prepare("SELECT record FROM bookmarks WHERE session_id=? ORDER BY json_extract(record,'$.onsetMs') DESC,id DESC LIMIT ?")
      .all(sessionId, Math.min(200, Math.max(1, limit))).map(row => JSON.parse(String(row.record)) as Bookmark).reverse();
    return { total, bookmarks };
  }
  appSettings(): Record<string, number> {
    const row = this.db.prepare("SELECT record FROM app_configuration WHERE id='detector'").get();
    return row ? JSON.parse(String(row.record)) : {};
  }
  saveAppSettings(value: Record<string, number>) {
    this.db.prepare("INSERT INTO app_configuration(id,record) VALUES('detector',?) ON CONFLICT(id) DO UPDATE SET record=excluded.record").run(JSON.stringify(value));
  }
  sessions(): Session[] { return this.db.prepare('SELECT record FROM sessions ORDER BY updated_ms DESC LIMIT 100').all().map(row => JSON.parse(String(row.record))); }
  integrationEvent(record: Record<string, unknown>) { this.db.prepare('INSERT INTO integration_events(record) VALUES(?)').run(JSON.stringify(record)); }
  integrationEvents(limit = 100) { return this.db.prepare('SELECT record FROM integration_events ORDER BY id DESC LIMIT ?').all(limit).map(row => JSON.parse(String(row.record))); }
  create(session: Session) {
    this.db.prepare('INSERT INTO sessions(id,record,updated_ms) VALUES(?,?,?)')
      .run(session.id, JSON.stringify(session), session.startedAtMs);
  }
  session(id: string): { session: Session; state: ReturnType<Detector['snapshot']> | undefined; updatedMs: number } {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
    if (!row) throw new Error(`Unknown session: ${id}`);
    return { session: JSON.parse(String(row.record)), state: row.state ? JSON.parse(String(row.state)) : undefined,
      updatedMs: Number(row.updated_ms) };
  }
  seen(sessionId: string, kind: string, value: string) {
    return Boolean(this.db.prepare('SELECT 1 FROM source_ids WHERE session_id=? AND kind=? AND value=?').get(sessionId, kind, value));
  }
  commit(detector: Detector, changes: Changes, now: number, input?: ReturnType<typeof parseInput>) {
    const id = detector.session.id;
    const committed: StoreEvent = { sessionId: id, bookmarks: [], gaps: changes.gaps };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const bookmark of changes.bookmarks) {
        const existing = this.bookmark(bookmark.id);
        const saved = existing ? { ...bookmark,
          caption: existing.captionStatus === 'complete' ? existing.caption : bookmark.caption,
          captionStatus: existing.captionStatus === 'disabled' ? bookmark.captionStatus : existing.captionStatus } : bookmark;
        this.db.prepare('INSERT INTO bookmarks(id,session_id,record) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record')
          .run(bookmark.id, id, JSON.stringify(saved));
        committed.bookmarks.push({ bookmark: saved, created: !existing });
      }
      for (const gap of changes.gaps)
        this.db.prepare('INSERT INTO coverage_gaps(session_id,record) VALUES(?,?)').run(id, JSON.stringify(gap));
      if (input && changes.accepted) {
        const insert = this.db.prepare('INSERT OR IGNORE INTO source_ids(session_id,kind,value) VALUES(?,?,?)');
        insert.run(id, 'transport', input.transportId);
        insert.run(id, input.type, input.sourceId);
      }
      this.db.prepare('UPDATE sessions SET record=?,state=?,updated_ms=? WHERE id=?')
        .run(JSON.stringify(detector.session), JSON.stringify(detector.snapshot()), now, id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    // Presentation is strictly after COMMIT and cannot roll back successful persistence.
    if (committed.bookmarks.length || committed.gaps.length) this.notify(committed);
  }
  bookmarks(sessionId: string): Bookmark[] {
    return this.db.prepare('SELECT record FROM bookmarks WHERE session_id=?').all(sessionId)
      .map(row => JSON.parse(String(row.record)) as Bookmark)
      .sort((a, b) => a.onsetMs - b.onsetMs || a.id.localeCompare(b.id));
  }
  gaps(sessionId: string): CoverageGap[] {
    return this.db.prepare('SELECT record FROM coverage_gaps WHERE session_id=? ORDER BY id').all(sessionId)
      .map(row => JSON.parse(String(row.record)) as CoverageGap);
  }
  gapPage(sessionId: string): CoverageGap[] {
    return this.db.prepare('SELECT record FROM coverage_gaps WHERE session_id=? ORDER BY id DESC LIMIT 100').all(sessionId)
      .map(row => JSON.parse(String(row.record)) as CoverageGap).reverse();
  }
  close() { this.db.close(); }
}

// Only return changes to callers after all bookmarks AND the matching detector state are durable.
export class Recorder {
  private detector: Detector;
  private store: Store;
  private clock: () => number;
  constructor(store: Store, session: Session, clock: () => number, recover = false, recoveryReason = 'process restart') {
    this.store = store;
    this.clock = clock;
    if (recover) {
      const saved = store.session(session.id);
      if (saved.session.streamId !== session.streamId || saved.session.mode !== session.mode ||
          saved.session.streamStartedAtMs !== session.streamStartedAtMs ||
          saved.session.settings.broadcasterId !== session.settings.broadcasterId)
        throw new Error('Recovered session must retain its broadcaster, stream identity and origin');
      const active = settings(session.settings);
      const changed = JSON.stringify(saved.session.settings) !== JSON.stringify(active);
      const history = structuredClone(saved.session.settingsHistory ?? [
        { revision: 0, effectiveFromMs: saved.session.startedAtMs, settings: saved.session.settings },
      ]);
      if (changed) history.push({ revision: history.at(-1)!.revision + 1, effectiveFromMs: clock(), settings: active });
      // Preserve sequence and durable source IDs, but never correlate across configuration revisions.
      const state = saved.state && structuredClone(saved.state);
      if (changed && state) state.recent = [];
      this.detector = new Detector({ ...saved.session, settings: active, settingsHistory: history }, clock, state, true);
      this.persist(() => this.detector.connectionGap(saved.updatedMs, clock(), changed ?
        `${recoveryReason}; detector settings changed; coverage unverified` : `${recoveryReason}; coverage unverified`));
    } else {
      this.detector = new Detector({ ...session, settingsHistory: [
        { revision: 0, effectiveFromMs: session.startedAtMs, settings: settings(session.settings) },
      ] }, clock, undefined, true);
      store.create(this.detector.session);
      this.persist(() => this.detector.tick());
    }
  }
  get session() { return structuredClone(this.detector.session); }
  status() { return this.detector.status(); }
  private persist(operation: () => Changes, input?: ReturnType<typeof parseInput>) {
    const before = this.detector.snapshot();
    try {
      const changes = operation();
      this.store.commit(this.detector, changes, this.clock(), input);
      return changes;
    } catch (error) { this.detector = new Detector(this.detector.session, this.clock, before, true); throw error; }
  }
  ingest(raw: unknown): Changes {
    const input = parseInput(raw);
    if (input && (this.store.seen(this.session.id, 'transport', input.transportId) || this.store.seen(this.session.id, input.type, input.sourceId))) {
      const changes = this.tick();
      return { ...changes, accepted: false, disposition: 'duplicate' };
    }
    return this.persist(() => this.detector.ingest(raw), input);
  }
  tick() { return this.persist(() => this.detector.tick()); }
  connectionGap(startMs: number, endMs = this.clock(), reason?: string) {
    return this.persist(() => this.detector.connectionGap(startMs, endMs, reason));
  }
}
