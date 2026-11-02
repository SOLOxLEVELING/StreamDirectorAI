import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store } from './store.ts';
import { exportCsv, exportJson, exportResolveEdl } from './exports.ts';
import { TwitchAuth, Helix } from './twitch/auth.ts';
import { LiveTwitch } from './twitch/live.ts';
import { enabledTypes, scopesFor } from './twitch/schema.ts';
import type { Feature } from './twitch/schema.ts';
import { EventHub } from './presentation.ts';
import { Simulation } from './simulation.ts';
import { page } from './web-pages.ts';
import { CaptionWorker } from './captions.ts';
import { publicFailure, failureFields } from './twitch/diagnostics.ts';

export function configuration(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.PORT ?? 4387);
  const overlayPort = Number(env.OVERLAY_PORT ?? port + 1);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer from 1024 to 65535');
  if (!Number.isInteger(overlayPort) || overlayPort < 1024 || overlayPort > 65535 || overlayPort === port) throw new Error('Invalid OVERLAY_PORT');
  const features = (env.TWITCH_FEATURES ?? 'chat,raid,subscriptions,cheer').split(',').map(s => s.trim()).filter(Boolean) as Feature[];
  if (features.some(s => !['chat', 'raid', 'subscriptions', 'cheer', 'redemptions'].includes(s))) throw new Error('Unknown Twitch feature');
  const rewardId = env.TWITCH_REWARD_ID || null;
  if (rewardId && !features.includes('redemptions')) features.push('redemptions');
  return { port, overlayPort, features, rewardId, clientId: env.TWITCH_CLIENT_ID ?? '', clientSecret: env.TWITCH_CLIENT_SECRET ?? '',
    captions: { enabled: env.AI_CAPTIONS_ENABLED === 'true', apiKey: env.OPENAI_API_KEY ?? '', model: env.OPENAI_CAPTION_MODEL ?? '',
      sessionBudget: Number(env.AI_CAPTION_SESSION_BUDGET ?? 10), chatContext: env.AI_CHAT_CONTEXT === 'true' },
    botIds: (env.TWITCH_BOT_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean),
    redirectUri: `http://localhost:${port}/auth/twitch/callback`, dataDirectory: resolve(env.STREAMDIRECTOR_DATA_DIR ?? 'data') };
}
function secret(path: string) {
  try { const token = readFileSync(path, 'utf8').trim(); if (/^[a-f0-9]{64}$/.test(token)) return token; } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const token = randomBytes(32).toString('hex'); writeFileSync(path, token, { mode: 0o600 }); chmodSync(path, 0o600); return token;
}
export function createBackend(config = configuration()) {
  mkdirSync(config.dataDirectory, { recursive: true, mode: 0o700 });
  const store = new Store(resolve(config.dataDirectory, 'streamdirector.sqlite'));
  const controlToken = secret(resolve(config.dataDirectory, 'control-token.txt'));
  const auth = new TwitchAuth({ ...config, scopes: scopesFor(enabledTypes(config.features, config.rewardId)), tokenPath: resolve(config.dataDirectory, 'twitch-token.json') });
  const live = new LiveTwitch(auth, new Helix(auth, config.clientId), store, { ...config, settings: store.appSettings() });
  const hub = new EventHub(), simulation = new Simulation(store), captions = new CaptionWorker(store, config.captions);
  const unsubscribe = store.subscribe(event => { hub.changes(event, store.session(event.sessionId).session.mode); captions.observe(event); });
  live.onChatSample = (id, time, text) => captions.sample(id, time, text);
  const origins = [`http://localhost:${config.port}`, `http://127.0.0.1:${config.port}`];
  const hostnames = [`localhost:${config.port}`, `127.0.0.1:${config.port}`];
  const send = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
    res.end(JSON.stringify(value));
  };
  const authenticatedControl = (req: IncomingMessage) => {
    const candidate = Buffer.from(req.headers.authorization?.replace(/^Bearer /, '') ?? '');
    const expected = Buffer.from(controlToken);
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return true;
    const cookie = /(?:^|;\s*)sd_dashboard=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1] ?? '';
    return req.url?.startsWith('/api/control/') && origins.includes(req.headers.origin ?? '') &&
      req.headers['x-streamdirector-control'] === 'dashboard' && cookie === controlToken;
  };
  const webHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'" };
  function html(res: ServerResponse, title: string, entry: string, overlay = false) {
    res.writeHead(200, { ...webHeaders, 'Content-Type': 'text/html; charset=utf-8' }); res.end(page(title, entry, overlay));
  }
  function asset(res: ServerResponse, path: string, overlay = false) {
    const allowed = overlay ? ['overlay.js', 'overlay.css', 'slate.js', 'slate.css'] : ['dashboard.js', 'dashboard.css'];
    const name = path.replace('/assets/', '');
    if (!allowed.includes(name)) { send(res, 404, { error: 'Unknown asset' }); return; }
    try { const data = readFileSync(resolve('output/web', name));
      res.writeHead(200, { ...webHeaders, 'Content-Type': name.endsWith('.css') ? 'text/css' : 'text/javascript' }); res.end(data);
    } catch { send(res, 503, { error: 'Build browser assets with npm run build' }); }
  }
  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    let data = ''; for await (const bytes of req) { data += String(bytes); if (Buffer.byteLength(data) > 4096) throw new Error('Request too large'); }
    const value = JSON.parse(data || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request');
    return value;
  }
  const overlayServer = createServer((req, res) => {
    if (![`localhost:${config.overlayPort}`, `127.0.0.1:${config.overlayPort}`].includes(req.headers.host ?? '')) return send(res, 403, { error: 'Local overlay host required' });
    if (req.method !== 'GET') return send(res, 405, { error: 'Read-only overlay' });
    const url = new URL(req.url ?? '/', `http://localhost:${config.overlayPort}`);
    if (url.pathname === '/overlay' || url.pathname === '/') return html(res, 'StreamDirector Overlay', 'overlay', true);
    if (url.pathname === '/slate') return html(res, 'StreamDirector Verification Clock', 'slate');
    if (url.pathname.startsWith('/assets/')) return asset(res, url.pathname, true);
    if (url.pathname === '/events') { hub.add(res, url.searchParams.get('mode') === 'simulated' ? 'simulated' : 'live'); return; }
    return send(res, 404, { error: 'Unknown read-only route' });
  });
  const server = createServer((req, res) => { void (async () => {
    if (!hostnames.includes(req.headers.host ?? '') || (req.headers.origin && !origins.includes(req.headers.origin)))
      return send(res, 403, { error: 'Local host/origin required' });
    const url = new URL(req.url ?? '/', origins[0]);
    if (req.method === 'GET' && url.pathname === '/') {
      res.setHeader('Set-Cookie', `sd_dashboard=${controlToken}; HttpOnly; SameSite=Strict; Path=/api/control`);
      return html(res, 'StreamDirector AI', 'dashboard');
    }
    if (req.method === 'GET' && url.pathname.startsWith('/assets/')) return asset(res, url.pathname);
    if (req.method === 'GET' && url.pathname === '/api/events') { hub.add(res, 'dashboard'); return; }
    if (req.method === 'GET' && url.pathname === '/api/snapshot') {
      const sessions = store.sessions(), status = live.status();
      const id = url.searchParams.get('sessionId') ?? status.activeSessionId ?? sessions[0]?.id;
      if (id && !store.hasSession(id)) return send(res, 404, { error: 'Unknown session' });
      return send(res, 200, { status, sessions, selectedSession: id ? store.session(id).session : null,
        ...(id ? store.bookmarkPage(id) : { total: 0, bookmarks: [] }), gaps: id ? store.gapPage(id) : [],
        settings: live.currentSettings(), overlayUrl: `http://localhost:${config.overlayPort}/overlay`,
        observerFailures: store.observerFailures, captions: captions.status(id ?? null) });
    }
    if (req.method === 'GET' && url.pathname === '/auth/twitch') {
      const { url: authorize, state } = auth.authorize();
      res.writeHead(302, { Location: authorize, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        'Set-Cookie': [`sd_oauth=${state}; HttpOnly; SameSite=Lax; Path=/auth/twitch; Max-Age=300`,
          `sd_oauth_dashboard=${url.searchParams.get('dashboard') === '1' ? '1' : '0'}; HttpOnly; SameSite=Lax; Path=/auth/twitch; Max-Age=300`] });
      res.end(); return;
    }
    if (req.method === 'GET' && url.pathname === '/auth/twitch/callback') {
      const cookie = /(?:^|;\s*)sd_oauth=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1] ?? '';
      await auth.callback(url.searchParams.get('code') ?? '', url.searchParams.get('state') ?? '', cookie);
      res.setHeader('Set-Cookie', ['sd_oauth=; HttpOnly; SameSite=Lax; Path=/auth/twitch; Max-Age=0',
        'sd_oauth_dashboard=; HttpOnly; SameSite=Lax; Path=/auth/twitch; Max-Age=0']);
      await live.connect();
      if (/(?:^|;\s*)sd_oauth_dashboard=1(?:;|$)/.test(req.headers.cookie ?? '')) { res.writeHead(303, { Location: '/', 'Cache-Control': 'no-store' }); res.end(); return; }
      return send(res, 200, { connected: true, status: '/api/status', note: 'Tokens remain backend-only; live event checks require activity' });
    }
    if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, live.status());
    if (req.method === 'GET' && url.pathname === '/api/sessions') return send(res, 200, store.sessions());
    if (req.method === 'GET' && url.pathname === '/api/evidence') return send(res, 200, store.integrationEvents());
    if (req.method === 'GET' && url.pathname === '/api/export') {
      const id = url.searchParams.get('sessionId');
      if (!id || !store.hasSession(id)) return send(res, 404, { error: 'Unknown session' });
      const format = url.searchParams.get('format');
      if (!['csv', 'json', 'edl'].includes(format ?? '')) return send(res, 400, { error: 'Select csv, json or edl' });
      let bookmarks = store.bookmarks(id);
      const selection = url.searchParams.getAll('bookmarkId');
      if (selection.length) {
        const requested = new Set(selection);
        bookmarks = bookmarks.filter(b => requested.has(b.id));
        if (bookmarks.length !== requested.size) return send(res, 404, { error: 'Unknown bookmark in export selection' });
      }
      let result: string;
      try {
        let title: string | undefined;
        if (format === 'edl' && (url.searchParams.has('alignmentSeconds') || url.searchParams.has('leadInSeconds'))) {
          if (!url.searchParams.has('alignmentSeconds') || !url.searchParams.has('leadInSeconds')) throw new Error('Provide both EDL alignment and lead-in');
          if (!url.searchParams.get('alignmentSeconds')?.trim() || !url.searchParams.get('leadInSeconds')?.trim()) throw new Error('Invalid EDL mapping');
          const alignment = Number(url.searchParams.get('alignmentSeconds')), leadIn = Number(url.searchParams.get('leadInSeconds'));
          if (!Number.isFinite(alignment) || Math.abs(alignment) > 86400 || !Number.isFinite(leadIn) || leadIn < 0 || leadIn > 3600) throw new Error('Invalid EDL mapping');
          // Explicit export-only mapping: saved evidence, settings revisions and offsets stay intact.
          bookmarks = bookmarks.map(bookmark => ({ ...bookmark, editorOffsetSeconds: Math.max(0, Math.max(0, bookmark.detectedOffsetSeconds - leadIn) + alignment) }));
          title = `StreamDirector align ${alignment}s lead ${leadIn}s`;
        }
        result = format === 'edl' ? exportResolveEdl(bookmarks, { fps: Number(url.searchParams.get('fps')),
        timelineStartTimecode: url.searchParams.get('startTimecode') ?? '', title }) :
        format === 'csv' ? exportCsv(bookmarks) : exportJson(store.session(id).session, bookmarks, store.gaps(id)); }
      catch (error) { return send(res, 400, { error: (error as Error).message }); }
      res.writeHead(200, { 'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : format === 'edl' ? 'text/plain; charset=utf-8' : 'application/json', 'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="streamdirector.${format}"`, 'X-Content-Type-Options': 'nosniff' });
      res.end(result); return;
    }
    if (req.method === 'POST') {
      if (!authenticatedControl(req)) return send(res, 401, { error: 'Local control token required' });
      const action = url.pathname.replace('/api/control/', '/api/');
      if (action === '/api/connect') { await live.connect(); return send(res, 200, live.status()); }
      if (action === '/api/disconnect') { live.stop(); return send(res, 200, live.status()); }
      if (action === '/api/logout') { live.stop(); auth.clear(); return send(res, 200, live.status()); }
      if (action === '/api/capabilities') return send(res, 200, await live.probeCapabilities());
      if (action === '/api/mark') return send(res, 200, live.manual());
      if (action === '/api/settings') return send(res, 200, live.updateSettings(await body(req) as Record<string, number>));
      if (action === '/api/demo') return send(res, 200, { sessionId: simulation.start(), mode: 'simulated' });
      if (action === '/api/demo-event') return send(res, 200, { sessionId: simulation.platform(String((await body(req)).type)), mode: 'simulated' });
      if (action === '/api/interruption') { live.interruptForVerification(); return send(res, 200, { seconds: 8 }); }
      if (action === '/api/diagnostics') return send(res, 200, { capturedAt: new Date().toISOString(), memory: process.memoryUsage(), sseClients: hub.count(), observerFailures: store.observerFailures, captionFailures: captions.failures });
    }
    send(res, 404, { error: 'Unknown endpoint' });
  })().catch(error => {
    // Never serialize raw network errors, headers, response bodies or URLs containing credentials.
    const safe=publicFailure(error);
    // Diagnostic storage is optional; even a failed logger must still return a safe HTTP result.
    try{store.integrationEvent({timeMs:Date.now(),provenance:'local',kind:'request_failed',operation:'http_request',...failureFields(error)});}
    catch{live.reportFailure('http_request',error);}
    send(res, 400, { error: safe });
  }); });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  const timer = setInterval(() => { void live.tick().catch(error=>live.reportFailure('background_tick',error)); void captions.tick().catch(error=>live.reportFailure('caption_job',error)); hub.status(live.status()); hub.heartbeat(); }, 1000); timer.unref();
  return { server, overlayServer, live, store, hub, captions, close() { clearInterval(timer); simulation.close(); captions.close(); unsubscribe(); live.stop(); hub.close(); server.close(); overlayServer.close(); store.close(); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = configuration();
  const backend = createBackend(config);
  backend.overlayServer.listen(config.overlayPort, '127.0.0.1');
  backend.overlayServer.on('error', error => { console.error(`Overlay could not listen (${(error as NodeJS.ErrnoException).code ?? 'unknown'}).`); backend.close(); });
  backend.server.listen(config.port, '127.0.0.1', () => {
    console.log(`StreamDirector backend: http://localhost:${config.port}`);
    console.log('Twitch setup status and connection state: /api/status. Secrets are never logged.');
    if (backend.live.status().auth.credentialsAvailable)
      void backend.live.connect().catch(() => { console.error('Stored Twitch authorization could not connect; inspect /api/status and reconnect.'); });
  });
  backend.server.on('error', error => { console.error(`Backend could not listen (${(error as NodeJS.ErrnoException).code ?? 'unknown'}).`); backend.close(); });
  const close = () => { backend.close(); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
}
