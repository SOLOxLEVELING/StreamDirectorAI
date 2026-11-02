import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers.ts';
import { Detector } from '../src/detector.ts';
import { settings, parseInput } from '../src/types.ts';

test('steady traffic and idle chat do not create bookmarks; zero buckets are counted', () => {
  const h = harness();
  h.traffic(0, 200, 2);
  assert.equal(h.bookmarks.size, 0);
  assert.equal(h.engine.status().baseline, 2);
  h.advance(201000, 280000);
  assert.equal(h.engine.status().baseline, 0);
  assert.equal(h.engine.status().rate, 0);
  assert.equal(h.bookmarks.size, 0);
});
test('zero baseline, warmup, qualifying burst onset and later confirmation', () => {
  const h = harness();
  h.advance(0, 59000);
  h.traffic(60, 70, 3);
  h.advance(71000, 80000);
  const [b] = [...h.bookmarks.values()];
  assert.equal(h.bookmarks.size, 1);
  assert.equal(b!.signal, 'chat');
  assert.equal(b!.onsetMs, 60000);
  assert.equal(b!.confirmedAtMs, 65000);
  assert.equal(b!.metrics.threshold, 1);
  assert.equal(b!.metrics.baseline, 0);
  assert.equal(b!.metrics.qualifyingBuckets, 3);
  assert.equal(b!.metrics.minimumBucketRate, 3);
  assert.equal(b!.tier, 'corner');
  assert.equal(b!.detectedOffsetSeconds, 60);
  assert.equal(b!.suggestedOffsetSeconds, 45);
});
test('no chat-only confirmation during warmup', () => {
  const h = harness();
  h.traffic(0, 30, 30);
  assert.equal(h.bookmarks.size, 0);
  assert.equal(h.engine.status().warm, false);
});
test('small one-second noise does not pass five-second floor', () => {
  const h = harness(); h.advance(0, 59000);
  h.traffic(60, 60, 3); h.advance(61000, 80000);
  assert.equal(h.bookmarks.size, 0);
});
for (const messages of [5, 30]) {
  test(`${messages}-message single-second impulse followed by silence creates no bookmark`, () => {
    const h = harness(); h.advance(0, 59000);
    h.traffic(60, 60, messages); h.advance(61000, 100000);
    assert.equal(h.bookmarks.size, 0);
  });
  test(`${messages}-message impulse surrounded by normal baseline traffic creates no bookmark`, () => {
    const h = harness(); h.traffic(0, 99, 2);
    h.traffic(100, 100, messages); h.traffic(101, 150, 2); h.advance(151000, 170000);
    assert.equal(h.bookmarks.size, 0);
  });
}
test('ordinary traffic preceding a sustained burst is excluded from recorded onset, not lead-in', () => {
  const h = harness(); h.traffic(0, 99, 2); h.traffic(100, 130, 10); h.advance(131000, 145000);
  assert.equal(h.bookmarks.size, 1);
  const b = [...h.bookmarks.values()][0]!;
  assert.equal(b.onsetMs, 100000);
  assert.equal(b.sourceTimeMs, 100000);
  assert.equal(b.confirmedAtMs, 105000);
  assert.equal(b.metrics.threshold, 6);
  assert.equal(b.detectedOffsetSeconds, 100);
  assert.equal(b.suggestedOffsetSeconds, 85);
  assert.equal(b.editorOffsetSeconds, 85);
});
test('three distinct completed buckets are required; repeated ticks cannot count an unfinished bucket', () => {
  const h = harness(); h.advance(0, 59000); h.traffic(60, 62, 3);
  for (let i = 0; i < 10; i++) h.at(64000);
  h.at(64999);
  assert.equal(h.bookmarks.size, 0);
  h.at(65000);
  assert.equal(h.bookmarks.size, 1);
});
test('a quiet bucket breaks the elevated sequence even when the rolling rate stays high', () => {
  const h = harness(); h.advance(0, 59000); h.traffic(60, 61, 30);
  h.at(65000);
  assert.ok(h.engine.status().rate >= 1);
  assert.equal(h.bookmarks.size, 0);
  h.traffic(66, 68, 10); h.at(71000);
  assert.equal(h.bookmarks.size, 1);
  assert.equal([...h.bookmarks.values()][0]!.onsetMs, 66000);
});
test('a nonzero below-threshold bucket resets the sequence and its onset', () => {
  const h = harness(); h.traffic(0, 99, 2); h.traffic(100, 101, 30); h.traffic(102, 102, 2);
  h.at(105000);
  assert.ok(h.engine.status().rate >= 6);
  assert.equal(h.bookmarks.size, 0);
  h.traffic(105, 107, 20); h.at(110000);
  assert.equal(h.bookmarks.size, 1);
  const b = [...h.bookmarks.values()][0]!;
  assert.equal(b.onsetMs, 105000);
  assert.equal(b.metrics.qualifyingBuckets, 3);
});
test('three elevated buckets cannot bypass the rolling-rate safeguard', () => {
  const h = harness(); h.advance(0, 59000);
  // Three completed buckets each meet 1 msg/s, but 3/5 msg/s is below the rolling floor.
  for (let sec = 60; sec <= 62; sec++) h.event('chat', sec * 1000, { userId: `u${sec}` });
  h.advance(63000, 80000);
  assert.equal(h.bookmarks.size, 0);
});
test('three elevated buckets cannot bypass the distinct-chatter safeguard', () => {
  const h = harness(); h.advance(0, 59000); h.traffic(60, 80, 2); h.advance(81000, 90000);
  assert.equal(h.bookmarks.size, 0);
});
test('two regular chatters for two minutes followed by one additional message cannot revive a stale candidate', () => {
  const h = harness(); h.advance(0, 59000); h.traffic(60, 179, 2);
  h.event('chat', 180000, { userId: 'additional-chatter' });
  h.traffic(180, 190, 2); h.advance(191000, 200000);
  assert.equal(h.bookmarks.size, 0);
  assert.equal(h.engine.snapshot().candidate, null);
});
test('a genuine surge after a stalled candidate expires uses the new baseline and new onset', () => {
  const h = harness(); h.advance(0, 59000); h.traffic(60, 179, 2);
  h.event('chat', 180000, { userId: 'additional-chatter' });
  h.traffic(180, 189, 2);
  assert.equal(h.bookmarks.size, 0);
  h.traffic(190, 220, 10); h.advance(221000, 240000);
  assert.equal(h.bookmarks.size, 1);
  const b = [...h.bookmarks.values()][0]!;
  assert.equal(b.onsetMs, 190000);
  assert.equal(b.sourceTimeMs, 190000);
  assert.equal(b.confirmedAtMs, 195000);
  assert.equal(b.metrics.baseline, 121 / 60);
  assert.equal(b.metrics.threshold, (121 / 60) * 3);
  assert.equal(b.metrics.qualifyingBuckets, 3);
  assert.equal(b.detectedOffsetSeconds, 190);
  assert.equal(b.suggestedOffsetSeconds, 175);
});
test('candidate has five completed buckets to validate, including the final bucket', () => {
  const h = harness(); h.advance(0, 59000); h.traffic(60, 64, 2);
  h.at(66000);
  assert.equal(h.engine.snapshot().candidate?.streak, 4);
  assert.equal(h.bookmarks.size, 0);
  h.event('chat', 66100, { sourceTimeMs: 64100, userId: 'third-chatter' });
  h.at(67000);
  assert.equal(h.bookmarks.size, 1);
  const b = [...h.bookmarks.values()][0]!;
  assert.equal(b.onsetMs, 60000);
  assert.equal(b.metrics.qualifyingBuckets, 5);
});
test('unsatisfied safeguards discard a candidate at its validation deadline without waiting for silence', () => {
  const h = harness(); h.advance(0, 59000); h.traffic(60, 64, 2);
  h.at(66000);
  assert.equal(h.engine.snapshot().candidate?.streak, 4);
  h.at(67000);
  assert.equal(h.engine.snapshot().candidate, null);
  assert.equal(h.bookmarks.size, 0);
  // The next candidate takes the newly observed baseline, rather than extending the expired one.
  h.traffic(67, 67, 2); h.at(70000);
  const candidate = h.engine.snapshot().candidate!;
  assert.equal(candidate.onsetMs, 67000);
  assert.equal(candidate.baseline, 6 / 60);
  assert.equal(candidate.streak, 1);
});
test('validation window allows rolling activity to fill before confirming on its final bucket', () => {
  const h = harness({ minimumRate: 3 }); h.advance(0, 59000); h.traffic(60, 64, 3);
  h.at(66000);
  assert.equal(h.bookmarks.size, 0);
  assert.equal(h.engine.status().rate, 2.4);
  h.at(67000);
  assert.equal(h.bookmarks.size, 1);
  const b = [...h.bookmarks.values()][0]!;
  assert.equal(b.onsetMs, 60000);
  assert.equal(b.metrics.rate, 3);
  assert.equal(b.metrics.qualifyingBuckets, 5);
  assert.equal(b.metrics.validationWindowSeconds, 5);
});
test('validation bound accounts for a configured sustain run longer than the activity window', () => {
  const h = harness({ activitySeconds: 3, sustainSeconds: 6, minimumChatters: 4 });
  h.advance(0, 59000); h.traffic(60, 65, 2); h.at(67000);
  assert.equal(h.engine.status().candidateValidationSeconds, 6);
  assert.equal(h.engine.snapshot().candidate?.streak, 5);
  h.at(68000);
  assert.equal(h.engine.snapshot().candidate, null);
  assert.equal(h.bookmarks.size, 0);
});
test('one-person spam, broadcaster, bots, and missing identities cannot trigger', () => {
  const h = harness({ excludedUserIds: ['bot'] }); h.advance(0, 59000);
  for (let sec = 60; sec <= 90; sec++) {
    for (let i = 0; i < 30; i++) h.event('chat', sec * 1000, { userId: 'solo' });
    for (const userId of ['broadcaster', 'bot', null]) h.event('chat', sec * 1000, { userId });
  }
  assert.equal(h.bookmarks.size, 0);
  assert.equal(h.engine.status().rate, 1);
});
test('per-user per-second cap applies to baseline and activity', () => {
  const h = harness();
  for (let sec = 0; sec < 90; sec++) {
    for (let n = 0; n < 20; n++) h.event('chat', sec * 1000, { userId: 'same' });
  }
  assert.equal(h.engine.status().baseline, 1);
  assert.equal(h.engine.status().rate, 1);
});
test('candidate threshold freezes while baseline rises', () => {
  // Short history intentionally moves burst traffic into the baseline before confirmation.
  const h = harness({ baselineSeconds: 2, activitySeconds: 2, sustainSeconds: 4 }); h.advance(0, 59000);
  h.traffic(60, 70, 3);
  const b = [...h.bookmarks.values()][0]!;
  assert.equal(b.metrics.threshold, 1);
  assert.equal(b.metrics.baseline, 0);
  assert.equal(b.confirmedAtMs, 66000);
  assert.ok(h.engine.status().baseline > 0);
});
test('one bookmark for sustained burst; cooldown AND ten quiet seconds required before rearming', () => {
  const h = harness(); h.advance(0, 59000);
  h.traffic(60, 110, 3);
  assert.equal(h.bookmarks.size, 1);
  h.advance(111000, 150000);
  h.traffic(151, 165, 10);
  assert.equal(h.bookmarks.size, 2);
});
test('quiet time without cooldown cannot rearm', () => {
  const h = harness(); h.advance(0, 59000); h.traffic(60, 65, 3);
  h.advance(66000, 85000); h.traffic(86, 95, 10);
  assert.equal(h.bookmarks.size, 1);
});
test('platform events bypass warmup and chat cooldown; independent events stay distinct', () => {
  const h = harness({ rewardId: 'mark' });
  for (const [i, type] of ['raid', 'subscription', 'gift', 'resubscription', 'redemption', 'manual'].entries()) {
    h.event(type as 'raid', i * 100, { amount: 25, isGift: false, rewardId: 'mark', userId: null });
  }
  assert.equal(h.bookmarks.size, 6);
  assert.ok([...h.bookmarks.values()].every(b => b.tier === 'banner'));
  h.advance(1000, 59000); h.traffic(60, 67, 3);
  h.event('raid', 68000, { amount: 50 });
  h.event('manual', 68100);
  assert.equal([...h.bookmarks.values()].filter(b => b.signal === 'raid').length, 2);
  assert.equal([...h.bookmarks.values()].filter(b => b.signal === 'manual').length, 2);
});
test('every platform signal, including qualifying cheers, bypasses chat warmup', () => {
  const h = harness({ rewardId: 'mark' });
  for (const type of ['raid', 'subscription', 'gift', 'resubscription', 'cheer', 'redemption', 'manual'] as const)
    h.event(type, 1000, { amount: 100, isGift: false, rewardId: 'mark' });
  assert.equal(h.engine.status().warm, false);
  assert.deepEqual([...h.bookmarks.values()].map(b => b.signal),
    ['raid', 'subscription', 'gift', 'resubscription', 'cheer', 'redemption', 'manual']);
  assert.ok([...h.bookmarks.values()].every(b => b.tier === 'banner'));
});
test('gift recipient events suppressed, batch uses supplied total, redemption filters by ID', () => {
  const h = harness({ rewardId: 'mark-id' });
  h.event('subscription', 0, { isGift: true });
  h.event('gift', 0, { amount: 5 });
  h.event('redemption', 0, { rewardId: 'other-id' });
  h.event('redemption', 0, { rewardId: 'mark-id' });
  assert.deepEqual([...h.bookmarks.values()].map(b => [b.signal, b.metrics.amount]), [['gift', 5], ['redemption', undefined]]);
});
test('cheers cross once per window, subsequent contributions update aggregate and persist all IDs', () => {
  const h = harness();
  h.event('cheer', 0, { amount: 40 });
  h.event('cheer', 1000, { amount: 59 });
  assert.equal(h.bookmarks.size, 0);
  h.event('cheer', 2000, { amount: 1 });
  h.event('cheer', 3000, { amount: 200 });
  assert.equal(h.bookmarks.size, 1);
  const b = [...h.bookmarks.values()][0]!;
  assert.equal(b.metrics.bits, 300);
  assert.equal(b.sourceIds.length, 4);
  assert.equal(b.onsetMs, 0);
  assert.equal(b.confirmedAtMs, 2000);
  h.event('cheer', 10000, { amount: 100 });
  assert.equal(h.bookmarks.size, 2);
});
test('cheer threshold never combines contributions outside ten-second window', () => {
  const h = harness();
  h.event('cheer', 0, { amount: 99 });
  h.event('cheer', 10000, { amount: 1 });
  assert.equal(h.bookmarks.size, 0);
});
test('chat attaches to nearest nearby platform bookmark without changing either platform tier', () => {
  const h = harness(); h.advance(0, 59000);
  h.event('raid', 60000, { amount: 25 });
  h.event('subscription', 60000, { isGift: false });
  h.traffic(60, 67, 3);
  assert.equal(h.bookmarks.size, 2);
  assert.equal([...h.bookmarks.values()].filter(b => b.chatEvidence.length === 1).length, 1);
  assert.ok([...h.bookmarks.values()].every(b => b.tier === 'banner'));
});
test('later platform event preserves an already-persisted chat bookmark and attaches evidence', () => {
  const h = harness(); h.advance(0, 59000); h.traffic(60, 66, 3);
  h.event('raid', 67000, { amount: 10 });
  assert.equal(h.bookmarks.size, 2);
  assert.equal([...h.bookmarks.values()].find(b => b.signal === 'raid')!.chatEvidence.length, 1);
});
test('transport duplicates and repeated chat IDs with fresh transport IDs are ignored', () => {
  const h = harness();
  h.event('raid', 0, { transportId: 't', sourceId: 's', amount: 10 });
  assert.equal(h.event('raid', 1, { transportId: 't', sourceId: 's2', amount: 10 }).disposition, 'duplicate');
  assert.equal(h.event('raid', 2, { transportId: 'new', sourceId: 's', amount: 10 }).disposition, 'duplicate');
  assert.equal(h.bookmarks.size, 1);
  h.event('chat', 3, { transportId: 'chat1', sourceId: 'message', userId: 'a' });
  assert.equal(h.event('chat', 4, { transportId: 'chat2', sourceId: 'message', userId: 'b' }).disposition, 'duplicate');
});
test('malformed input and invalid source timestamps do not crash or create bookmarks', () => {
  const h = harness();
  for (const raw of [null, false, {}, { type: 'raid' }, 'bad', [], { type: 'chat', amount: NaN }]) {
    assert.equal(h.engine.ingest(raw).disposition, 'malformed');
  }
  assert.equal(h.event('raid', 0, { amount: 0 }).disposition, 'malformed');
  assert.equal(h.event('raid', 0, { amount: 2, sourceTimeMs: 999999 }).disposition, 'invalid timestamp');
  assert.equal(h.bookmarks.size, 0);
});
test('out-of-order chat within mutable buckets is counted; finalized late chat is excluded with coverage note', () => {
  const h = harness(); h.advance(0, 59000);
  h.event('chat', 60000, { sourceTimeMs: 59500, userId: 'a' });
  h.event('chat', 60000, { sourceTimeMs: 59000, userId: 'b' });
  h.at(62000);
  assert.equal(h.engine.status().rate, 0.4);
  const late = h.event('chat', 63000, { sourceTimeMs: 59000, userId: 'c' });
  assert.equal(late.disposition, 'late chat excluded');
  assert.equal(late.gaps.length, 1);
  h.event('raid', 64000, { sourceTimeMs: 1000, amount: 5 });
  assert.equal(h.bookmarks.size, 1);
  assert.equal([...h.bookmarks.values()][0]!.sourceTimeMs, 1000);
});
test('connection gaps discard partial chat burst and restart warmup; platform events still work', () => {
  const h = harness(); h.advance(0, 59000); h.traffic(60, 61, 3);
  h.at(64000);
  const gap = h.engine.connectionGap(63000, 64000);
  assert.equal(gap.gaps.length, 1);
  h.traffic(65, 90, 3);
  assert.equal(h.bookmarks.size, 0);
  h.event('manual', 91000);
  assert.equal(h.bookmarks.size, 1);
  assert.equal(h.engine.status().warm, false);
});
test('process suspension creates missing coverage rather than fabricating idle history', () => {
  const h = harness();
  const result = h.at(3600000);
  assert.equal(result.gaps[0]!.reason, 'evaluation clock gap');
  assert.equal(h.engine.status().warm, false);
});
test('midstream session offsets use Twitch stream origin, lead-in and alignment remain separate', () => {
  const h = harness({ leadInSeconds: 15, alignmentSeconds: 3600 }, 1800000);
  h.event('manual', 1805000);
  const b = [...h.bookmarks.values()][0]!;
  assert.equal(b.detectedOffsetSeconds, 1805);
  assert.equal(b.suggestedOffsetSeconds, 1790);
  assert.equal(b.editorOffsetSeconds, 5390);
  assert.equal(b.onsetMs, 1805000);
});
test('settings are validated and captured immutably', () => {
  for (const bad of [{ activitySeconds: 0 }, { multiplier: NaN }, { rearmRatio: 1 }, { leadInSeconds: -1 }, { dedupLimit: 0 }])
    assert.throws(() => settings(bad));
  const h = harness();
  h.session.settings.multiplier = 999;
  assert.equal(h.engine.session.settings.multiplier, 3);
  assert.equal(parseInput({}), null);
  assert.throws(() => new Detector({ ...h.session, streamStartedAtMs: 1000 }, () => 0));
});
test('bounded chat buckets, dedup cache, and snapshot restoration preserve deterministic output', () => {
  const h = harness({ dedupLimit: 100 });
  h.traffic(0, 1000, 2);
  assert.ok(h.engine.status().bucketCount <= 70);
  assert.ok(h.engine.status().dedupCount <= 100);
  const snapshot = h.engine.snapshot();
  const restored = new Detector(h.session, h.clock, snapshot);
  assert.deepEqual(restored.snapshot(), snapshot);
});
test('bucket overload records a gap and resets chat rather than letting memory grow', () => {
  const h = harness({ maxUsersPerBucket: 3 });
  for (const userId of ['a', 'b', 'c']) h.event('chat', 0, { userId });
  const result = h.event('chat', 0, { userId: 'd' });
  assert.equal(result.gaps[0]!.reason, 'chat bucket capacity exceeded');
  assert.equal(h.engine.status().bucketCount, 0);
});
test('chat preserves real sub-second source timestamps; missing source timestamps remain null', () => {
  for (const sourceKnown of [true, false]) {
    const h = harness(); h.advance(0, 59000);
    for (let sec = 60; sec < 68; sec++) {
      for (let u = 0; u < 3; u++) h.event('chat', sec * 1000 + 123, {
        userId: `u${u}`, sourceTimeMs: sourceKnown ? sec * 1000 + 123 : null,
      });
    }
    const b = [...h.bookmarks.values()][0]!;
    assert.equal(b.onsetMs, 60123);
    assert.equal(b.sourceTimeMs, sourceKnown ? 60123 : null);
  }
});
test('every platform signal, including qualifying cheers, bypasses an active chat cooldown', () => {
  const h = harness({ rewardId: 'mark' }); h.advance(0, 59000); h.traffic(60, 67, 3);
  for (const type of ['raid', 'subscription', 'gift', 'resubscription', 'cheer', 'redemption', 'manual'] as const)
    h.event(type, 68000, { amount: 100, isGift: false, rewardId: 'mark' });
  assert.deepEqual([...h.bookmarks.values()].map(b => b.signal),
    ['chat', 'raid', 'subscription', 'gift', 'resubscription', 'cheer', 'redemption', 'manual']);
  assert.ok([...h.bookmarks.values()].slice(1).every(b => b.tier === 'banner'));
});
