export interface Settings {
  bucketSeconds: 1;
  baselineSeconds: number;
  activitySeconds: number;
  warmupSeconds: number;
  multiplier: number;
  minimumRate: number;
  sustainSeconds: number;
  minimumChatters: number;
  cooldownSeconds: number;
  rearmSeconds: number;
  rearmRatio: number;
  allowedLatenessSeconds: number;
  cheerThreshold: number;
  cheerWindowSeconds: number;
  correlationSeconds: number;
  leadInSeconds: number;
  alignmentSeconds: number;
  broadcasterId: string;
  excludedUserIds: string[];
  rewardId: string | null;
  maxUsersPerBucket: number;
  dedupLimit: number;
}
export const defaults: Settings = {
  bucketSeconds: 1, baselineSeconds: 60, activitySeconds: 5, warmupSeconds: 60,
  multiplier: 3, minimumRate: 1, sustainSeconds: 3, minimumChatters: 3,
  cooldownSeconds: 30, rearmSeconds: 10, rearmRatio: 0.6,
  allowedLatenessSeconds: 2, cheerThreshold: 100, cheerWindowSeconds: 10,
  correlationSeconds: 10, leadInSeconds: 15, alignmentSeconds: 0,
  broadcasterId: 'broadcaster', excludedUserIds: [], rewardId: null,
  maxUsersPerBucket: 10000, dedupLimit: 100000,
};
export function settings(overrides: Partial<Settings> = {}): Settings {
  const value = structuredClone({ ...defaults, ...overrides });
  const integers = ['baselineSeconds', 'activitySeconds', 'warmupSeconds', 'sustainSeconds',
    'minimumChatters', 'cooldownSeconds', 'rearmSeconds', 'allowedLatenessSeconds',
    'cheerThreshold', 'cheerWindowSeconds', 'correlationSeconds', 'maxUsersPerBucket', 'dedupLimit'] as const;
  for (const key of integers) if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 1000000)
    throw new Error(`Invalid setting: ${key}`);
  for (const key of ['multiplier', 'minimumRate', 'rearmRatio', 'leadInSeconds', 'alignmentSeconds'] as const)
    if (!Number.isFinite(value[key])) throw new Error(`Invalid setting: ${key}`);
  if (value.bucketSeconds !== 1 || value.baselineSeconds < 1 || value.activitySeconds < 1 ||
      value.sustainSeconds < 1 || value.minimumChatters < 1 || value.maxUsersPerBucket < 1 ||
      value.dedupLimit < 1 || value.cheerThreshold < 1 || value.cheerWindowSeconds < 1 ||
      value.multiplier <= 0 || value.minimumRate <= 0 || value.rearmRatio <= 0 ||
      value.rearmRatio >= 1 || value.leadInSeconds < 0 || !value.broadcasterId ||
      !Array.isArray(value.excludedUserIds) || value.excludedUserIds.some(x => typeof x !== 'string') ||
      (value.rewardId !== null && typeof value.rewardId !== 'string')) throw new Error('Invalid settings');
  return value;
}
export type Signal = 'chat' | 'raid' | 'subscription' | 'gift' | 'resubscription' | 'cheer' | 'redemption' | 'manual';
// Internal normalized input, deliberately NOT an assumed Twitch wire schema.
export interface Input {
  transportId: string;
  sourceId: string;
  sourceTimeMs: number | null;
  receivedAtMs: number;
  type: Signal;
  userId?: string | null;
  amount?: number;
  isGift?: boolean;
  rewardId?: string;
}
export interface ChatEvidence {
  onsetMs: number;
  confirmedAtMs: number;
  rate: number;
  baseline: number;
  threshold: number;
  distinctChatters: number;
  sourceIds: string[];
  qualifyingBuckets: number;
  minimumBucketRate: number;
  validationWindowSeconds: number;
}
export interface Bookmark {
  id: string;
  sessionId: string;
  streamId: string;
  signal: Signal;
  tier: 'corner' | 'banner';
  sourceTimeMs: number | null;
  receivedAtMs: number;
  onsetMs: number;
  confirmedAtMs: number;
  detectedOffsetSeconds: number;
  suggestedOffsetSeconds: number;
  editorOffsetSeconds: number;
  reason: string;
  metrics: Record<string, number>;
  sourceIds: string[];
  chatEvidence: ChatEvidence[];
  caption: string;
  captionStatus: 'disabled' | 'pending' | 'complete' | 'failed';
  // Older records without this field belong to revision zero.
  settingsRevision?: number;
}
export interface Session {
  id: string;
  mode: 'live' | 'simulated';
  streamId: string;
  streamStartedAtMs: number;
  startedAtMs: number;
  settings: Settings;
  settingsHistory?: { revision: number; effectiveFromMs: number; settings: Settings }[];
}
export interface CoverageGap { startMs: number; endMs: number; reason: string }
export function parseInput(raw: unknown): Input | null {
  if (!raw || typeof raw !== 'object') return null;
  const x = raw as Record<string, unknown>;
  if (typeof x.transportId !== 'string' || !x.transportId || x.transportId.length > 256 ||
      typeof x.sourceId !== 'string' || !x.sourceId || x.sourceId.length > 256 ||
      !['chat', 'raid', 'subscription', 'gift', 'resubscription', 'cheer', 'redemption', 'manual'].includes(String(x.type)) ||
      !Number.isSafeInteger(x.receivedAtMs) || Number(x.receivedAtMs) < 0 ||
      !(x.sourceTimeMs === null || (Number.isSafeInteger(x.sourceTimeMs) && Number(x.sourceTimeMs) >= 0))) return null;
  if (x.userId !== undefined && x.userId !== null && (typeof x.userId !== 'string' || x.userId.length > 256)) return null;
  if (x.isGift !== undefined && typeof x.isGift !== 'boolean') return null;
  if (['raid', 'gift', 'cheer'].includes(String(x.type)) && (!Number.isSafeInteger(x.amount) || Number(x.amount) < 1)) return null;
  if (x.type === 'subscription' && typeof x.isGift !== 'boolean') return null;
  if (x.type === 'redemption' && (typeof x.rewardId !== 'string' || !x.rewardId)) return null;
  return { transportId: x.transportId, sourceId: x.sourceId, sourceTimeMs: x.sourceTimeMs as number | null,
    receivedAtMs: x.receivedAtMs as number, type: x.type as Signal, userId: x.userId as string | null | undefined,
    amount: x.amount as number | undefined, isGift: x.isGift as boolean | undefined, rewardId: x.rewardId as string | undefined };
}
