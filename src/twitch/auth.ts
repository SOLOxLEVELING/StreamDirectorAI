import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, chmodSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { object, string } from './schema.ts';
import { IntegrationFailure, fetchSafe, jsonSafe, httpCategory } from './diagnostics.ts';

export interface AuthConfig { clientId: string; clientSecret: string; redirectUri: string; scopes: string[]; tokenPath: string }
interface Token { access_token: string; refresh_token: string; scopes: string[]; expiresAtMs: number; userId: string; login: string; pendingValidation?: boolean }
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
class TokenRejected extends IntegrationFailure {
  constructor(message:string,status?:number){super('authorization',message,status);}
}
export class TwitchAuth {
  private config: AuthConfig;
  private fetcher: Fetcher;
  private clock: () => number;
  private token: Token | null = null;
  private validatedToken: Token | null = null;
  // Every async result belongs to one authorization lifetime. Logout/revocation wins over late I/O.
  private generation = 0;
  private states = new Map<string, number>();
  private refreshPromise: Promise<void> | null = null;
  private validation: { token: Token; promise: Promise<void> } | null = null;
  constructor(config: AuthConfig, fetcher: Fetcher = fetch, clock = Date.now) {
    this.config = config; this.fetcher = fetcher; this.clock = clock;
    try {
      const raw = object(JSON.parse(readFileSync(config.tokenPath, 'utf8')));
      if (raw && string(raw.access_token) && string(raw.refresh_token) && string(raw.userId) && string(raw.login) &&
          Array.isArray(raw.scopes) && raw.scopes.every(s => typeof s === 'string') && Number.isFinite(raw.expiresAtMs) &&
          (raw.pendingValidation === undefined || typeof raw.pendingValidation === 'boolean'))
        this.token = raw as unknown as Token;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Stored Twitch credentials are invalid; remove data/twitch-token.json and reconnect'); }
  }
  configured() { return Boolean(this.config.clientId && this.config.clientSecret); }
  status() { return { configured: this.configured(), credentialsAvailable: Boolean(this.token),
    authenticated: Boolean(this.token && this.validatedToken === this.token && this.token.expiresAtMs > this.clock()),
    validationRequired: Boolean(this.token && (this.validatedToken !== this.token || this.token.expiresAtMs <= this.clock())), userId: this.token?.userId ?? null,
    login: this.token?.login ?? null, scopes: this.token?.scopes ?? [],
    missingScopes: this.config.scopes.filter(s => !this.token?.scopes.includes(s)) }; }
  authorize(): { url: string; state: string } {
    if (!this.configured()) throw new Error('Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in .env');
    for (const [state, expiry] of this.states) if (expiry <= this.clock()) this.states.delete(state);
    if (this.states.size >= 10) this.states.delete(this.states.keys().next().value!);
    const state = randomBytes(32).toString('hex');
    this.states.set(state, this.clock() + 300000);
    const query = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: this.config.redirectUri,
      response_type: 'code', scope: this.config.scopes.join(' '), state });
    return { url: `https://id.twitch.tv/oauth2/authorize?${query}`, state };
  }
  async callback(code: string, state: string, cookieState: string) {
    const generation = this.generation;
    const expiry = this.states.get(state);
    this.states.delete(state);
    const a = Buffer.from(state), b = Buffer.from(cookieState);
    if (!expiry || expiry <= this.clock() || a.length !== b.length || !timingSafeEqual(a, b) || !code || code.length > 512)
      throw new Error('OAuth state missing, expired or invalid; start sign-in again');
    const response = await this.requestToken({ code, grant_type: 'authorization_code', redirect_uri: this.config.redirectUri });
    this.assertCurrent(generation);
    const validated = await this.validateAccess(response.access_token);
    this.assertCurrent(generation);
    // This local app tracks exactly one broadcaster. Revoke/logout explicitly before changing accounts.
    if (this.token && this.token.userId !== validated.user_id) throw new Error('Different broadcaster; disconnect first');
    // A successful new grant supersedes refreshes/validations and other callbacks from the old grant.
    this.invalidatePending();
    this.save({ access_token: response.access_token, refresh_token: response.refresh_token, scopes: validated.scopes,
      expiresAtMs: this.clock() + validated.expires_in * 1000, userId: validated.user_id, login: validated.login }, true);
  }
  private async requestToken(values: Record<string, string>) {
    const response = await fetchSafe(this.fetcher,'https://id.twitch.tv/oauth2/token', { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, ...values }) });
    if (!response.ok) {
      let reason = '';
      try {
        const body = object(await response.json());
        if (body?.message === 'invalid client secret') reason = ': invalid client secret; check TWITCH_CLIENT_SECRET and restart';
        else if (body?.message === 'invalid authorization code' || body?.message === 'Invalid authorization code') reason = ': authorization code invalid or expired; start sign-in again';
      } catch { /* Do not display untrusted/raw HTTP error content. */ }
      if (values.grant_type === 'refresh_token' && [400, 401, 403].includes(response.status))
        throw new TokenRejected(`Twitch token exchange failed (${response.status})${reason}`,response.status);
      throw new IntegrationFailure(httpCategory(response.status),`Twitch token exchange failed (${response.status})${reason}`,response.status);
    }
    const data = object(await jsonSafe(response));
    if (!string(data?.access_token) || !string(data?.refresh_token)) throw new Error('Invalid token response');
    return { access_token: data.access_token, refresh_token: data.refresh_token };
  }
  private async validateAccess(access: string) {
    const response = await fetchSafe(this.fetcher,'https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${access}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new TokenRejected(`Twitch token validation failed (${response.status})`,response.status);
      throw new IntegrationFailure(httpCategory(response.status),`Twitch token validation failed (${response.status}); retry when Twitch is available`,response.status);
    }
    const data = object(await jsonSafe(response));
    if (data?.client_id !== this.config.clientId || !string(data.user_id) || !string(data.login) ||
        !Array.isArray(data.scopes) || !data.scopes.every(s => typeof s === 'string') || !Number.isFinite(data.expires_in) || Number(data.expires_in) <= 0)
      throw new TokenRejected('Token belongs to a different application or is not a valid user token');
    return data as unknown as { user_id: string; login: string; scopes: string[]; expires_in: number };
  }
  private save(token: Token, validated = false) {
    mkdirSync(dirname(this.config.tokenPath), { recursive: true, mode: 0o700 });
    const temporary = `${this.config.tokenPath}.tmp`;
    writeFileSync(temporary, JSON.stringify(token), { mode: 0o600 });
    chmodSync(temporary, 0o600); renameSync(temporary, this.config.tokenPath);
    this.token = token; this.validatedToken = validated ? token : null;
  }
  private assertCurrent(generation: number, token?: Token) {
    if (generation !== this.generation || (token && token !== this.token))
      throw new Error('Twitch sign-in changed; start sign-in again');
  }
  private invalidatePending() {
    this.generation++; this.states.clear(); this.refreshPromise = null; this.validation = null;
  }
  clear() {
    this.invalidatePending(); this.validatedToken = null;
    this.token = null;
    for (const path of [this.config.tokenPath, `${this.config.tokenPath}.tmp`])
      try { unlinkSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  async validate() {
    if (!this.token) throw new Error('Twitch sign-in required');
    if (!this.token.pendingValidation && this.token.expiresAtMs - this.clock() < 60000) await this.refresh();
    else await this.validateCurrent();
  }
  private validateCurrent(): Promise<void> {
    if (!this.token) return Promise.reject(new Error('Twitch sign-in required'));
    if (this.validation?.token === this.token) return this.validation.promise;
    const token = this.token, generation = this.generation;
    const promise = (async () => {
      try {
        const info = await this.validateAccess(token.access_token);
        this.assertCurrent(generation, token);
        if (info.user_id !== token.userId) throw new TokenRejected('Broadcaster identity changed');
        const { pendingValidation: _, ...validated } = token;
        this.save({ ...validated, login: info.login, scopes: info.scopes, expiresAtMs: this.clock() + info.expires_in * 1000 }, true);
      } catch (error) {
        if (generation === this.generation && token === this.token) {
          if (error instanceof TokenRejected) this.clear();
          else this.validatedToken = null;
        }
        throw error;
      }
    })();
    this.validation = { token, promise };
    void promise.finally(() => { if (this.validation?.promise === promise) this.validation = null; }).catch(() => {});
    return promise;
  }
  async accessToken() {
    const generation = this.generation;
    if (!this.token) throw new Error('Twitch sign-in required');
    if (!this.token.pendingValidation && this.token.expiresAtMs - this.clock() < 60000) await this.refresh();
    else if (this.validatedToken !== this.token) await this.validateCurrent();
    this.assertCurrent(generation);
    if (!this.token || this.validatedToken !== this.token) throw new Error('Twitch sign-in requires validation');
    return this.token!.access_token;
  }
  assertAccessToken(access: string) {
    if (!this.token || this.validatedToken !== this.token || this.token.access_token !== access || this.token.expiresAtMs <= this.clock())
      throw new Error('Twitch sign-in changed; start sign-in again');
  }
  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    const generation = this.generation;
    const promise = (async () => {
      if (!this.token) throw new Error('Twitch sign-in required');
      let candidate = this.token;
      try {
        if (!candidate.pendingValidation) {
          const tokens = await this.requestToken({ grant_type: 'refresh_token', refresh_token: candidate.refresh_token });
          this.assertCurrent(generation, candidate);
          // Rotation may invalidate the previous refresh token. Durably retain the new pair even
          // if /validate is temporarily unavailable, but never hand it to Helix before validation.
          candidate = { ...candidate, ...tokens, expiresAtMs: 0, pendingValidation: true };
          this.save(candidate);
        }
        await this.validateCurrent();
        this.assertCurrent(generation);
      } catch (error) {
        if (error instanceof TokenRejected && generation === this.generation && candidate === this.token) this.clear();
        throw error;
      }
    })();
    this.refreshPromise = promise;
    void promise.finally(() => { if (this.refreshPromise === promise) this.refreshPromise = null; }).catch(() => {});
    return promise;
  }
}

export class Helix {
  private auth: TwitchAuth;
  private clientId: string;
  private fetcher: Fetcher;
  constructor(auth: TwitchAuth, clientId: string, fetcher: Fetcher = fetch) { this.auth = auth; this.clientId = clientId; this.fetcher = fetcher; }
  async request(path: string, method = 'GET', body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const access = await this.auth.accessToken();
      this.auth.assertAccessToken(access);
      const response = await fetchSafe(this.fetcher,`https://api.twitch.tv/helix/${path}`, {
        method, headers: { Authorization: `Bearer ${access}`, 'Client-Id': this.clientId, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
      this.auth.assertAccessToken(access);
      if (response.status === 401 && attempt === 0) { await this.auth.refresh(); continue; }
      const data = response.status === 204 ? {} : object(await jsonSafe(response)) ?? {};
      this.auth.assertAccessToken(access);
      return { status: response.status, data };
    }
    throw new Error('Twitch API authorization failed');
  }
}
