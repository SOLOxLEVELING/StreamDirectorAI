# Final demo narration

English narration generated locally with the installed macOS Samantha voice at160words/minute. This is presentation audio; the application AI-caption integration remains disabled. No voice imitation or provider API was used.

## From stream to editing timeline

When a broadcast ends, finding the moments worth editing means scrubbing through a long recording. StreamDirector AI gives a streamer a reviewable list of suggested moments, then carries those timestamps into the editing timeline. Here is the workflow.

## Review the moments, keep the context

The dashboard brings the session, bookmarks and connection coverage together. Each saved moment keeps its reason and timing. Choose the moments you want to edit, and inspect any coverage gap before trusting the list. These are starting points for a human editor, not automatic clips.

## Keep a moment while you are live

This is footage from our actual Twitch broadcast. A manual mark saves the moment and produces a brief banner in OBS. Three manual bookmarks were persisted during the broadcast. The manual fallback lets the streamer keep a moment even when chat does not qualify.

## A small corner for chat, a banner for events

For chat, the reaction is a quieter corner. This demonstration uses visibly simulated input, not a successful live chat trigger. Detection requires sustained completed buckets, a rolling rate and distinct viewers. The bookmark is committed before the overlay or optional caption work, so presentation failures cannot erase it.

## Select. Align. Export.

Select bookmarks and export CSV, JSON or a Resolve marker EDL. Keep the source onset separate from editorial lead in and recording alignment. The original evidence stays intact, while the export maps the chosen moments onto the editor's recording. The app supports thirty and sixty frame per second non drop frame timelines.

## Open the moments in Resolve

Import the marker EDL onto the existing recording timeline in Resolve. Our actual manual broadcast markers were read back at the expected frames, with their names and notes. Separate native imports also passed at thirty and sixty frames per second, with zero and one hour timeline starts.

## Built and reviewed with Codex

Codex helped implement the detector, Twitch integration, persistence and this interface. Regression tests drove fixes for impulse rejection, stale authorization, session selection and caption expiry. A fresh context independent review found material defects that were fixed and rechecked. The release now passes one hundred fifty four tests, strict type checking and a production build.

## Stream. Review. Edit.

StreamDirector AI connects streaming moments to an editor's workflow, with a labeled replay for judges. Positive live chat bookmarking and sustained connection continuity remain unverified. Recurrent EventSub timeouts and historical dropped frames are documented. AI captions stay off. The repository includes setup, tests, exports and the full limitations, so you can inspect exactly what was demonstrated.
