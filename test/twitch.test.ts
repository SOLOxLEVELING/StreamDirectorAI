import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TwitchAuth, Helix } from '../src/twitch/auth.ts';
import type { Fetcher } from '../src/twitch/auth.ts';
import { EventSubClient } from '../src/twitch/eventsub.ts';
import { enabledTypes, envelope, eventTypes, normalize, scopesFor, subscription } from '../src/twitch/schema.ts';
import { LiveTwitch } from '../src/twitch/live.ts';
import { Store, Recorder } from '../src/store.ts';
import { settings } from '../src/types.ts';
import { IntegrationFailure, failureFields, publicFailure } from '../src/twitch/diagnostics.ts';

const now = 1800000;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const userInfo = { client_id: 'test-client', user_id: '42', login: 'test_broadcaster', scopes: ['user:read:chat'], expires_in: 3600 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
export function wire(type: string, event: Record<string, unknown>, id = type, extra: Record<string, unknown> = {}) {
  const condition = type === 'channel.raid' ? { to_broadcaster_user_id: '42' } :
    type === 'channel.chat.message' ? { broadcaster_user_id: '42', user_id: '42' } : { broadcaster_user_id: '42' };
  return { metadata: { message_id: id, message_type: 'notification', message_timestamp: new Date(now).toISOString(),
    subscription_type: type, subscription_version: '1' },
  payload: { subscription: { id: 'sub-id', type, version: '1', condition },
    event: { broadcaster_user_id: '42', ...event } }, ...extra };
}
test('documented subscription conditions/scopes: broadcaster reader, incoming raid, configured reward and v1', () => {
  assert.deepEqual(subscription('channel.chat.message', '42', 'ws', null).condition, { broadcaster_user_id: '42', user_id: '42' });
  assert.deepEqual(subscription('channel.raid', '42', 'ws', null).condition, { to_broadcaster_user_id: '42' });
  assert.deepEqual(subscription('channel.channel_points_custom_reward_redemption.add', '42', 'ws', 'reward').condition,
    { broadcaster_user_id: '42', reward_id: 'reward' });
  assert.throws(() => subscription('channel.channel_points_custom_reward_redemption.add', '42', 'ws', null));
  assert.ok(eventTypes.every(t => subscription(t, '42', 'ws', 'reward').version === '1'));
  assert.deepEqual(scopesFor(enabledTypes(['chat', 'raid'], null)), ['user:read:chat']);
  assert.equal(enabledTypes(['redemptions'], null).length, 0);
});
test('all seven v1 notification schemas normalize structured fields; gift total is not cumulative_total', () => {
  const events: [string, Record<string, unknown>, string, number | undefined][] = [
    ['channel.chat.message', { chatter_user_id: 'viewer', message_id: 'chat-id', message: { text: 'CLIP IT' } }, 'chat', undefined],
    ['channel.raid', { to_broadcaster_user_id: '42', viewers: 25 }, 'raid', 25],
    ['channel.subscribe', { is_gift: true }, 'subscription', undefined],
    ['channel.subscription.gift', { total: 5, cumulative_total: 500, is_anonymous: true, user_id: null }, 'gift', 5],
    ['channel.subscription.message', {}, 'resubscription', undefined],
    ['channel.cheer', { bits: 100, is_anonymous: true, user_id: null }, 'cheer', 100],
    ['channel.channel_points_custom_reward_redemption.add', { id: 'redemption', reward: { id: 'reward', title: 'Wrong display title' }, redeemed_at: new Date(now - 500).toISOString() }, 'redemption', undefined],
  ];
  for (const [type, event, signal, amount] of events) {
    const normalized = normalize(envelope(wire(type, event))!, '42', now)!;
    assert.equal(normalized.type, signal);
    assert.equal(normalized.amount, amount);
    if (signal === 'chat') assert.equal(normalized.sourceId, 'chat-id');
    if (signal === 'redemption') { assert.equal(normalized.sourceId, 'redemption'); assert.equal(normalized.sourceTimeMs, now - 500); assert.equal(normalized.rewardId, 'reward'); }
  }
});
test('malformed, wrong channel/reader, inconsistent type/version and spoofed reward condition are rejected', () => {
  assert.equal(envelope(null), null);
  const bad = wire('channel.chat.message', { chatter_user_id: 'u', message_id: 'm' });
  assert.equal(normalize(envelope(bad)!, 'different', now), null);
  bad.payload.subscription.condition.user_id = 'wrong';
  assert.equal(normalize(envelope(bad)!, '42', now), null);
  const version = wire('channel.raid', { to_broadcaster_user_id: '42', viewers: 10 });
  version.metadata.subscription_version = '2';
  assert.equal(normalize(envelope(version)!, '42', now), null);
  assert.equal(normalize(envelope(wire('channel.cheer', { bits: -1, is_anonymous: false }))!, '42', now), null);
});

function authHarness() {
  const directory = mkdtempSync(join(tmpdir(), 'streamdirector-oauth-'));
  let time = now; let exchanges = 0;
  let responder: Fetcher | undefined;
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (responder) return responder(url, init);
    if (url.endsWith('/token')) { exchanges++; return json({ access_token: `test-access-${exchanges}`, refresh_token: `test-refresh-${exchanges}` }); }
    if (url.endsWith('/validate')) return json({ client_id: 'test-client', user_id: '42', login: 'test_broadcaster', scopes: ['user:read:chat'], expires_in: 3600 });
    return json({ data: [] });
  };
  const config = { clientId: 'test-client', clientSecret: 'test-secret', scopes: ['user:read:chat'],
    redirectUri: 'http://localhost:4387/auth/twitch/callback', tokenPath: join(directory, 'token.json') };
  const auth = new TwitchAuth(config, fetcher, () => time);
  return { auth, config, fetcher, calls, setTime: (t: number) => { time = t; },
    setResponder: (next?: Fetcher) => { responder = next; },
    async login() { const { state } = auth.authorize(); await auth.callback('test-code', state, state); },
    close() { rmSync(directory, { recursive: true }); } };
}
test('OAuth code flow uses one-time browser-bound state, validates identity, saves mode-0600 tokens and keeps status secret-free', async () => {
  const h = authHarness();
  try {
    const { url, state } = h.auth.authorize();
    assert.equal(new URL(url).searchParams.get('response_type'), 'code');
    assert.equal(new URL(url).searchParams.get('scope'), 'user:read:chat');
    assert.ok(!url.includes('test-secret'));
    await h.auth.callback('code', state, state);
    assert.equal(statSync(h.config.tokenPath).mode & 0o777, 0o600);
    assert.equal(h.auth.status().userId, '42');
    assert.ok(!JSON.stringify(h.auth.status()).includes('test-access'));
    await assert.rejects(h.auth.callback('code', state, state), /state/);
    const { state: next } = h.auth.authorize();
    await assert.rejects(h.auth.callback('code', next, 'wrong'), /state/);
    const { state: expired } = h.auth.authorize(); h.setTime(now + 300001);
    await assert.rejects(h.auth.callback('code', expired, expired), /expired/);
  } finally { h.close(); }
});
test('concurrent token refreshes use one exchange and rotated refresh token is durable', async () => {
  const h = authHarness();
  try {
    await h.login(); h.setTime(now + 3600000);
    const tokens = await Promise.all([h.auth.accessToken(), h.auth.accessToken(), h.auth.accessToken()]);
    assert.deepEqual(tokens, ['test-access-2', 'test-access-2', 'test-access-2']);
    assert.equal(h.calls.filter(c => c.url.endsWith('/token')).length, 2);
    assert.equal(JSON.parse(readFileSync(h.config.tokenPath, 'utf8')).refresh_token, 'test-refresh-2');
  } finally { h.close(); }
});
test('Helix uses user Bearer token and Client-Id, retries once after 401', async () => {
  const h = authHarness(); let count = 0;
  try {
    await h.login();
    const api = new Helix(h.auth, 'test-client', async (_url, init) => {
      count++; assert.equal((init!.headers as Record<string, string>)['Client-Id'], 'test-client');
      assert.match((init!.headers as Record<string, string>).Authorization!, /^Bearer test-access-/);
      return count === 1 ? json({}, 401) : json({ data: [] });
    });
    assert.equal((await api.request('streams?user_id=42')).status, 200);
    assert.equal(count, 2);
  } finally { h.close(); }
});

class FakeSocket {
  closed = false;
  listeners = new Map<string, ((e: any) => void)[]>();
  addEventListener(type: string, cb: (e: any) => void) { this.listeners.set(type, [...this.listeners.get(type) ?? [], cb]); }
  close() { this.closed = true; }
  message(raw: unknown) { for (const cb of this.listeners.get('message') ?? []) cb({ data: typeof raw === 'string' ? raw : JSON.stringify(raw) }); }
}
const control = (type: string, session: unknown, id = type) => ({ metadata: { message_type: type, message_id: id,
  message_timestamp: new Date(now).toISOString() }, payload: { session } });
test('EventSub welcome subscribes once; keepalives, malformed messages and notifications handled', async () => {
  let time = now; const socket = new FakeSocket(); let subscribed = 0, notified = 0;
  const client = new EventSubClient({ socketFactory: () => socket, clock: () => time,
    subscribe: async id => { assert.equal(id, 'session'); subscribed++; }, notification: () => notified++,
    status: () => {}, revocation: () => {}, gap: () => {} });
  client.start();
  socket.message(control('session_welcome', { id: 'session', keepalive_timeout_seconds: 10 })); await flush();
  socket.message(control('session_welcome', { id: 'session', keepalive_timeout_seconds: 10 }));
  socket.message('malformed'); socket.message('{}');
  socket.message(wire('channel.raid', { to_broadcaster_user_id: '42', viewers: 5 }));
  time += 9000; socket.message(control('session_keepalive', null)); client.tick();
  assert.equal(subscribed, 1); assert.equal(notified, 1); assert.equal(socket.closed, false); client.stop();
});
test('requested reconnect overlaps only until replacement welcome and never recreates subscriptions', async () => {
  const sockets: FakeSocket[] = []; let subscriptions = 0, gaps = 0;
  const client = new EventSubClient({ socketFactory: () => { const s = new FakeSocket(); sockets.push(s); return s; },
    subscribe: async () => { subscriptions++; }, notification: () => {}, status: () => {}, revocation: () => {}, gap: () => { gaps++; } });
  client.start(); sockets[0]!.message(control('session_welcome', { id: 's1', keepalive_timeout_seconds: 10 })); await flush();
  sockets[0]!.message(control('session_reconnect', { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?reconnect=test' }));
  assert.equal(sockets.length, 2); assert.equal(sockets[0]!.closed, false);
  sockets[1]!.message(control('session_welcome', { id: 's2', keepalive_timeout_seconds: 10 })); await flush();
  assert.equal(sockets[0]!.closed, true); assert.equal(subscriptions, 1); assert.equal(gaps, 0); client.stop();
});
test('unexpected keepalive timeout marks coverage incomplete immediately and resubscribes after reconnect', async () => {
  let time = now; const sockets: FakeSocket[] = []; let subscriptions = 0; const gaps: string[] = [];
  const client = new EventSubClient({ clock: () => time, socketFactory: () => { const s = new FakeSocket(); sockets.push(s); return s; },
    subscribe: async () => { subscriptions++; }, notification: () => {}, status: () => {}, revocation: () => {}, gap: (_s, _e, reason) => gaps.push(reason) });
  client.start(); sockets[0]!.message(control('session_welcome', { id: 's1', keepalive_timeout_seconds: 10 })); await flush();
  time += 11000; client.tick(); assert.equal(sockets[0]!.closed, true); assert.equal(gaps.length, 1);
  time += 1000; client.tick();
  sockets[1]!.message(control('session_welcome', { id: 's2', keepalive_timeout_seconds: 10 })); await flush();
  assert.equal(subscriptions, 2); assert.equal(gaps.length, 2); client.stop();
});
test('untrusted reconnect destinations are rejected; revocations reach handler', async () => {
  const socket = new FakeSocket(); const revoked: string[] = []; const gaps: string[] = [];
  const client = new EventSubClient({ socketFactory: () => socket, subscribe: async () => {}, notification: () => {}, status: () => {},
    revocation: (type, reason) => revoked.push(`${type}:${reason}`), gap: (_s, _e, reason) => gaps.push(reason) });
  client.start(); socket.message(control('session_welcome', { id: 's', keepalive_timeout_seconds: 10 })); await flush();
  socket.message({ metadata: control('revocation', null).metadata, payload: { subscription: { type: 'channel.cheer', status: 'authorization_revoked' } } });
  assert.deepEqual(revoked, ['channel.cheer:authorization_revoked']);
  socket.message(control('session_reconnect', { reconnect_url: 'wss://attacker.example/ws' }));
  assert.equal(socket.closed, true); assert.equal(gaps.length, 1); client.stop();
});
test('headless live service persists events without a presentation callback, uses Twitch stream start and preserves provenance', async () => {
  const h = authHarness(), store = new Store(':memory:');
  try {
    await h.login();
    const api = new Helix(h.auth, 'test-client', async () => json({ data: [{ id: 'real-format-test-stream', user_id: '42', started_at: new Date(0).toISOString() }] }));
    const live = new LiveTwitch(h.auth, api, store, { features: ['chat', 'raid', 'subscriptions', 'cheer'], rewardId: null, botIds: [] }, () => now);
    await live.pollStream();
    live.notification(envelope(wire('channel.raid', { to_broadcaster_user_id: '42', viewers: 25 }))!, now);
    live.notification(envelope(wire('channel.raid', { to_broadcaster_user_id: '42', viewers: 25 }))!, now);
    const sessions = store.sessions();
    assert.equal(sessions.length, 1);
    const bookmarks = store.bookmarks(sessions[0]!.id);
    assert.equal(bookmarks.length, 1); assert.equal(bookmarks[0]!.detectedOffsetSeconds, 1800);
    assert.equal(bookmarks[0]!.tier, 'banner');
    // These are mocked API inputs, never saved as actual live evidence outside the isolated test database.
    assert.equal(sessions[0]!.mode, 'live');
  } finally { store.close(); h.close(); }
});
test('real-clock processing delay does not make a captured notification receipt fail detector timestamp validation', async () => {
  const h = authHarness(), store = new Store(':memory:'); let time = now;
  try {
    await h.login();
    const api = new Helix(h.auth, 'test-client', async () => json({ data: [{ id: 'clock-test', user_id: '42', started_at: new Date(0).toISOString() }] }));
    const live = new LiveTwitch(h.auth, api, store, { features: ['raid'], rewardId: null, botIds: [] }, () => time++);
    await live.pollStream(); time += 100;
    const receipt = time;
    live.notification(envelope(wire('channel.raid', { to_broadcaster_user_id: '42', viewers: 25 }))!, receipt);
    const bookmarks = store.bookmarks(store.sessions()[0]!.id);
    assert.equal(bookmarks.length, 1);
    assert.equal(bookmarks[0]!.receivedAtMs, receipt);
  } finally { store.close(); h.close(); }
});
test('temporary validation outage retains credentials; authoritative token rejection clears them', async () => {
  const h = authHarness(); let rejected = false;
  try {
    await h.login();
    const auth = new TwitchAuth(h.config, async () => rejected ? json({}, 401) : json({}, 503), () => now);
    await assert.rejects(auth.validate(), /retry/);
    assert.equal(auth.status().authenticated, false);
    assert.equal(auth.status().credentialsAvailable, true);
    rejected = true;
    await assert.rejects(auth.validate(), /401/);
    assert.equal(auth.status().authenticated, false);
  } finally { h.close(); }
});
test('invalid client secret is reported without reflecting arbitrary token endpoint response content', async () => {
  const h = authHarness();
  try {
    const auth = new TwitchAuth(h.config, async () => json({ message: 'invalid client secret', secret: 'NEVER-ECHO-THIS' }, 403));
    const { state } = auth.authorize();
    await assert.rejects(auth.callback('code', state, state), error => {
      assert.match(String(error), /invalid client secret/); assert.ok(!String(error).includes('NEVER-ECHO-THIS')); return true;
    });
  } finally { h.close(); }
});

for (const phase of ['token', 'validate'] as const) {
  test(`logout fences an in-flight refresh at ${phase}, deletes credentials and invalidates unused OAuth states`, async () => {
    const h = authHarness(), entered = deferred<void>(), response = deferred<Response>();
    try {
      await h.login();
      const unused = h.auth.authorize();
      h.setResponder(async url => {
        if (url.endsWith(`/${phase}`)) { entered.resolve(); return response.promise; }
        return json({ access_token: 'rotated-access', refresh_token: 'rotated-refresh' });
      });
      const pending = assert.rejects(h.auth.refresh(), /sign-in changed/);
      await entered.promise;
      h.auth.clear();
      await assert.rejects(h.auth.callback('unused-code', unused.state, unused.state), /state/);
      response.resolve(phase === 'token' ? json({ access_token: 'rotated-access', refresh_token: 'rotated-refresh' }) : json(userInfo));
      await pending;
      assert.equal(h.auth.status().credentialsAvailable, false);
      assert.equal(h.auth.status().authenticated, false);
      assert.equal(existsSync(h.config.tokenPath), false);
      assert.equal(new TwitchAuth(h.config, h.fetcher).status().credentialsAvailable, false);
    } finally { h.close(); }
  });
  test(`logout fences an in-flight authorization callback at ${phase}`, async () => {
    const h = authHarness(), entered = deferred<void>(), response = deferred<Response>();
    try {
      const { state } = h.auth.authorize();
      h.setResponder(async url => {
        if (url.endsWith(`/${phase}`)) { entered.resolve(); return response.promise; }
        return json({ access_token: 'callback-access', refresh_token: 'callback-refresh' });
      });
      const pending = assert.rejects(h.auth.callback('code', state, state), /sign-in changed/);
      await entered.promise; h.auth.clear();
      response.resolve(phase === 'token' ? json({ access_token: 'callback-access', refresh_token: 'callback-refresh' }) : json(userInfo));
      await pending;
      assert.equal(existsSync(h.config.tokenPath), false);
      assert.equal(h.auth.status().authenticated, false);
    } finally { h.close(); }
  });
}

test('a stale refresh rejection cannot clear a newer login or release its pending refresh lock', async () => {
  const h = authHarness(), oldEntered = deferred<void>(), oldResponse = deferred<Response>();
  const newEntered = deferred<void>(), newResponse = deferred<Response>(); let newRequests = 0;
  try {
    await h.login();
    h.setResponder(async () => { oldEntered.resolve(); return oldResponse.promise; });
    const old = assert.rejects(h.auth.refresh(), /exchange failed/);
    await oldEntered.promise; h.auth.clear(); h.setResponder(); await h.login();
    h.setResponder(async url => {
      if (url.endsWith('/validate')) return json(userInfo);
      newRequests++; newEntered.resolve(); return newResponse.promise;
    });
    const current = h.auth.refresh(); await newEntered.promise;
    oldResponse.resolve(json({}, 401)); await old;
    const concurrent = h.auth.refresh();
    assert.equal(newRequests, 1);
    assert.equal(h.auth.status().credentialsAvailable, true);
    newResponse.resolve(json({ access_token: 'new-access', refresh_token: 'new-refresh' }));
    await Promise.all([current, concurrent]);
    assert.equal(await h.auth.accessToken(), 'new-access');
    assert.equal(JSON.parse(readFileSync(h.config.tokenPath, 'utf8')).refresh_token, 'new-refresh');
  } finally { h.close(); }
});

for (const reason of ['authorization_revoked', 'user_removed']) {
  test(`simulated EventSub service revocation ${reason} fences both pending refresh and callback`, async () => {
    const h = authHarness(), store = new Store(':memory:'), socket = new FakeSocket();
    const refreshEntered = deferred<void>(), refreshResponse = deferred<Response>();
    const callbackEntered = deferred<void>(), callbackResponse = deferred<Response>();
    const live = new LiveTwitch(h.auth, new Helix(h.auth, 'test-client', h.fetcher), store,
      { features: [], rewardId: null, botIds: [] }, () => now, () => socket);
    try {
      await h.login(); await live.connect();
      socket.message(control('session_welcome', { id: 'session', keepalive_timeout_seconds: 10 })); await flush();
      h.setResponder(async (url, init) => {
        if (url.endsWith('/validate')) { callbackEntered.resolve(); return callbackResponse.promise; }
        if (new URLSearchParams(String(init?.body)).get('grant_type') === 'refresh_token') {
          refreshEntered.resolve(); return refreshResponse.promise;
        }
        return json({ access_token: 'callback-access', refresh_token: 'callback-refresh' });
      });
      const refresh = assert.rejects(h.auth.refresh(), /sign-in changed/);
      const { state } = h.auth.authorize();
      const callback = assert.rejects(h.auth.callback('code', state, state), /sign-in changed/);
      await Promise.all([refreshEntered.promise, callbackEntered.promise]);
      socket.message({ metadata: control('revocation', null).metadata, payload: { subscription: { type: 'channel.chat.message', status: reason } } });
      assert.equal(socket.closed, true);
      refreshResponse.resolve(json({ access_token: 'rotated-access', refresh_token: 'rotated-refresh' }));
      callbackResponse.resolve(json(userInfo));
      await Promise.all([refresh, callback]);
      assert.equal(h.auth.status().credentialsAvailable, false);
      assert.equal(existsSync(h.config.tokenPath), false);
      assert.equal(live.status().connection, 'disconnected');
    } finally { live.stop(); store.close(); h.close(); }
  });
}

test('rotated credentials survive validation outage and restart, stay quarantined, and recover without the obsolete refresh token', async () => {
  const h = authHarness(); let unavailable = true, exchanges = 0, apiCalls = 0;
  try {
    await h.login(); h.setTime(now + 3600000);
    h.setResponder(async (url, init) => {
      if (url.endsWith('/validate')) return unavailable ? json({}, 503) : json(userInfo);
      exchanges++;
      assert.equal(new URLSearchParams(String(init?.body)).get('refresh_token'), exchanges === 1 ? 'test-refresh-1' : 'rotated-refresh');
      return json({ access_token: `rotated-access-${exchanges}`, refresh_token: exchanges === 1 ? 'rotated-refresh' : 'newest-refresh' });
    });
    await assert.rejects(h.auth.accessToken(), /503/);
    const saved = JSON.parse(readFileSync(h.config.tokenPath, 'utf8'));
    assert.equal(saved.refresh_token, 'rotated-refresh'); assert.equal(saved.pendingValidation, true);
    assert.equal(statSync(h.config.tokenPath).mode & 0o777, 0o600);
    assert.equal(h.auth.status().authenticated, false);
    const restored = new TwitchAuth(h.config, h.fetcher, () => now + 3600000);
    const api = new Helix(restored, 'test-client', async (_url, init) => {
      apiCalls++; assert.equal((init!.headers as Record<string, string>).Authorization, 'Bearer rotated-access-1');
      return json({ data: [] });
    });
    await assert.rejects(api.request('streams'), /503/);
    assert.equal(apiCalls, 0); assert.equal(exchanges, 1);
    unavailable = false;
    assert.equal((await api.request('streams')).status, 200);
    assert.equal(apiCalls, 1); assert.equal(exchanges, 1);
    assert.equal(restored.status().authenticated, true);
    assert.equal(JSON.parse(readFileSync(h.config.tokenPath, 'utf8')).pendingValidation, undefined);
    await restored.refresh(); // The next rotation must use the recovered refresh token.
    assert.equal(exchanges, 2);
    assert.equal(JSON.parse(readFileSync(h.config.tokenPath, 'utf8')).refresh_token, 'newest-refresh');
  } finally { h.close(); }
});

test('logout during retry of quarantined validation defeats its late success', async () => {
  const h = authHarness(), entered = deferred<void>(), response = deferred<Response>();
  try {
    await h.login();
    h.setResponder(async url => url.endsWith('/token') ? json({ access_token: 'rotated-access', refresh_token: 'rotated-refresh' }) : json({}, 503));
    await assert.rejects(h.auth.refresh(), /503/);
    h.setResponder(async () => { entered.resolve(); return response.promise; });
    const retry = assert.rejects(h.auth.accessToken(), /sign-in changed/);
    await entered.promise; h.auth.clear(); response.resolve(json(userInfo)); await retry;
    assert.equal(existsSync(h.config.tokenPath), false);
    assert.equal(h.auth.status().credentialsAvailable, false);
  } finally { h.close(); }
});

test('authoritative rejection of a quarantined rotated token removes the entire grant', async () => {
  const h = authHarness();
  try {
    await h.login();
    h.setResponder(async url => url.endsWith('/token') ? json({ access_token: 'rotated-access', refresh_token: 'rotated-refresh' }) : json({}, 401));
    await assert.rejects(h.auth.refresh(), /401/);
    assert.equal(h.auth.status().credentialsAvailable, false);
    assert.equal(existsSync(h.config.tokenPath), false);
  } finally { h.close(); }
});

test('late Helix responses after logout cannot trigger a refresh of a newer login', async () => {
  const h = authHarness(), entered = deferred<void>(), response = deferred<Response>();
  try {
    await h.login();
    const api = new Helix(h.auth, 'test-client', async () => { entered.resolve(); return response.promise; });
    const pending = assert.rejects(api.request('streams'), /sign-in changed/);
    await entered.promise; h.auth.clear(); await h.login();
    const exchanges = h.calls.filter(c => c.url.endsWith('/token')).length;
    response.resolve(json({}, 401)); await pending;
    assert.equal(h.calls.filter(c => c.url.endsWith('/token')).length, exchanges);
    assert.equal(h.auth.status().authenticated, true);
  } finally { h.close(); }
});

test('a late callback cannot overwrite a fresh login after logout', async () => {
  const h = authHarness(), entered = deferred<void>(), response = deferred<Response>();
  try {
    const { state } = h.auth.authorize();
    h.setResponder(async url => {
      if (url.endsWith('/validate')) { entered.resolve(); return response.promise; }
      return json({ access_token: 'obsolete-callback', refresh_token: 'obsolete-refresh' });
    });
    const old = assert.rejects(h.auth.callback('old-code', state, state), /sign-in changed/);
    await entered.promise; h.auth.clear(); h.setResponder(); await h.login();
    const current = readFileSync(h.config.tokenPath, 'utf8');
    response.resolve(json(userInfo)); await old;
    assert.equal(readFileSync(h.config.tokenPath, 'utf8'), current);
    assert.equal(h.auth.status().authenticated, true);
  } finally { h.close(); }
});

test('live service resumes quarantined authorization after a validation outage without a presentation callback', async () => {
  const h = authHarness(), store = new Store(':memory:'), socket = new FakeSocket(); let time = now, unavailable = false;
  const api = new Helix(h.auth, 'test-client', async url => url.includes('/streams?') ?
    json({ data: [{ id: 'outage-stream', user_id: '42', started_at: new Date(0).toISOString() }] }) : json({ data: [] }, 202));
  const live = new LiveTwitch(h.auth, api, store, { features: ['raid'], rewardId: null, botIds: [] }, () => time, () => socket);
  try {
    await h.login(); await live.connect();
    socket.message(control('session_welcome', { id: 'session', keepalive_timeout_seconds: 10 })); await flush();
    const sessionId = live.status().activeSessionId!;
    time += 3600000; h.setTime(time); unavailable = true;
    h.setResponder(async url => url.endsWith('/token') ? json({ access_token: 'rotated-access', refresh_token: 'rotated-refresh' }) :
      unavailable ? json({}, 503) : json(userInfo));
    socket.message(control('session_keepalive', null)); await live.tick();
    assert.equal(live.status().auth.authenticated, false);
    live.notification(envelope(wire('channel.raid', { to_broadcaster_user_id: '42', viewers: 5 }, 'during-outage'))!, time);
    assert.equal(store.bookmarks(sessionId).length, 0);
    assert.ok(store.gaps(sessionId).some(g => g.reason.includes('ingestion suspended')));
    time += 1000; h.setTime(time); unavailable = false;
    socket.message(control('session_keepalive', null)); await live.tick();
    assert.equal(live.status().auth.authenticated, true);
    assert.ok(store.gaps(sessionId).some(g => g.reason.includes('validation recovered')));
    const after = wire('channel.raid', { to_broadcaster_user_id: '42', viewers: 5 }, 'after-outage');
    after.metadata.message_timestamp = new Date(time).toISOString();
    live.notification(envelope(after)!, time);
    assert.equal(store.bookmarks(sessionId).length, 1);
    assert.equal(store.bookmarks(sessionId)[0]!.detectedOffsetSeconds, time / 1000);
  } finally { live.stop(); store.close(); h.close(); }
});

test('same-broadcast configuration recovery preserves history/origin/dedup and applies current reward, bots and detector rules', async () => {
  const h = authHarness(), directory = mkdtempSync(join(tmpdir(), 'streamdirector-config-'));
  const path = join(directory, 'sessions.sqlite'); let store = new Store(path), time = now;
  const api = new Helix(h.auth, 'test-client', async () => json({ data: [{ id: 'same-broadcast', user_id: '42', started_at: new Date(0).toISOString() }] }));
  const makeLive = (rewardId: string, botIds: string[], minimumRate: number) => new LiveTwitch(h.auth, api, store,
    { features: ['chat', 'redemptions'], rewardId, botIds, settings: { minimumRate, warmupSeconds: 1,
      allowedLatenessSeconds: 0, activitySeconds: 3, correlationSeconds: 0 } }, () => time);
  const send = (live: LiveTwitch, type: string, event: Record<string, unknown>, id: string) => {
    const message = wire(type, event, id); message.metadata.message_timestamp = new Date(time).toISOString();
    live.notification(envelope(message)!, time);
  };
  const reward = (id: string, rewardId: string) => ({ id, reward: { id: rewardId }, redeemed_at: new Date(time).toISOString() });
  const redemptionType = 'channel.channel_points_custom_reward_redemption.add';
  try {
    await h.login();
    let live = makeLive('old-reward', ['old-bot'], 99); await live.pollStream();
    const sessionId = live.status().activeSessionId!;
    send(live, redemptionType, reward('old-redemption', 'old-reward'), 'old-transport');
    send(live, 'channel.chat.message', { message_id: 'old-excluded-message', chatter_user_id: 'old-bot' }, 'old-chat-transport');
    const originalBookmark = store.bookmarks(sessionId)[0]!;
    const originalSession = store.session(sessionId).session;
    live.stop(); store.close(); store = new Store(path); time += 20000;
    live = makeLive('new-reward', ['new-bot'], 1); await live.pollStream();
    const recovered = store.session(sessionId).session;
    assert.equal(recovered.startedAtMs, originalSession.startedAtMs);
    assert.equal(recovered.streamStartedAtMs, 0); assert.equal(recovered.streamId, 'same-broadcast');
    assert.equal(recovered.settings.rewardId, 'new-reward');
    assert.deepEqual(recovered.settings.excludedUserIds, ['new-bot']);
    assert.deepEqual(recovered.settingsHistory!.map(x => [x.revision, x.settings.rewardId, x.settings.minimumRate]),
      [[0, 'old-reward', 99], [1, 'new-reward', 1]]);
    assert.equal(live.status().detector!.warm, false);
    // The same source is not replayed after reconfiguration, even with a fresh transport ID.
    send(live, redemptionType, reward('old-redemption', 'new-reward'), 'fresh-transport');
    send(live, redemptionType, reward('obsolete-reward-message', 'old-reward'), 'obsolete-transport');
    assert.equal(store.bookmarks(sessionId).length, 1);
    send(live, redemptionType, reward('new-redemption', 'new-reward'), 'new-transport');
    assert.equal(store.bookmarks(sessionId).length, 2);
    assert.equal(store.bookmarks(sessionId)[1]!.settingsRevision, 1);
    assert.equal(store.bookmarks(sessionId)[1]!.detectedOffsetSeconds, time / 1000);
    // The old bot is now a normal participant; the newly configured bot is excluded.
    for (let second = 0; second < 3; second++) {
      time = now + 21000 + second * 1000;
      send(live, 'channel.chat.message', { message_id: 'old-excluded-message', chatter_user_id: 'old-bot' }, `redelivery-${second}`);
      for (const user of ['old-bot', 'viewer-a', 'viewer-b', 'new-bot']) {
        const id = `${second}:${user}`;
        send(live, 'channel.chat.message', { message_id: id, chatter_user_id: user }, id);
      }
    }
    time += 1000;
    // An excluded message still advances the last completed bucket without adding a chatter.
    send(live, 'channel.chat.message', { message_id: 'final-bot', chatter_user_id: 'new-bot' }, 'final-bot');
    const bookmarks = store.bookmarks(sessionId);
    assert.deepEqual(bookmarks[0], originalBookmark);
    assert.deepEqual(bookmarks.map(b => b.id), [`${sessionId}:1`, `${sessionId}:2`, `${sessionId}:3`]);
    const chat = bookmarks.find(b => b.signal === 'chat')!;
    assert.equal(chat.onsetMs, now + 21000); assert.equal(chat.settingsRevision, 1);
    assert.equal(chat.metrics.distinctChatters, 3); assert.equal(chat.metrics.rate, 3);
    assert.ok(chat.sourceIds.some(id => id.endsWith(':old-bot')));
    assert.ok(chat.sourceIds.every(id => !id.endsWith(':new-bot') && id !== 'old-excluded-message'));
    assert.ok(store.gaps(sessionId).some(g => g.reason.includes('settings changed')));
    // A second restart with the same active configuration creates no spurious revision.
    live.stop(); store.close(); store = new Store(path); time += 1000;
    live = makeLive('new-reward', ['new-bot'], 1); await live.pollStream();
    assert.equal(store.session(sessionId).session.settingsHistory!.length, 2);
    send(live, redemptionType, reward('new-redemption', 'new-reward'), 'second-restart-transport');
    assert.equal(store.bookmarks(sessionId).length, 3); live.stop();
  } finally { store.close(); h.close(); rmSync(directory, { recursive: true }); }
});
test('retained official Twitch CLI wire fixtures normalize and persist as six simulated platform bookmarks', () => {
  const fixture = JSON.parse(readFileSync('evidence/checkpoint-2/simulated-cli/wire-fixtures.json', 'utf8'));
  const messages = fixture.notifications.map((raw: unknown) => envelope(raw));
  assert.equal(messages.length, 6); assert.ok(messages.every(Boolean));
  const inputs = messages.map((message: any) => normalize(message, '42', Date.parse(message.metadata.message_timestamp))!);
  let time = Math.min(...inputs.map((input: any) => input.receivedAtMs));
  const store = new Store(':memory:');
  try {
    const session = { id: 'retained-cli', mode: 'simulated' as const, streamId: 'SIMULATED-CLI',
      startedAtMs: time, streamStartedAtMs: time - 60000, settings: settings({ broadcasterId: '42', rewardId: 'mark' }) };
    const recorder = new Recorder(store, session, () => time);
    for (const input of inputs) { time = input.receivedAtMs; recorder.ingest(input); }
    assert.deepEqual(store.bookmarks(session.id).map(b => b.signal).sort(), ['cheer', 'gift', 'raid', 'redemption', 'resubscription', 'subscription']);
    assert.equal(store.session(session.id).session.mode, 'simulated');
  } finally { store.close(); }
});

test('controlled interruption exercises unexpected-disconnect coverage, holdoff and automatic subscription recovery',async()=>{
  let time=now,subscriptions=0;const sockets:FakeSocket[]=[],gaps:string[]=[];
  const client=new EventSubClient({clock:()=>time,socketFactory:()=>{const socket=new FakeSocket();sockets.push(socket);return socket;},
    subscribe:async()=>{subscriptions++;},notification:()=>{},revocation:()=>{},status:()=>{},gap:(_start,_end,reason)=>gaps.push(reason)});
  try{
    client.start();sockets[0]!.message(control('session_welcome',{id:'first',keepalive_timeout_seconds:10}));await flush();
    client.interruptForVerification(8);assert.equal(sockets[0]!.closed,true);assert.match(gaps[0]!,/controlled/);
    time+=7000;client.tick();assert.equal(sockets.length,1);time+=1000;client.tick();assert.equal(sockets.length,2);
    sockets[1]!.message(control('session_welcome',{id:'second',keepalive_timeout_seconds:10}));await flush();
    assert.equal(subscriptions,2);assert.equal(gaps.length,2);
  }finally{client.stop();}
});

test('dashboard settings apply to the same stream with history/dedup intact and presentation exceptions stay isolated',async()=>{
  const h=authHarness(),store=new Store(':memory:');let time=now;
  try{
    await h.login();
    const api=new Helix(h.auth,'test-client',async()=>json({data:[{id:'dashboard-settings',user_id:'42',started_at:new Date(0).toISOString()}]}));
    const live=new LiveTwitch(h.auth,api,store,{features:['raid'],rewardId:null,botIds:[]},()=>time);await live.pollStream();
    live.onChanges=()=>{throw new Error('broken renderer');};
    const message=envelope(wire('channel.raid',{to_broadcaster_user_id:'42',viewers:5},'first'))!;live.notification(message,time);
    const id=live.status().activeSessionId!,original=store.bookmarks(id)[0]!;
    time+=1000;live.updateSettings({leadInSeconds:5,alignmentSeconds:2});
    live.notification(message,time);assert.equal(store.bookmarks(id).length,1);assert.deepEqual(store.bookmarks(id)[0],original);
    assert.equal(store.session(id).session.settingsHistory!.length,2);assert.equal(store.appSettings().leadInSeconds,5);
    assert.throws(()=>live.updateSettings({minimumRate:-1}));assert.throws(()=>live.updateSettings({broadcasterId:123}));
    live.stop();h.auth.clear();live.updateSettings({leadInSeconds:6});assert.equal(store.appSettings().leadInSeconds,6);
  }finally{store.close();h.close();}
});

test('notification, gap and diagnostic callback failures cannot break EventSub retry state',async()=>{
  let time=now;const sockets:FakeSocket[]=[],states:string[]=[];
  const client=new EventSubClient({clock:()=>time,socketFactory:()=>{const s=new FakeSocket();sockets.push(s);return s;},
    subscribe:async()=>{},notification:()=>{throw new Error('private event');},gap:()=>{throw new Error('private storage');},
    failure:()=>{throw new Error('broken diagnostics');},status:value=>states.push(value),revocation:()=>{}});
  try{
    client.start();sockets[0]!.message(control('session_welcome',{id:'old',keepalive_timeout_seconds:10}));await flush();
    sockets[0]!.message(control('notification',{}));await flush();await flush();
    time+=1001;client.tick();assert.equal(sockets.length,2);
    sockets[1]!.message(control('session_welcome',{id:'new',keepalive_timeout_seconds:10}));await flush();
    assert.equal(states.at(-1),'connected');
  }finally{client.stop();}
});

test('write outage blocks ingestion until the coverage gap is durable, without logger failure escaping',async()=>{
  class FailingStore extends Store{
    failWrites=false;failDiagnostics=false;
    override commit(...args:Parameters<Store['commit']>){if(this.failWrites)throw Object.assign(new Error('PRIVATE storage detail'),{code:'ERR_SQLITE_ERROR'});return super.commit(...args);}
    override integrationEvent(...args:Parameters<Store['integrationEvent']>){if(this.failDiagnostics)throw new Error('PRIVATE log detail');return super.integrationEvent(...args);}
  }
  const h=authHarness(),store=new FailingStore(':memory:'),sockets:FakeSocket[]=[];let time=now;
  const api=new Helix(h.auth,'test-client',async url=>url.includes('/streams?')?json({data:[{id:'durable-gap',user_id:'42',started_at:new Date(0).toISOString()}]}):json({},202));
  const live=new LiveTwitch(h.auth,api,store,{features:['raid'],rewardId:null,botIds:[]},()=>time,()=>{const s=new FakeSocket();sockets.push(s);return s;});
  try{
    await h.login();await live.connect();sockets[0]!.message(control('session_welcome',{id:'one',keepalive_timeout_seconds:10}));await flush();
    const sid=live.status().activeSessionId!;live.manual();
    store.failWrites=true;store.failDiagnostics=true;
    sockets[0]!.message(wire('channel.raid',{to_broadcaster_user_id:'42',viewers:5},'write-fails'));await flush();await flush();
    assert.equal(live.status().coveragePersistencePending,true);assert.ok(live.status().diagnosticWriteFailures>0);
    assert.equal(store.bookmarks(sid).length,1);assert.throws(()=>live.manual(),/Coverage persistence/);
    await live.tick();assert.equal(live.status().coveragePersistencePending,true);
    live.notification(envelope(wire('channel.raid',{to_broadcaster_user_id:'42',viewers:5},'while-pending'))!,time);
    assert.equal(store.bookmarks(sid).length,1);
    store.failWrites=false;store.failDiagnostics=false;time+=2000;h.setTime(time);await live.tick();
    assert.equal(live.status().coveragePersistencePending,false);
    assert.ok(store.gaps(sid).some(g=>g.reason.includes('persistence failure')));
    live.manual();assert.equal(store.bookmarks(sid).length,2);
    assert.ok(!JSON.stringify(live.status()).includes('PRIVATE'));
  }finally{live.stop();store.close();h.close();}
});

for(const mode of ['explicit reconnect','socket retry']as const)test(`late subscription response cannot overwrite a newer ${mode}`,async()=>{
  const h=authHarness(),store=new Store(':memory:'),pending=deferred<Response>(),sockets:FakeSocket[]=[];let time=now,posts=0;
  const api=new Helix(h.auth,'test-client',async url=>url.includes('/streams?')?json({data:[]}):++posts===1?pending.promise:json({},202));
  const live=new LiveTwitch(h.auth,api,store,{features:['chat'],rewardId:null,botIds:[]},()=>time,()=>{const s=new FakeSocket();sockets.push(s);return s;});
  try{
    await h.login();await live.connect();sockets[0]!.message(control('session_welcome',{id:'old',keepalive_timeout_seconds:10}));await flush();
    if(mode==='explicit reconnect')await live.connect();else{time+=11000;h.setTime(time);await live.tick();time+=1001;h.setTime(time);await live.tick();}
    sockets[1]!.message(control('session_welcome',{id:'new',keepalive_timeout_seconds:10}));await flush();
    assert.deepEqual(live.status().subscriptions['channel.chat.message'],{state:'enabled',httpStatus:202});
    pending.resolve(json({message:'PRIVATE response'},400));await flush();await flush();
    assert.deepEqual(live.status().subscriptions['channel.chat.message'],{state:'enabled',httpStatus:202});
    assert.equal(live.status().connection,'connected');assert.equal(live.status().warning,undefined);
  }finally{live.stop();store.close();h.close();}
});

test('sanitized operation categories identify stream failures and clear only after that operation recovers',async()=>{
  const h=authHarness(),store=new Store(':memory:'),socket=new FakeSocket();let time=now,status=200;
  const api=new Helix(h.auth,'test-client',async url=>url.includes('/streams?')?json(status===200?{data:[]}:{message:'PRIVATE CHAT token=SECRET'},status):json({},202));
  const live=new LiveTwitch(h.auth,api,store,{features:['raid'],rewardId:null,botIds:[]},()=>time,()=>socket);
  try{
    await h.login();await live.connect();socket.message(control('session_welcome',{id:'safe',keepalive_timeout_seconds:100}));await flush();
    time+=16000;h.setTime(time);status=503;await live.tick();
    const failure=live.status().lastFailure as {operation:string;category:string;httpStatus:number};
    assert.equal(failure.operation,'stream_lookup');assert.equal(failure.category,'upstream');assert.equal(failure.httpStatus,503);
    assert.ok(!JSON.stringify(live.status()).includes('PRIVATE'));assert.ok(!JSON.stringify(live.status()).includes('SECRET'));
    time+=16000;h.setTime(time);status=200;await live.tick();assert.equal(live.status().warning,undefined);
    assert.ok((live.status().lastFailure as {recoveredAtMs:number}).recoveredAtMs);
  }finally{live.stop();store.close();h.close();}
});

test('diagnostics never reflect error messages, stacks, arbitrary codes or misleading public prefixes',()=>{
  const privateText='Twitch API PRIVATE_CHAT Bearer SECRET https://example.invalid/?token=SECRET';
  const errors=[new Error(privateText),Object.assign(new Error(privateText),{code:privateText}),
    new IntegrationFailure('upstream',privateText,503),Object.assign(new Error(privateText),{name:'TimeoutError'}),
    Object.assign(new Error(privateText),{code:'ERR_SQLITE_ERROR'})];
  const output=JSON.stringify(errors.map(error=>({fields:failureFields(error),public:publicFailure(error)})));
  assert.ok(!output.includes('PRIVATE_CHAT'));assert.ok(!output.includes('SECRET'));assert.ok(!output.includes('example.invalid'));
  assert.deepEqual(errors.map(error=>failureFields(error).category),['unknown','unknown','upstream','timeout','storage']);
});

for(const next of ['offline','new broadcast']as const)test(`a pending stream poll cannot discard an unpersisted gap on ${next}`,async()=>{
  class FailingStore extends Store{
    fail=false;
    override commit(...args:Parameters<Store['commit']>){if(this.fail)throw Object.assign(new Error('private disk details'),{code:'SQLITE_FULL'});return super.commit(...args);}
  }
  const h=authHarness(),store=new FailingStore(':memory:'),socket=new FakeSocket(),pending=deferred<Response>();let polls=0;
  const stream=(id:string)=>({id,user_id:'42',started_at:new Date(0).toISOString()});
  const nextData=next==='offline'?[]:[stream('replacement')];
  const api=new Helix(h.auth,'test-client',async url=>url.includes('/streams?')?++polls===1?json({data:[stream('original')]}):polls===2?pending.promise:json({data:nextData}):json({},202));
  const live=new LiveTwitch(h.auth,api,store,{features:['raid'],rewardId:null,botIds:[]},()=>now,()=>socket);
  try{
    await h.login();await live.connect();socket.message(control('session_welcome',{id:'one',keepalive_timeout_seconds:10}));await flush();
    const oldSession=live.status().activeSessionId!;const polling=live.pollStream();await flush();
    store.fail=true;socket.message(wire('channel.raid',{to_broadcaster_user_id:'42',viewers:5},'disk-failure'));await flush();await flush();
    assert.equal(live.status().coveragePersistencePending,true);pending.resolve(json({data:nextData}));
    await assert.rejects(polling,/Coverage persistence/);assert.equal(live.status().activeSessionId,oldSession);
    assert.equal(live.status().coveragePersistencePending,true);assert.equal(store.gaps(oldSession).length,0);
    store.fail=false;await live.pollStream();assert.ok(store.gaps(oldSession).length>0);
    assert.equal(live.status().coveragePersistencePending,false);
    assert.equal(live.status().activeSessionId,next==='offline'?null:'twitch:42:replacement');
  }finally{live.stop();store.close();h.close();}
});
