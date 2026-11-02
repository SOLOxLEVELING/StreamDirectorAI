# Submission preparation — verified requirements and current blockers

Verified November1,2026 against the [official overview](https://twitchcon-codex.devpost.com/) and [official rules](https://twitchcon-codex.devpost.com/rules). This is a working preparation record, not a submitted entry or an eligibility determination.

The rules close at November2,2026,14:00 Pacific. Using America/Los_Angeles on that date gives **November3,03:30 Asia/Kolkata**. The user updated the internal target to **November2,22:00 IST**, leaving5h30m. The timezone conversion is computed, not a different organizer deadline.

The official submission package needs an accessible source repository with run instructions, a feature/Codex description, the main build session ID, and a public YouTube demo under3 minutes showing Twitch operation and Codex-build footage. Materials must be English or translated. The rules allow a public repository or the specified private-repository sharing arrangement. Recheck the live rules before final submission. No rules acceptance or publishing action was taken here.

## Concrete preparation state

| Item | Current state / next action |
|---|---|
|Accepted code and scope|User accepted independent review.Original63-file feature freeze unchanged; separate five-file diagnostic supplement.154 tests/typecheck/build passed; diagnostic review cleared.|
|Live acceptance|Default-settings attempt with three eligible viewers aborted on timeout; output span120.857s stayed under150s. Persisted chat + recorded corner + matching native marker remain unverified.|
|Code repository|Local source exists; `git remote -v` is empty. Repository URL, visibility and publication still need a concrete final decision/action. No push, remote creation or sharing occurred.|
|Run instructions|README, Twitch setup, OBS/Resolve procedure and labelled judge replay are present. A local allowlisted source archive and isolated clean-install check are recorded in packaging-checks.json; this is not an external public checkout.|
|Description|project-description.md is drafted using actual scopes and open limitations.|
|Demo|The narrated product cut is153.6s, with actual manual Twitch footage, labelled simulated material, Resolve results and operator-supplied Codex footage. The24-second evidence preview is superseded; final assembly/complete viewing and public URL are tracked in the delivery report.|
|Session ID|01a19261-1097-73a2-8036-50df8c51465e, the main build chat.|
|License/asset attribution|Pinned dependencies and owned procedural footage are identified. Check distribution/attribution in the final repository; do not invent a chosen project license.|
|Dashboard visual check|User authorized capture on November2. Saved origin permission still blocked direct automation; operator-provided new offline/simulated dashboard recordings are visually reviewed. Interaction coverage remains scoped to tests and prior checks.|
|Final claim check|Use claim-ledger.json. Retain failures, temporary historical profiles and simulation labels. No fabricated successful-chat segment.|

## Packaging and final handoff

Keep `.env`, data/, credentials, control tokens, databases and raw private runtime logs out of the repository/video. The current .gitignore excludes private runtime data and ignored raw recordings. Review the actual final file set and secret scan before any publication; a past scan is not a guarantee for later additions.

Prepare the final repository and video as concrete reviewable artifacts, then obtain any required publication/submission authorization. Do not create a public URL placeholder that looks like a real result. The submission itself accepts official terms, so its final action is for the user. No email/message or judge sharing has been sent as part of this preparation.
