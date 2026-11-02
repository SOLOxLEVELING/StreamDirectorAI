# Checkpoint 2 — Twitch integration and Resolve marker export

Status: checkpoint 2 implementation and available external checks complete; **paused again for user review after addressing all three review findings on November 1, 2026**. Actual Resolve marker import passed all four cases. Live Twitch authentication and chat delivery passed; real broadcast timing and other unavailable checks remain unverified below. Checkpoint 1 passed user review. Dashboard, overlay, SSE presentation and AI captions have not been started.

## Changes

- Added the loopback-only Node backend, server-side broadcaster authorization-code flow, browser-bound one-use OAuth state, user/application validation, protected token storage, serialized refresh and one-retry API authorization recovery. Saved authorization reconnects on backend restart. Secrets are excluded from status, exports and logs.
- Verified current official Twitch versions, conditions, permissions and event fields before implementing adapters. See `twitch-protocol.md`. The MVP uses only the selected feature scopes. Six live subscriptions are currently enabled; redemption subscription/scope requires a configured reward ID.
- Added the EventSub WebSocket client: welcome/session subscription creation, native protocol ping/pong, keepalive watchdog, bounded retry, immediate incomplete-coverage recording, chat warmup reset, revocation handling, and requested reconnect handover without duplicate subscriptions. The documented handover briefly overlaps two sockets; steady state uses one outgoing connection.
- Added stream identity/start lookup, persisted stream-relative sessions, direct account capability probes, explicit live/simulated provenance, backend status/evidence/reference exports and authenticated manual fallback. Offline event receipts never become fabricated stream-relative bookmarks.
- Added the Resolve marker-EDL writer after inspecting a real Resolve export. It supports explicitly selected 30/60 fps NDF, explicit timeline start, nearest-frame serialization, names/notes, text sanitization and clear rejection of unsupported rates/timecodes/colliding marker frames. CSV/JSON retain full records. Explicit bookmark selections are available on the export endpoint.
- Added real CLI simulation, retained wire fixtures, OAuth/transport/backend/export tests, procedural 30/60 fps test video generation and four native-import cases with an inspection script.
- Review fixes add generation-fenced authorization, durable validation quarantine for rotated credentials, and current-configuration reconciliation with complete historical settings revisions during same-broadcast recovery. See the regression evidence below.

## Automated and simulated results

| Check | Actual result |
| --- | --- |
| Full automated suite | `npm test`: **104 passed, 0 failed, 0 skipped** (previous checkpoint report: 88). Includes all checkpoint 1 regressions, fourteen deterministic replay fixtures and sixteen added review regressions. |
| TypeScript | `npm run typecheck`: passed with zero diagnostics. |
| OAuth security/lifecycle | One-use browser-bound state, expiry/replay rejection, identity validation, mode-0600 persistence, concurrent refresh serialization, API 401 retry and safe errors passed. Added delayed-response tests prove logout/revocation fence callbacks/refreshes, stale failures cannot clear a newer grant or release its refresh lock, and quarantined rotations survive validation outage/restart without API use until validation succeeds. All failure injections use mocked HTTP/sockets. |
| HTTP backend | Real loopback HTTP tests passed for host/origin rejection, control-token enforcement, secret-free status, safe callback diagnostics, native EDL response, required FPS, collision rejection and bookmark selection. |
| EventSub transport | Fake-socket tests passed for welcome, notifications, malformed messages, keepalive timeout, revocation, trusted reconnect URLs, immediate coverage gaps, resubscription and handover without duplicate subscription creation. |
| Official Twitch CLI 1.1.24 | **Six supported platform events produced six persisted banner bookmarks**: raid, non-gift subscription, gift batch, resubscription, cheer and configured redemption. Requested reconnect completed with inherited subscriptions and zero coverage gaps. Results, actual wire fixtures and logs are explicitly simulated under `evidence/checkpoint-2/simulated-cli/`. CLI does not support a chat-message trigger in its current supported list; chat adapter tests are separate fixtures. |
| Integration receipt time | CLI exposed a millisecond clock disagreement between capture and persistence. The adapter now freezes the recorder clock at the captured receipt instant; the regression passed. The checkpoint 1 detector itself was not loosened. |
| Headless persistence | Mocked live-service integration saved bookmarks without a presentation callback, deduplicated repeat delivery and used the supplied Twitch-shaped stream origin. These tests are isolated mocks, not real broadcasts. |
| Same-broadcast configuration recovery | Real SQLite close/reopen with mocked Twitch inputs passed: current reward/bot/numeric settings applied, new reward accepted, obsolete reward rejected, removed bot counted, newly configured bot excluded, old source IDs still deduplicated, bookmark sequence/origin preserved and historical records unchanged. Legacy history, failed configuration commits and revision isolation also passed. |
| EDL serialization | Parsed real Resolve sample; generated 30/60 fps zero/one-hour marker files passed timecode/name/note checks within half a frame. Unsupported/drop-frame rates, malformed timecode, 24-hour overflow, text injection, mutation and same-frame collisions reject correctly. These checks alone are not a native import pass. |

Evidence logs: `evidence/checkpoint-2/test-results.txt`, `typecheck-results.txt`, CLI `results.json`, `cli-log.txt`, `wire-fixtures.json`, and generated CSV/JSON exports. CLI binary came from the official release; SHA-256 archive checksum was verified before execution.

## Review-finding regressions — November 1, 2026

| Finding | Reproduction and actual result |
| --- | --- |
| Late auth work restores credentials after logout/revocation | Held refresh and callback responses at both token exchange and validation; cleared authorization; released successful responses. Every pending operation rejected and no credential file was recreated. Unused pre-logout OAuth states rejected. Simulated `authorization_revoked` and `user_removed` notifications through the real service handler invalidated pending refresh and callback together. A late callback could not overwrite a fresh login; an old refresh rejection could not clear a newer grant or release its active refresh lock. Late Helix 401 responses could not refresh a replacement login. |
| Rotation lost when validation is unavailable | Refreshed successfully, returned validation HTTP 503, and recreated the auth manager from the protected file. The new refresh token and `pendingValidation` survived. Helix sent zero requests during the outage. Once validation recovered, the saved access token worked without a second rotation, and the next rotation used the new refresh token. Logout during the pending validation retry defeated its late success; authoritative validation rejection deleted the quarantined grant. A separate headless live-service test paused ingestion, recorded both sides of the coverage gap, retried successfully and persisted a subsequent event. |
| Same broadcast silently resumes obsolete detector settings | Reopened the same SQLite database with a changed reward ID, bot list and rate threshold. The saved session kept its stream origin, app-join time, sequence and dedup IDs. Current settings became revision 1; complete old settings remained revision 0. A new redemption and sustained traffic produced the expected bookmarks, the old reward was ignored, the removed bot contributed and the new bot did not. An unchanged second restart created no extra revision. Legacy records gained history without rewriting old bookmarks; a failed configuration commit left stored settings unchanged. New evidence near an old platform bookmark stayed within its own revision. Conflicting stream identity/origin was rejected. |

These sixteen added tests use controlled mocked network responses, fake EventSub sockets and isolated SQLite databases; they are **not actual Twitch revocation, outage, redemption or broadcast evidence**. The full suite also replays the retained official CLI fixtures; the CLI binary and Resolve UI import were not rerun for these auth/configuration fixes. Their earlier evidence is retained, and the EDL writer is unchanged.

Recovery contract: callers supply the active configuration. Complete settings history is persisted with state/gaps in the same transaction. Historical bookmarks are not recalculated. New bookmarks carry `settingsRevision`; missing revision on legacy bookmarks means zero. CSV includes `settings_revision`, and JSON retains the complete history. Recovery resets chat warm-up, candidates and aggregates; a configuration change also clears prior correlation candidates. Changing configuration currently requires a backend restart. A failed startup validation can be retried with `/api/connect` after the outage; it does not require reauthorization solely because validation was unavailable.

## Actual live Twitch evidence

Broadcaster: **soloxleveling**, user ID `238520082`.

- Successful real authorization-code exchange and Twitch validation. Granted scopes: `user:read:chat`, `channel:read:subscriptions`, `bits:read`.
- Twitch returned HTTP **202** for all six configured v1 subscriptions: chat, incoming raid, subscribe, gift, shared resubscription and cheer.
- **Three actual `channel.chat.message` notifications** arrived with distinct source message IDs and separate source/receipt timestamps. The user sent these messages from the broadcaster account. Broadcaster messages are excluded from detection counts, and the channel was offline; no stream-relative bookmark was fabricated.
- Direct authenticated capability probes returned HTTP **200** for broadcaster subscriptions and the Bits leaderboard. This verifies API access, not that paid events occurred or that all monetization UI tools were enabled.
- Backend restart reloaded protected authorization, validated with Twitch and re-established the six subscriptions without another consent step.
- Twitch consistently reported the channel **offline**. No actual broadcast, live stream start, live detection bookmark, real paid event, manual live mark, live-to-editor alignment or stream recording comparison has been verified.
- Channel Points was **not checked live** because `channel:read:redemptions` is missing and no Mark This reward ID is configured. No entitlement was inferred from Affiliate status.

Sanitized evidence: `evidence/checkpoint-2/live/status.json`, `capabilities.json`, `received-events.json`, `integration-events.json`, `review-status.json`, and review-fix restart `review-fixes-status.json`. The fixed backend's real restart again showed authenticated/connected, six enabled subscriptions, `validationRequired: false` and an offline channel. This verifies normal startup validation/reconnection, not real failure recovery. Tokens, client secrets, authorization codes, raw OAuth callback query strings and chat content are absent. The final exact-value credential scan found zero occurrences; see `evidence/checkpoint-2/secret-check.json`.

## Actual Resolve evidence

- Resolve **21.1.1.10** was opened in the isolated project **StreamDirector Checkpoint 2 Markers**. The internal console returned this version.
- The user exported `resolve-exported-sample.edl` from the real timeline. Its two markers, known timecodes, names, notes, colors and durations established the dialect before the writer was implemented.
- Known H.264 MOV footage was generated: 12 seconds at 30 fps / 360 frames, and 12 seconds at 60 fps / 720 frames.
- The user ran the preparation script; the assistant independently inspected the actual console output showing **all four timelines prepared with one video clip each**: 30/60 fps at zero and one-hour starts.
- **Actual marker import passed: four cases, sixteen markers, zero failed cases.** The user imported each generated EDL onto its matching existing footage-backed timeline through **Media Pool timeline item → Timelines → Import → Timeline Markers from EDL**, then ran `sd_action='verify'`. The assistant independently read the full output from Resolve's actual console. `GetMarkers()` returned the expected count, relative frames, names, notes, Blue/Green colors and one-frame durations in every case. The script also confirmed timeline FPS, start timecode and the exact known footage path.

| Timeline rate / start | Actual relative marker frames | Result |
| --- | --- | --- |
| 30 NDF / 00:00:00:00 | 0, 15, 91, 300 | 4 markers, all checks passed |
| 30 NDF / 01:00:00:00 | 0, 15, 91, 300 | 4 markers, all checks passed |
| 60 NDF / 00:00:00:00 | 0, 30, 181, 600 | 4 markers, all checks passed |
| 60 NDF / 01:00:00:00 | 0, 30, 181, 600 | 4 markers, all checks passed |

Observed frames equal the expected rounded frames; the fixtures' offsets serialize within half a frame, satisfying the one-frame acceptance bound. This establishes known-marker serialization/import at these rates and starts, not live detection or recording alignment accuracy. Full console readback: `evidence/checkpoint-2/resolve/actual-import-results.txt`; manifest and files are in the same directory. JSON exports now record this limited verification scope and retain `liveStreamAlignment: 'unverified'`.

An earlier attempt used ordinary timeline import, creating separate `generated-…` timelines with offline reference clips while leaving the intended timelines without markers. That failed attempt is retained in `actual-import-attempt-1.txt`; the correct marker-import command above passed without changing the generated EDL files.

Native evidence is under `evidence/checkpoint-2/resolve/`. Context-menu automation was unreliable and the console initially lagged; the user restarted Resolve and assisted with sample export and timeline preparation. Safe Lua scripting disables `io`, so actual readback results are printed for capture rather than enabling broader scripting permissions.

## Limitations / remaining external checks

- Real stream-relative timestamps, sustained chat detection against a recording, real platform-event timing, live subscription revocation/expiry and unexpected real network-gap recovery remain unverified. Simulated tests establish code behavior only.
- Channel Points scope/reward setup and actual redemption delivery remain unverified.
- Resolve verification covers 21.1.1.10, known footage and the four supported rate/start cases above. Other Resolve versions, other frame rates/drop-frame, actual Twitch recording alignment and live editorial relevance were not verified.
- Stream status is polled every 15 seconds. Offline/unknown-origin receipts are logged but not converted into bookmarks; events before a newly started stream is discovered may therefore lack a stream-relative bookmark. This limitation is visible and should be considered during live verification.
- SQLite history grows on disk. Real broadcast throughput/memory bounds have not been measured.
- EDL is limited to 999 non-colliding markers, 30/60 fps NDF, one-frame point markers, ASCII/transliterated names (80 chars) and notes (240 chars). Same-frame collisions reject rather than silently lose or move markers; full text/records remain available in CSV/JSON.
- Dashboard/overlay/captions and the fresh independent review remain for the user-authorized later stages. No independent review is claimed at this checkpoint.

Main build chat ID remains `01a19261-1097-73a2-8036-50df8c51465e`.
