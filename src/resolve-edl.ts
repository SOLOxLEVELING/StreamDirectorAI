import type { Bookmark } from './types.ts';

export interface EdlOptions { fps: number; timelineStartTimecode: string; title?: string }
export function supportedFps(fps: number): 30 | 60 {
  if (fps !== 30 && fps !== 60) throw new Error('Resolve EDL requires explicitly selected 30 or 60 fps non-drop-frame; other rates are unsupported');
  return fps;
}
export function timecodeFrames(value: string, fps: number) {
  supportedFps(fps);
  if (!/^\d{2}:\d{2}:\d{2}:\d{2}$/.test(value)) throw new Error('Timeline start must be HH:MM:SS:FF non-drop-frame');
  const [h, m, s, f] = value.split(':').map(Number) as [number, number, number, number];
  if (h > 23 || m > 59 || s > 59 || f >= fps) throw new Error('Invalid non-drop-frame timeline start');
  return ((h * 60 + m) * 60 + s) * fps + f;
}
export function frameTimecode(frame: number, fps: number) {
  supportedFps(fps);
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= 86400 * fps) throw new Error('EDL timecode exceeds supported 24-hour range');
  const f = frame % fps, total = Math.floor(frame / fps), s = total % 60, m = Math.floor(total / 60) % 60, h = Math.floor(total / 3600);
  return [h, m, s, f].map(n => String(n).padStart(2, '0')).join(':');
}
export function markerText(value: string, limit: number) {
  // Real Resolve sample places note before |C:, then |M: name and |D: duration.
  // Never allow text to inject these fields or another EDL record. Full original remains in CSV/JSON.
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\|/g, '/')
    .replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}
export function exportResolveEdl(bookmarks: Bookmark[], options: EdlOptions) {
  const fps = supportedFps(options.fps);
  const start = timecodeFrames(options.timelineStartTimecode, fps);
  if (bookmarks.length > 999) throw new Error('Resolve marker EDL supports at most 999 bookmarks per file; use CSV/JSON for complete records');
  const rows = bookmarks.map(bookmark => {
    const offset = bookmark.editorOffsetSeconds;
    if (!Number.isFinite(offset) || offset < 0) throw new Error('Bookmark editor offset must be finite and non-negative');
    const frame = Math.round(offset * fps);
    if (!Number.isSafeInteger(frame)) throw new Error('Bookmark offset exceeds frame range');
    return { bookmark, frame };
  }).sort((a, b) => a.frame - b.frame || a.bookmark.id.localeCompare(b.bookmark.id));
  const seen = new Set<number>();
  const lines = [`TITLE: ${markerText(options.title ?? 'StreamDirector AI', 80)}`, 'FCM: NON-DROP FRAME', ''];
  for (const [index, { bookmark: b, frame }] of rows.entries()) {
    if (seen.has(frame)) throw new Error('Multiple bookmarks map to the same timeline frame; Resolve stores one marker per frame. Export a selection or adjust alignment/lead-in; CSV/JSON preserve all records.');
    seen.add(frame);
    const input = frameTimecode(start + frame, fps), output = frameTimecode(start + frame + 1, fps);
    const name = markerText(b.caption, 80) || 'Suggested bookmark';
    const note = markerText(`${b.signal}: ${b.reason} [${b.id}]`, 240);
    const color = b.tier === 'banner' ? 'ResolveColorGreen' : 'ResolveColorBlue';
    lines.push(`${String(index + 1).padStart(3, '0')}  001      V     C        ${input} ${output} ${input} ${output}  `,
      `${note} |C:${color} |M:${name} |D:1`, '');
  }
  return lines.join('\r\n') + '\r\n';
}
