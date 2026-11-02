# StreamDirector AI — submission description

Status: publication-review draft. Repository/video URLs await authorization. Main Codex build session: `01a19261-1097-73a2-8036-50df8c51465e`.

## One line

Keep moments while streaming, review their context afterward, and open the selected markers in Resolve.

## The streamer’s workflow

After a broadcast, an editor faces a long recording and a short memory of its best moments. StreamDirector AI gives a broadcaster a reviewable list of suggested moments with reasons and timing. It is an editing starting point: the streamer still decides which moments matter.

Connect Twitch, add the read-only OBS overlay, and keep moments through deterministic chat/platform rules or a manual mark. Chat uses a small corner reaction; platform/manual marks use a brief banner. In the dashboard, inspect bookmarks and coverage gaps, choose the moments to edit, and export CSV, JSON or Resolve marker EDL. Import the EDL onto the existing recording timeline. Recording alignment and editorial lead-in are mapped deliberately while original source evidence stays intact.

## Built with Codex

The app uses TypeScript/Node, React and SQLite, with Twitch OAuth/EventSub and server-sent updates. Codex helped plan and implement the detector, persistence, authentication, exports, interface and regression tests in the main build chat. Reviews exposed false impulse/stalled-candidate detection, authentication races, stale dashboard responses and expired caption context; these were fixed and covered by regressions.

A specified fresh-context GPT-6.1 Sol review at high reasoning effort directly inspected actual source, tests, exports, recordings and native Resolve evidence. Material findings were fixed and independently rechecked. The final feature scope is frozen. A separate diagnostic supplement was also reviewed; the complete suite has154 passing tests, strict typecheck and a production build. Exact clean-checkout results identify the final release commit separately.

Deterministic rules decide bookmarks and tiers. Each bookmark commits before presentation or optional captions. Optional AI can only caption an already confirmed bookmark through a bounded worker; it cannot choose detection, timing or tier. AI captions remain off in this submission’s demonstrations. Local synthesized video narration is presentation audio, not an AI-caption integration test.

## Demonstrated results and limits

Actual Twitch authorization/chat receipt and six EventSub subscriptions were verified. A real broadcast produced three persisted manual bookmarks and recorded OBS banners. Those three manual markers imported onto the actual recording in Resolve21.1.1.10 at30fps NDF with a one-hour start. Four additional native known-footage cases passed at30/60fps and zero/one-hour starts.

The chat-corner segment is **SIMULATED input** rendered in an actual local OBS recording, and remains labelled throughout. Platform routes and caption bounds were exercised with simulations/fake providers. They do not prove real paid-event or AI-provider delivery.

**Positive live chat bookmarking and sustained connection continuity remain unverified.** Earlier input failed configured thresholds; a later default three-viewer attempt aborted on an EventSub timeout. Reconnects retain coverage gaps. Historical OBS dropped-frame results, including24.5%, and the unexplained older integration error remain documented. The offline probes narrow timing observations but do not establish historical root cause or a verified production fix. No new broadcast or further open-ended investigation is scheduled for delivery.

No measured editing-time savings, precision/recall, video understanding, automatic clips or production-scale usefulness is claimed. The repository provides a visibly labelled judge replay, setup instructions, tests and selected sanitized evidence so judges can reproduce the implemented behavior without shared credentials or paid AI access.

## Delivery fields

- Platform: local Node24+ app; browser dashboard; OBS Browser Source; tested DaVinci Resolve marker imports on macOS.
- Run: `npm ci`, `npm test`, `npm run typecheck`, `npm run build`, `npm start`; open localhost:4387 and use **Judge replay** without Twitch credentials.
- Repository: pending publication review; no placeholder is a live URL.
- Public YouTube demo under3minutes: pending publication review.
- Source/setup/limitations: README, checkpoint reports, independent review and the claim ledger.
