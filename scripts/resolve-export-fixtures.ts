import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exportResolveEdl, markerText, timecodeFrames } from '../src/resolve-edl.ts';
import type { Bookmark } from '../src/types.ts';

const directory = resolve('evidence/checkpoint-2/resolve'); mkdirSync(directory, { recursive: true });
const manifest: unknown[] = [];
for (const fps of [30, 60]) for (const [label, start] of [['zero', '00:00:00:00'], ['one-hour', '01:00:00:00']]) {
  const offsets = [0, 0.5, 3 + 1 / fps, 10 + 0.49 / fps];
  const names = ['First Frame', 'Half Second', 'Frame Boundary', 'Final Marker'];
  const bookmarks: Bookmark[] = offsets.map((offset, index) => ({ id: `native-test-${index}`, sessionId: 'SIMULATED-RESOLVE-TEST',
    streamId: 'procedural-12-second-footage', signal: index === 0 ? 'chat' : 'manual', tier: index === 0 ? 'corner' : 'banner',
    sourceTimeMs: null, receivedAtMs: 0, onsetMs: offset * 1000, confirmedAtMs: offset * 1000,
    detectedOffsetSeconds: offset, suggestedOffsetSeconds: offset, editorOffsetSeconds: offset,
    caption: names[index]!, captionStatus: 'disabled', reason: `Known fixture ${index + 1}`, metrics: {}, sourceIds: [], chatEvidence: [] }));
  const file = `generated-${fps}-${label}.edl`;
  writeFileSync(`${directory}/${file}`, exportResolveEdl(bookmarks, { fps, timelineStartTimecode: start!, title: `StreamDirector native test ${fps} ${label}` }));
  manifest.push({ file, fps, timelineStartTimecode: start, timelineStartFrame: timecodeFrames(start!, fps),
    footage: resolve(`output/test-${fps}.mov`), markers: bookmarks.map(b => ({ frame: Math.round(b.editorOffsetSeconds * fps),
      name: b.caption, note: markerText(`${b.signal}: ${b.reason} [${b.id}]`, 240), duration: 1,
      color: b.tier === 'corner' ? 'Blue' : 'Green', idealFrame: b.editorOffsetSeconds * fps })) });
}
writeFileSync(`${directory}/expected-imports.json`, JSON.stringify({ provenance: 'simulated known test footage; requires real Resolve import', cases: manifest }, null, 2));
console.log('Generated four native-import fixtures (30/60 fps NDF, zero and one-hour starts).');
