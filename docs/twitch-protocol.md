# Twitch protocol verification — checkpoint 2

Verified against current official Twitch documentation on October 31, 2026. Adapter code is in `src/twitch/schema.ts`; this matrix is documentation verification, not evidence that an event occurred live.

| Event type | Version | User-token scope | Condition | Fields used |
| --- | --- | --- | --- | --- |
| `channel.chat.message` | 1 | `user:read:chat` | `broadcaster_user_id`, `user_id`, both the authorizing broadcaster | `chatter_user_id`, `message_id` |
| `channel.raid` | 1 | None specific to event | `to_broadcaster_user_id` only | `to_broadcaster_user_id`, `viewers` |
| `channel.subscribe` | 1 | `channel:read:subscriptions` | `broadcaster_user_id` | `is_gift` (gift recipients are ignored) |
| `channel.subscription.gift` | 1 | `channel:read:subscriptions` | `broadcaster_user_id` | `total` for this batch; **never `cumulative_total`** |
| `channel.subscription.message` | 1 | `channel:read:subscriptions` | `broadcaster_user_id` | structured event occurrence |
| `channel.cheer` | 1 | `bits:read` | `broadcaster_user_id` | `bits`, `is_anonymous`, nullable `user_id` |
| `channel.channel_points_custom_reward_redemption.add` | 1 | `channel:read:redemptions` | `broadcaster_user_id`, configured `reward_id` | redemption `id`, `redeemed_at`, `reward.id`; display title is ignored |

References: [subscription types](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/), [event payload reference](https://dev.twitch.tv/docs/eventsub/eventsub-reference/), [WebSocket message reference](https://dev.twitch.tv/docs/eventsub/websocket-reference/).

WebSocket subscription creation uses `POST https://api.twitch.tv/helix/eventsub/subscriptions`, a **user access token**, the matching `Client-Id`, and `transport: {method: "websocket", session_id: welcomeSessionId}`. The raid event's lack of a scope does not permit anonymous subscription creation. App-token chat rules requiring `user:bot`/`channel:bot` do not apply to this broadcaster user-token flow. See [Create EventSub Subscription](https://dev.twitch.tv/docs/api/reference/#create-eventsub-subscription).

The adapter validates metadata and payload type/version agreement, broadcaster/reader conditions, and positive integer counts. Chat uses its stable message ID; redemptions use their stable redemption ID. Other events deduplicate the transport message ID because these payloads do not promise another event ID. Source time normally comes from `metadata.message_timestamp`; redemptions expose `redeemed_at`. Receipt time is independent. Chat text is not read for detection.

## Authentication lifecycle

Use the [authorization-code grant](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#authorization-code-grant-flow): backend generates five-minute one-use random state, binds it to an HttpOnly/SameSite=Lax browser cookie, exchanges code with the client secret on the server, then validates application and user identity. Tokens never appear in status/export responses. Local token storage is ignored `data/twitch-token.json`, written atomically with mode 0600; this is filesystem access control, not encryption at rest. `.env` is ignored and must also be mode 0600.

Refresh before expiry and retry an API 401 once with a refreshed token. Serialize concurrent refreshes. Validate at connection and hourly, per [token validation](https://dev.twitch.tv/docs/authentication/validate-tokens/) and [refresh guidance](https://dev.twitch.tv/docs/authentication/refresh-tokens/), rechecked November 1, 2026. Twitch recommends reactive refresh on 401; the app also retains its early-expiry refresh check. A successful refresh immediately saves the rotated pair atomically with mode 0600 as `pendingValidation`, before requesting validation. A transient validation failure preserves this quarantined pair because the previous refresh token may no longer work. No quarantined token is returned to Helix or used to authorize ingestion. Recovery validates the saved access token first, including after restart, and only then enables use; it does not rotate again using the obsolete refresh token. Identity/application mismatch or authoritative token rejection clears the grant.

Stored credentials start unvalidated after every process restart. Status distinguishes `credentialsAvailable`, `authenticated`, and `validationRequired`; stored identity/scopes while validation is required are informational. The backend still attempts validation/reconnect for available credentials. A transient outage during an established connection pauses unvalidated ingestion, records incomplete coverage and retries validation on subsequent ticks. After recovery it closes the gap and restarts chat warm-up. If startup connection fails, retry `/api/connect` once the service is available; no fresh consent is needed solely because a quarantined token awaits validation.

Logout, authoritative rejection and EventSub authorization/user revocations increment an authorization generation, invalidate all unused OAuth states, remove saved/quarantined credentials and invalidate pending refresh/validation work. Callbacks and refreshes check their generation before saving results. A successful new grant also supersedes old async work. Promise cleanup cannot release a newer grant's refresh/validation lock; late failures cannot clear a newer grant. Helix checks the current validated access token before sending and before consuming responses, so stale responses cannot refresh a replacement login. EventSub authorization/user revocations stop ingestion and require sign-in again. Reduced grants are reported as missing scopes rather than assumed enabled permissions.

When the same broadcast is recovered, current detector configuration (including reward ID and bot exclusions) is reconciled with the saved configuration. Session/stream identity, original stream origin, original app-join time, bookmark sequence and durable transport/source deduplication remain intact. Changed configuration appends a complete `settingsHistory` revision with its effective receipt time; new bookmarks carry `settingsRevision`, and legacy bookmarks without that field mean revision zero. JSON retains full history; CSV includes the revision number. Old bookmarks are not recalculated. Recovery resets warm-up/candidates/aggregates, and changed configuration also clears recent correlation candidates so new evidence cannot mutate a historical revision's bookmark. Settings/history, state and the recovery gap commit in the same SQLite transaction. Conflicting broadcast identity/origin is rejected rather than silently rewritten. Configuration changes currently require a backend restart.

## Connection lifecycle

The steady state uses **one outgoing EventSub WebSocket**, with Node's native WebSocket handling protocol pings/pongs. Welcome supplies the session ID; keepalives/notifications renew the advertised timeout. Unexpected loss records incomplete coverage immediately, retries with bounded backoff, resubscribes on a new welcome, and records the completed gap. No events are claimed to replay across that gap. The detector resets warmup.

Twitch's **requested reconnect** requires a brief two-socket handover: keep the old socket until the replacement's welcome, use the provided URL unchanged, and do not recreate subscriptions. This is the documented exception to steady-state one-connection operation; the old socket closes immediately at replacement welcome. Reconnect URLs are restricted to Twitch's WSS host. Local WS URLs are only allowed in the separate, explicitly simulated CLI harness. See [handling WebSocket events](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/).

## Stream origin and capability checks

[Get Streams](https://dev.twitch.tv/docs/api/reference/#get-streams) supplies the stream `id`, broadcaster `user_id` and `started_at`, including for a midstream join. The service polls every 15 seconds. It never substitutes app startup time as stream start. While Twitch reports offline, transport event receipt can be verified, but no bookmark with a fabricated stream offset is saved.

Direct capability probes use [Get Broadcaster Subscriptions](https://dev.twitch.tv/docs/api/reference/#get-broadcaster-subscriptions), [Get Bits Leaderboard](https://dev.twitch.tv/docs/api/reference/#get-bits-leaderboard), and [Get Custom Reward](https://dev.twitch.tv/docs/api/reference/#get-custom-reward), only when their read scopes are granted. Successful API access is reported separately from real event delivery and from tool enablement in Creator Dashboard. Rejected EventSub subscriptions retain their actual HTTP status. No Affiliate/Partner entitlement is inferred from `broadcaster_type`; Twitch's [May 2026 rollout](https://blog.twitch.tv/en/2026/05/13/monetization-for-all) and some older API wording differ, so account outcomes must be observed directly.

## Simulation

The [official Twitch CLI](https://dev.twitch.tv/docs/cli/) provides a [local WebSocket server and event triggers](https://dev.twitch.tv/docs/cli/websocket-event-command/). Version 1.1.24 was downloaded from [twitchdev's official release](https://github.com/twitchdev/twitch-cli/releases/tag/v1.1.24); the archive was checked against the release's SHA-256 checksums before execution.

This CLI supports the six planned platform types. Its supported trigger list does **not** include `channel.chat.message`; chat adapter fixtures are separately simulated and actual chat reception still needs a live Twitch check. CLI results remain under `evidence/checkpoint-2/simulated-cli/` with simulated session identity. The CLI harness never loads `.env` or connects to the real Twitch service.
