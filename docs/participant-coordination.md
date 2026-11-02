# Offline coordination and future readiness

No broadcast is scheduled. OBS streaming and recording remain stopped. This protocol prepares a future separately agreed attempt; it does not authorize outputs or Twitch posts.

## Actual rehearsal results

The public offline rehearsal did **not pass** the abort check. The operator corrected the initial acknowledgment: after rehearsal A, the abort cue appeared, but rehearsal B and C were still sent. Preserve that correction in `evidence/eventsub-diagnostics-2026-11-01/rehearsal-result.json`.

The later **no-post** check was acknowledged with **STOPPED**. Its instruction explicitly canceled pending B/C and prohibited all Twitch posts. This confirms acknowledgment of the rule; it is not a measured response-time pass or proof of coordination while operating three accounts. Evidence: `no-post-abort-check.json` in the same folder.

## One sequence and one abort rule

Before a future attempt, appoint one coordinator and confirm all participants can see/hear the coordinator immediately while using Twitch. Three people, one per account, are preferred. One operator switching three browser profiles must demonstrate that both cadence and abort visibility are practical; three logged-in accounts alone are insufficient.

1. Agree one output deadline and a shorter absolute chat-window expiry. Keep outputs stopped until the test plan is agreed. Stage short lowercase messages without sending; do not use repetitive caps text.
2. Start only the agreed recording and broadcast. Verify the source clock, actual stream origin, recording file and detector configuration. Keep AI off and use default three-chatters settings.
3. Wait for the detector to report **warm and armed after the latest gap**. Require active recording and broadcast at the same instant. Any timeout/gap resets readiness; discard any old SEND cue.
4. State the absolute chat expiry and give **one direct countdown: “3, 2, 1, SEND.”** No asynchronous questionnaire reply is the countdown. Only post inside that active recording window, within the separately authorized message allowance.
5. The exact cue **“ABORT CHAT NOW”** cancels the entire sequence immediately. Do not finish pending accounts, messages or rounds. On a gap, lost readiness, output stop, expiry, or uncertainty, apply the same abort rule. A later attempt needs a fresh readiness check and cue.
6. Judge received, counted completed buckets and distinct chatters against the current threshold. Sent-message totals or activity received after output stop do not prove acceptance. Stop both outputs at the agreed deadline even if coordination is delayed.

The next live attempt remains blocked on reliable coordination and unresolved EventSub continuity. Future acceptance still needs one persisted real chat bookmark, its recorded corner reaction and its matching exported/native Resolve marker, with source timing, coverage and bucket evidence retained together.
