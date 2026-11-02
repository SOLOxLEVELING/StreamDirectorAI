# Default-settings acceptance attempt — aborted on EventSub timeout

Actual Twitch stream316461332331; session `twitch:238520082:316461332331`. Three distinct non-broadcaster identities were read through their actual Twitch avatar menus:solo_leveliing,testuserx002,testuserx003. The user authorized eight lowercase test messages per account and supplied three offline readiness posts. Native Chrome input/window control did not pass preflight; the user provided the agreed manual fallback. No agent public posts were successfully submitted in this attempt.

The independent-review source remained frozen. All defaults were used:minimumChatters3,minimumRate1/s,60s warm-up,3 qualifying completed buckets,5s rolling window and2s lateness. AI remained off. The read-only observer was prepared before either OBS output started; no extra EventSub connection or simulated input was created.

## Readiness and invalidation

At **84.011s** after the first observed OBS output, the actual persisted state was warm, unlatched and candidate-free. Two quiet completed buckets were verified; rate0/s,baseline1/60,threshold1/s. Chat subscription was enabled, auth validated, no pending persistence failure and no known gaps. The source/session-specific [readiness snapshot](readiness-at-cue.json) was saved before the human cue.

A subsequent keepalive timeout was detected at **2026-11-01T18:13:17.925000+00:00**, invalidating readiness. The conservative coverage interval is **2026-11-01T18:13:07.503000+00:00–2026-11-01T18:13:20.160000+00:00**, **12.657s**. Two overlapping records describe this one outage. Its start is the last known message, slightly before the readiness snapshot; it is not an exact proved event-loss interval. Warm-up reset on recovery, and another full60s could not fit the fixed readiness/deadline budget. The attempt was aborted without a second cue or another burst.

## Actual output timing

- Recording wall-log interval:2026-11-01T18:11:43.528000+00:00–2026-11-01T18:13:44.385000+00:00,**120.857s**.
- Streaming wall-log interval:2026-11-01T18:11:44.294000+00:00–2026-11-01T18:13:39.799000+00:00,**115.505s**.
- The maximum output span **120.857s is below150s**. Both zero timers/Start controls were directly verified after stopping, and [native stopped-state evidence](obs-stopped.png) saved. When the user later asked whether to stop at their2:30 timer, both outputs were already stopped; neither was restarted.
- Actual OBS log:3452 streamed output frames, no network-drop summary or attempted/output discrepancy. Recording separately skipped2/3625 frames from encoding lag,0.1%. Do not call encoding skips network drops or infer uninterrupted EventSub health from RTMP statistics.

The copied MOV is actually1920×1080/30fps,120.366s by AVFoundation; media duration and wall-log output span are distinct measurements. Path,size,SHA256 and decoded clock frames are retained in recording-file.json and recording-frames/. No corner-positive frame is claimed.

## Result and evidence scope

**Zero persisted chat bookmarks.** During the actual OBS broadcast, only the initial automated stream announcement was received. Human burst messages arrived after streaming had stopped. Some post-stop arrivals still carry `recordedAgainstLiveStream=true` because the backend had not yet observed Twitch offline through its periodic stream lookup. That flag is not proof that the local recording/public OBS output was running. All source/receipt timing is retained and those arrivals are explicitly separated in [final-session-evidence.json](final-session-evidence.json); captured bucket totals extending after stop are not represented as live acceptance evidence.

No successful chat bookmark, recorded chat corner or matching new Resolve marker exists. No manual/simulated bookmark or old native-import result was substituted. Native import was not attempted with an empty marker set. session-export.json is the genuine zero-bookmark JSON export, preserving settings and gaps.

Final state:default settings unchanged and verified,AI disabled,Twitch offline,no active recorder,no pending coverage persistence. Backend EventSub remains connected for ordinary operation. All63 frozen source/test/script/config hashes still match. No runtime edit or test rerun was needed for this evidence-only execution; the accepted140-test/typecheck/build baseline remains linked through final-checks.json.

End-to-end acceptance remains open. Recurrent timeout diagnosis stays separate from the frozen feature scope; there is no automatic second attempt. The dashboard visual recheck remains pending explicit browser authorization.

Artifacts:preflight-identities.json,offline-readiness-receipts.json,run-plan.json,deadline.json,observations.jsonl,live-sse.txt,obs-live-transitions.jsonl,obs-log-extract.txt,readiness-at-cue.json,final-session-evidence.json,after-stop.json,final-snapshot.json,session-export.json,recording-file.json,recording-frames/,final-checks.json and obs-stopped.png.
