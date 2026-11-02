import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { once } from 'node:events';
import { configuration, createBackend } from '../src/server.ts';
import { Recorder } from '../src/store.ts';
import { settings } from '../src/types.ts';

test('configuration enables only selected scopes/features and does not accept invalid ports/features', () => {
  const minimal = configuration({ TWITCH_FEATURES: 'chat,raid' });
  assert.deepEqual(minimal.features, ['chat', 'raid']);
  assert.equal(minimal.redirectUri, 'http://localhost:4387/auth/twitch/callback');
  assert.ok(configuration({ TWITCH_REWARD_ID: 'mark' }).features.includes('redemptions'));
  assert.throws(() => configuration({ PORT: '80' }));
  assert.throws(() => configuration({ TWITCH_FEATURES: 'write-chat' }));
});

test('loopback HTTP backend rejects foreign hosts/origins and unauthenticated controls; status never exposes secrets', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'streamdirector-http-'));
  const backend = createBackend({ ...configuration({ TWITCH_CLIENT_ID: 'mock-client', TWITCH_CLIENT_SECRET: 'MOCK-SECRET' }), dataDirectory: directory });
  const call = (path: string, method = 'GET', headers: Record<string, string> = {}) => new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
    const address = backend.server.address();
    if (!address || typeof address === 'string') throw new Error('Server is not listening');
    const req = request({ host: '127.0.0.1', port: address.port, path, method, headers: { Host: 'localhost:4387', ...headers } }, res => {
      let body = ''; res.on('data', bytes => { body += String(bytes); });
      res.on('end', () => resolve({ status: res.statusCode!, body, headers: res.headers }));
    }); req.on('error', reject); req.end();
  });
  try {
    backend.server.listen(0, '127.0.0.1'); await once(backend.server, 'listening');
    assert.equal((await call('/api/status')).status, 200);
    const dashboard=await call('/');assert.equal(dashboard.status,200);assert.match(dashboard.body,/dashboard.js/);
    const dashboardCookie=String((dashboard.headers['set-cookie'] as string[])[0]).split(';')[0]!;
    assert.match(String(dashboard.headers['set-cookie']),/HttpOnly; SameSite=Strict; Path=\/api\/control/);
    assert.ok(!dashboard.body.includes(readFileSync(join(directory,'control-token.txt'),'utf8').trim()));
    assert.equal((await call('/api/control/settings','POST',{Cookie:dashboardCookie})).status,401);
    assert.equal((await call('/api/control/settings','POST',{Cookie:dashboardCookie,Origin:'http://localhost:4388','X-StreamDirector-Control':'dashboard'})).status,403);
    assert.equal((await call('/api/control/settings','POST',{Cookie:dashboardCookie,Origin:'http://localhost:4387','X-StreamDirector-Control':'dashboard'})).status,200);
    assert.ok(!(await call('/api/status')).body.includes('MOCK-SECRET'));
    assert.equal((await call('/api/status', 'GET', { Host: 'attacker.example' })).status, 403);
    assert.equal((await call('/api/status', 'GET', { Origin: 'https://attacker.example' })).status, 403);
    assert.equal((await call('/api/mark', 'POST')).status, 401);
    const token = readFileSync(join(directory, 'control-token.txt'), 'utf8').trim();
    const manual = await call('/api/mark', 'POST', { Authorization: `Bearer ${token}` });
    assert.equal(manual.status, 400); assert.match(manual.body, /verified active Twitch stream/);
    const auth = await call('/auth/twitch');
    assert.equal(auth.status, 302); assert.ok(String(auth.headers.location).startsWith('https://id.twitch.tv/oauth2/authorize?'));
    assert.ok(!JSON.stringify(auth.headers).includes('MOCK-SECRET'));
    const callback = await call('/auth/twitch/callback?code=fake&state=wrong');
    assert.equal(callback.status, 400); assert.match(callback.body, /OAuth state/);
    assert.ok(!JSON.stringify(await call('/api/evidence')).includes('code=fake'));
    const recorder = new Recorder(backend.store, { id: 'http-export-test', mode: 'simulated', streamId: 'synthetic',
      startedAtMs: 0, streamStartedAtMs: 0, settings: settings() }, () => 0);
    for (const id of ['a', 'b']) recorder.ingest({ type: 'manual', sourceId: id, transportId: id, sourceTimeMs: 0, receivedAtMs: 0 });
    const base = '/api/export?sessionId=http-export-test&format=edl&startTimecode=01:00:00:00';
    assert.equal((await call(base)).status, 400);
    const collision = await call(base + '&fps=30');
    assert.equal(collision.status, 400); assert.match(collision.body, /same timeline frame/);
    const selected = await call(base + '&fps=30&bookmarkId=http-export-test%3A1');
    assert.equal(selected.status, 200); assert.match(selected.body, /FCM: NON-DROP FRAME/); assert.match(selected.body, /01:00:00:00/);
    assert.equal((await call(base + '&fps=60&bookmarkId=missing')).status, 404);
    const remapped=await call(base+'&fps=30&bookmarkId=http-export-test%3A1&alignmentSeconds=2&leadInSeconds=0');
    assert.equal(remapped.status,200);assert.match(remapped.body,/01:00:02:00/);
    assert.equal(backend.store.bookmarks('http-export-test')[0]!.editorOffsetSeconds,0);
    assert.equal((await call(base+'&fps=30&alignmentSeconds=Infinity&leadInSeconds=0')).status,400);
    const snapshot=JSON.parse((await call('/api/snapshot?sessionId=http-export-test')).body);
    assert.equal(snapshot.bookmarks.length,2);assert.equal(snapshot.total,2);assert.match(snapshot.overlayUrl,/4388/);
    backend.overlayServer.listen(0,'127.0.0.1');await once(backend.overlayServer,'listening');
    const overlayAddress=backend.overlayServer.address();assert.ok(overlayAddress&&typeof overlayAddress!=='string');
    const overlayCall=(path:string,method='GET')=>new Promise<{status:number;body:string;cookie:unknown}>((resolve,reject)=>{
      const req=request({host:'127.0.0.1',port:overlayAddress.port,path,method,headers:{Host:'localhost:4388',Authorization:`Bearer ${token}`}},res=>{
        let body='';res.on('data',bytes=>{body+=String(bytes);});res.on('end',()=>resolve({status:res.statusCode!,body,cookie:res.headers['set-cookie']}));
      });req.on('error',reject);req.end();
    });
    assert.equal((await overlayCall('/api/control/mark','POST')).status,405);
    assert.equal((await overlayCall('/api/status')).status,404);
    assert.equal((await overlayCall('/assets/dashboard.js')).status,404);
    const overlay=await overlayCall('/overlay');assert.equal(overlay.status,200);assert.equal(overlay.cookie,undefined);assert.match(overlay.body,/overlay.js/);
  } finally { backend.close(); rmSync(directory, { recursive: true }); }
});
