# StreamDirector AI

**Keep a moment while streaming. Review it afterward. Open it in Resolve.**

StreamDirector AI is a local Twitch companion for one broadcaster. It keeps a reviewable list of suggested moments, their reasons and source timing; shows small OBS reactions; and exports markers for an editor's recording. It does not analyze video or create clips. Human editorial judgment stays in the workflow.

## The workflow

1. Connect a broadcaster through Twitch OAuth/EventSub. Put the separate read-only overlay in an OBS Browser Source.
2. Keep moments through deterministic chat/platform rules or a manual bookmark. Saving happens before presentation or optional caption work.
3. Review bookmarks and connection coverage in the dashboard. Choose moments and export CSV, JSON or Resolve marker EDL.
4. Import the EDL **onto an existing footage-backed timeline** using Resolve's **Timeline Markers from EDL** command. Set the export frame rate, timeline start, recording alignment and editorial lead-in deliberately.

## What was demonstrated

| Scope | Result |
|---|---|
|Actual Twitch integration|Broadcaster authorization, chat receipt and six enabled EventSub subscriptions verified. A real broadcast produced three persisted **manual** bookmarks and OBS banners.|
|Actual native Resolve imports|The three manual markers imported on the actual recording at30fps/one-hour timeline start. Four additional known-footage cases passed at30/60fps NDF with zero/one-hour starts.|
|Chat corner and platform routing|Exercised with **SIMULATED** input; the chat corner was verified in an actual local OBS recording. These are not successful live chat or paid-event results.|
|Automated checks|154 tests, strict typecheck and production build passed. Fresh-context independent review directly inspected code, tests, exports and evidence; material findings were fixed and rechecked.|
|Open acceptance|**Positive real chat bookmarking and sustained connection continuity remain unverified.** Recurrent EventSub timeouts and historical dropped frames, including24.5%, remain documented. Real paid/redemption events, real AI requests and production usefulness/load are unverified.|

AI captions are **off by default and off in the demonstrations**. No broadcast is needed for the judge replay. See [limitations and verification](docs/checkpoint-3.md), [independent review](docs/independent-review.md) and the [separate diagnostic history](docs/eventsub-timeout-investigation.md). Feature scope is [frozen](docs/scope-freeze.md); no further timeout investigation or live attempt is scheduled for submission delivery.

## Run locally

Requirements: **Node24 or newer** and npm. The backend uses Node's built-in SQLite and native TypeScript execution. The interface build dependencies are pinned in the lockfile.

```sh
npm ci
npm test
npm run typecheck
npm run build
npm start
```

Open `http://localhost:4387`. Without Twitch credentials, the local dashboard and **Judge replay** are available. Click **Run sustained chat replay**, then select the generated **Simulated** session. The replay uses explicit test settings and persists separately from live sessions. Use **Send test** to exercise labeled simulated platform events. The corresponding read-only overlay is `http://localhost:4388/overlay?mode=simulated`.

Replay never proves actual live delivery. Keep its SIMULATED labels visible in screenshots, OBS and demonstrations. The live-only overlay is `http://localhost:4388/overlay`. Do not expose either local service through a tunnel or reverse proxy.

A headless deterministic replay needs no credentials:

```sh
npm run replay
npm run replay -- test/fixtures/platform-overlap.json output/platform-overlap
```

Generated databases/exports and built web assets go into ignored `output/`; private runtime state goes into ignored `data/`. No shared account, token or paid AI access is required for replay/testing.

## Connect Twitch and OBS

Copy `.env.example` to `.env`, fill your own Twitch app ID/secret locally and configure the exact callback `http://localhost:4387/auth/twitch/callback`. Never commit `.env` or runtime data. Start the app, use **Sign in with Twitch**, and authorize as the broadcaster. Credentials stay on the backend. Optional rewards require the configured reward ID and appropriate permissions.

Follow [Twitch setup](docs/checkpoint-2-setup.md) and [dashboard/OBS setup](docs/checkpoint-3-setup.md). OBS Browser Source:1920×1080, live overlay URL above. Chat uses a corner; manual/platform events use a banner. Overlay suppression or failure cannot remove a saved bookmark. Coverage gaps remain visible; missed Twitch events are not replayed.

## Detection, timing and exports

Chat confirmation uses three consecutive completed non-overlapping one-second elevated buckets, a frozen candidate threshold, five-second rolling activity and distinct-chatter safeguards. Candidates expire within a bounded validation window; subsequent candidates use the current baseline. Defaults include60-second warm-up, minimum rate1/s and three distinct eligible chatters. Broadcaster/configured bots are excluded, and each viewer counts at most once per second. Source onset is separate from editorial lead-in. Platform/manual signals bypass chat warm-up and cooldown.

CSV/JSON preserve source, receipt, onset and confirmation evidence, stream origin, settings and coverage. EDL supports30/60fps **non-drop-frame** marker imports, selection and export-only alignment/lead-in. See [Resolve mapping and import procedure](docs/resolve-edl.md). Fractional/drop-frame rates and untested editor formats are not claimed.

Optional captions can write only the caption of an already confirmed bookmark. Detection, tier, timing and persistence remain deterministic. Provider jobs are bounded, and opt-in chat context expires after45seconds, including silence and delayed jobs. Failures keep deterministic labels. Real provider integration/quality was not tested.

## Review and submission

Main Codex build session: `01a19261-1097-73a2-8036-50df8c51465e`.

- [Submission description](docs/submission/project-description.md)
- [Demo narration/storyboard](docs/submission/demo-storyboard.md)
- [Verification and claim ledger](docs/submission/claim-ledger.json)
- [Accepted feature baseline and separate diagnostic supplement](docs/scope-freeze.md)
- [Checkpoint1 detector evidence](docs/checkpoint-1.md), [checkpoint2 Twitch/Resolve](docs/checkpoint-2.md), [checkpoint3 UI/live results](docs/checkpoint-3.md)

The release contains selected sanitized evidence. Full raw recordings and private runtime state remain outside the repository. Packaging/clean-checkout checks identify the exact release tree; a review or test pass does not close end-to-end live acceptance.

## License

Original project code is licensed under the [MIT License](LICENSE), copyright (c) 2026 Shaikh Adnan. Third-party components retain their own copyright notices and license terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
