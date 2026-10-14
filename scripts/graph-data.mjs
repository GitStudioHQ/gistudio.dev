// Regenerate public/vendor/graph-data.json, the history the home page's live
// <gitstudio-graph> draws, from GitStudio's real public history.
//
//   npm run graph-data -- --repo ../GitStudioHQ/gitstudio
//   npm run graph-data -- --repo <path> --ref origin/main --count 106
//
// It runs the same pipeline the desktop app does — `git log --parents
// --date-order` → computeGraphLayout (packages/engine) → buildWireRows
// (packages/host-bridge) — with the engine source read out of the repository
// AT --ref via `git show`, so the checkout's working tree and branch are never
// touched. Only public data goes in: the walk is --ref alone (no local
// branches, no stash, no notes), and the only ref chips are main, origin/main
// and the release tags that point into the window.
import { transform } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const arg = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const repo = arg('repo');
const ref = arg('ref', 'origin/main');
const count = Number(arg('count', '106'));
if (!repo || !Number.isInteger(count) || count < 1) {
	console.error('usage: node scripts/graph-data.mjs --repo <gitstudio checkout> [--ref origin/main] [--count 106]');
	process.exit(2);
}
// Release tags only: ext-v* (extension), app-v* (desktop).
const PUBLIC_TAG = /^(ext|app)-v\d+\.\d+\.\d+$/;

const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });

// ── the engine, as it is at --ref ────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'gs-graph-'));
let engine;
try {
	for (const [src, out] of [
		['packages/engine/src/graph/layout.ts', 'layout.mjs'],
		['packages/host-bridge/src/graphWire.ts', 'graphWire.mjs'],
	]) {
		const { code } = await transform(git('show', `${ref}:${src}`), { loader: 'ts', format: 'esm' });
		writeFileSync(join(dir, out), code);
	}
	engine = {
		...(await import(pathToFileURL(join(dir, 'layout.mjs')).href)),
		...(await import(pathToFileURL(join(dir, 'graphWire.mjs')).href)),
	};
} finally {
	rmSync(dir, { recursive: true, force: true });
}

// ── the commits ──────────────────────────────────────────────────────────────
const F = '\x1f';
const R = '\x1e';
const log = git('log', '--parents', '--date-order', `--max-count=${count}`, `--pretty=format:%H${F}%P${F}%an${F}%ae${F}%at${F}%s${R}`, ref);
const commits = [];
const records = new Map();
for (const raw of log.split(R)) {
	const line = raw.replace(/^\n/, '');
	if (!line) continue;
	const [sha, parents, author, authorEmail, at, subject] = line.split(F);
	commits.push({ sha, parents: parents ? parents.split(' ') : [] });
	records.set(sha, { subject, author, authorEmail, authorDate: Number(at) });
}

// ── the refs ─────────────────────────────────────────────────────────────────
const head = git('rev-parse', `${ref}^{commit}`).trim();
const refsBySha = new Map();
const addRef = (sha, r) => {
	if (!records.has(sha)) return;
	refsBySha.set(sha, [...(refsBySha.get(sha) ?? []), r]);
};
addRef(head, { type: 'head', name: 'main', fullName: 'refs/heads/main', isCurrent: true });
addRef(head, { type: 'remote', name: 'origin/main', fullName: 'refs/remotes/origin/main', isCurrent: false });
for (const line of git('for-each-ref', '--format=%(refname:strip=2)%09%(objectname)%09%(*objectname)', 'refs/tags').split('\n')) {
	const [name, sha, peeled] = line.split('\t');
	if (name && PUBLIC_TAG.test(name)) {
		addRef(peeled || sha, { type: 'tag', name, fullName: `refs/tags/${name}`, isCurrent: false });
	}
}

// ── lay it out, exactly as a host does ───────────────────────────────────────
const layout = engine.computeGraphLayout(commits);
const rows = engine.buildWireRows({ rows: layout.rows, records, refsBySha });
const data = { head, totalColumns: layout.totalColumns, hasMore: false, rows };

const outFile = fileURLToPath(new URL('../public/vendor/graph-data.json', import.meta.url));
writeFileSync(outFile, JSON.stringify(data));
const tags = rows.flatMap((r) => r.refs.filter((x) => x.kind === 'tag').map((x) => x.name));
console.log(
	`graph-data.json: ${rows.length} commits, ${layout.totalColumns} lanes, ${rows.filter((r) => r.isMerge).length} merges, ` +
		`${new Date(rows.at(-1).authorDate * 1000).toISOString().slice(0, 10)} → ${new Date(rows[0].authorDate * 1000).toISOString().slice(0, 10)}, ` +
		`tags: ${tags.join(' ') || 'none'}`,
);
