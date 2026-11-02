# Resolve marker EDL

The writer in `src/resolve-edl.ts` was implemented **after** inspecting `evidence/checkpoint-2/resolve/resolve-exported-sample.edl`, exported from the isolated test timeline by the user in DaVinci Resolve **21.1.1.10**. Resolve's built-in Lua console independently returned that version. The real sample has two known markers at 01:00:01:00 and 01:00:03:01, names “Sample Name” / “Second Name”, notes, Blue/Green colors, and durations 1/3 frames. It is the format oracle, not an app-generated sample.

The observed dialect has `TITLE`, `FCM: NON-DROP FRAME`, numbered video/cut records containing source and record in/out timecodes, followed by a line containing the note and `|C:ResolveColor… |M:name |D:duration`. The writer uses this layout, creates one-frame point markers, uses Blue for chat corner tier and Green for platform/manual banner tier, and puts the signal, reason and bookmark ID into notes.

Frame rates must be explicitly selected as **30 or 60 fps NDF**. Drop-frame, fractional rates and other rates reject with an error. Timeline start must be explicit `HH:MM:SS:FF`; a semicolon/drop-frame start, invalid fields, and times reaching the 24-hour wrap reject. Offset frames are rounded to nearest integer; supported-rate serialization is within half a frame. Timeline start is added **after** converting the saved editor offset. Saved evidence times, lead-in and alignment are not rewritten.

Names are capped at 80 ASCII characters and notes at 240. Diacritics are transliterated where Unicode decomposition permits; other non-ASCII/control characters become spaces. Pipes/newlines are sanitized to prevent metadata or record injection. Full caption/reason originals remain in CSV/JSON. The writer never mutates bookmark records.

Resolve stores one marker per frame. If two bookmarks round to the same frame (including multiple lead-in suggestions clamped to zero), the writer **rejects the export** instead of silently overwriting a bookmark or shifting its time. Select individual/non-colliding records for native export, or use complete CSV/JSON reference exports. Files with more than 999 markers also reject explicitly.

## Export endpoint

`GET /api/export?sessionId=<encoded ID>&format=edl&fps=30&startTimecode=01:00:00:00`

Use `fps=60` only with a 60 fps NDF timeline. The rate is not inferred from Twitch/video. JSON/CSV remain independent of timeline start. Native import is **verified in Resolve 21.1.1.10 at 30/60 fps NDF with zero and one-hour starts** on the known footage below. Checkpoint 3 additionally verified three actual-broadcast markers at 30 fps/one-hour start with measured recording mapping. Neither establishes action-detection accuracy. JSON retains the known-footage verification scope; older exports retain status at generation time.

Repeat `bookmarkId=<encoded bookmark ID>` to export an explicit selection when full-session markers collide; an unknown selected ID returns 404. The saved bookmark list itself remains complete.

Add both `alignmentSeconds=<finite seconds>` and `leadInSeconds=<0..3600>` to override only an EDL export's mapping. Alignment is limited to ±86400 seconds. Mapped offset is `max(0, max(0, detectedOffsetSeconds - leadInSeconds) + alignmentSeconds)`. Supplying only one rejects. These dashboard EDL-only controls never rewrite saved bookmarks/settings or JSON/CSV.

## Actual broadcast — checkpoint 3

Actual session `twitch:238520082:316456451563` produced three manual bookmarks. Six recorded clock anchors gave alignment **+139.5335 seconds**. Explicit **zero lead-in**, **30 fps NDF** and **01:00:00:00** start yielded relative frames **6273/10247/16423**. Saved records retain the fifteen-second lead-in. Native import into **SD Actual Broadcast Final 30 NDF** on actual footage passed count, frames, names, notes, durations and Green colors through `GetMarkers()`. This was assisted UI import followed by direct API/console inspection, without scripted marker creation.

Use `scripts/resolve-live-import-check.lua` for preparation/read-only verification per the [checkpoint report](checkpoint-3.md). EDL, manifest, actual readback and screenshot are indexed in [evidence](../evidence/checkpoint-3/README.md). The failed older-fixture import is preserved. Exact decoded marker-frame visible-clock residuals were −3/−32/−41 ms; display/calibration jitter and the manual/slate scope preclude an action-timing accuracy claim.

## Known footage and actual import test

`scripts/make-resolve-footage.swift` uses Apple's AVFoundation to create procedural 320×180 H.264 MOVs: exactly 360 frames at 30 fps and 720 frames at 60 fps (12 seconds each). Files are in ignored `output/test-30.mov` and `output/test-60.mov`; no user media is used. The video encoder required running outside the execution sandbox. Reproduce on macOS:

```sh
swift -module-cache-path /private/tmp/streamdirector-swift-cache scripts/make-resolve-footage.swift output/test-30.mov 30
swift -module-cache-path /private/tmp/streamdirector-swift-cache scripts/make-resolve-footage.swift output/test-60.mov 60
node --disable-warning=ExperimentalWarning scripts/resolve-export-fixtures.ts
```

`expected-imports.json` specifies four generated EDL files: each frame rate at a zero and a one-hour start. Each has four markers. Expected relative frames are `[0,15,91,300]` at 30 fps and `[0,30,181,600]` at 60 fps. The last marker's ideal frame is N+0.49, checking quantization. All names, notes, colors and durations are in the manifest.

In the isolated project **StreamDirector Checkpoint 2 Markers**, open Workspace → Console, choose Lua and run:

```lua
sd_action='prepare'; dofile([[/Users/adnan/Developer/Hack/Projects/StreamDirectorAI /scripts/resolve-import-check.lua]])
```

This creates four named timelines on the corresponding test footage, explicitly configures 30/60 fps and zero/one-hour starts, and leaves existing user projects alone. It does not import any markers or manufacture a passing report.

For each `SD Import <fps> <zero|one-hour>` timeline, right-click its **Media Pool timeline item** → Timelines → Import → Timeline Markers from EDL, and choose the matching `generated-<fps>-<zero|one-hour>.edl` from the evidence folder. This command imports markers onto existing footage; ordinary timeline-EDL import is a different command.

Then run:

```lua
sd_action='verify'; dofile([[/Users/adnan/Developer/Hack/Projects/StreamDirectorAI /scripts/resolve-import-check.lua]])
```

The script directly reads Resolve's actual timeline settings, exact test footage path and marker dictionaries and checks count/frames/names/notes/durations/colors. It prints the results in Console; Resolve's safe scripting mode disables direct file writing, so capture the observed console results as `actual-import-results.txt`. A missing marker or incorrect start/rate yields `CASE FAIL`. The script saves the isolated project. The report verifies serialization/import of known markers, not live editorial or action-detection accuracy.

## Actual result — October 31, 2026

The user performed the four UI marker imports and ran verification; the assistant independently inspected the actual console output. **All four cases passed: sixteen markers, zero failed cases.** Both zero and one-hour starts returned `[0,15,91,300]` at 30 fps and `[0,30,181,600]` at 60 fps. Counts, names, notes, colors, one-frame durations, timeline settings and exact footage paths matched. Frames equal the expected rounded frames, within half a frame of the fixture offsets. Full observed output is retained at `evidence/checkpoint-2/resolve/actual-import-results.txt`.

The initial failed attempt used ordinary timeline import and created new timelines containing offline reference clips. That workflow did not exercise marker import onto the prepared footage. The final successful attempt used the exact Media Pool marker-import command above with the same generated EDL files. The failed-attempt evidence is retained for clarity.

Relevant primary local documentation: `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/README.md` (updated August 31, 2026) and `DaVinciResolveScript.pyi`. External scripting was unavailable and was **not** enabled; the documented internal console is used. Automated context-menu activation proved unreliable, so assisted UI steps are identified in the checkpoint evidence.
