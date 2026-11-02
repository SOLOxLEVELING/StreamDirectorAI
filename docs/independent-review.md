# Independent review — November 1, 2026

**Current review verdict: all four reproduced code findings are fixed and independently rechecked.** The final suite has **140 passes**, and typecheck/build pass. No remaining material code defect was identified in the reviewed scope. **End-to-end acceptance remains open** for the external checks listed below; this review does not certify actual chat-trigger usefulness, clean stream stability, real paid-event delivery or real AI.

The report preserves the 131-test baseline, three initial findings, a fourth race found during fix review, and subsequent fix verification. Native Resolve evidence is independently corroborated, and all eight signal routes rendered with the correct overlay tier in an isolated browser exercise. None of the findings allowed an LLM to decide detection or tier.

## Independence and method

This review began in a fresh review-agent context from the repository, `docs/accepted-plan.txt` and `docs/checkpoints.md`. The requested reviewer configuration was GPT-6.1 Sol with high reasoning effort; model selection is controlled by the parent orchestration. The executing agent's completion summary was not used as proof. Directly inspected source, fixtures, tests, exported artifacts, existing recordings, current native Resolve marker dictionaries, and a separately launched credential-free application instance. The executing agent began a separate diagnostic implementation during review; baseline findings refer to the code inspected before those changes, with follow-up status to be appended.

No runtime implementation or existing evidence was modified by the reviewer. Review-only reproductions and fresh decoded frames are in `/private/tmp`; this report is the only repository file authored by the reviewer. No `.env`, private data, token contents, or raw chat was printed. No external messages were sent, public streams started, live settings changed, native markers created/imported, projects switched, or playheads moved. The isolated backend used ports 4497/4498 and `/private/tmp/streamdirector-independent-backend-data`, with no Twitch or AI credentials. Native/browser UI use was coordinated with the executing agent.

## Commands and results

| Check | Independent result |
|---|---|
| `node -v` | v24.15.0 |
| `npm test` in the default sandbox | 130 pass; one backend test cannot bind loopback (`listen EPERM`) |
| `npm test` with loopback permission | **131 passed, 0 failed, 0 skipped**, approximately 1.2 seconds |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; browser bundles regenerated |
| `node --disable-warning=ExperimentalWarning /private/tmp/streamdirector-review-repros.mts` | Reproduced early caption finalization and unhandled EventSub failure callback rejection |
| `node --disable-warning=ExperimentalWarning /private/tmp/streamdirector-review-lifetime.mts` | Reproduced obsolete subscription result overwriting a healthy current connection |
| `node --disable-warning=ExperimentalWarning /private/tmp/streamdirector-review-exports.mts` | Real CSV and mapped EDL regenerate byte-for-byte; actual dashboard JSON contains the same three manual records; expected frames 6273/10247/16423 |
| SHA-256 and byte-size checks of all three existing checkpoint-3 MOV files | All match their manifests |
| AVFoundation/Vision decoding of existing live and simulated recordings | Fresh decoding corroborates recorded manual banners, exact clock samples and simulated corner visibility |
| Resolve internal Lua console, direct read-only calls | Version 21.1.1.10; all four known-footage cases and actual-broadcast timeline match retained marker data |
| Isolated backend → Store → SSE → actual browser overlay | Chat corner and raid/subscription/gift/resubscription/cheer/redemption/manual banners observed; reload starts blank |

AVFoundation decoding initially failed inside the sandbox (exit 133); repeating the same read-only decoding with permission succeeded. This is an environment limitation, not an application test failure. Temporary reproduction scripts use fake credentials/providers/sockets or in-memory SQLite and do not call Twitch/OpenAI.

## Actionable baseline findings

### 1. [P1] A persistence failure in a disconnect callback can terminate the process and interrupt reconnect setup

Baseline locations: `src/twitch/eventsub.ts:61`, `src/twitch/eventsub.ts:67`, `src/twitch/live.ts:88`, and `src/twitch/live.ts:242`.

The socket message listener discards the promise returned by `.catch(() => this.fail(...))`. `fail()` invokes the external gap callback before clearing remaining connections, scheduling backoff, and reporting status. The production callback writes diagnostics and calls `Recorder.connectionGap()`. If persistence fails while handling an incoming notification, and the gap/diagnostic write also fails, `fail()` throws. The catch handler consequently produces an unhandled rejection; default Node handling may terminate the backend. A synchronous socket close/error callback can similarly propagate the throw, and the remaining reconnect cleanup is skipped. The baseline tick catch also writes `integration_error` without protecting that diagnostic write, while the server launches `live.tick()` without a rejection handler.

Reproduction: the isolated script uses the actual EventSub client, a welcomed fake socket, a notification callback that throws a simulated SQLite-write error, and a gap callback that throws another simulated SQLite-write error. One notification produces `unhandledRejections: ["simulated SQLite gap write failure"]`. The script installs an observation handler only to keep the review process alive; production has no such handler. This is simulated fault injection, not a claim that the existing private database failed.

Required correction: make connection retirement/retry bookkeeping unconditional; isolate failures from persistence/status/gap callbacks, retain a sanitized failure state, and handle all detached asynchronous operations. Ensure a failed write remains visibly unpersisted rather than fabricating success. Add regressions where both the notification write and subsequent gap/diagnostic writes fail, then recover and confirm reconnect and retry behavior without unhandled rejection.

### 2. [P2] An obsolete subscription request can overwrite current connection health

Baseline location: `src/twitch/live.ts:111` through `src/twitch/live.ts:125`.

`subscribe()` updates the service-wide subscription dictionary and warning after awaiting Helix, without checking that its originating EventSub connection is still current. `EventSubClient.message()` checks whether its socket was retired after awaiting `subscribe()`, but that occurs after the shared service state was already changed.

Reproduction: `/private/tmp/streamdirector-review-lifetime.mts` uses actual LiveTwitch and EventSub code with fake auth/Helix/sockets. Hold the old socket's subscription request; call `connect()` again; welcome the replacement socket and return HTTP 202; then resolve the old request with HTTP 400. Before the old result, status is `connected` with chat `enabled`. Afterward, it remains `connected` but chat becomes `rejected` and the unavailable-chat warning appears. A late 202 can likewise conceal a current rejected request. No credential disclosure was observed.

Required correction: scope subscription operations and result application to their owning connection/session generation; ignore stale results and diagnostics and reset state for the active subscription attempt. Cover both obsolete-success/current-failure and obsolete-failure/current-success orderings, including stop/logout.

### 3. [P2] Caption finalization omits the chat candidate's confirmation horizon

Baseline location: `src/captions.ts:47` through `src/captions.ts:50`; related detector correlation/confirmation at `src/detector.ts:172` through `src/detector.ts:196`.

The caption due time includes the cheer window and correlation plus lateness, but omits the time needed to validate the completed chat-bucket sequence. Chat onset can be at the far edge of the correlation window and its evidence can attach after the job is already complete. This breaks the intended finalized-bookmark boundary and can omit late surrounding context from the only caption job. Detection, persistence, and overlay tier remain deterministic.

Reproduction: in-memory live session with only warm-up reduced to zero; raid at 0; three distinct chatters in source buckets 10, 11 and 12; remaining horizons at defaults. The raid caption job completes at 14,000 ms with zero attached chat evidence. At 15,000 ms the detector confirms the chat and attaches one evidence record to the already-captioned raid. Script output records `beforeEvidenceCount: 0`, `afterEvidenceCount: 1`, `afterChatConfirmedAtMs: 15000`, and `captionStatus: complete`. The worker currently sends a subset of structured fields rather than the complete evidence array, but the documented finalization boundary is still premature and delivery near the lateness boundary can also arrive after the only request.

Required correction: include the bounded candidate validation horizon and a boundary allowance in finalization; test default and configured activity/sustain/lateness settings and the latest eligible correlation onset. Continue to enforce one job, timeout, budget, and fallback behavior.

## Independently verified behavior

**Deterministic detector.** Direct inspection confirms no LLM/text/sentiment/emote/keyword input in the detector. The threshold sequence uses completed, nonoverlapping one-second buckets, zero buckets, per-user caps, distinct-chatters and rolling-rate safeguards. Candidates freeze threshold and expire inclusively at `max(activitySeconds, sustainSeconds)`. The suite covers short impulses with silence/baseline, stalled two-chatter candidates, a later fresh surge/onset, exactly-one sustained bursts, cooldown/rearm, gaps and platform bypass. All baseline regressions passed. Synthetic tests establish the implemented rule, not editorial relevance.

**Persistence and provenance.** Bookmarks, source IDs and detector state commit together before observers run; rollback restores detector state. Source-ID dedup persists beyond engine-cache eviction/restart. Session/broadcast identity, mode, settings revisions and preserved old offsets are checked during recovery. Configuration recovery clears correlations across revisions and resets coverage/warm-up. Store observers get clones and one failing presentation observer cannot roll back a successful commit. The failure escalation in finding 1 is outside that successful-commit isolation.

**AI boundary.** Source search finds one model call, in `src/captions.ts`, directed to Responses with `tools: []`, `tool_choice: none`, `store: false`, bounded evidence and optional untrusted samples. Detector/normalizer do not receive chat text. The worker snapshots and freezes its input, calls only the caption/status store surface, limits output to 80 Unicode code points, and cannot create/delete bookmarks or write timing, reason, metrics, signal or tier. Context is pruned at admission and tick/job construction, including while a provider is busy; the exact 45-second boundary is tested. Budgets and one-job identity persist across restart; failed/late/incomplete/oversized/HTML-like provider results retain fallback labels. These are fake-provider checks; **no real AI request or caption quality was verified**. Finding 3 affects finalization timing.

**Auth, HTTP and diagnostics.** The baseline tests exercise browser-bound one-time OAuth state, backend-only credentials, file mode, refresh rotation, validation quarantine, logout/revocation generations and stale Helix responses. Overlay is a separate read-only listener with no dashboard asset/control/status route or credential cookie. Host/origin and dashboard control checks passed in a real isolated HTTP server. No secret leakage was observed in these checks. Baseline generic integration diagnostics remain insufficient to identify the recorded historical error; the executing agent is separately implementing sanitized operation/category diagnostics. This review is not a general security audit.

**Snapshot/export ordering.** Directly inspected `SnapshotRequests` and its dashboard use: selection generation and request sequence fence late bodies/errors; selection invalidates export identity immediately; A→B→A cannot admit the first A; selected bookmark IDs and mapping are captured with the verified session at export start. All five controlled race regressions passed. Existing actual browser-downloaded JSON for the original session matches its three retained manual bookmarks and CSV.

**Event routing and presentation.** The new isolated exercise ran the real backend, SQLite writes, post-commit hub, SSE, bundled browser renderer and DOM. Observed `reaction corner` for simulated chat, and `reaction banner` for all seven other signals, with explicit SIMULATED labels and expected captions. The test session was `simulated:7c52114a-c586-4580-accb-7e0f46766e0b`; an additional gift/redemption was sent to capture their brief DOM states. Full browser reload was blank and did not replay them. Gift-recipient suppression, current-batch total, configured reward filtering, cheer crossings/aggregate updates, correlation without banner downgrade, queue suppression without bookmark deletion, and live/simulated isolation are independently passing automated checks. Official current [subscription documentation](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types) and [payload reference](https://dev.twitch.tv/docs/eventsub/eventsub-reference) were consulted for chat permissions/version and gift field semantics. Simulated normalized/wire events and local rendering are **not real paid-event deliveries**.

## Exports, recordings and native Resolve

The real three-manual-bookmark CSV regenerates exactly from its JSON. The actual recording EDL also regenerates exactly using explicit alignment +139.5335 seconds, zero lead-in, 30 fps NDF, and 01:00:00:00 timeline start. It yields relative frames **6273, 10247, 16423** without changing saved offsets. The dashboard-download JSON has the same session and bookmarks. Tests additionally cover CSV escaping/formula protection, JSON evidence/settings, EDL sanitization, unsupported rates, 24-hour range, quantization and explicit frame-collision rejection.

Fresh **read-only native API inspection** was performed in the existing `StreamDirector Checkpoint 2 Markers` project through Resolve's actual internal Lua console. The command only called GetProjectManager/GetCurrentProject, GetTimelineByIndex/GetName/GetMarkers/GetSetting/GetStartTimecode/GetItemListInTrack/GetMediaPoolItem/GetClipProperty and printed results. It did not use the repository scripts' prepare/SaveProject paths or create markers.

- Resolve returned **21.1.1.10**.
- `SD Import 30 zero` and `SD Import 30 one-hour` each have four markers at **0/15/91/300**, correct zero/one-hour start and 30 fps, and the actual `output/test-30.mov` path.
- The corresponding 60 fps timelines each have markers **0/30/181/600**, correct starts/rate and `output/test-60.mov`.
- Names were First Frame, Half Second, Frame Boundary and Final Marker; notes matched fixture IDs/reasons; first color Blue, others Green; every duration was one frame.
- `SD Actual Broadcast Final 30 NDF` has exactly three markers at **6273/10247/16423**, Green, one frame, caption Streamer marked this moment, and exact manual signal/reason/bookmark-ID notes on actual OBS footage. Its start is **01:00:00:00**, rate **30 fps**.

The retained failed earlier import is visible in the console history and remains documented; it is not counted as a pass. Fresh readback corroborates the final native marker state, beyond EDL syntax tests. Historical assisted UI import steps are supported by the retained evidence; the reviewer did not repeat the imports.

All three MOV files match recorded byte lengths and SHA-256 values. Fresh live-recording decoding at exact relative frames gives visible clocks **1793480483549 / 1793480616012 / 1793480821865**, matching the retained −3/−32/−41 ms residual calculations. Fresh frames at 343 s and 549 s visibly show manual banners. The first marker's 210 s frame is still before its banner paints and is not counted as positive visibility proof. Fresh simulated-recording frames at 65.8/66.3/67.0 s show the explicit simulated chat corner; it is absent at 68 s. Outputs are in `/private/tmp/streamdirector-independent-live-frames` and `/private/tmp/streamdirector-independent-sim-frames`. These checks establish recorded UI/serialization behavior, not gameplay/action timing or editorial accuracy.

## Explicit unresolved acceptance

**End-to-end acceptance has not passed.** An actual chat-triggered bookmark still has not been demonstrated. Independent recomputation from `rerun/integration-events.json` finds 30 chat notifications, at most two consecutive occupied source buckets, and a one-viewer capped five-second rate upper bound of **0.8/s**. This is below the unchanged three-bucket and 1/s safeguards even with temporary `minimumChatters=1`; zero bookmarks is consistent with those supplied inputs. It does not establish the default three-viewer positive path. The restored settings evidence must remain distinct from the temporary profile.

The retained actual OBS log independently reports **5,017 network-dropped frames out of 20,436 attempted (24.5%)**, so clean streaming stability failed. One EventSub timeout recovered; two associated coverage records and one historical generic integration error remain in evidence. The original cause of that generic error cannot be reconstructed from newly added diagnostics. A later diagnostic fix or passing test must not relabel that run as clean.

Real raid/subscription/gift/resubscription/cheer/redemption delivery, real AI output, sustained production-load/memory behavior, detection usefulness/noise and actual chat-to-recording/native-editor timing remain unverified. Known-marker Resolve compatibility and actual manual-marker import have passed their narrower scopes. Public demo/submission claims must preserve these distinctions.

## Follow-up review history

Baseline findings were promptly sent to the executing agent with reproduction paths. The successive checks below record the fixes and further findings in order. Passing fixes do not close the external acceptance items above.

### First fix follow-up — 138-test revision

Independently inspected the patched `diagnostics.ts`, auth, LiveTwitch, EventSub, server and caption worker, then reran the original reproduction scripts, full test suite, typecheck and production build. **138 tests pass, zero failures/skips; typecheck/build pass.**

The three original repros no longer exhibit their defects:

- EventSub fault injection now reports **zero unhandled rejections**. Connection retirement and retry scheduling precede protected gap/status callbacks; failures from callbacks, closing sockets and diagnostics cannot escape their wrappers. LiveTwitch retains an in-memory pending coverage interval when its durable gap write fails, blocks incoming/manual persistence until recovery, and exposes the pending state. A passing regression exercises notification+gap+logger write failures and later recovery.
- Obsolete subscription HTTP 400 no longer overwrites a replacement socket's enabled state or warning. Results are gated by connection epoch and subscription generation, including automatic socket retry retirement. Both original repro and added explicit-reconnect/socket-retry regressions pass.
- Caption status stays **pending** at 14,000 ms in the original reproducer. The added regression confirms correlated chat at 15,000 ms and a single model call with bounded numeric correlated evidence at 19,000 ms. The finalization formula now includes candidate validation, lateness and bucket allowance; the worker's write authority remains caption/status only.

Diagnostics now persist allowlisted operation/category/HTTP status, omit arbitrary error messages/stacks/causes/provider bodies/URLs, use exact safe public messages, and remove arbitrary HTTP path retention. Auth distinguishes safe network/timeout/HTTP/invalid-response categories. Logger failures increment an exposed counter and do not prevent safe HTTP completion. Stream-lookup recovery clears the warning only when that operation succeeds; historical last-failure details remain with recovery time. The tests inject private-string sentinel errors/provider bodies and do not reflect those strings. No new real upstream/AI call was made. These changes cannot determine the cause of the older generic integration error.

**A new material race remains open in this revision**, described below. Therefore this is not yet a cleared implementation verdict.

### 4. [P1] An in-flight stream lookup can discard a coverage gap created during its await

Follow-up revision location: `src/twitch/live.ts:186` through `src/twitch/live.ts:201` (and the new-broadcast recorder replacement immediately afterward).

The new pending-gap guard runs only before awaiting the stream lookup. A notification can fail persistence during that await, establishing a pending gap against the current recorder. When the already-running lookup later reports the channel offline, the function clears both recorder and pending gap without saving the interval. A new-broadcast response can similarly replace the recorder before the old gap is durable. This defeats the new fail-closed guarantee and silently omits missing coverage from the old session.

Independent reproduction: `node --disable-warning=ExperimentalWarning /private/tmp/streamdirector-review-poll-gap-race.mts`. It uses actual LiveTwitch/EventSub/Recorder and an in-memory Store subclass whose `commit()` throws a synthetic `SQLITE_FULL`. Establish a live recorder and saved manual mark; start and hold a second stream lookup; enable the write outage; send a raid notification through the fake socket and allow its failed gap write; then resolve the held lookup with HTTP 200 and `data: []` while the outage continues. Output:

```json
{"before":{"pending":true,"session":"twitch:42:original"},"after":{"pending":false,"session":null},"durableGaps":0}
```

Required correction: after the awaited stream response and ownership/authentication fences, flush/recheck any pending interval against the old recorder **before** applying offline or new-broadcast state. If persistence still fails, retain the old recorder/pending interval and reject the transition safely. Add regressions for both response types with the gap created during the request, then validate recovery and old-session coverage. This fault injection is simulated and does not assert an actual production database outage.

### Second fix follow-up — pending-gap race behavior

The after-await transition guard is now present immediately after the ownership/authentication fence in `pollStream()`. Independently reexercised the original race with explicit assertions and both result variants in `/private/tmp/streamdirector-review-poll-gap-fixed.mts` and `/private/tmp/streamdirector-review-poll-gap-new-broadcast-fixed.mts`. While persistence fails, the poll rejects safely with storage category and **retains the original session and pending interval**. After restoring the Store, each variant saves one gap to the original session before transitioning respectively to offline or `twitch:42:replacement`. Finding 4's behavioral reproduction is resolved.

Additional independent checks: obsolete HTTP 202 cannot overwrite the current HTTP 400; the current rejected state/warning survives. The caption check in `/private/tmp/streamdirector-review-caption-fixed.mts` uses the complete default 60-second warm-up and separately tests configured activity=8 and sustain=8. No request occurs before the computed boundary; each makes exactly one later request containing the correlated numeric evidence. Actual retained CSV/EDL/dashboard JSON still regenerate/match exactly.

The full suite now passes **140/140**. This intermediate revision's typecheck failed at `src/twitch/live.ts:197` (`startMs` on `never`, caused by TypeScript retaining pre-await narrowing), so the chained build did not execute. The compile correction and final checks remain pending at this point in the review history.

### Final fix verification — 140-test revision

Independently inspected `requireDurableCoverage()` and its calls both before the stream request and immediately after the awaited response/ownership fence. This avoids the invalid TypeScript narrowing while preserving the required behavior. Reran **all 140 tests: 140 passed, zero failed/skipped**, then `npm run typecheck` and `npm run build`: **both passed**. Repeated both independent deferred-poll race variants after the helper change; they retain the original recorder/pending interval during outage and save the old-session gap before offline/replacement transition. Repeated the default-warm-up and extended activity/sustain caption checks; each sends once after finalized correlated evidence. The original no-unhandled-rejection and subscription-order reproductions were already rechecked on the fixed implementation, and the relevant regressions remain passing in the final suite.

**Findings 1–4 are resolved.** No remaining material implementation defect was identified in this review's inspected/exercised scope. The final tests are local/simulated fault and behavior checks, not new real Twitch/OBS/AI acceptance. This review's external-evidence cutoff precedes any later authorized live test; the actual-chat, stability and other unresolved acceptance statements above continue to apply unless separately superseded by new actual evidence. Review browser/native surfaces were released and the isolated backend was stopped.

### External-verification follow-up — two later actual runs

Independently inspected `evidence/independent-review/live-rerun/final-session-evidence.json`, its OBS log extract and recording manifest, and the retry's final session, traffic, SQL snapshot, OBS, after-stop and restored-settings artifacts. Also queried the existing SQLite database **read-only**, selecting only these two sessions' normalized state, bookmark/gap counts and saved detector settings. Both stored session records exactly match their retained evidence, with **zero bookmarks and two coverage records each**. The first recording's byte size and SHA-256 match its manifest. The actual OBS source log corroborates the retained excerpts; no UI interaction, public message, source edit, stream start or configuration change was performed by this follow-up reviewer. Source remained unchanged after the passing 140-test fix review, so checks here target the new external evidence.

**Neither run demonstrates a real chat-triggered bookmark.** The first session (`316496783341`) retains four normalized chat notifications concentrated in only two isolated source-time seconds; this cannot satisfy three consecutive qualifying buckets. Message text/public-send counts are not inferred from metadata-only records. For retry session `316460892267`, independent recomputation from the persisted-bucket observations finds **14 counted messages spanning 35 seconds**, a longest occupied run of three seconds and maximum five-second counted rate **0.8/s**, below the unchanged **1/s** floor. The only three-second run ends **59.075 seconds** after the recovered-gap warm-up origin, before the required 60 seconds. Thus the observed zero results are consistent with the supplied traffic; they do not validate the positive path or the default three-chatter profile. Each session used temporary `minimumChatters=1` and retained its historical configuration.

The first broadcast ran **20:40:40.477–21:21:59.562 local**, approximately **41 min 19 s**; OBS reports 74,364 streaming frames without a network-drop summary or attempted/output discrepancy, consistent with zero reported network drops. The retry ran **22:24:25.847–22:33:39.614**, approximately **9 min 14 s**, with **16/16,598 network-dropped frames (0.1%)** and **21/16,828 recording encoding skips (0.1%)**. No OBS reconnect was logged in either interval. Each application session nevertheless had **one recovered EventSub timeout**, with overlapping initial/final coverage records spanning **12.432 s** and **12.638 s** respectively, followed by six enabled subscriptions. Neither session's retained integration events contains a new generic `integration_error`. These substantially longer runs must not be described as 90-second tests or an uninterrupted/clean stability pass.

Restored-settings artifacts and the current saved app configuration show **minimumChatters=3**, minimum rate 1/s, 60-second warm-up and the other prior defaults. Retry after-stop evidence confirms **stream offline, no active session, no pending coverage persistence, and AI disabled**; EventSub itself remains connected. The OBS logs show broadcasting and recording stopped. There were no new chat bookmarks to export/import into Resolve, so the earlier verified manual-marker/native-import scope is unchanged. **End-to-end acceptance remains open**, including successful real qualifying chat, positive chat overlay/recording/editor timing, clean continuity, real paid-event deliveries, real AI and production-load/usefulness checks. The four resolved code findings remain resolved; these new runs do not supply the missing positive acceptance evidence.
