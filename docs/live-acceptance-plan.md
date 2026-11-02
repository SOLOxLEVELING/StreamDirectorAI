# One live acceptance attempt — plan for operator review

Status: **one default-settings attempt executed and aborted within the hard deadline.** Three eligible viewer identities were verified. Warm-and-armed readiness was saved at84.011s; a subsequent EventSub timeout invalidated it. Both outputs stopped within120.857s. No chat bookmark/corner/native marker passed. See [actual evidence](../evidence/acceptance-defaults-2026-11-01/README.md). No second attempt is scheduled automatically; the recurrent timeout issue remains a separate investigation. The runbook below preserves the agreed procedure.

## Profiles

| Profile | Participants | Settings | Permitted success claim |
|---|---|---|---|
| Agreed | Three distinct non-broadcaster, non-bot viewers | All defaults, including minimumChatters3 and minimumRate1/s | Actual workflow at defaults, limited to this attempt |
| Actual attempt | Three distinct eligible identities verified | Defaults unchanged | Aborted on later timeout; no positive-chain acceptance |

Do not change the rate floor, multiplier, sustain, activity, lateness, cooldown or warm-up to manufacture a pass. Do not remove channel moderation or use the broadcaster as a viewer. AI is disabled. No reduced-chatter fallback is scheduled.

## Preconditions while both outputs are stopped

1. Agree the profile, exact participating account count, operator and start cue. Operator remains present throughout; no unattended broadcast. Confirm native stop controls and have an independent150-second timer ready before either output starts. If the agent stalls, operator stops both outputs at the deadline.
2. Confirm Twitch grant validated, chat subscription enabled and channel offline. Save the full numeric defaults for the post-test comparison. Check no pending coverage-persistence failure. Scope/frozen-source manifest must match.
3. Verify OBS selected scene `StreamDirector Verification`, the clock slate under the live overlay,1920×1080/30fps, and local recording destination/free space. Record actual bitrate, audio mute state and initial drop/skip/reconnect counters. Keep the live overlay URL; no simulated replay during the attempt. Do not start outputs for troubleshooting.
4. Verify eligible viewers can use chat without an active timeout/slow-mode restriction; use short varied lowercase text. Confirm account identities against broadcaster/exclusion settings without retaining credentials or message bodies. Participation means they are ready together, not merely signed in.
5. Prepare a read-only bucket/state evidence capture and sanitized connection/coverage recorder before outputs start. Capture source IDs/timestamps, receipts, completed source seconds, eligible per-user counts, distinct count, rolling rate, baseline, frozen threshold and settings revision. Keep source timestamps intact; no chat text or tokens in the capture. Confirm the capture works against offline state before launch.
6. Resolve21.1.1.10 and the isolated verification project must be available, with an operator able to use Timeline Markers from EDL after the broadcast. Existing manual/fixture imports do not satisfy this new chat-marker test.
7. Dashboard visual recheck remains pending explicit browser authorization. Do not attempt alternate browser surfaces or treat ambient localhost visibility as consent. Read-only backend/SQLite readiness evidence is a separate operation, not a substitute visual pass.

If any prerequisite is missing, report it and leave both outputs stopped. A readiness observation while offline is not a warm/live pass.

## Strict live timebox

The live attempt has a **150-second hard maximum from the first OBS output starting**. Offline verification is a separate maximum10-minute step. No second burst, settings change, forced disconnect, backend restart or timeout experiment during this attempt.

| Elapsed ceiling | Action or gate |
|---|---|
| T0 | User starts local recording, then streaming; start the independent hard-stop timer at the first output. Capture both actual start times. |
| T+15s | Both OBS timers must run; otherwise stop whichever output started and abort. |
| By T+110s | Obtain warm-and-armed readiness after the latest gap. If unavailable, stop both; report prerequisite unmet. |
| Immediately after readiness | Cue all participants together: each sends one short distinct lowercase message per second for8 seconds, then stops. Treat these as intended inputs only. |
| By T+130s | Verify the actual received/counted profile and exactly one new persisted chat bookmark. If none or inconclusive, stop without another burst. |
| After corner finishes, by T+150s | Stop streaming and recording; verify zero timers/Start buttons and log stop timestamps. Restore exact saved defaults and confirm AI remains off. |

The budget is fixed. A gap restarts the readiness check, not the stopwatch. If the latest gap leaves insufficient time for a full warm-up plus the burst/confirmation/corner before the gates, abort promptly and stop both. Do not keep broadcasting while diagnosing input controls or waiting for help.

## Warm AND armed readiness

The public detector status exposes `warm` but not an `armed` field. Do not equate warm with armed and do not add a feature for this test. Inspect the current persisted detector state read-only, matched to the same live session/settings revision:

- Auth validated; chat subscription enabled; EventSub connected; real active broadcast identity and Twitch stream origin established; no pending durable-coverage write.
- `status.warm=true`; `warmFromMs` reflects at least the end of the latest coverage gap; evaluations are advancing. Account for the2-second lateness allowance, completed-bucket boundaries and the engine's full60-second gate.
- `latched=null` and `candidate=null`, with quiet completed buckets. A latch means cooldown/rearm is still active even if warm is true. Observe two quiet completed buckets before the cue.
- Compute current threshold from actual status/settings. With no candidate/latch, it must match max(minimumRate, multiplier×baseline). A participating viewer contributes at most1 count per second. If eligible participant capacity cannot meet the current threshold or distinct requirement, do not cue; wait only within the existing readiness budget, then abort.
- No nearby platform bookmark that would absorb the chat evidence into a banner. If an actual platform event arrives and correlation changes the expected tier, preserve it and report the chat-corner criterion inconclusive; do not alter/delete it.

If EventSub times out, any new gap appears, authorization suspends, settings change or session identity changes, discard the prior readiness observation. Silence chat, preserve gaps and restart this entire readiness check against the new warm-up origin, within the same hard deadline.

## Received profile and success evidence

Sent-message totals are never acceptance evidence. In the engine's completed, non-overlapping one-second source buckets, confirm all of:

- At least3 consecutive completed qualifying buckets each meet the candidate's frozen threshold.
- At confirmation, five-second counted rolling rate meets that threshold and eligible distinct-chatters count meets the default three-chatter requirement.
- Candidate validation remains within max(activitySeconds,sustainSeconds), five seconds by default; actual baseline/threshold and onset belong to the accepted sequence.
- Messages arrived before their source buckets finalized, and broadcaster/bot/per-user caps are reflected. Record rejected/late coverage honestly.

Success requires **one persisted bookmark whose signal is chat and tier is corner**, with its durable ID, source time, onset, receipt and confirmation times, rate/threshold/distinct metrics and settings revision. Preserve bucket/source evidence, raw bookmark JSON/CSV and every coverage record. A manual bookmark, simulated event, platform banner or chat evidence merely attached to a platform event is not this success.

Success also requires the actual local recording to show that bookmark's live corner reaction. Inspect decoded recording frames around confirmation; a transient preview screenshot alone is insufficient. Preserve the file path, SHA256, fps, recording clock anchors, visible label and first/last positive frames. Compare the displayed UTC clock and onset/confirmation without claiming gameplay/action accuracy.

## Offline native-marker verification, after both outputs stop

1. Restore and verify exact pre-test numeric defaults, AI off, and stopped OBS outputs. Preserve the session's historical test configuration/revisions.
2. Derive this recording's own stream-to-media alignment from multiple post-startup clock anchors. Do not reuse the old+139.5335s alignment. Keep editorial lead-in separate; export this selected chat marker with explicit export-only lead-in0 for the onset comparison. Saved original offsets/settings must remain unchanged.
3. Export JSON/CSV and actual Resolve EDL for the selected bookmark ID,30fps NDF and01:00:00:00 timeline start. Keep full generated files and expected frame/name/note/Blue color/duration1. Expected relative frame is round(30×mapped editor offset).
4. Use a new isolated footage-backed timeline named with this stream ID. Import the actual EDL via Media Pool timeline → Timelines → Import → Timeline Markers from EDL. Do not use ordinary timeline import or create markers through scripting.
5. Read Resolve's actual marker dictionary/settings/footage path through its internal console. Require exactly one expected marker, matching metadata and frame within one frame of the mapped expectation. Preserve actual readback and native evidence. Missing or inaccessible import is partial/unverified, not a pass.

Report persisted chat, recorded corner and native marker as three separate outcomes. All three are necessary for this attempt's success. Editorial usefulness, paid events, real AI and sustained continuity must retain their actual verification scope even after a successful default-profile attempt.

Report actual duration, OBS network drops separately from recording encoding skips, EventSub outages/recovery, received bucket math, default restoration and anything missing. Recurrent timeout diagnosis runs separately, after outputs stop.
