# Dashboard, OBS and optional captions

Use Node 24 or newer. Install pinned dependencies and verify the project:

```sh
npm ci
npm test
npm run typecheck
npm start
```

`npm start` builds React/overlay/slate assets before starting the backend. Open **http://localhost:4387/**. The overlay server is **http://localhost:4388/** by default. Both bind to loopback. Keep an existing `.env`; for a new installation, create it using `.env.example` and follow [Twitch setup](checkpoint-2-setup.md). Register exactly `http://localhost:4387/auth/twitch/callback` and authorize the broadcaster through the dashboard. Credentials and token refresh stay on the backend.

The dashboard shows current Twitch state and a separately selectable persisted session. Labels explicitly say LIVE or SIMULATED. Historical bookmarks remain available offline. Mark now and interruption verification require an actual active broadcast. Stream origin comes from Twitch, including when the app joins later.

## OBS

Add a **Browser Source** with URL `http://localhost:4388/overlay`, width **1920**, height **1080**, above your video sources. Its background is transparent. Chat bookmarks show a corner reaction; platform/manual bookmarks show a brief full banner. Suppression affects animation only. Reload/reconnect starts from a fresh SSE cursor, so old saved bookmarks do not flash again.

For timing verification, put another 1920×1080 Browser Source underneath it using `http://localhost:4388/slate`. This clock is optional. Start local recording and Twitch streaming yourself. Once Twitch is live in the dashboard, use Mark now. **Exercise 8-second connection interruption** closes the actual EventSub connection, holds retry for eight seconds, reconnects and records incomplete coverage. Chat warm-up restarts. Missed events cannot be reconstructed.

An organic chat-trigger test requires three non-broadcaster, non-bot participants at default settings, each capped at one counted message per second. The streamer cannot serve as another viewer. A manual bookmark verifies the live fallback/export path; chat-trigger acceptance needs a real qualifying surge.

The overlay origin has read-only routes and no controller, Twitch or OpenAI credentials. Use the overlay URL rather than the dashboard. The app is intended for the same machine without a public tunnel.

## Judge replay

No live channel or AI credential is needed for **Run sustained chat replay** or the seven simulated platform-event choices. Replays persist in separate SIMULATED sessions. Open `http://localhost:4388/overlay?mode=simulated` for their reactions; the live overlay ignores them. Demo settings avoid the sixty-second wait and do not alter live settings. Restore the live URL after testing OBS. A replay is not live Twitch evidence.

## Settings and exports

Numeric settings changes append a revision on an active broadcast, record incomplete coverage and restart warm-up/correlation. Historical evidence, stream origin and durable deduplication remain intact. Reward IDs, bot IDs and features use backend environment configuration described in checkpoint 2; same-broadcast recovery reconciles changes.

Select a session and optionally individual bookmarks, then CSV, JSON or Resolve EDL. EDL requires explicit **30/60 fps NDF** and a valid timeline start. Align stream origin with the recording separately from editorial lead-in. **EDL alignment** and **EDL lead-in** affect only the export; CSV/JSON keep saved fields/settings. HTTP requests must supply both overrides if either is used. Unsupported rates, marker-frame collisions and 24-hour wrap reject.

The retained actual recording used **+139.5335 s alignment, 0 s lead-in, 30 fps, start 01:00:00:00**. Other recordings need their own mapping. See [Resolve procedure](resolve-edl.md). Use the existing timeline's **Timeline Markers from EDL** command; ordinary timeline import creates a different object and can show offline references.

## Optional AI

Deterministic labels work without AI. To opt in, set backend `.env` values and restart:

```dotenv
AI_CAPTIONS_ENABLED=true
OPENAI_API_KEY=<local secret>
OPENAI_CAPTION_MODEL=<Responses API model available to your account>
AI_CAPTION_SESSION_BUDGET=10
AI_CHAT_CONTEXT=false
```

Budget is 0–50 requests per broadcast session; zero disables calls. Reserved/used jobs persist across restart. Only new live bookmarks enqueue jobs; simulation never calls the provider. Finalization waits `max(cheerWindowSeconds, correlationSeconds + max(activitySeconds, sustainSeconds) + allowedLatenessSeconds + 1) + 1` seconds (nineteen by default), covering candidate validation, bucket boundaries and an idle-tick allowance. The worker then snapshots immutable evidence and runs one request at a time with an eight-second timeout and at most one job per bookmark. Failed/interrupted attempts retain the fallback label. Completion changes only caption text/status and never creates another reaction.

Requests use Responses with `store:false`, no tools and an enforced eighty-code-point plain-text result. Default `AI_CHAT_CONTEXT=false` sends no raw chat. Opt-in allows twenty samples of at most 160 code units per session, two sessions, forty-five-second in-memory retention and at most 2,400 sample bytes per request. Message text can itself include personal information; identity fields are not added. All context buffers are pruned on idle and busy ticks, with another expiry check before request assembly; samples at least forty-five seconds old cannot enter a request. Evidence input is capped at 4,096 UTF-8 bytes and response reads at 65,536 bytes. Real provider/model access and caption quality were not verified locally.

Primary references consulted: [OBS Browser Source](https://obsproject.com/kb/browser-source), [React integration](https://react.dev/learn/add-react-to-an-existing-project), [esbuild API](https://esbuild.github.io/api/), [OpenAI text generation](https://developers.openai.com/api/docs/guides/text) and [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data). The bounds describe this code, not model obedience or provider retention policy.

See the [checkpoint report](checkpoint-3.md) for actual observations, simulations and remaining checks. The independent code review is accepted and feature scope frozen. The user chose to wait for a third viewer and keep defaults for the next [timeboxed acceptance plan](live-acceptance-plan.md).

## Received traffic for live verification

A one-viewer test must be labeled explicitly with temporary `minimumChatters=1` and restored afterward. With all other defaults, the per-viewer cap is exactly the1/s rate threshold: five consecutive received source seconds must be occupied for the rolling five-second window to reach1/s, and three completed elevated buckets must also qualify. Typing sixteen messages does not establish this profile. Confirm received source seconds, counted rates, active warm-up and all safeguards from retained engine evidence. An EventSub gap restarts the full60-second warm-up. One-viewer results do not verify the default three-chatter safeguard live. Respect channel moderation; avoid uppercase test spam and never remove a timeout to manufacture an outcome.
