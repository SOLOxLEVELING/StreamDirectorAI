interface SessionSnapshot { selectedSession: { id: string } | null }

// Abort saves work; the generation checks also fence fetchers/body reads that ignore abort.
export class SnapshotRequests<T extends SessionSnapshot> {
  private selectedId = '';
  private generation = 0;
  private sequence = 0;
  private abort: AbortController | null = null;
  private current: T | null = null;
  private fetchSnapshot: (id: string, signal: AbortSignal) => Promise<T>;
  private commit: (snapshot: T) => void;
  constructor(fetchSnapshot: (id: string, signal: AbortSignal) => Promise<T>, commit: (snapshot: T) => void) {
    this.fetchSnapshot = fetchSnapshot; this.commit = commit;
  }
  get selectionVersion() { return this.generation; }
  select(id: string) {
    this.selectedId = id; this.generation++; this.current = null; this.abort?.abort();
  }
  async load() {
    const id = this.selectedId, generation = this.generation, sequence = ++this.sequence;
    this.abort?.abort(); const abort = new AbortController(); this.abort = abort;
    const isCurrent = () => generation === this.generation && sequence === this.sequence;
    try {
      const snapshot = await this.fetchSnapshot(id, abort.signal);
      if (!isCurrent()) return false;
      if (id && snapshot.selectedSession?.id !== id) throw new Error('Workspace returned a different session; retry selection.');
      this.selectedId = snapshot.selectedSession?.id ?? '';
      this.current = snapshot; this.commit(snapshot); return true;
    } catch (error) {
      if (!isCurrent()) return false;
      throw error;
    } finally { if (this.abort === abort) this.abort = null; }
  }
  exportSessionId(snapshot: T | null) {
    return snapshot === this.current && snapshot?.selectedSession?.id === this.selectedId ? this.selectedId : null;
  }
  close() { this.generation++; this.current = null; this.abort?.abort(); }
}
