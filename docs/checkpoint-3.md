# Checkpoint 3 — independent code review completed; live acceptance open

November 1, 2026, Asia/Kolkata. Checkpoints 1 and 2 passed user review. The user passed review of the checkpoint 3 code fixes and authorized the fresh-context GPT-6.1 Sol high independent review. That review directly inspected and exercised actual code, tests, exports, recordings, browser routing and native Resolve marker data. Its four reproduced material findings are fixed and independently verified. **End-to-end acceptance remains open** at the live scope below. No publication or submission was performed.

## Changes

- React dashboard: Twitch/stream/permission state, warm-up, counted rate/baseline/threshold and sixty recent samples, bookmark explanations/selection, gaps, manual marking, settings revisions, CSV/JSON/Resolve exports and explicit LIVE/SIMULATED sessions. Six numeric controls cover sensitivity, distinct chatters, warm-up, lead-in and alignment; other settings use the existing backend configuration contract.
- SSE and a separate read-only overlay origin. Dashboard controls require protected controller credentials, expected Origin and a control header. The overlay has no credentials, write routes or dashboard assets. It serves transparent reactions and an optional verification-clock slate.
- Corner reactions for chat and full banners for platform/manual bookmarks. A six-item queue prioritizes banners and suppresses duplicates/stale alerts; reconnect/reload starts fresh. Twelve SSE clients maximum, with slow-client disconnection. Store observers run after commit; presentation failures and suppressed animations cannot undo persistence. Caption updates never replay reactions.
- Optional captions: finalized immutable evidence, one durable job per new live bookmark, one active request, a maximum fifty-request session budget, eight-second timeout, bounded input/response and eighty-code-point plain-text output. No tools. Only caption text/status can change; failures retain deterministic labels. Restart does not retry interrupted running jobs. Simulation never calls the provider. Raw chat context is separately opt-in and bounded. **AI is off locally**, with no configured key/model/opt-in and no real provider requests.
- Explicit EDL-only alignment/lead-in mapping for existing bookmarks preserves saved evidence, settings and JSON/CSV. Controlled eight-second EventSub interruption supports recovery checks during an active stream.

Main source: `src/ui/`, `src/presentation.ts`, `src/overlay-queue.ts`, `src/captions.ts`, `src/server.ts`, `src/store.ts`, `src/simulation.ts` and `src/twitch/`. The detector remains independent of UI and AI. See [setup and exact bounds](checkpoint-3-setup.md).

## Independent review fixes and current live verification

The fresh-context GPT-6.1 Sol high reviewer reproduced and verified fixes for four material defects: persistence exceptions escaping reconnect handling; obsolete subscription responses replacing current health; captions finalizing before bounded correlated chat confirmation; and an awaited stream lookup discarding a gap created during its request. Nine additional regressions bring the suite from 131 to 140. See the [independent report](independent-review.md) for direct inspection, reproductions, independent test runs and limitations.

Connection retirement/retry setup now precedes protected observers. Failed coverage persistence stays pending and blocks ingestion until durable; an old recorder cannot be discarded by either offline or new-broadcast responses before its gap is saved. Subscription results use connection and request ownership fences. Caption finalization includes correlation, the maximum activity/sustain window, lateness and bucket boundary allowances; its default is nineteen seconds, and only bounded numeric correlated evidence joins the input. AI remains disabled throughout actual live checks.

Integration diagnostics retain fixed operation/category/optional HTTP-status fields and recovery times. They omit arbitrary errors, stacks, causes, request paths/URLs, upstream bodies, credentials and chat text. Diagnostic write failures are counted and isolated. Fake storage/network/provider failures exercise these paths. New diagnostics cannot reconstruct the cause of the historical generic integration error.

The new actual live attempt and any retry are retained under [independent-review/live-rerun](../evidence/independent-review/live-rerun/). The first attempt produced no chat bookmark: only the first two uppercase verification messages were confirmed published before the channel bot timed out the viewer for caps. Defaults were restored and OBS stopped. Its planned short run extended to 41m19s while native input controls were resolved. OBS showed zero network drops; one EventSub keepalive timeout recovered, so this is not a clean overall integration-stability pass. The second attempt also failed the received profile: fourteen manual viewer messages spanned35 source seconds, peaking at0.8/s versus1/s, and produced zero bookmarks. Its9m13.767s OBS run recorded16/16598 network drops(0.1%), local-recording encoding skips21/16828(0.1%), and one recovered12.638s EventSub outage. Both outputs are stopped, exact defaults restored, and AI off. No new chat EDL/import existed. The final dashboard screenshot was unverified because localhost browser permission was declined. See the separate actual evidence for exact metadata and the distinction between network drops and encoding skips. Successful live chat-trigger and clean integration-stability acceptance remain open.

## Automated results

Current full run: **140 tests passed, zero failures/skips**. Strict TypeScript checking and production build passed, all exit code 0; the independent reviewer separately confirmed all three checks. Current [test output](../evidence/independent-review/test-results.txt), [type-check output](../evidence/independent-review/typecheck-results.txt) and [build output](../evidence/independent-review/build-results.txt) are retained. Earlier 131-test checkpoint evidence remains historical.

The initial eighteen new tests cover committed persistence despite observers/slow clients, SSE cursors/mode separation/limits, queue priority/expiry/reload and renderer suspension; caption finalization, budgets across restart, duplicate jobs, bounded/malformed/oversized responses, timeout/late-result fences, disabled/simulated operation and deterministic-field preservation; controlled interruption and settings-history recovery. HTTP coverage additionally exercises controller-cookie/Origin protection, read-only overlay routes, snapshots and non-mutating export mapping. All accepted detector and checkpoint 2 auth/configuration regressions still pass. Caption-provider/event/race tests use controlled fakes and are not live deliveries.

## Review fixes and controlled regressions

Both checkpoint 3 findings are addressed. `src/ui/snapshot-requests.ts` owns session-selection generations and request ordering. A newer selection invalidates pending results immediately; only the latest request can commit. Aborting is an optimization, not the correctness mechanism. Exports require the exact accepted snapshot for the current selection and remain disabled while that selection loads. Older initial/body reads, A→B→A races, same-session refreshes, wrong-session replies, stale errors and closed requests are covered by five controlled deferred-response tests. Dashboard-driven actions also respect intervening user selection. Mapping/status initialization runs only for accepted snapshots. Actual browser verification selected the original session, downloaded JSON containing its exact ID and three bookmarks, then switched back to the new rerun with zero bookmarks and disabled exports. The download and check metadata are retained separately from the controlled-response tests.

Caption context expires at the exact forty-five-second cutoff. All session buffers are pruned on idle and busy ticks and again immediately before request assembly; admission rejects expired/future samples. Four fake-provider regressions cover silent exact-boundary expiry, a delayed job without intervening input, cleanup while another provider is busy, and expired admission with a positive fresh-context control. No real provider calls were made. These nine additional regressions bring the suite to **131**. Type-checking and production build pass.

The actual rerun is complete; [its evidence](../evidence/checkpoint-3/rerun/README.md) is separate from the original manual-bookmark broadcast below. Stream `316495473645` started **2026-11-01T10:15:13Z / 15:45:13 Asia/Kolkata**. Only `minimumChatters` temporarily changed from 3 to 1. All other detector settings stayed unchanged, including three elevated completed buckets and a 1/s rolling threshold. AI was forced off. Exact pre-test defaults, including three chatters, were restored and verified; historical test settings remain in the revision history.

**No chat bookmark was confirmed.** Thirty actual normalized chat notifications arrived during the OBS broadcast. Counting all notification seconds as eligible still yields at most two consecutive occupied buckets; the one-viewer capped five-second rate upper bound is 0.8/s. Both attempts therefore failed to supply the unchanged qualifying traffic. This verifies actual receipt and honest rejection, while successful chat-trigger/overlay/native-marker confirmation remains **unverified**, including the default three-viewer case. No simulated event was substituted.

OBS streamed **15:45:12.118–15:56:33.667 local**, approximately eleven minutes twenty-two seconds; coordination extended the planned short run. Its log reports **15,419 output / 20,436 attempted frames, 5,017 network drops (24.5%)**. One initial EventSub keepalive timeout recovered with six subscriptions. A later generic integration error was retained; its cause was not isolated and its warning remains visible. The two overlapping initial timeout/reconnect records represent one outage; restoration adds a separate configuration-change coverage record. A continuous 177-sample, 179.521-second observation window remained connected with no additional gaps, but the overall run **does not establish a clean stability pass**.

The actual local recording is **1920×1080, 30 fps, 682.733 seconds**, 47,125,363 bytes, SHA-256 `42c2483dfde33df54638c0db81d3ac340c79eee98c650eddb7faa925b5dbd4dd`. Both streaming and recording were stopped by the user. Settings restoration and final offline/AI-off state are retained. No new chat bookmark existed to export/import; the original verified manual-bookmark Resolve import remains the native evidence. Network reliability and successful real chat-trigger validation are still open external checks.

## Original actual Twitch and OBS broadcast

Broadcaster `soloxleveling` (`238520082`), stream `316456451563`, session `twitch:238520082:316456451563`. Twitch's stream origin was **2026-10-31T21:00:14Z**. The app joined **21:00:28.225Z**, 14.225 seconds later; offsets remain relative to the actual Twitch origin.

OBS **33.0.1** used the isolated **StreamDirector Verification** scene, with a 1920×1080 clock-slate Browser Source underneath the transparent live overlay. The user started/stopped broadcasting and recording and assisted with source URLs. Automatic approval review rejected automated Start Streaming because the “Untitled” collection title did not establish the selected scene; it was not bypassed.

Three actual manual-fallback bookmarks persisted while the broadcast and local recording ran:

| Suffix | Source/onset UTC | Stream offset | Situation |
|---|---|---:|---|
| `:1` | 21:01:23.552 | 69.552 s | During the app's initial sixty-second warm-up |
| `:2` | 21:03:36.044 | 202.044 s | After controlled EventSub reconnection |
| `:3` | 21:07:01.906 | 407.906 s | After backend restart |

Real viewer chat was received. Counted traffic had one viewer and excluded broadcaster messages; no chat bookmark was created. Only one non-broadcaster account was available. Pre-broadcast setup briefly used two chatters; the actual live session's sole saved settings revision already uses the default **three distinct chatters**, which remains configured. The earlier setup response is retained, without a live chat-trigger claim. Actual chat-triggered detection remains **unverified**.

Controlled interruption held retries for eight seconds. Twitch reconnected and accepted six subscriptions; incomplete coverage was recorded and warm-up restarted. The conservative gap starts at the last known WebSocket message and includes the handshake, so it is not an exact eight-second coverage interval. A backend restart preserved stream origin, original app-join timestamp, settings/history, earlier bookmarks, durable deduplication and sequence. The next bookmark used `:3`; reconnecting overlays did not replay earlier alerts.

Two additional keepalive/welcome timeouts were recorded around **21:08:16–21:08:47Z** while verification continued. Their causes were not isolated. Recovery completed; the final snapshot shows a connected EventSub client and all six subscriptions enabled. The session has **seven gap records**, including overlapping timeout/action and reconnect intervals, rather than seven independent outages. All are retained in `live/final-snapshot.json` and visible in the dashboard.

Actual native screenshots and recording frames show manual full banners after recovery/restart. An initial screenshot taken before the first popup painted is retained as a failed capture; later recorded frames establish visibility. Two actual backend RSS observations were **73,957,376** and **72,515,584 bytes**, with zero observer failures. This short quiet run establishes neither a memory ceiling nor sustained-load behavior.

## Recording and exact-frame comparison

Original recording: `/Users/adnan/Movies/2026-11-01 02-27-54.mov`. Ignored copy: `output/checkpoint-3/actual-obs-recording.mov`, **52,237,143 bytes**, **1920×1080**, **30 fps**, **761.3 seconds**. SHA-256: `1586016c4b7e28b16459a656cde0a9db22b3188a119db509c3f525791d0381de`.

Six post-startup OCR anchors gave a median recording origin of **1793480274466.5 ms**, with a **27 ms** range. A stale startup clock frame was excluded from calibration and retained as evidence. Stream-to-recording alignment is **+139.5335 seconds**. Native comparison explicitly exported **zero lead-in**; original records retain the fifteen-second editorial lead-in and settings.

| Exported/decoded relative frame, 30 fps | Visible clock minus onset |
|---:|---:|
| 6273 | −3 ms |
| 10247 | −32 ms |
| 16423 | −41 ms |

Decoded frame indices are asserted to match all exported indices. The helper initially sought the third sample one frame early due to floating-point CMTime truncation; exact rational rounding fixed the inspection. Earlier output is retained in `recorded-moments-before-seek-fix`; the final comparison supersedes it. These are manual timestamps compared with a rendered UTC slate, including calibration/display jitter. They do not establish gameplay/action timing accuracy.

OBS's actual log reports **2,372 dropped streaming frames out of 18,664 attempted (12.7%)** from network/connection stalls. Timing comparison uses the local recording; no zero-drop streaming claim is made.

## Actual Resolve import

**Resolve 21.1.1.10**, isolated project **StreamDirector Checkpoint 2 Markers**, clean timeline **SD Actual Broadcast Final 30 NDF**, actual recorded footage, **30 fps NDF**, start **01:00:00:00**. The user imported exact `actual-broadcast-30-one-hour.edl` through **Media Pool → right-click timeline → Timelines → Import → Timeline Markers from EDL**. The assistant then directly ran the read-only verification in Resolve's Lua console:

```lua
sd_action='verify'; dofile([[/Users/adnan/Developer/Hack/Projects/StreamDirectorAI /scripts/resolve-live-import-check.lua]])
```

Actual `GetMarkers()` returned **exactly three markers at 6273/10247/16423**. Every name (`Streamer marked this moment`), note with its matching live bookmark ID, Green color and one-frame duration passed, along with actual footage path, frame rate and timeline start. The script never calls `AddMarker`. See [actual readback](../evidence/checkpoint-3/resolve/actual-import-results.txt), [manifest](../evidence/checkpoint-3/resolve/expected-live-imports.json) and screenshot.

The first attempt imported the older four-marker fixture by mistake; its failed timeline/output is retained. The clean final timeline imported the correct file and passed. Checkpoint 2's separate four known-footage cases remain the evidence for 60 fps and zero-start compatibility. This actual broadcast import is specifically 30 fps with a one-hour start.

## Simulated presentation and corner fix

Browser exercise observed simulated chat-corner and raid-banner reactions through actual local SSE. The first simulated corner in the main OBS recording expired during a rendering pause, with a frozen slate in those frames. The player now advances lifetime on animation frames, caps elapsed steps and expires alerts after fifteen seconds of wall age. The renderer-suspension regression passes.

A **second local-only recording**, with streaming stopped and overlay explicitly `?mode=simulated`, verified the final build. Session `simulated:d737b655-5438-4605-ba97-ac268efb6a3c` saved exactly one corner bookmark and zero gaps. Actual recorded frames **65.8, 66.3 and 67.0 seconds** visibly show **SIMULATED · CHAT MOMENT** and its deterministic label; it clears by 68 seconds. The first positive sample's clock is 297 ms after confirmation and was visually inspected. Hash/path/OCR are retained under `simulated/`. This is actual OBS rendering of simulated input. The user stopped recording and restored the live URL afterward.

## Remaining limitations and handoff

- Actual chat-triggered bookmarking needs three non-broadcaster participants at default settings. Ordinary one-viewer chat/filtering was observed; real surge precision/recall and editorial usefulness were not measured.
- Real incoming raids, subscriptions/gifts/resubscriptions, qualifying cheers and reward redemptions were not delivered. Normalization/rules have automated or simulated evidence. Channel Points permission/reward remain unconfigured; tool access does not prove event delivery.
- AI remains disabled. Real provider/model access, output quality and behavior are unverified; bounds, failures and write isolation use fakes.
- Long-run/high-load memory and sustained network resilience remain unverified. Actual controlled interruption and backend restart passed; actual streaming also had the reported drops.
- Native import and timing scope is explicit above. Clock-slate calibration does not establish frame-accurate gameplay detection. Source URLs and import menus needed the stated user assistance.
- The [independent review](independent-review.md) is complete for code and retained evidence; public repository/demo video and submission remain pending. Live chat-trigger and streaming-stability acceptance remain explicitly open until the new live checks are assessed.

[Reproducible setup](checkpoint-3-setup.md) · [Evidence index](../evidence/checkpoint-3/README.md) · [Gate instructions](checkpoints.md).

## Later default-settings timeboxed attempt

Three real viewer identities were verified and a new attempt used all defaults with AI off. Warm-and-armed readiness passed at84.011s with no then-known gaps. A later EventSub timeout invalidated it; its conservative recovered coverage interval spans12.657s. A fresh60-second warm-up could not fit, so the agent aborted and verified both OBS outputs stopped. Streaming lasted115.505s and recording wall output120.857s, below the150-second maximum. No chat bookmark was persisted; later human chat receipts were after streaming stopped and are not live success. No recorded corner or matching new native marker was manufactured. Defaults remained unchanged; all63 frozen files match. [Actual source, bucket, coverage, clock and output evidence](../evidence/acceptance-defaults-2026-11-01/README.md) is separate from every prior attempt. Dashboard visual recheck remains pending browser authorization.


## Submission-delivery visual follow-up — November2

The user authorized local dashboard access/capture. The saved origin permission still rejected direct browser automation, and native access to the Codex app was also blocked by computer-use policy. No alternate browser or indirect live capture was used to bypass either block. The operator instead supplied two local screen recordings for the walkthrough. Their frames show the offline workspace, default detection settings, AI off, a populated visibly SIMULATED session, its bookmark and export controls, and the actual Codex build chat/edit summary. These captured states were visually inspected; they are not a new automated interaction pass or successful real-chat acceptance. Final source hashes, crops and viewing evidence are in the submission-delivery report.
