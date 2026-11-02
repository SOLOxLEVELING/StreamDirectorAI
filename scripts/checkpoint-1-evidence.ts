import { readdirSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Exercise the actual CLI and retain every fixture's CSV/JSON, including empty impulse results.
const evidence = 'evidence/checkpoint-1';
mkdirSync(evidence, { recursive: true });
const logs: string[] = [];
for (const name of readdirSync('test/fixtures').filter(n => n.endsWith('.json')).sort()) {
  const fixture = name.slice(0, -5);
  const output = join('output/checkpoint-1', fixture);
  const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/replay.ts',
    join('test/fixtures', name), output], { encoding: 'utf8' });
  const log = `Fixture: ${name}\nExit: ${result.status}\n${result.stdout}${result.stderr}`;
  logs.push(log);
  if (result.error || result.status !== 0) throw result.error ?? new Error(log);
  const target = join(evidence, fixture);
  mkdirSync(target, { recursive: true });
  for (const file of ['bookmarks.csv', 'bookmarks.json']) copyFileSync(join(output, file), join(target, file));
}
writeFileSync(join(evidence, 'replay-results.txt'), logs.join('\n'));
console.log(`Generated actual CLI exports for ${logs.length} simulated fixtures.`);
