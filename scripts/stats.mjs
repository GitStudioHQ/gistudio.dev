// Runs a TypeScript entry that imports src/lib/stats.ts, by bundling it with
// esbuild (Astro's own dependency) into a temp file and executing that.
//   node scripts/stats.mjs          → live APIs: print what the site would show
//   node scripts/stats.mjs --test   → test/stats.test.ts (mocked fetch, no network)
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const entry = process.argv.includes('--test') ? 'test/stats.test.ts' : 'test/stats.live.ts';
const dir = mkdtempSync(join(tmpdir(), 'gs-stats-'));
const out = join(dir, 'run.mjs');
try {
	await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'warning' });
	const r = spawnSync(process.execPath, [out], { stdio: 'inherit' });
	process.exitCode = r.status ?? 1;
} finally {
	rmSync(dir, { recursive: true, force: true });
}
