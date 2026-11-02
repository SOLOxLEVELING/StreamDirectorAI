import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { Store } from '../src/store.ts';
import { replay } from '../src/replay.ts';
import type { Fixture } from '../src/replay.ts';
import { exportCsv, exportJson } from '../src/exports.ts';

for (const name of readdirSync(new URL('./fixtures/', import.meta.url)).filter(n => n.endsWith('.json'))) {
  test(`fixture ${name}: explicit outputs and identical repeat replay`, () => {
    const fixture = JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as Fixture;
    const run = () => {
      const store = new Store(':memory:');
      try {
        const result = replay(fixture, store);
        assert.deepEqual(result.bookmarks.map(({ signal, onsetMs, confirmedAtMs, tier }) =>
          ({ signal, onsetMs, confirmedAtMs, tier })), fixture.expected);
        return { result, csv: exportCsv(result.bookmarks), json: exportJson(result.session, result.bookmarks, result.gaps) };
      } finally { store.close(); }
    };
    assert.deepEqual(run(), run());
  });
}
test('replay processes final partial-second events and rejects events outside its interval', () => {
  const store = new Store(':memory:');
  const fixture: Fixture = { name: 'partial', startedAtMs: 0, streamStartedAtMs: 0, endAtMs: 1500,
    events: [{ type: 'manual', sourceId: 's', transportId: 't', sourceTimeMs: 1250, receivedAtMs: 1250 }], expected: [] };
  try {
    assert.equal(replay(fixture, store).bookmarks[0]!.onsetMs, 1250);
    assert.throws(() => replay({ ...fixture, endAtMs: 1000 }, store), /Invalid replay interval/);
  } finally { store.close(); }
});
