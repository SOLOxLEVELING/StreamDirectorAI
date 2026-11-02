import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EventSubClient } from '../src/twitch/eventsub.ts';
import { envelope, normalize, subscription, eventTypes } from '../src/twitch/schema.ts';
import { Store, Recorder } from '../src/store.ts';
import { settings } from '../src/types.ts';
import { exportCsv, exportJson } from '../src/exports.ts';

// This never connects to Twitch or reads .env. Every session/artifact is SIMULATED.
const cli = resolve(process.argv[2] ?? 'output/tools/twitch-cli_1.1.24_Darwin_arm64/twitch');
const evidence = resolve('evidence/checkpoint-2/simulated-cli'); mkdirSync(evidence, { recursive: true });
const base = 'http://127.0.0.1:4888';
let log = ''; let started = false;
const child = spawn(cli, ['event', 'websocket', 'start-server', '--port=4888', '--require-subscription']);
child.stdout.on('data', bytes => { log += String(bytes); started ||= log.includes('Started WebSocket server'); });
child.stderr.on('data', bytes => { log += String(bytes); started ||= log.includes('Started WebSocket server'); });
const waitFor = async (condition: () => boolean) => {
  const deadline = Date.now() + 10000;
  while (!condition()) { if (Date.now() > deadline) throw new Error('Simulation timeout'); await new Promise(r => setTimeout(r, 25)); }
};
const store = new Store(':memory:');
const start = Date.now();
const session = { id: `cli-simulated:${start}`, mode: 'simulated' as const, streamId: 'SIMULATED-CLI-stream',
  streamStartedAtMs: start - 60000, startedAtMs: start, settings: settings({ broadcasterId: '42', rewardId: 'mark' }) };
let processingReceipt: number | null = null;
const recorder = new Recorder(store, session, () => processingReceipt ?? Date.now());
let connected = false; let notifications = 0;
const rawNotifications: unknown[] = [], statuses: string[] = [];
const outcomes: unknown[] = [];
const client = new EventSubClient({ endpoint: 'ws://127.0.0.1:4888/ws', simulated: true,
  subscribe: async id => {
    for (const type of eventTypes.filter(t => t !== 'channel.chat.message')) {
      const response = await fetch(`${base}/eventsub/subscriptions`, { method: 'POST', headers: {
        'Content-Type': 'application/json', 'Client-Id': 'SIMULATED-CLI-client', Authorization: 'Bearer SIMULATED-CLI-token' },
        body: JSON.stringify(subscription(type, '42', id, 'mark')) });
      if (response.status !== 202) { log += `Mock ${type}: ${response.status} ${await response.text()}\n`; throw new Error(`Mock subscription failed ${response.status}`); }
    }
  },
  notification: (message, receipt) => {
    notifications++; rawNotifications.push(message);
    const input = normalize(message, '42', receipt);
    if (!input) throw new Error('CLI event failed adapter normalization');
    processingReceipt = receipt;
    try {
      const result = recorder.ingest(input);
      outcomes.push({ type: input.type, rewardId: input.rewardId, disposition: result.disposition });
    } finally { processingReceipt = null; }
  },
  gap: (from, to, reason) => { recorder.connectionGap(Math.max(from, start), to, reason); },
  revocation: () => {}, status: state => { statuses.push(state); if (state === 'connected') connected = true; },
});
const timer = setInterval(() => { client.tick(); recorder.tick(); }, 100);
try {
  await waitFor(() => started); client.start(); await waitFor(() => connected);
  const triggers = ['channel.raid', 'channel.subscribe', 'channel.subscription.gift', 'channel.subscription.message',
    'channel.cheer', 'channel.channel_points_custom_reward_redemption.add'];
  for (const [index, type] of triggers.entries()) {
    const args = ['event', 'trigger', type, '--transport=websocket', '--to-user=42', '--from-user=43',
      '--cost=100', '--item-id=mark', `--event-id=simulation-${index}`, '--no-config'];
    const result = spawnSync(cli, args, { encoding: 'utf8' }); log += result.stdout + result.stderr;
    if (result.status !== 0) throw new Error(`CLI trigger failed: ${type}`);
    await waitFor(() => notifications >= index + 1);
  }
  const reconnect = spawnSync(cli, ['event', 'websocket', 'reconnect', '--port=4888'], { encoding: 'utf8' });
  log += reconnect.stdout + reconnect.stderr;
  await waitFor(() => statuses.filter(s => s === 'connected').length >= 2);
  const bookmarks = store.bookmarks(session.id);
  writeFileSync(`${evidence}/wire-fixtures.json`, JSON.stringify({ provenance: 'SIMULATED: official Twitch CLI 1.1.24', notifications: rawNotifications }, null, 2));
  if (bookmarks.length !== 6 || bookmarks.some(b => b.tier !== 'banner')) throw new Error(`Unexpected simulation bookmarks: ${bookmarks.length}; ${JSON.stringify(outcomes)}`);
  writeFileSync(`${evidence}/bookmarks.json`, exportJson(session, bookmarks, store.gaps(session.id)));
  writeFileSync(`${evidence}/bookmarks.csv`, exportCsv(bookmarks));
  writeFileSync(`${evidence}/wire-fixtures.json`, JSON.stringify({ provenance: 'SIMULATED: official Twitch CLI 1.1.24', notifications: rawNotifications }, null, 2));
  writeFileSync(`${evidence}/results.json`, JSON.stringify({ provenance: 'simulated', cliVersion: '1.1.24', notifications,
    bookmarks: bookmarks.length, signals: bookmarks.map(b => b.signal), statuses, coverageGaps: store.gaps(session.id) }, null, 2));
  console.log(`SIMULATED Twitch CLI: ${notifications} events → ${bookmarks.length} persisted banner bookmarks; requested reconnect completed.`);
} finally {
  clearInterval(timer); client.stop(); child.kill('SIGTERM'); store.close();
  writeFileSync(`${evidence}/cli-log.txt`, log + '\nClient states: ' + JSON.stringify(statuses));
}
