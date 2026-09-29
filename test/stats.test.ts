import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fetchStats, installerKey, cmpVersion } from '../src/lib/stats.js';
import { APP, EXT, MERGE, FALLBACK_COUNTS } from '../src/consts.js';

// src/lib/stats.ts reads GitHub, Open VSX and the Marketplace at build time
// and in api/stats.ts. No network here: fetch is injected. The promise pinned
// below is that a dead or lying source NEVER fails a build or the API — it
// answers with the consts.ts fallback — and that a live answer is read right.
// Run: npm run test:stats

const json = (body: unknown, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });

const asset = (name: string, download_count = 1, size = 3_142_405, digest?: string) => ({
	name,
	size,
	download_count,
	digest: digest ?? null,
	browser_download_url: `https://github.com/GitStudioHQ/gitstudio/releases/download/${name.includes('vsix') ? 'ext' : 'app'}/${name}`,
});
const rel = (tag: string, assets: ReturnType<typeof asset>[], draft = false) => ({
	tag_name: tag,
	draft,
	prerelease: false,
	html_url: `https://github.com/GitStudioHQ/gitstudio/releases/tag/${tag}`,
	assets: assets.map((a) => ({ ...a, browser_download_url: a.browser_download_url.replace(/\/(ext|app)\//, `/${tag}/`) })),
});
const appAssets = (v: string, n = 10) => [
	asset(`GitStudio-${v}-arm64.dmg`, n),
	asset(`GitStudio-${v}-x64.dmg`, n),
	asset(`GitStudio-Setup-${v}.exe`, n),
	asset(`GitStudio-Setup-${v}.exe.blockmap`, 999), // not an installer: not counted
	asset('latest.yml', 999), // not an installer: not counted
	asset(`GitStudio-${v}-x86_64.AppImage`, n),
	asset('SHA256SUMS.txt', 999),
];

/** A world where every source answers. */
function liveFetch(overrides: Record<string, () => Response> = {}): typeof fetch {
	return (async (input: RequestInfo | URL) => {
		const url = String(input);
		for (const [k, v] of Object.entries(overrides)) if (url.includes(k)) return v();
		if (url.includes('/repos/GitStudioHQ/gitstudio/releases'))
			return json([
				rel('app-v9.1.0', appAssets('9.1.0').filter((a) => a.name !== 'SHA256SUMS.txt')), // still uploading: skipped
				rel('app-v9.2.0', appAssets('9.2.0'), true), // draft: skipped
				rel('ext-v5.0.0', [asset('gitstudio.vsix', 3, 4_200_000, 'sha256:' + 'ab'.repeat(32))]),
				rel('app-v9.0.0', appAssets('9.0.0', 10)),
				rel('app-v8.9.9', appAssets('8.9.9', 5)),
				rel('ext-v4.9.0', [asset('gitstudio.vsix', 1)]),
			]);
		if (url.includes('/repos/GitStudioHQ/merge-studio/releases'))
			return json([rel('v3.0.0', [{ ...asset('merge-studio.vsix', 1, 3_155_202) }])]);
		if (url.includes('open-vsx.org/api/gitstudio/gitstudio')) return json({ version: '5.0.0', downloadCount: 12345 });
		if (url.includes('open-vsx.org/api/gitstudio/merge-studio')) return json({ version: '3.0.0', downloadCount: 2999 });
		if (url.includes('marketplace.visualstudio.com'))
			return json({
				results: [
					{
						extensions: [
							{ publisher: { publisherName: 'gitstudio' }, extensionName: 'gitstudio', versions: [{ version: '5.0.0' }], statistics: [{ statisticName: 'install', value: 1234 }, { statisticName: 'averagerating', value: 4.5 }, { statisticName: 'ratingcount', value: 7 }] },
							{ publisher: { publisherName: 'gitstudio' }, extensionName: 'merge-studio', versions: [{ version: '3.0.0' }], statistics: [{ statisticName: 'install', value: 777 }, { statisticName: 'averagerating', value: 5 }] },
						],
					},
				],
			});
		if (url.includes('raw.githubusercontent.com/GitStudioHQ/gitstudio/ext-v5.0.0/apps/extension/package.json'))
			return json({ engines: { vscode: '^1.90.0' }, contributes: { commands: new Array(150).fill({}) } });
		if (url.includes('raw.githubusercontent.com/GitStudioHQ/merge-studio/v3.0.0/package.json'))
			return json({ engines: { vscode: '^1.85.0' }, contributes: { commands: new Array(14).fill({}) } });
		return new Response('not found', { status: 404 });
	}) as typeof fetch;
}

test('installer keys are stable across versions', () => {
	assert.equal(installerKey('GitStudio-2.3.0-arm64.dmg', '2.3.0'), 'arm64.dmg');
	assert.equal(installerKey('GitStudio-Setup-2.3.0.exe', '2.3.0'), 'setup.exe');
	assert.equal(installerKey('GitStudio-2.3.0-x86_64.AppImage', '2.3.0'), 'x86_64.appimage');
	assert.equal(installerKey('GitStudio-2.3.0-x64.tar.gz', '2.3.0'), 'x64.tar.gz');
	// Every row of the consts matrix has a distinct key.
	const keys = APP.downloads.map((d) => installerKey(d.url.slice(d.url.lastIndexOf('/') + 1), APP.version));
	assert.equal(new Set(keys).size, APP.downloads.length);
});

test('versions compare numerically', () => {
	assert.ok(cmpVersion('1.10.0', '1.9.0') > 0);
	assert.ok(cmpVersion('2.0.0', '10.0.0') < 0);
	assert.equal(cmpVersion('1.2.3', '1.2.3'), 0);
});

test('a live answer is read right', async () => {
	const s = await fetchStats({ fetch: liveFetch(), githubToken: '' });
	assert.deepEqual(s.live, { github: true, mergeStudioGithub: true, openVsx: true, marketplace: true, manifest: true });
	assert.deepEqual(s.stale, []);
	// Newest PUBLISHED app release with its checksums: not the draft, not the one still uploading.
	assert.equal(s.app.version, '9.0.0');
	assert.equal(s.text['app.minor'], '9.0');
	// Installers only, all app-v* releases (drafts aside): 4 files × 10 + 4 × 5 + the 9.1.0 one still uploading (4 × 10).
	assert.equal(s.app.downloads, 100);
	assert.equal(s.href['app.asset.arm64.dmg'], 'https://github.com/GitStudioHQ/gitstudio/releases/download/app-v9.0.0/GitStudio-9.0.0-arm64.dmg');
	assert.equal(s.href['app.asset.setup.exe'], 'https://github.com/GitStudioHQ/gitstudio/releases/download/app-v9.0.0/GitStudio-Setup-9.0.0.exe');
	// A matrix row the release has no file for goes to the release page, never a 404.
	assert.equal(s.href['app.asset.amd64.deb'], 'https://github.com/GitStudioHQ/gitstudio/releases/tag/app-v9.0.0');
	assert.equal(s.href['app.sums'], 'https://github.com/GitStudioHQ/gitstudio/releases/download/app-v9.0.0/SHA256SUMS.txt');

	assert.equal(s.text['ext.version'], '5.0.0');
	assert.equal(s.text['ext.installs'], '1,234');
	assert.equal(s.text['ext.downloads'], '12,345');
	assert.equal(s.text['ext.rating'], '4.5');
	assert.equal(s.text['ext.commands'], '150');
	assert.equal(s.text['ext.minVsCode'], '1.90');
	assert.equal(s.text['ext.vsixSize'], '4.2');
	assert.equal(s.text['ext.sha256'], 'ab'.repeat(32));
	assert.equal(s.href['ext.vsix'], 'https://github.com/GitStudioHQ/gitstudio/releases/download/ext-v5.0.0/gitstudio.vsix');

	assert.equal(s.text['ms.version'], '3.0.0');
	assert.equal(s.text['ms.installs'], '777');
	assert.equal(s.text['ms.downloads'], '2,999');
	assert.equal(s.text['ms.minVsCode'], '1.85');
	assert.equal(s.text['ms.vsixSize'], '3.2');
});

test('the registries name the extension version, even before GitHub has the VSIX', async () => {
	const s = await fetchStats({
		fetch: liveFetch({ 'open-vsx.org/api/gitstudio/gitstudio': () => json({ version: '5.0.1', downloadCount: 1 }) }),
		githubToken: '',
	});
	assert.equal(s.text['ext.version'], '5.0.1');
	// No ext-v5.0.1 release: the newest VSIX there is is still offered.
	assert.equal(s.href['ext.vsix'], 'https://github.com/GitStudioHQ/gitstudio/releases/download/ext-v5.0.0/gitstudio.vsix');
	// ...and its manifest still gives the command count, not the consts fallback.
	assert.equal(s.text['ext.commands'], '150');
});

/** What a total outage must render: exactly the consts.ts values, counts marked "+". */
function assertFallback(s: Awaited<ReturnType<typeof fetchStats>>) {
	assert.deepEqual(s.live, { github: false, mergeStudioGithub: false, openVsx: false, marketplace: false, manifest: false });
	// Every key is marked, so the client never replaces a build-time value with an older fallback.
	assert.deepEqual([...s.stale].sort(), [...Object.keys(s.text), ...Object.keys(s.href)].sort());
	assert.equal(s.text['ext.version'], EXT.version);
	assert.equal(s.text['ext.commands'], String(EXT.commands));
	assert.equal(s.text['ext.minVsCode'], EXT.minVsCode);
	assert.equal(s.text['ext.sha256'], EXT.vsixSha256);
	assert.equal(s.text['ext.vsixSize'], EXT.vsixSizeMb);
	assert.equal(s.text['ext.installs'], `${FALLBACK_COUNTS.ext.marketplaceInstalls.toLocaleString('en-US')}+`);
	assert.equal(s.text['ext.downloads'], `${FALLBACK_COUNTS.ext.openVsxDownloads.toLocaleString('en-US')}+`);
	assert.equal(s.text['ms.version'], MERGE.version);
	assert.equal(s.text['ms.downloads'], `${FALLBACK_COUNTS.ms.openVsxDownloads.toLocaleString('en-US')}+`);
	assert.equal(s.text['app.version'], APP.version);
	assert.equal(s.text['app.downloads'], `${FALLBACK_COUNTS.app.downloads.toLocaleString('en-US')}+`);
	assert.equal(s.href['ext.vsix'], EXT.vsixPath);
	assert.equal(s.href['app.release'], APP.releaseUrl);
	assert.equal(s.href['app.sums'], APP.sumsUrl);
	assert.deepEqual(
		s.app.installers.map((i) => i.url),
		APP.downloads.map((d) => d.url),
	);
}

test('fetch throwing everywhere falls back to consts.ts', async () => {
	const warn = console.warn;
	console.warn = () => {};
	try {
		const s = await fetchStats({ fetch: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch, githubToken: '' });
		assertFallback(s);
	} finally {
		console.warn = warn;
	}
});

test('every source answering 500 or garbage falls back to consts.ts', async () => {
	const warn = console.warn;
	console.warn = () => {};
	try {
		assertFallback(await fetchStats({ fetch: (async () => new Response('oops', { status: 503 })) as typeof fetch, githubToken: '' }));
		assertFallback(await fetchStats({ fetch: (async () => json({ message: 'rate limited' })) as typeof fetch, githubToken: '' }));
	} finally {
		console.warn = warn;
	}
});

test('one source down marks exactly its keys stale', async () => {
	const warn = console.warn;
	console.warn = () => {};
	try {
		const s = await fetchStats({
			fetch: liveFetch({ '/repos/GitStudioHQ/gitstudio/releases': () => new Response('rate limited', { status: 403 }) }),
			githubToken: '',
		});
		assert.equal(s.live.github, false);
		// Desktop facts and the VSIX come from GitHub: stale, left alone by the client.
		for (const k of ['app.version', 'app.minor', 'app.downloads', 'app.release', 'app.sums', 'app.asset.arm64.dmg', 'ext.vsix', 'ext.sha256', 'ext.vsixSize'])
			assert.ok(s.stale.includes(k), k);
		// The registries still answered: those stay live.
		for (const k of ['ext.version', 'ext.installs', 'ext.downloads', 'ms.version', 'ms.vsix', 'ext.commands']) assert.ok(!s.stale.includes(k), k);
	} finally {
		console.warn = warn;
	}
});

test('a refused GitHub token is retried without it', async () => {
	const seen: (string | null)[] = [];
	const base = liveFetch();
	const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.includes('api.github.com')) {
			const auth = new Headers(init?.headers).get('authorization');
			seen.push(auth);
			if (auth) return new Response('bad credentials', { status: 401 });
		}
		return base(input, init);
	}) as typeof fetch;
	const s = await fetchStats({ fetch: f, githubToken: 'revoked' });
	assert.equal(s.live.github, true);
	assert.ok(seen.includes('Bearer revoked') && seen.includes(null));
});

test('STATS_OFFLINE=1 never touches the network', async () => {
	process.env.STATS_OFFLINE = '1';
	try {
		const s = await fetchStats({ fetch: (() => { throw new Error('network touched'); }) as unknown as typeof fetch });
		assertFallback(s);
	} finally {
		delete process.env.STATS_OFFLINE;
	}
});
