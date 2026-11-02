import type { Bookmark, CoverageGap, Session } from './types.ts';

function csvCell(value: unknown) {
  let text = String(value ?? '');
  // Quote escaping alone does not stop spreadsheet formulas, including whitespace-prefixed formulas.
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
const iso = (ms: number | null) => ms === null ? '' : new Date(ms).toISOString();
export function exportCsv(bookmarks: Bookmark[]) {
  const rows: unknown[][] = [[
    'id', 'signal', 'tier', 'source_timestamp', 'received_at', 'burst_onset', 'confirmed_at',
    'detected_seconds', 'suggested_seconds', 'editor_seconds', 'caption', 'reason', 'caption_status', 'settings_revision',
  ]];
  for (const b of bookmarks) rows.push([b.id, b.signal, b.tier, iso(b.sourceTimeMs), iso(b.receivedAtMs),
    iso(b.onsetMs), iso(b.confirmedAtMs), b.detectedOffsetSeconds, b.suggestedOffsetSeconds,
    b.editorOffsetSeconds, b.caption, b.reason, b.captionStatus, b.settingsRevision ?? 0]);
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
export function exportJson(session: Session, bookmarks: Bookmark[], coverageGaps: CoverageGap[]) {
  return JSON.stringify({
    schemaVersion: 1,
    editorCompatibility: 'verified-for-resolve-marker-edl',
    editorVerification: {
      application: 'DaVinci Resolve', version: '21.1.1.10',
      fps: [30, 60], timecodeMode: 'non-drop-frame',
      timelineStarts: ['00:00:00:00', '01:00:00:00'],
      scope: 'Known-footage marker import: count, frames, names, notes, colors and durations',
      liveStreamAlignment: 'unverified',
      evidence: 'evidence/checkpoint-2/resolve/actual-import-results.txt',
    },
    session, coverageGaps, bookmarks,
  }, null, 2) + '\n';
}
export { exportResolveEdl } from './resolve-edl.ts';
