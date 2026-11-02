# Separate investigation: recurrent EventSub timeouts

Status: root cause unresolved; two actual offline diagnostic probes completed. Feature scope stays frozen. Production timeout, transport, detector and OBS settings remain unchanged. The isolated probe's requested-30-second phase is a separate diagnostic experiment, not the production configuration.

## Facts retained

| Actual run | Conservative recovered EventSub gap | OBS network drops |
|---|---|---|
|316496783341|12.432s, two overlapping records describing one outage|0% reported|
|316460892267|12.638s, two overlapping records describing one outage|16/16598 attempted frames,0.1%|

Each reconnect accepted six subscriptions. The latter recording separately skipped21/16828 frames from encoding lag,0.1%. No new generic integration_error appeared in these two runs. The older24.5% network-drop run and its generic error remain historical failures; new categories cannot retroactively reconstruct its cause. Source: independent-review/live-rerun evidence and independent read-only corroboration in `docs/independent-review.md`.

The initial timeout records occur roughly10 seconds after the last known message. This is consistent with a10-second negotiated timeout, but the retained actual welcome payload/negotiated value is absent, so that value is an inference. The full conservative gaps also include reconnect/handshake time; they are not exact intervals of proved event loss. Low OBS RTMP drops do not prove a healthy separate EventSub transport.

## Current primary documentation

Verified November1,2026: [Twitch WebSocket handling](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/) describes a welcome-supplied timeout, reset by notification/keepalive messages; exceeding it requires reconnect/resubscribe, and missed events are not replayed. WebSocket Ping/Pong is independent. Twitch permits an optional initial keepalive-timeout query parameter,10–600 seconds. These facts do not establish the cause of our observed gaps.

The inspected client uses the actual welcome timeout and a one-second watchdog. Node's event-loop scheduling, machine sleep, transport delays or a missing server message could each contribute. Existing artifacts do not distinguish them. Do not add a grace interval, request a longer timeout or send application keepalives during the acceptance run to hide the symptom.

## Additional passive evidence after outputs stopped

Read-only analysis retained in [timeout-analysis.json](../evidence/acceptance-plan/timeout-analysis.json) examined the existing app connection, without creating another one. Between17:03:46.068Z and17:53:44.945Z on November1, three more timeout status records occurred; no generic integration_error was recorded. The latest actual OBS log transitions still show the prior outputs stopped. This makes an explanation solely dependent on active OBS streaming insufficient, but does not isolate a transport, host or server cause.

Eighty retained engine samples around the latter live timeout show1.480–2.586s between capture wall time and the next evaluation boundary. This includes normal completed-bucket/lateness delay and is not a measurement of network latency or event-loop lag. It cannot establish whether a heartbeat was delayed, absent or processed near the deadline. Initial observed timeout intervals were10.003s and10.152s; final recovered coverage spans were longer.

No runtime or timeout setting was changed. These observations are diagnosis, not a clean continuity pass.

## Isolated diagnostic sequence, later

1. Use a separate diagnostic window with OBS streaming/recording stopped. Keep one outgoing EventSub connection; do not create a second production reader or alter the accepted app during the acceptance attempt.
2. Specify minimal sanitized instrumentation as a separate proposed defect/diagnostic change: negotiated timeout; fixed control-message type; receipt wall/monotonic timestamps; watchdog elapsed time/overshoot; event-loop lag; allowlisted socket close code/error category; opaque local connection generation. No message text, credentials, URLs, response bodies or raw close reasons.
3. First exercise delayed watchdog/server messages and process suspension with an isolated fake server. Compare wall and monotonic clocks; confirm detection gaps/rearm behavior. These results are simulated.
4. Then observe actual idle Twitch delivery without OBS. Compare message intervals, timeout deadlines and host timing. Only after a reproducible cause, propose a focused fix and relevant regressions; repeat full checks if runtime code changes.
5. Keep the original gaps and failures. Separately label any later transport experiment. A longer negotiated timeout, if explicitly tested later, changes detection/recovery latency and cannot retroactively turn old gaps into uninterrupted coverage.

No root cause or remediation success is claimed. New instrumentation/fix work is not part of the frozen feature scope or the planned acceptance broadcast.

## Further default-settings attempt

The later default-settings test recorded another actual keepalive timeout after warm-and-armed readiness. Initial timeout interval10.422s; conservative recovery coverage12.657s. The attempt correctly restarted readiness and aborted rather than exceeding its fixed output budget. Human burst receipts were after OBS streaming stopped, so no live positive chain was supplied. Full retained timestamps and separate output windows: [actual evidence](../evidence/acceptance-defaults-2026-11-01/README.md). No transport/timeout setting or runtime code changed. The root cause remains unresolved.


## Completed diagnostic work — November 2

Diagnostic additions are standalone scripts and tests. The accepted production files are unchanged. The worker temporarily replaces the production EventSub reader with one isolated read-only subscription, retains no chat text and cannot write bookmarks. Its shadow watchdog deliberately does not close on deadline exceedance, allowing observation of late receipts. A requested-30-second phase applies only to that worker. Both phases ran with OBS outputs stopped; no broadcast was scheduled.

The runner records negotiated timeout, wall/monotonic receipt timestamps, watchdog elapsed/overshoot, worker and parent event-loop samples, and worker-to-parent dispatch delay. Fixed allowlists exclude credentials, raw errors, identities, URLs, payloads and chat content from timing traces. The separately saved post-run app settings include the already-public broadcaster ID, but no credentials or chat. Independent review found and fixed evidence-writer teardown, reused-output mixing and unreported cancellation defects. See [direct review](eventsub-diagnostics-review.md). Restoration is fenced against logout and changed identity; upstream-check failure cannot block the separate local restoration path.

| Actual offline run/phase | Negotiated | Receipts | Intervals beyond deadline | Maximum interval | Maximum parent dispatch / worker loop |
|---|---:|---:|---:|---:|---:|
|Initial normal-path / default|10s|18|7|10,067.503ms|29.135 / 83.296ms|
|Initial normal-path / requested30|30s|4|1|30,032.407ms|4.631 / 38.928ms|
|Reviewed runner / default|10s|18|7|10,077.064ms|18.361 / 59.146ms|
|Reviewed runner / requested30|30s|4|0|all observed intervals within30s|3.993 / 59.539ms|

The reviewed-run default late receipts were dispatched to the parent in0.085–0.325ms. Adjacent worker loop maxima were11.960–53.051ms. These observations distinguish extended worker inter-receipt spacing from a large delay *after* worker receipt in this diagnostic process. They do not measure packet arrival or the old production process, eliminate smaller local scheduling effects, or locate delay among Twitch, network and lower runtime layers. Wall-time server ages also include clock skew. **Transport silence versus delayed lower-level/local callback processing is not fully resolved.**

No sampled shadow watchdog expiry occurred in either run: a one-second sample can miss a short crossing. **SIMULATED** replay of actual default intervals through the unchanged production watchdog timed out at3/40 tick phases for the initial trace and4/40 for the reviewed trace. That demonstrates a plausible deadline/arrival ordering mechanism, not actual observed disconnects in these probes or proof of every historical outage. Increasing the negotiated timeout alone is not a demonstrated fix; the initial30-second experiment also received one late interval. No production grace period or timeout change is proposed as a verified remedy.

The reviewed runner completed without failure/abort, independently checked offline status52 times, requested restoration, and the separate post-probe readback confirmed **connected**, offline, validated auth and all six subscriptions enabled. Both native OBS timers were00:00:00 with Start Streaming/Start Recording controls. Defaults remain minimumChatters3, minimumRate1/s, warm-up60s; AI is disabled. The probe is not a streaming stability pass.

Actual evidence: `evidence/eventsub-diagnostics-2026-11-01/probe-reviewed/{trace.jsonl,summary.json,timing-analysis.json,executed-source-manifest.json,post-probe-status.json}`. Earlier trace and its original executed-source manifest remain separate. Automated checks: **154 passed,0 failed/skipped**, strict typecheck and production build passed; independent follow-up ran14 targeted tests and typecheck. Original63 frozen hashes match; the supplemental diagnostic freeze adds five files without feature changes.

## Remaining diagnosis and acceptance limits

A future separate reliability investigation would need contemporaneous production-process timing and, if justified, a lower-level receipt boundary to separate local callback delay from upstream silence. It must retain compliant reconnect/gap/rearm behavior and receive its own review; these measurements do not justify hiding coverage gaps. No such runtime change is included here.

The older24.5% OBS network-drop run and unexplained generic integration error remain failures. Current sanitized operation/error categories help future diagnosis but cannot reconstruct that historical cause. Successful real chat → persisted bookmark → recorded corner → matching native Resolve marker remains unverified. The public offline abort rehearsal failed; the subsequent no-post STOPPED acknowledgment does not replace it. See [coordination protocol](participant-coordination.md). Dashboard visual recheck remains pending explicit browser authorization. No further broadcast is scheduled.


## Submission delivery freeze

On November2 the user stopped open-ended timeout investigation and switched to submission delivery. The observations and causal limits above are retained; no further probe, broadcast or production reliability change is scheduled. Any future investigation requires separate scope.
