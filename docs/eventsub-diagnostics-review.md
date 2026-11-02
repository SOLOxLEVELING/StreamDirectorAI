# Independent review: EventSub diagnostic tooling

**Final diagnostic-code verdict: the three reproduced review findings are fixed and independently rechecked. Fourteen targeted tests and strict typecheck pass; all 63 production freeze hashes still match. No remaining material defect was identified in this diagnostic-only scope.**

Review scope: the standalone probe timing helpers, worker, runner, diagnostic watchdog replay and their tests. This review does not authorize or certify a new stream, production timeout policy, detector change or dashboard visual change. The existing end-to-end acceptance verdict remains open.

## Method and freeze boundary

Directly inspected `scripts/eventsub-probe-timing.ts`, `eventsub-probe-worker.ts`, `eventsub-probe.ts`, `eventsub-probe-replay.ts` and `test/eventsub-probe.test.ts`. Ran only isolated synthetic-worker/fake-API tests and review-only reproductions in `/private/tmp`, plus strict typecheck. No new network connection, UI action, credential read, application control action or public message was performed by the reviewer. Full application tests include loopback HTTP connections and are outside this follow-up's no-new-connections constraint; the parent runs those separately.

Independently recomputed all **63** hashes in `evidence/acceptance-plan/frozen-source-manifest.json`: **zero mismatches**. The new scripts/tests supplement that baseline; they do not alter the production feature or watchdog policy. Production code does not import the diagnostic runner/worker. The replay imports the unchanged production EventSub client with an injected fake socket/clock and creates no actual connection.

Initial targeted result: **5/5 passed**, strict typecheck passed. After the first teardown fix and added cases: **11/11 passed**, including sink failures, lost disconnect response, changed readiness, revocation and simulated watchdog timing. Intermediate and final follow-up results are recorded below.

## Findings

### 1. [P1, fixed] Evidence-writer errors escaped the runner and bypassed restoration

Initial runner locations: `scripts/eventsub-probe.ts:11`–`:16`.

The worker-message and main-timer callbacks called the supplied writer directly. An `appendFileSync` failure such as full disk could throw outside the awaited promise, terminate the diagnostic process and bypass the main `finally` that restores the disconnected production reader. `/private/tmp/eventsub-probe-review-callback-failure.mts` reproduced this with a 100 ms synthetic worker and a throwing writer: the initial process exited 1 without its promise catch or caller finally running.

The patched runner catches sink exceptions, rejects once with a fixed safe error, clears the timer/histogram/listeners and awaits worker termination. Repeating the same independent reproduction now prints `PROMISE_REJECTED_SAFELY` and `CALLER_FINALLY_RAN`. Added worker-message and main-timer sink regressions pass, and the fake-API wrapper confirms restoration is attempted through the caller's finally. The extracted connection wrapper also marks disconnect attempted before awaiting its response, addressing the lost-response side-effect case.

### 2. [P2, fixed after follow-up] Reusing the output directory mixes traces from distinct runs

Runner locations in the 11-test revision: `scripts/eventsub-probe.ts:46`, `:57`, `:62`.

The default output folder is fixed and created recursively. `trace.jsonl` is appended to, while `summary.json` is replaced using only the latest run's in-memory records. Running the documented command again with its default folder therefore silently combines old and new phases in the trace, while the summary describes only the new phases; records lack a run identifier or explicit run boundary. This can misattribute measured timing to a later run. Static reproduction is the second invocation with the same output folder; no additional real probe was started for review.

Required correction: reserve a fresh trace/run directory exclusively, or introduce explicit run identity and scope both trace and summary to it. Preserve existing evidence and fail safely before disconnecting if output allocation is invalid.

### 3. [P2, fixed after follow-up] Monitor-triggered cancellation is reported as normal completion

Runner locations in the 11-test revision: `scripts/eventsub-probe.ts:26`, `:35`, `:57`, `:62`; worker stop handling at `scripts/eventsub-probe-worker.ts:11`–`:12`.

The readiness/auth monitor aborts a private inner controller, but the summary's `aborted` flag reads only the outer controller used for SIGINT/SIGTERM. A logout, changed identity, status failure or readiness failure detected during observation can stop the run while its summary still says `aborted: false`. Worker stop also emits `done/category: duration_complete`, making cancellation harder to distinguish.

Independent fake-API reproduction `/private/tmp/eventsub-probe-review-abort-report.mts` produces `innerAborted: true`, `mainSummaryAborted: false`, `restored: false`. A separate synthetic-worker cancellation in the same script records `done/category: duration_complete`. No real auth or app state was changed.

Required correction: retain the observation cancellation outcome/reason in cleanup state and derive the summary from that state; distinguish stop/abort from the natural duration limit. Test a monitor-triggered cancellation and its final reported outcome, including cancellation between phases.

## Sanitization, lifetime and measurement assessment

The worker uses fixed Twitch destinations and sends the parent only sanitized numeric timing/status fields and allowlisted message/category strings. It never forwards raw payloads, chat, identities, session IDs, credentials, response bodies, URLs or raw close reasons. The parent sanitizes again before persistence. Canary tests pass. Token/client/user data is passed only to the diagnostic worker, which receives an empty environment and no inherited exec arguments; it has no bookmark/store surface. Workers run sequentially for fixed 180 s/120 s phases, with an outer duration-plus-five-second bound and termination in finally. The synthetic worker is selected explicitly and uses no network.

The restoration helper refuses a logged-out/changed broadcaster or an already-connected reader. The initial runner relied only on cached app offline status after disconnect, when unchanged `LiveTwitch.tick()` stops polling. The final runner supplements local auth/status monitoring with a separate read-only Helix stream check, cached for at most five seconds under a normally advancing clock and bounded by a three-second request timeout. This improves live-transition detection but is sampled rather than instantaneous. Local monitor calls do not overlap; late monitor completions are ignored after cleanup begins. The cleanup path uses the raw local API separately, so a failed upstream stream check cannot prevent restoration. No new broadcasts are authorized during the diagnostic window.

`restoreIfUnchanged()` returns true when the connect request returns successfully. It does not itself wait for EventSub welcome/subscription enablement; a fake API returning `connection: connecting` correctly demonstrates this. The final runner accurately names its summary field `restoreRequested`. The historical probe's `restored: true` alone proves a reconnect request, not a verified connected reader. Separate actual post-probe status evidence is needed for the latter claim.

Monotonic receipt spacing, watchdog sample timing, parent dispatch lag and sampled event-loop delay distinguish observed local scheduling symptoms. They cannot establish where a packet was delayed, prove a missing Twitch keepalive, or reconstruct older outages. Server-to-worker wall-time differences include clock skew and scheduling and must not be called measured network latency. The classifier's 200 ms/1 s cutoffs are diagnostic labels, not validated causality thresholds. A worker watchdog can miss a short deadline crossing between one-second samples; zero sampled exceedances does not mean every receipt interval was within its negotiated deadline. Receipt parsing also observes metadata-bearing diagnostic frames rather than proving identical application processing semantics for every malformed frame.

The diagnostic deliberately does **not** close its socket on a shadow watchdog expiry. It can observe a late receipt that the production policy might have disconnected before receiving. This is an observational experiment, not production continuity evidence or an authorized grace-period change. The requested-30-second phase changes only that isolated reader and observes a different recovery tradeoff; it cannot retroactively repair historical gaps or establish the cause of them.

## Actual offline probe evidence

Read `evidence/eventsub-diagnostics-2026-11-01/probe/trace.jsonl` and `summary.json` directly. Independently recomputed **2,719 records**, with no unexpected keys outside the timing/status/classification allowlist. Summary values match the trace:

| Phase | Recorded span | Negotiated timeout | Subscription | Late receipt intervals | Sampled watchdog exceedances |
|---|---:|---:|---:|---:|---:|
| Default | 179.822 s | 10,000 ms | HTTP 202 | 7; maximum 10,067.503 ms | 0 |
| Requested 30 | 119.801 s | 30,000 ms | HTTP 202 | 1 at 30,032.407 ms | 0 |

Maximum recorded parent dispatch lag is **29.135/4.631 ms**, and worker loop delay **83.296/38.928 ms**, respectively. The trace does not show a local stall above the diagnostic classifier's 200 ms threshold in these maxima. This narrows observations for this short offline window; it does not establish root cause or eliminate smaller scheduling/network jitter. The actual normal-path run used the pre-writer-fix runner; failure-path fixes were verified synthetically afterward. No repeat actual probe was required or performed by the reviewer.

The replay test passes the measured **10,067.503 ms** interval through the unchanged production watchdog using a fake clock/socket. A watchdog tick 20 ms after the deadline times out; a tick 100 ms after it receives the keepalive first and does not. This verifies sensitivity to ordering/tick phase under simulated timing. It does not show which phase occurred in any historical production outage or prove an upstream fault.

## Follow-up status

All three findings and the operational/measurement limits were sent promptly to the parent. The final follow-up below records the fixes. Existing production freeze hashes remain unchanged; live/editor acceptance remains open.

## Final independent fix verification

Directly inspected the final runner, helper, worker and tests, then independently ran `node --disable-warning=ExperimentalWarning --test test/eventsub-probe.test.ts`: **14 tests passed, zero failed/skipped**. Strict `npm run typecheck` passed. Independently recomputed the original frozen manifest again: **63 checked, zero mismatches**. No production policy/source change occurred.

- The initial throwing-writer reproduction still rejects safely and runs caller finally. Both worker-message and main-timer sink failures are covered.
- Output allocation now creates a fresh directory exclusively, before reading credentials or disconnecting the app. The default name contains time/PID. An existing target, including its old trace, is rejected without modifying that evidence; the collision regression passes. Finding 2 is resolved.
- Cleanup now retains inner `observationAborted` and an allowlisted `abortCategory`; summary and console use that outcome. Worker stop emits `observation_aborted`, distinct from natural duration completion. An independent corrected reproduction in `/private/tmp/eventsub-probe-review-abort-report-fixed.mts` gives **innerAborted=true, mainSummaryAborted=true, abortCategory=readiness_changed, restored=false**, and its synthetic cancellation records **observation_aborted**. The monitor-cancellation regression passes. Finding 3 is resolved.
- The new read-only stream guard does not change production polling or transport policy. Its failed upstream status cannot block local restoration: separate fake-API regression passes. Restoration remains conditional on current authorization/user/connection state and is recorded as requested, rather than certified connected.

**Findings 1–3 are resolved.** The final diagnostic runner has not been exercised against Twitch by this reviewer; the earlier actual five-minute normal-path trace belongs to the older runner and remains separately scoped. Any subsequent actual run, post-probe connected readback and supplemental diagnostic freeze must be recorded separately. This review supports the diagnostic additions within their measured limits and does not close live positive-chat/editor acceptance, identify the historical timeout root cause, or approve a production timeout/grace change.

## Corroboration of the reviewed runner's actual offline rerun — November 2

Read the new `probe-reviewed/trace.jsonl`, `summary.json`, `timing-analysis.json`, `executed-source-manifest.json` and `post-probe-status.json` directly, plus `evidence/acceptance-plan/diagnostic-freeze-manifest.json`. Independently re-sanitized and reclassified every trace record and recomputed counts/intervals. **All 2,719 rows match the allowlisted sanitizer/classifier output**, and the reported timing values match the trace:

| Phase | Receipt count | Negotiated timeout | Intervals exceeding timeout | Maximum interval | Sampled shadow exceedances |
|---|---:|---:|---:|---:|---:|
| Default | 18: one welcome, 17 keepalives | 10,000 ms | 7 | 10,077.064 ms | 0 |
| Requested 30 | 4: one welcome, three keepalives | 30,000 ms | 0 | Below 30,000 ms | 0 |

Recorded monotonic spans are **179.806 s** and **119.796 s**; both subscriptions returned HTTP 202 and both phases ended with `duration_complete`, with no recorded premature close. Maximum parent dispatch lag is **18.361/3.993 ms** and worker loop delay **59.146/59.539 ms**, respectively. All **52** retained independent stream checks report offline. Summary records no runner failure/cancellation and a restoration request. These are sampled application-callback observations. The no-close shadow policy and one-second sampling can produce late receipt intervals without a sampled exceedance; this is not a production-disconnect result or a clean-continuity acceptance pass.

The **SIMULATED** watchdog phase sweep was independently rerun using the same full observed interval list, including its initial welcome sample. All 40 retained phase results match exactly, with four simulated timeout orderings. This is a controlled ordering demonstration, **not four actual disconnects, an estimated outage probability, or causal proof about historical failures**. Different initialization/phase sampling changes the simulated results; the prior measurement and causal limits remain applicable.

The five executed diagnostic source hashes match the actual reviewed files. The supplemental manifest's **68** file hashes also match, and the original **63** production-freeze hashes independently remain unchanged. The retained full-check output reports **154 tests passed, zero failed/skipped**, alongside passing typecheck/build in the supplemental manifest. That full suite was not rerun by this reviewer under this follow-up's no-new-connections constraint; the reviewer previously independently ran the 14 synthetic diagnostic tests and typecheck.

The retained post-probe status now supplies the separate connected readback missing from a restoration request alone: **connected, authenticated, validation not required, stream offline, six enabled subscriptions, no active session, zero diagnostic write failures and no pending coverage persistence**. It records restored three-chatter defaults and captions off. Its native OBS readback records zero output timers and Start Streaming/Start Recording buttons. Dashboard visual review is explicitly still pending authorization. These are corroborated retained status fields; this reviewer did not reopen the UI or query the running app.

The reviewed diagnostic runner's actual normal path is now supported by separately retained evidence. No new code finding emerged from these artifacts. Production policy remains unchanged, the historical timeout cause remains unproven, and real positive-chat → recorded corner → exported/imported marker acceptance remains open. No network connection, credential read, app control, source edit or UI action was performed during this corroboration.
