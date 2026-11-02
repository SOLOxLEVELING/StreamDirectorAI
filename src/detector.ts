import { parseInput, settings } from './types.ts';
import type { Bookmark, ChatEvidence, CoverageGap, Input, Session } from './types.ts';

interface Bucket { second: number; users: string[]; sourceIds: string[]; receiptMs: number; onsetMs: number; sourceTimeMs: number | null }
interface Candidate { threshold: number; baseline: number; streak: number; onsetMs: number; sourceTimeMs: number | null; minimumBucketRate: number }
interface Cheer { timeMs: number; receiptMs: number; bits: number; sourceId: string; sourceTimeMs: number | null }
interface State {
  nextEnd: number;
  warmFromMs: number;
  buckets: Bucket[];
  seen: string[];
  candidate: Candidate | null;
  latched: { threshold: number; confirmedEnd: number; below: number } | null;
  cheers: Cheer[];
  cheerBookmarkId: string | null;
  recent: Bookmark[];
  sequence: number;
  status: { rate: number; baseline: number; threshold: number; warm: boolean };
}
export interface Changes { bookmarks: Bookmark[]; gaps: CoverageGap[]; accepted: boolean; disposition: string }

// Pure synchronous domain engine: no networking, filesystem, model calls, or wall-clock reads.
export class Detector {
  readonly session: Session;
  private state: State;
  private seen: Set<string>;
  private clock: () => number;
  private externallyDeduplicated: boolean;
  private changes: Changes = { bookmarks: [], gaps: [], accepted: false, disposition: 'tick' };
  constructor(session: Session, clock: () => number, restored?: State, externallyDeduplicated = false) {
    this.clock = clock;
    this.externallyDeduplicated = externallyDeduplicated;
    this.session = structuredClone({ ...session, settings: settings(session.settings) });
    if (!session.id || !session.streamId || !Number.isSafeInteger(session.streamStartedAtMs) ||
        !Number.isSafeInteger(session.startedAtMs) || session.streamStartedAtMs > session.startedAtMs)
      throw new Error('A verified stream start and stream identity are required');
    const start = Math.ceil(session.startedAtMs / 1000);
    this.state = restored ? structuredClone(restored) : {
      nextEnd: start + 1, warmFromMs: session.startedAtMs, buckets: [], seen: [],
      candidate: null, latched: null, cheers: [], cheerBookmarkId: null, recent: [], sequence: 0,
      status: { rate: 0, baseline: 0, threshold: this.session.settings.minimumRate, warm: false },
    };
    this.seen = new Set(this.state.seen);
  }
  snapshot(): State { return structuredClone({ ...this.state, seen: [...this.seen] }); }
  status() { return structuredClone({ ...this.state.status, nextEvaluationSecond: this.state.nextEnd,
    bucketCount: this.state.buckets.length, dedupCount: this.seen.size, recentCount: this.state.recent.length,
    candidateValidationSeconds: Math.max(this.session.settings.activitySeconds, this.session.settings.sustainSeconds) }); }
  private begin() { this.changes = { bookmarks: [], gaps: [], accepted: false, disposition: 'tick' }; }
  private now() {
    const now = this.clock();
    if (!Number.isSafeInteger(now) || now < this.session.startedAtMs) throw new Error('Invalid clock');
    return now;
  }
  private publish(bookmark: Bookmark) {
    const index = this.state.recent.findIndex(b => b.id === bookmark.id);
    if (index < 0) this.state.recent.push(bookmark); else this.state.recent[index] = bookmark;
    const pending = this.changes.bookmarks.findIndex(b => b.id === bookmark.id);
    if (pending < 0) this.changes.bookmarks.push(structuredClone(bookmark));
    else this.changes.bookmarks[pending] = structuredClone(bookmark);
  }
  private gap(startMs: number, endMs: number, reason: string) {
    this.changes.gaps.push({ startMs, endMs, reason });
    this.state.warmFromMs = endMs;
    this.state.nextEnd = Math.ceil(endMs / 1000) + 1;
    this.state.buckets = [];
    this.state.candidate = null;
    this.state.latched = null;
    this.state.cheers = [];
    this.state.cheerBookmarkId = null;
    this.state.status = { rate: 0, baseline: 0, threshold: this.session.settings.minimumRate, warm: false };
  }
  connectionGap(startMs: number, endMs = this.now(), reason = 'connection lost'): Changes {
    this.begin();
    if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || endMs < startMs || endMs > this.now())
      throw new Error('Invalid coverage gap');
    this.gap(startMs, endMs, reason);
    return structuredClone(this.changes);
  }
  tick(): Changes { this.begin(); this.advance(this.now()); return structuredClone(this.changes); }
  ingest(raw: unknown): Changes {
    this.begin();
    const input = parseInput(raw);
    if (!input) { this.changes.disposition = 'malformed'; return this.changes; }
    const now = this.now();
    if (input.receivedAtMs !== now || (input.sourceTimeMs !== null && input.sourceTimeMs > now + 1000)) {
      this.changes.disposition = 'invalid timestamp'; return this.changes;
    }
    this.advance(now);
    if (!this.externallyDeduplicated) {
      const keys = [`transport:${input.transportId}`, `source:${input.type}:${input.sourceId}`];
      if (keys.some(key => this.seen.has(key))) { this.changes.disposition = 'duplicate'; return structuredClone(this.changes); }
      for (const key of keys) this.seen.add(key);
      // Service provides session-long durable dedup. Pure engine keeps only a bounded recent cache.
      while (this.seen.size > this.session.settings.dedupLimit) this.seen.delete(this.seen.values().next().value!);
    }
    this.changes.accepted = true;
    this.changes.disposition = 'accepted';
    if (input.type === 'chat') this.chat(input);
    else if (input.type === 'cheer') this.cheer(input);
    else if (input.type === 'subscription' && input.isGift) this.changes.disposition = 'gift recipient ignored';
    else if (input.type === 'redemption' && input.rewardId !== this.session.settings.rewardId) this.changes.disposition = 'unconfigured reward ignored';
    else this.platform(input);
    return structuredClone(this.changes);
  }
  private chat(input: Input) {
    const s = this.session.settings;
    // Identity is required for spam caps and distinct-chatter checks. Never invent anonymous identities.
    if (!input.userId || input.userId === s.broadcasterId || s.excludedUserIds.includes(input.userId)) {
      this.changes.disposition = 'excluded or unidentified chatter'; return;
    }
    const time = input.sourceTimeMs ?? input.receivedAtMs;
    const second = Math.floor(time / 1000);
    if (time < this.state.warmFromMs || second < this.state.nextEnd - 1) {
      this.changes.disposition = 'late chat excluded';
      this.changes.gaps.push({ startMs: time, endMs: input.receivedAtMs, reason: 'chat arrived after bucket finalized' });
      return;
    }
    let bucket = this.state.buckets.find(b => b.second === second);
    if (!bucket) { bucket = { second, users: [], sourceIds: [], receiptMs: 0, onsetMs: time, sourceTimeMs: input.sourceTimeMs }; this.state.buckets.push(bucket); }
    if (bucket.users.includes(input.userId)) return;
    if (bucket.users.length >= s.maxUsersPerBucket) {
      this.gap(time, input.receivedAtMs, 'chat bucket capacity exceeded'); return;
    }
    bucket.users.push(input.userId);
    bucket.sourceIds.push(input.sourceId);
    bucket.receiptMs = Math.max(bucket.receiptMs, input.receivedAtMs);
    if (time < bucket.onsetMs) { bucket.onsetMs = time; bucket.sourceTimeMs = input.sourceTimeMs; }
  }
  private advance(now: number) {
    const s = this.session.settings;
    const end = Math.floor(now / 1000) - s.allowedLatenessSeconds;
    // No unbounded catch-up loop after a suspended process. This is missing coverage, not idle chat.
    if (end - this.state.nextEnd > s.baselineSeconds + s.activitySeconds + s.warmupSeconds) {
      this.gap((this.state.nextEnd - 1) * 1000, now, 'evaluation clock gap'); return;
    }
    while (this.state.nextEnd <= end) {
      this.evaluate(this.state.nextEnd, now);
      this.state.nextEnd++;
    }
    const retainAfter = this.state.nextEnd - s.activitySeconds - s.baselineSeconds - 1;
    this.state.buckets = this.state.buckets.filter(b => b.second >= retainAfter);
    this.state.recent = this.state.recent.filter(b =>
      b.confirmedAtMs >= now - (s.correlationSeconds + s.cheerWindowSeconds + s.allowedLatenessSeconds + 1) * 1000);
  }
  private evaluate(end: number, now: number) {
    const s = this.session.settings;
    const activity = this.state.buckets.filter(b => b.second >= end - s.activitySeconds && b.second < end);
    const base = this.state.buckets.filter(b => b.second >= end - s.activitySeconds - s.baselineSeconds && b.second < end - s.activitySeconds);
    const rate = activity.reduce((n, b) => n + b.users.length, 0) / s.activitySeconds;
    const baseline = base.reduce((n, b) => n + b.users.length, 0) / s.baselineSeconds;
    // A consecutive bucket is one second, so this permits a full activity window and sustain run,
    // but cannot hold a startup threshold/onset indefinitely while another safeguard is missing.
    const validationWindowSeconds = Math.max(s.activitySeconds, s.sustainSeconds);
    // Also reject expired candidates in snapshots created by the earlier unbounded detector.
    if (this.state.candidate && this.state.candidate.streak >= validationWindowSeconds) this.state.candidate = null;
    const threshold = this.state.candidate?.threshold ?? this.state.latched?.threshold ?? Math.max(s.minimumRate, baseline * s.multiplier);
    const warm = end * 1000 - this.state.warmFromMs >= s.warmupSeconds * 1000;
    this.state.status = { rate, baseline, threshold, warm };
    if (!warm) return;
    if (this.state.latched) {
      const latch = this.state.latched;
      latch.below = rate < latch.threshold * s.rearmRatio ? latch.below + 1 : 0;
      if (end - latch.confirmedEnd >= s.cooldownSeconds && latch.below >= s.rearmSeconds) this.state.latched = null;
      return;
    }
    // Each evaluation visits a new completed [end-1, end) bucket exactly once.
    // Rolling windows overlap; they must never stand in for independent seconds of elevated activity.
    const bucket = activity.find(b => b.second === end - 1);
    const bucketRate = (bucket?.users.length ?? 0) / s.bucketSeconds;
    if (!bucket || bucketRate < threshold) { this.state.candidate = null; return; }
    const candidate = this.state.candidate ?? { threshold, baseline, streak: 0,
      onsetMs: bucket.onsetMs, sourceTimeMs: bucket.sourceTimeMs, minimumBucketRate: bucketRate };
    this.state.candidate = candidate;
    candidate.streak++;
    candidate.minimumBucketRate = Math.min(candidate.minimumBucketRate, bucketRate);
    const distinctChatters = new Set(activity.flatMap(b => b.users)).size;
    // Track the bucket sequence from its true start, even while the rolling window fills.
    // These additional safeguards must hold at confirmation; neither can waive the sequence requirement.
    if (candidate.streak < s.sustainSeconds || rate < threshold || distinctChatters < s.minimumChatters) {
      // The final validation bucket is inclusive: try every safeguard before discarding.
      // Do not reuse this bucket to restart a candidate with the obsolete threshold.
      if (candidate.streak >= validationWindowSeconds) {
        this.state.candidate = null;
        this.state.status.threshold = Math.max(s.minimumRate, baseline * s.multiplier);
      }
      return;
    }
    const sourceIds = [...new Set(activity.flatMap(b => b.sourceIds))];
    const evidence: ChatEvidence = { onsetMs: candidate.onsetMs, confirmedAtMs: now,
      rate, baseline: candidate.baseline, threshold, distinctChatters, sourceIds,
      qualifyingBuckets: candidate.streak, minimumBucketRate: candidate.minimumBucketRate, validationWindowSeconds };
    const nearby = this.state.recent.filter(b => b.signal !== 'chat' &&
      Math.abs(b.onsetMs - candidate.onsetMs) <= s.correlationSeconds * 1000)
      .sort((a, b) => Math.abs(a.onsetMs - candidate.onsetMs) - Math.abs(b.onsetMs - candidate.onsetMs) || a.id.localeCompare(b.id))[0];
    if (nearby) { nearby.chatEvidence.push(evidence); this.publish(nearby); }
    else {
      const bookmark = this.make('chat', candidate.onsetMs, now, candidate.sourceTimeMs,
        Math.max(...activity.map(b => b.receiptMs)), sourceIds, 'Consecutive completed chat buckets and rolling rate met threshold',
        { rate, baseline: candidate.baseline, threshold, distinctChatters,
          qualifyingBuckets: candidate.streak, minimumBucketRate: candidate.minimumBucketRate, validationWindowSeconds });
      bookmark.chatEvidence = [evidence];
      this.publish(bookmark);
    }
    this.state.latched = { threshold, confirmedEnd: end, below: 0 };
    this.state.candidate = null;
  }
  private make(signal: Bookmark['signal'], onsetMs: number, confirmedAtMs: number,
    sourceTimeMs: number | null, receivedAtMs: number, sourceIds: string[], reason: string,
    metrics: Record<string, number>): Bookmark {
    const s = this.session.settings;
    const detected = Math.max(0, (onsetMs - this.session.streamStartedAtMs) / 1000);
    const suggested = Math.max(0, detected - s.leadInSeconds);
    const captions: Record<Bookmark['signal'], string> = {
      chat: `Chat activity reached ${metrics.rate?.toFixed(1)} messages/s`,
      raid: `Raid arrived with ${metrics.amount} viewers`, subscription: 'New subscription',
      gift: `${metrics.amount} subscriptions gifted`, resubscription: 'Resubscription shared',
      cheer: `${metrics.bits} Bits cheered`, redemption: 'Mark This reward redeemed', manual: 'Streamer marked this moment',
    };
    return { id: `${this.session.id}:${++this.state.sequence}`, sessionId: this.session.id,
      settingsRevision: this.session.settingsHistory?.at(-1)?.revision ?? 0,
      streamId: this.session.streamId, signal, tier: signal === 'chat' ? 'corner' : 'banner',
      sourceTimeMs, receivedAtMs, onsetMs, confirmedAtMs, detectedOffsetSeconds: detected,
      suggestedOffsetSeconds: suggested, editorOffsetSeconds: Math.max(0, suggested + s.alignmentSeconds),
      reason, metrics, sourceIds: [...sourceIds], chatEvidence: [], caption: captions[signal], captionStatus: 'disabled' };
  }
  private platform(input: Input) {
    const time = input.sourceTimeMs ?? input.receivedAtMs;
    const bookmark = this.make(input.type, time, input.receivedAtMs, input.sourceTimeMs,
      input.receivedAtMs, [input.sourceId], `Confirmed ${input.type} event`, input.amount === undefined ? {} : { amount: input.amount });
    // If the chat bookmark was already saved, retain it and cross-reference evidence. Never erase history.
    const chat = this.state.recent.filter(b => b.signal === 'chat' && Math.abs(b.onsetMs - time) <= this.session.settings.correlationSeconds * 1000)
      .sort((a, b) => Math.abs(a.onsetMs - time) - Math.abs(b.onsetMs - time))[0];
    if (chat) bookmark.chatEvidence = structuredClone(chat.chatEvidence);
    this.publish(bookmark);
  }
  private cheer(input: Input) {
    const s = this.session.settings;
    // Arrival-time windows keep delayed/out-of-order platform events deterministic; source time is preserved.
    const now = input.receivedAtMs;
    if (this.state.cheerBookmarkId) {
      const bookmark = this.state.recent.find(b => b.id === this.state.cheerBookmarkId);
      if (bookmark && now < bookmark.metrics.windowStartedAtMs! + s.cheerWindowSeconds * 1000) {
        bookmark.metrics.bits = bookmark.metrics.bits! + input.amount!;
        bookmark.sourceIds.push(input.sourceId);
        bookmark.caption = `${bookmark.metrics.bits} Bits cheered`;
        this.publish(bookmark); return;
      }
      this.state.cheerBookmarkId = null;
      this.state.cheers = [];
    }
    this.state.cheers = this.state.cheers.filter(e => e.receiptMs > now - s.cheerWindowSeconds * 1000);
    this.state.cheers.push({ timeMs: input.sourceTimeMs ?? now, receiptMs: now, bits: input.amount!,
      sourceId: input.sourceId, sourceTimeMs: input.sourceTimeMs });
    const bits = this.state.cheers.reduce((n, e) => n + e.bits, 0);
    if (bits < s.cheerThreshold) return;
    const first = this.state.cheers[0]!;
    const bookmark = this.make('cheer', Math.min(...this.state.cheers.map(e => e.timeMs)), now,
      first.sourceTimeMs, first.receiptMs, this.state.cheers.map(e => e.sourceId),
      `${s.cheerThreshold} Bits threshold crossed in ${s.cheerWindowSeconds}s window`,
      { bits, threshold: s.cheerThreshold, windowStartedAtMs: first.receiptMs });
    this.state.cheerBookmarkId = bookmark.id;
    this.publish(bookmark);
    this.state.cheers = [];
  }
}
