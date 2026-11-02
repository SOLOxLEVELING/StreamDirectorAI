import type { Input } from '../types.ts';

export const eventTypes = ['channel.chat.message', 'channel.raid', 'channel.subscribe',
  'channel.subscription.gift', 'channel.subscription.message', 'channel.cheer',
  'channel.channel_points_custom_reward_redemption.add'] as const;
export type EventType = typeof eventTypes[number];
export type Feature = 'chat' | 'raid' | 'subscriptions' | 'cheer' | 'redemptions';
export const permissions: Record<EventType, string | null> = {
  'channel.chat.message': 'user:read:chat', 'channel.raid': null,
  'channel.subscribe': 'channel:read:subscriptions', 'channel.subscription.gift': 'channel:read:subscriptions',
  'channel.subscription.message': 'channel:read:subscriptions', 'channel.cheer': 'bits:read',
  'channel.channel_points_custom_reward_redemption.add': 'channel:read:redemptions',
};
export function enabledTypes(features: Feature[], rewardId: string | null): EventType[] {
  return eventTypes.filter(type => type === 'channel.chat.message' ? features.includes('chat') :
    type === 'channel.raid' ? features.includes('raid') : type === 'channel.cheer' ? features.includes('cheer') :
    type.includes('redemption') ? features.includes('redemptions') && Boolean(rewardId) : features.includes('subscriptions'));
}
export function scopesFor(types: EventType[]) { return [...new Set(types.map(t => permissions[t]).filter((s): s is string => s !== null))]; }
export function subscription(type: EventType, broadcasterId: string, sessionId: string, rewardId: string | null) {
  const condition: Record<string, string> = type === 'channel.raid' ? { to_broadcaster_user_id: broadcasterId } : { broadcaster_user_id: broadcasterId };
  if (type === 'channel.chat.message') condition.user_id = broadcasterId;
  if (type.includes('redemption')) {
    if (!rewardId) throw new Error('A reward ID is required for redemptions');
    condition.reward_id = rewardId;
  }
  return { type, version: '1', condition, transport: { method: 'websocket', session_id: sessionId } };
}
export const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
export const string = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
export interface Envelope { metadata: Record<string, unknown>; payload: Record<string, unknown> }
export function envelope(raw: unknown): Envelope | null {
  const root = object(raw), metadata = object(root?.metadata), payload = object(root?.payload);
  if (!metadata || !payload || !string(metadata.message_id) || !string(metadata.message_type) ||
      !string(metadata.message_timestamp) || !Number.isFinite(Date.parse(metadata.message_timestamp))) return null;
  return { metadata, payload };
}
// Verified against Twitch's official v1 EventSub docs; see docs/twitch-protocol.md.
// Only structured fields are read. Chat text, emotes and sentiment cannot influence detection.
export function normalize(message: Envelope, broadcasterId: string, receivedAtMs: number): Input | null {
  const m = message.metadata, sub = object(message.payload.subscription), e = object(message.payload.event);
  if (m.message_type !== 'notification' || !sub || !e || sub.version !== '1' || m.subscription_version !== '1' ||
      sub.type !== m.subscription_type || !eventTypes.includes(sub.type as EventType)) return null;
  const type = sub.type as EventType;
  const condition = object(sub.condition);
  const target = type === 'channel.raid' ? 'to_broadcaster_user_id' : 'broadcaster_user_id';
  if (e[target] !== broadcasterId || condition?.[target] !== broadcasterId) return null;
  if (type === 'channel.chat.message' && condition?.user_id !== broadcasterId) return null;
  const base = { transportId: String(m.message_id), sourceId: String(m.message_id),
    sourceTimeMs: Date.parse(String(m.message_timestamp)), receivedAtMs };
  switch (type) {
    case 'channel.chat.message':
      if (!string(e.message_id) || !(e.chatter_user_id === null || string(e.chatter_user_id))) return null;
      return { ...base, sourceId: e.message_id, type: 'chat', userId: e.chatter_user_id as string | null };
    case 'channel.raid':
      return positive(e.viewers) ? { ...base, type: 'raid', amount: e.viewers } : null;
    case 'channel.subscribe':
      return typeof e.is_gift === 'boolean' ? { ...base, type: 'subscription', isGift: e.is_gift } : null;
    case 'channel.subscription.gift':
      return positive(e.total) ? { ...base, type: 'gift', amount: e.total } : null;
    case 'channel.subscription.message': return { ...base, type: 'resubscription' };
    case 'channel.cheer':
      return positive(e.bits) && typeof e.is_anonymous === 'boolean' ?
        { ...base, type: 'cheer', amount: e.bits, userId: e.is_anonymous ? null : string(e.user_id) ? e.user_id : null } : null;
    case 'channel.channel_points_custom_reward_redemption.add': {
      const reward = object(e.reward);
      if (!string(e.id) || !string(reward?.id) || (condition?.reward_id && condition.reward_id !== reward.id) ||
          !string(e.redeemed_at) || !Number.isFinite(Date.parse(e.redeemed_at))) return null;
      return { ...base, sourceId: e.id, sourceTimeMs: Date.parse(e.redeemed_at), type: 'redemption', rewardId: reward.id };
    }
  }
}
