# Checkpoint 2 setup and verification

Dashboard, OBS overlay and AI captions remain checkpoint 3 work. This phase exposes a loopback-only backend and JSON status, with no product UI.

## Twitch

1. Register a Twitch developer app with exact redirect URL `http://localhost:4387/auth/twitch/callback`.
2. Copy `.env.example` to `.env`, fill `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`, and set file permissions to 0600. Use the **client secret**, not the client ID, for the secret variable. Keep it out of chat/recordings. Restart after changing `.env`.
3. For minimal initial testing, use `TWITCH_FEATURES=chat,raid`. To test all enabled MVP signals use `chat,raid,subscriptions,cheer`. Setting a real `TWITCH_REWARD_ID` also enables the read-only redemption scope and ID-filtered subscription. No reward is created or renamed by this app.
4. Run `npm start` and open [local authorization](http://localhost:4387/auth/twitch). Complete consent yourself as the broadcaster. Use this start URL for retries, not a previous callback URL; state and codes are one-use.
5. Read [sanitized status](http://localhost:4387/api/status). It shows authentication, subscriptions, missing scopes, live/offline state and detector readiness. A broadcaster message verifies reception even though that broadcaster is excluded from counted chat. A real stream must be active to validate stream-relative bookmarks and exports.
6. Call the capability probe below and independently inspect Creator Dashboard tools. Neither an OAuth grant nor a 202 subscription response proves that a real paid event occurred.

The local control token is generated in ignored `data/control-token.txt`. It authorizes control POST requests, but is never sent to Twitch or returned to the browser/overlay. Use this Node command to probe capabilities without printing it:

```sh
node --input-type=module -e 'import fs from "node:fs"; const r=await fetch("http://localhost:4387/api/capabilities",{method:"POST",headers:{Authorization:`Bearer ${fs.readFileSync("data/control-token.txt","utf8").trim()}`}}); console.log(await r.json());'
```

Other control POST endpoints: `/api/connect`, `/api/disconnect`, `/api/logout`, `/api/mark`. Logout removes local credentials; revoke the app separately in Twitch Connections if desired. Manual marks require a verified active Twitch stream. GET `/api/sessions` lists saved session identities; `/api/export?sessionId=...&format=json` (or `csv`) downloads reference exports. All responses omit Twitch/OpenAI secrets. Do not expose the backend through a public tunnel; Host/Origin checks and a local control token are enforced, and the server binds only to 127.0.0.1.

Status distinguishes available credentials from validated authentication. If `credentialsAvailable` and `validationRequired` are true during an outage, the saved credentials are retained but blocked from API use until validation succeeds. Established connections retry validation on subsequent ticks. After a failed startup connection, retry `/api/connect` when Twitch is reachable. Logout invalidates pending sign-ins/refreshes as well as deleting the saved pair; a late response cannot undo logout.

Restart the backend after changing reward ID, bot exclusions or detector settings. Recovery of the same broadcast applies the current configuration, appends a complete historical settings revision when changed and resets chat warm-up. It preserves the original stream origin and all prior bookmarks/deduplication. JSON contains `session.settingsHistory`; each bookmark's `settingsRevision` identifies the applicable configuration (missing on legacy records means zero). CSV includes `settings_revision`. Conflicting stream identity/origin is rejected for inspection.

If authorization returns **invalid client secret**, correct the current developer-app secret and restart. If state is invalid/expired, start a new authorization. If a scope is missing, enable the corresponding feature and authorize again. If Twitch reports offline, event reception can still be checked, but stream timing/native export alignment remain unverified until a real broadcast is running.

## Automated/simulated checks

```sh
npm test
npm run typecheck
node --disable-warning=ExperimentalWarning scripts/twitch-cli-simulation.ts
```

The optional CLI harness expects the official 1.1.24 binary at `output/tools/twitch-cli_1.1.24_Darwin_arm64/twitch` or accepts a binary path as its first argument. It opens only a local mock service on port 4888 and never loads live credentials. It exercises the same adapter/recorder with simulated identities and saves evidence separately.

Resolve format/import instructions and actual verification outcomes are recorded in `resolve-edl.md` and the checkpoint 2 report. Actual Resolve 21.1.1.10 marker import passed all four known-footage cases: 30/60 fps NDF at zero/one-hour starts, sixteen matching markers. Live stream-to-recording alignment remains unverified.
