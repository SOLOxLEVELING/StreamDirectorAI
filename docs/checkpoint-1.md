# Checkpoint 1 — detection engine and tests

Status: detector revised for both the bucket-sequence and stalled-candidate checkpoint reviews; **paused again for user review**. Checkpoints 2 and 3 have not started. The requested independent review must run after the final checkpoint review, not at this gate. The later bucket-sequence and bounded-validation instructions supersede the original overlapping-evaluation rule; see `docs/checkpoints.md`.

## What changed

- Created a TypeScript/Node 24 project with pinned development tools, lockfile and no runtime dependencies.
- Implemented an isolated deterministic detector with an injectable clock, zero-inclusive one-second buckets, excluded activity window baseline, warmup, capped chatter contributions, configurable thresholds, candidate freeze, distinct chatter requirement, cooldown and rearming. The corrected sustain rule requires three consecutive completed, non-overlapping one-second buckets each meeting the frozen threshold; confirmation also requires the rolling-rate and distinct-chatter safeguards.
- Candidate threshold/baseline freeze at the first elevated bucket **only for a bounded validation window of `max(activitySeconds, sustainSeconds)` completed buckets (five by default)**. This allows the activity window to fill and the sustain run to complete. The first bucket counts as attempt 1; the last bucket may still confirm. If any safeguard remains unsatisfied at that final attempt, discard the candidate immediately; the next completed bucket must use the current baseline and a new onset. Failed validation does not start cooldown. The lateness allowance delays evaluation without extending the number of attempts. Old snapshots retaining an already-expired candidate are also rejected before evaluation.
- Empty or below-threshold buckets reset the sequence sooner. Onset is the earliest counted message in the sequence's first bucket, excluding preceding ordinary traffic from the rolling window. Lead-in is separate. Saved evidence now includes validation-window length, qualifying bucket count and minimum bucket rate.
- Added normalized rules for raids, non-gift subscriptions, gift batches, resubscriptions, qualifying cheer aggregates, configured reward redemptions and manual marks. These bypass chat warmup/cooldown, remain independent, and carry banner tiers. Chat evidence attaches according to the explicit correlation policy in README.
- Added transport/source deduplication, malformed input validation, anonymous-chat exclusion, nullable source timestamps, bounded chat history/recent dedup, late/out-of-order handling, coverage gaps and warmup resets.
- Added transactional SQLite persistence with immediate fallback captions, durable deduplication, saved settings, state rollback after failed commit, restart recovery, and correct separation of evidence times, stream-relative offsets, lead-in and editor alignment.
- Added replay CLI, fourteen committed JSON fixtures with explicit expected outputs, CSV/JSON reference writers, formula-safe CSV cells and documented replay provenance. Updated the former positive impulse fixture to expect no bookmarks, added five-message and baseline regressions, and adjusted sustained-burst confirmation and partial-gap inputs. The two newest fixtures reject a stalled candidate after two minutes of regular two-chatter traffic and confirm a later genuine surge at its new onset. EDL serialization remains explicitly unavailable pending real format/import verification at gate 2.
- Added reproducible scripts to run the actual CLI for every fixture, retain its exports/logs, and inspect those files using Python's separate CSV/JSON parsers.
- Preserved the accepted plan and main build session ID. Added launch/setup instructions and subsequent review gates.

## Tests and actual results

Execution environment: macOS, Node v24.15.0, npm 11.12.1; TypeScript 5.9.3 and Node definitions 22.20.4. The pinned Node 22 definitions cover the SQLite API subset used by the Node 24 runtime here.

| Check | Actual result |
| --- | --- |
| Clean dependency install | `npm ci --offline --ignore-scripts --no-audit --no-fund --cache /Users/adnan/.npm --logs-dir /private/tmp/streamdirector-npm-logs`: passed, 3 packages installed from local npm cache. Online registry requests failed DNS; online installation was not verified. |
| Strict type check | `npm run typecheck`: passed, zero diagnostics. |
| Automated tests | `npm test`: **65 passed, 0 failed, 0 skipped**. Includes fourteen replay fixtures executed twice and compared for identical outputs. |
| Single-second impulse CLI | Five-message and 30-message impulses followed by silence each created **0 bookmarks**. Five-message and 30-message impulses surrounded by established 2 msg/s baseline traffic each created **0 bookmarks**. Synthetic source only. |
| Sustained burst CLI | Real CLI execution created **1 chat bookmark**, onset 60.000s, confirmation 65.000s, detected offset 60s, lead-in suggestion 45s. The three independent buckets contain 3 counted messages each. Synthetic source only. |
| Sustained burst after normal traffic CLI | Established 2 msg/s baseline followed by sustained 10 msg/s created **exactly 1 bookmark**, threshold 6 msg/s, onset 100.000s, confirmation 105.000s, suggested offset 85s. Earlier ordinary messages in the rolling window do not become onset. Synthetic source only. |
| Stalled candidate CLI | After idle warmup, two regular chatters each posting once per second for two minutes, followed by one additional chatter's message, created **0 bookmarks**. Continued ordinary traffic did not revive the original low-threshold candidate. Synthetic source only. |
| Genuine surge after candidate expiry CLI | The same two-minute sequence and additional message, followed by normal traffic until a real 10 msg/s surge at 190s, created **exactly 1 chat bookmark**: onset 190.000s, confirmation 195.000s, lead-in suggestion 175s. It used the current 121/60 msg/s baseline and 6.05 msg/s threshold, rather than the original zero baseline / 1 msg/s threshold. Synthetic source only. |
| Validation boundaries | Unit tests passed: fifth-bucket confirmation when either distinct chatters or rolling activity becomes sufficient; immediate fifth-bucket expiry when safeguards fail; a new candidate uses a new onset/current baseline; configured six-second sustain with three-second activity derives a six-bucket bound. Existing valid four-bucket threshold-freeze regression still passed. |
| Platform overlap CLI | Real CLI execution created **7 separate banner records**: raid, gift, subscription, resubscription, redemption, manual and cheer. Gift-recipient event suppressed. Exactly one received nearby chat evidence. Cheer aggregate reached 110 Bits in one record. Synthetic source only. |
| File inspection | Python stdlib parsed all fourteen generated CSV/JSON pairs, including empty impulse/stalled-candidate results: record counts, IDs and explicit outputs matched; simulated provenance, unverified editor label, offsets, validation-window lengths, qualifying bucket bounds/rates, timing, tiers, correlation and cheer totals passed assertions. |
| Restart persistence | Test closed and reopened an on-disk SQLite database; saved bookmark/settings survived, replayed source ID was rejected, next ID continued correctly, coverage gap was recorded and warmup restarted. Separate test persisted a partial chat candidate and confirmed restart discarded it. |
| Save failure | Injected persistence failure restored engine state; retry saved the bookmark exactly once. This exercises failure handling, not a destructive physical disk failure. |
| Memory bounds | Synthetic 1,001-second chat test kept retained chat buckets at ≤70 and standalone dedup IDs at ≤100 for that configuration. Bucket overload test recorded a gap and cleared history. No real-stream memory/throughput measurements have been made. |

Coverage includes steady and idle traffic, zero baseline, five-/30-message impulses with silence and normal baseline traffic, two-minute stalled candidates and single added chatters, subsequent genuine surges with current baselines/new onsets, inclusive validation deadlines and expiry, configured validation bounds, full rolling-window fill before confirmation, sustained bursts, exclusion of preceding ordinary traffic from onset, unfinished-bucket/repeated-tick rejection, quiet and nonzero below-threshold sequence resets, independent rolling-rate/distinct-chatter safeguards, one-person spam, broadcaster/bot exclusions, per-user baseline caps, threshold freezing while the baseline changes during valid confirmation, warmup, cooldown/rearming, all seven platform types during warmup and cooldown, gift suppression, reward ID filtering, cheer thresholds/window boundaries, nearby-event correlation, duplicate deliveries/IDs, malformed inputs, anonymous users, delayed/out-of-order inputs, connection and clock gaps, sub-second and unknown source timestamps, midstream offsets, exports, save failure and restart recovery.

Evidence: `evidence/checkpoint-1/test-results.txt`, `typecheck-results.txt`, `replay-results.txt`, `artifact-inspection.txt`, and each fixture's regenerated `bookmarks.csv`/`bookmarks.json` pair. These artifacts are synthetic replay evidence, never live Twitch evidence. Python parsing is a separate artifact check, not the requested independent model review or a Resolve import test.

Reproduce evidence from the repository root:

```sh
npm test
npm run typecheck
node --disable-warning=ExperimentalWarning scripts/checkpoint-1-evidence.ts
python3 scripts/inspect-checkpoint-1.py
```

## Rule limitations and decisions to review

1. **Impulse and stalled-candidate defects fixed:** the previous overlapping-evaluation rule allowed five- and 30-message one-second impulses to trigger. The revised rule counts distinct completed buckets; both impulses followed by silence and isolated impulses with established normal baseline traffic now produce no bookmark. The first revision could still freeze a low startup threshold/onset indefinitely while waiting for distinct chatters. The new five-bucket default validation bound discards that failed candidate, preventing a third chatter's single later message from confirming it. Only a new candidate at the current baseline may qualify. These synthetic regressions establish the revised behavior, not general false-positive rejection or editorial relevance.
2. **Warmup/history convention:** warmup lasts the requested 60 seconds. Because the baseline excludes the latest five seconds, its earliest full denominator includes five zero-filled pre-session buckets. This convention is documented; requiring 65 seconds of observed history would be a settings/design change.
3. **Arrival ordering for correlation:** a chat confirmation attaches to the closest existing platform bookmark. A platform event arriving after a saved chat bookmark keeps both records and copies chat evidence; it never deletes saved history or merges unrelated platform events.
4. **Timing conventions:** default event-time evaluation waits two seconds for late chat. Cheer aggregation is receipt-time based so delayed/out-of-order deliveries have a deterministic policy. The ten-second post-crossing aggregate boundary is fixed at its first included receipt, not extended on every contribution. All these settings/choices are recorded/documented.
5. SQLite session dedup IDs and bookmark history grow on disk. Real throughput, memory use, archival UX and practical sensitivity remain to be measured. Rule tests establish behavior, not editorial relevance, detection accuracy or time savings.

## Still unverified / external work

- Broadcaster account readiness, Twitch developer app registration, OAuth and required scopes, current account subscription/Bits/Channel Points capabilities, actual live chat and platform delivery. The user's setup response retained alternative placeholders, so none is interpreted as confirmation.
- Official EventSub adapter details and CLI simulation integration; no adapter has been implemented against guessed Twitch payloads. Before gate 2, verify current official versions/conditions/scopes and payloads.
- Resolve-exported marker EDL sample, chosen dialect, 30/60 fps NDF serialization, nonzero timeline start, and actual native import count/positions/names/notes. Resolve is installed at `/Applications/DaVinci Resolve/DaVinci Resolve.app`; it has not been opened/tested. **Editor compatibility remains unverified.**
- OBS installation/load and transparent overlay behavior. OBS was not found in the inspected `/Applications` inventory. No browser source or overlay exists yet.
- Dashboard, backend web endpoints/SSE, read-only overlay access, bounded captions, real stream comparison, independent review, public repository, video and submission materials.

Setup guidance is in README. Main build session: `01a19261-1097-73a2-8036-50df8c51465e`.

The next action is the user's review of this checkpoint. Do not continue to live integration or the Resolve export until that review authorizes continuation.
