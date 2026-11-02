import { randomUUID } from 'node:crypto';
import { Recorder, Store } from '../store.ts';
import { settings } from '../types.ts';
import type { Changes } from '../detector.ts';
import type { Input, Settings } from '../types.ts';
import { TwitchAuth, Helix } from './auth.ts';
import { EventSubClient } from './eventsub.ts';
import type { EventSubOptions } from './eventsub.ts';
import { enabledTypes, normalize, object, permissions, string, subscription } from './schema.ts';
import type { Envelope, EventType, Feature } from './schema.ts';
import { IntegrationFailure, failureFields, httpCategory } from './diagnostics.ts';
import type { IntegrationOperation } from './diagnostics.ts';

export interface LiveOptions { features: Feature[]; rewardId: string | null; botIds: string[]; settings?: Partial<Settings> }
export class LiveTwitch {
  private auth: TwitchAuth;
  private helix: Helix;
  private store: Store;
  private options: LiveOptions;
  private clock: () => number;
  private client: EventSubClient | null = null;
  private recorder: Recorder | null = null;
  private lastStreamPoll = 0;
  private lastValidation = 0;
  private busy = false;
  private connectPromise: Promise<void> | null = null;
  private connectionEpoch = 0;
  private subscriptionGeneration = 0;
  private pendingGap: {startMs:number;endMs:number} | null = null;
  private activeFailureOperation: IntegrationOperation | null = null;
  private diagnosticWriteFailures = 0;
  private suspendedAt: number | null = null;
  private authSuspendedAt: number | null = null;
  private processingAtMs: number | null = null;
  private socketFactory: EventSubOptions['socketFactory'];
  // Preserve the captured receipt instant across synchronous persistence/validation work.
  // The detector's injected clock and the input receipt time must agree exactly.
  private recorderClock = () => this.processingAtMs ?? this.clock();
  private health: Record<string, unknown> = { connection: 'disconnected', stream: 'unknown', evidence: 'live Twitch checks not yet performed' };
  private subscriptions: Record<string, unknown> = {};
  onChanges: ((changes: Changes) => void) | null = null;
  onChatSample: ((sessionId: string, timeMs: number, text: string) => void) | null = null;
  constructor(auth: TwitchAuth, helix: Helix, store: Store, options: LiveOptions, clock = Date.now,
    socketFactory?: EventSubOptions['socketFactory']) {
    this.auth = auth; this.helix = helix; this.store = store; this.options = options; this.clock = clock;
    this.socketFactory = socketFactory;
  }
  status() { return { ...this.health, connection: this.health.connection, warning:this.health.warning,lastFailure:this.health.lastFailure, auth: this.auth.status(), subscriptions: structuredClone(this.subscriptions),
    activeSessionId: this.recorder?.session.id ?? null, detector: this.recorder?.status() ?? null,
    diagnosticWriteFailures:this.diagnosticWriteFailures, coveragePersistencePending:Boolean(this.pendingGap) }; }
  currentSettings() { return settings({ ...this.options.settings, broadcasterId: this.auth.status().userId ?? 'broadcaster',
    excludedUserIds: this.options.botIds, rewardId: this.options.rewardId }); }
  updateSettings(patch: Record<string, number>) {
    const allowed = ['multiplier', 'minimumRate', 'minimumChatters', 'warmupSeconds', 'leadInSeconds', 'alignmentSeconds'];
    if (Object.keys(patch).some(key => !allowed.includes(key) || typeof patch[key] !== 'number')) throw new Error('Invalid settings fields');
    const active = settings({ ...this.currentSettings(), ...patch });
    if (this.recorder && this.auth.status().authenticated) this.recorder = new Recorder(this.store, { ...this.recorder.session, settings: active }, this.recorderClock, true, 'dashboard settings updated');
    this.options.settings = active;
    this.store.saveAppSettings(Object.fromEntries(allowed.map(key => [key, active[key as keyof Settings] as number])));
    return active;
  }
  interruptForVerification() {
    if (!this.client || !this.recorder) throw new Error('A verified active Twitch stream is required');
    this.record('controlled_interruption_requested', { seconds: 8, sessionId: this.recorder.session.id });
    this.client.interruptForVerification(8);
  }
  private publish(changes: Changes) {
    try { this.onChanges?.(changes); } catch { /* Persistence has completed; presentation is optional. */ }
  }
  private record(kind: string, details: Record<string, unknown> = {}) {
    try { this.store.integrationEvent({ timeMs: this.clock(), provenance: 'live', kind, ...details }); }
    catch { this.diagnosticWriteFailures++; }
  }
  reportFailure(operation:IntegrationOperation,error:unknown){
    const details={operation,...failureFields(error),timeMs:this.clock()};
    this.activeFailureOperation=operation;this.health.lastFailure=details;
    this.health.warning=`Integration ${operation} failed (${details.category}); inspect sanitized diagnostics.`;
    this.record('integration_error',details);
  }
  private recovered(operation:IntegrationOperation){
    if(this.activeFailureOperation!==operation)return;
    this.activeFailureOperation=null;delete this.health.warning;
    this.health.lastFailure={...object(this.health.lastFailure),recoveredAtMs:this.clock()};
    this.record('integration_recovered',{operation});
  }
  private persistGap(startMs:number,endMs:number,reason:string){
    if(!this.recorder)return;
    const start=Math.max(this.recorder.session.startedAtMs,Math.min(startMs,this.pendingGap?.startMs??startMs));
    const end=Math.max(endMs,this.pendingGap?.endMs??endMs);
    try{
      this.publish(this.recorder.connectionGap(start,end,reason));this.pendingGap=null;this.recovered('coverage_persistence');
    }catch(error){this.pendingGap={startMs:start,endMs:end};this.reportFailure('coverage_persistence',error);}
  }
  private requireDurableCoverage(){
    if(this.pendingGap)this.persistGap(this.pendingGap.startMs,this.clock(),'Twitch coverage gap recovered after persistence failure');
    if(this.pendingGap)throw new IntegrationFailure('storage','Coverage persistence must recover before stream transition');
  }
  async connect() {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.connectOnce().catch(error=>{this.reportFailure('connection_setup',error);throw error;}).finally(() => { this.connectPromise = null; });
    return this.connectPromise;
  }
  private async connectOnce() {
    this.stop();
    const epoch = this.connectionEpoch;
    await this.auth.validate();
    if (epoch !== this.connectionEpoch) return;
    const userId = this.auth.status().userId!;
    this.health = { connection: 'connecting', stream: 'unknown', channel: this.auth.status().login,
      evidence: 'authenticated with Twitch; platform occurrence must be verified separately' };
    this.record('oauth_validated', { userId, scopes: this.auth.status().scopes });
    await this.pollStream();
    if (epoch !== this.connectionEpoch) return;
    this.lastValidation = this.clock();
    this.client = new EventSubClient({
      clock: this.clock,
      socketFactory: this.socketFactory,
      subscribe: id => this.subscribe(id,epoch),
      failure: (operation,error)=>{if(epoch===this.connectionEpoch)this.reportFailure(operation==='subscription'?'subscription_create':operation==='coverage'?'coverage_persistence':'notification_ingest',error);},
      notification: (message, now) => this.notification(message, now),
      gap: (start, end, reason) => {
        this.record('coverage_gap', { startMs: start, endMs: end, reason });
        if (this.recorder) {
          this.persistGap(start,end,reason);
        }
      },
      revocation: (type, reason) => {
        this.subscriptions[type] = { state: 'revoked', reason };
        this.record('subscription_revoked', { type, reason });
        if (this.recorder) this.persistGap(this.clock(), this.clock(), `subscription revoked: ${type}`);
        if (reason === 'authorization_revoked' || reason === 'user_removed') { this.auth.clear(); this.stop(); }
      },
      status: connection => { if(epoch!==this.connectionEpoch)return;this.health.connection = connection;
        if(connection!=='connected'&&connection!=='reconnecting with Twitch handover'){this.subscriptionGeneration++;this.subscriptions={};}
        this.record('connection_status', { connection }); },
    });
    this.client.start();
  }
  stop() {
    this.connectionEpoch++;
    this.subscriptionGeneration++;
    this.client?.stop(); this.client = null;
    if (this.recorder) this.suspendedAt ??= this.clock();
    this.health.connection = 'disconnected';
  }
  private async subscribe(sessionId: string,epoch:number) {
    if(epoch!==this.connectionEpoch)return;
    const generation=++this.subscriptionGeneration;
    const id = this.auth.status().userId!;
    const current=()=>epoch===this.connectionEpoch&&generation===this.subscriptionGeneration&&this.auth.status().authenticated&&this.auth.status().userId===id;
    this.subscriptions={};
    await Promise.all(enabledTypes(this.options.features, this.options.rewardId).map(async type => {
      const scope = permissions[type];
      if (scope && !this.auth.status().scopes.includes(scope)) {
        this.subscriptions[type] = { state: 'missing_scope', scope }; return;
      }
      let response;
      try{response=await this.helix.request('eventsub/subscriptions', 'POST', subscription(type, id, sessionId, this.options.rewardId));}
      catch(error){if(!current())return;throw error;}
      if(!current())return;
      const state = response.status === 202 ? 'enabled' : 'rejected';
      this.subscriptions[type] = { state, httpStatus: response.status };
      this.record('subscription_result', { type, state, httpStatus: response.status });
    }));
    if(!current())return;
    this.recovered('subscription_create');
    const chatRequired = this.options.features.includes('chat');
    if (chatRequired && object(this.subscriptions['channel.chat.message'])?.state !== 'enabled')
      this.health.warning = 'Chat subscription unavailable: inspect missing scopes or Twitch rejection';
  }
  async probeCapabilities() {
    const id = this.auth.status().userId;
    if (!id) throw new Error('Sign in with Twitch first');
    const scopes = this.auth.status().scopes;
    const result: Record<string, unknown> = { subscriptions: 'not checked', bits: 'not checked', channelPoints: 'not checked' };
    const probes = [
      ['subscriptions', 'channel:read:subscriptions', `subscriptions?broadcaster_id=${id}&first=1`],
      ['bits', 'bits:read', 'bits/leaderboard?count=1'],
      ['channelPoints', 'channel:read:redemptions', `channel_points/custom_rewards?broadcaster_id=${id}&only_manageable_rewards=false`],
    ];
    for (const [capability, scope, path] of probes) {
      if (!scopes.includes(scope!)) { result[capability!] = { state: 'missing_scope', scope }; continue; }
      const response = await this.helix.request(path!);
      result[capability!] = { state: response.status === 200 ? 'api_access_confirmed' : 'unavailable_or_denied', httpStatus: response.status };
      if (capability === 'channelPoints' && response.status === 200 && Array.isArray(response.data.data))
        result.configuredRewardFound = response.data.data.some(x => object(x)?.id === this.options.rewardId);
    }
    this.health.capabilities = result; this.record('capability_probe', { result }); return result;
  }
  async pollStream() {
    // Finish the old recorder's gap before switching broadcasts or observing it offline.
    this.requireDurableCoverage();
    const epoch = this.connectionEpoch;
    const user = this.auth.status().userId;
    if (!user || !this.auth.status().authenticated) return;
    const response = await this.helix.request(`streams?user_id=${encodeURIComponent(user)}&first=1`);
    if (epoch !== this.connectionEpoch || !this.auth.status().authenticated || user !== this.auth.status().userId) return;
    // A notification can fail while the HTTP request is pending. Recheck before
    // either the offline branch or a new broadcast can discard the old recorder.
    this.requireDurableCoverage();
    this.lastStreamPoll = this.clock();
    if (response.status !== 200) throw new IntegrationFailure(httpCategory(response.status),`Stream lookup failed (${response.status})`,response.status);
    if(!Array.isArray(response.data.data))throw new IntegrationFailure('invalid_response','Invalid stream lookup response',response.status);
    const stream = object(response.data.data[0]);
    if (!stream) {
      if (this.recorder) this.record('stream_offline', { sessionId: this.recorder.session.id });
      this.recorder = null; this.pendingGap=null; this.health.stream = 'offline'; this.recovered('stream_lookup'); return;
    }
    if (!string(stream.id) || stream.user_id !== user || !string(stream.started_at) || !Number.isFinite(Date.parse(stream.started_at)))
      throw new Error('Invalid stream identity/start returned by Twitch');
    const start = Date.parse(stream.started_at);
    if (start > this.clock()) throw new Error('Twitch stream start is in the future');
    const sessionId = `twitch:${user}:${stream.id}`;
    if (this.recorder?.session.id !== sessionId) {
      const session = { id: sessionId, mode: 'live' as const, streamId: stream.id, streamStartedAtMs: start,
        startedAtMs: this.clock(), settings: settings({ ...this.options.settings, broadcasterId: user,
          excludedUserIds: this.options.botIds, rewardId: this.options.rewardId }) };
      const recover = this.store.hasSession(sessionId);
      this.recorder = new Recorder(this.store, session, this.recorderClock, recover);
      if (recover) this.record('detector_settings_recovered', { sessionId,
        settingsRevision: this.recorder.session.settingsHistory!.at(-1)!.revision });
      this.record('live_stream_origin', { streamId: stream.id, startedAtMs: start, sessionId, recovered: recover });
    }
    this.health.stream = 'live';
    this.recovered('stream_lookup');
    if (this.suspendedAt !== null) {
      this.persistGap(this.suspendedAt,this.clock(),'app disconnected from Twitch');
      this.suspendedAt = null;
    }
  }
  notification(message: Envelope, receivedAtMs: number) {
    const user = this.auth.status().userId;
    if (!user) return;
    if (!this.auth.status().authenticated) {
      if (this.auth.status().credentialsAvailable) this.suspendAuthorization(receivedAtMs);
      return;
    }
    const input = normalize(message, user, receivedAtMs);
    if (!input) { this.record('invalid_or_unrelated_notification'); return; }
    if (!enabledTypes(this.options.features, this.options.rewardId).includes(String(message.metadata.subscription_type) as EventType)) return;
    this.record('notification_received', { type: message.metadata.subscription_type, transportId: input.transportId,
      sourceId: input.sourceId, sourceTimeMs: input.sourceTimeMs, recordedAgainstLiveStream: Boolean(this.recorder) });
    if (!this.recorder) { this.health.warning = 'Events received while offline or stream origin unavailable; no fabricated stream offsets'; return; }
    if(this.pendingGap){this.pendingGap.endMs=Math.max(this.pendingGap.endMs,receivedAtMs);return;}
    let changes:Changes;
    try{changes=this.ingest(input);this.recovered('notification_ingest');}
    catch(error){this.reportFailure('notification_ingest',error);throw error;}
    this.publish(changes);
    if (input.type === 'chat' && input.userId && input.userId !== user && !this.options.botIds.includes(input.userId)) {
      const text = object(object(message.payload.event)?.message)?.text;
      if (typeof text === 'string') try { this.onChatSample?.(this.recorder.session.id, receivedAtMs, text.slice(0, 160)); } catch { /* Optional caption context. */ }
    }
  }
  manual() {
    if (!this.recorder || !this.client) throw new Error('A verified active Twitch stream is required');
    if(this.pendingGap)throw new IntegrationFailure('storage','Coverage persistence must recover before marking');
    const now = this.clock();
    const id = randomUUID();
    const changes = this.ingest({ type: 'manual', sourceId: id, transportId: id, sourceTimeMs: null, receivedAtMs: now });
    this.publish(changes); return changes;
  }
  private ingest(input: Input) {
    this.processingAtMs = input.receivedAtMs;
    try { return this.recorder!.ingest(input); }
    finally { this.processingAtMs = null; }
  }
  private suspendAuthorization(startMs: number) {
    if (this.authSuspendedAt !== null) return;
    this.authSuspendedAt = startMs;
    if (this.recorder) {
      this.persistGap(startMs,this.clock(),'Twitch authorization validation unavailable; ingestion suspended');
    }
  }
  async tick() {
    if (!this.client || this.busy) return;
    this.busy = true;
    let validationAttemptAt: number | null = null;
    let operation:IntegrationOperation='socket_tick';
    try {
      this.client.tick();
      operation='coverage_persistence';
      if(this.pendingGap){this.persistGap(this.pendingGap.startMs,this.clock(),'Twitch coverage gap recovered after persistence failure');if(this.pendingGap)return;}
      if (!this.auth.status().authenticated || this.clock() - this.lastValidation >= 3600000) {
        operation='token_validation';
        validationAttemptAt = this.clock();
        await this.auth.validate(); this.lastValidation = this.clock();
        this.recovered('token_validation');
      }
      if (this.authSuspendedAt !== null) {
        if (this.recorder) {
          this.persistGap(this.authSuspendedAt,this.clock(),'Twitch authorization validation recovered; coverage incomplete');
        }
        this.authSuspendedAt = null;
        if(!this.pendingGap)this.recovered('token_validation');
      }
      operation='stream_lookup';
      if (this.clock() - this.lastStreamPoll >= 15000) await this.pollStream();
      operation='detector_tick';
      if (this.recorder&&!this.pendingGap) { const changes = this.recorder.tick(); this.publish(changes);this.recovered('detector_tick'); }
    } catch(error) {
      this.reportFailure(operation,error);
      if (!this.auth.status().authenticated && this.authSuspendedAt === null) {
        this.suspendAuthorization(validationAttemptAt ?? this.clock());
      }
      if (!this.auth.status().credentialsAvailable) this.stop();
    } finally { this.busy = false; }
  }
}
