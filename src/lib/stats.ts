/**
 * Live product facts: versions, install and download counts, command counts,
 * and the installer / VSIX URLs of the newest releases.
 *
 * One fetcher, used in two places:
 *   - at BUILD time, by the pages (`await getStats()` in frontmatter), so the
 *     static HTML already carries the newest numbers;
 *   - at REQUEST time, by api/stats.ts (`fetchStats()`), which the client
 *     script in src/components/LiveStats.astro reads after the page loads, so
 *     numbers move between deploys without a rebuild.
 *
 * Sources:
 *   GitHub Releases  GitStudioHQ/gitstudio  newest ext-v* (VSIX url, size, sha256)
 *                                           newest app-v* (installers), and the
 *                                           download count summed over every
 *                                           app-v* installer ever published
 *                    GitStudioHQ/merge-studio  newest v* (VSIX url, size)
 *   raw package.json at the ext-v* / v* tag  contributes.commands, engines.vscode
 *   Open VSX         /api/gitstudio/<name>   version, downloadCount
 *   VS Code Marketplace extensionquery       version, install, averagerating
 *
 * Every call has a timeout, and anything that fails falls back to the
 * checked-by-hand values in src/consts.ts — a build never fails, and the API
 * never errors, because a registry is down. Counts that come from the fallback
 * are shown with a trailing "+", since a hand-checked count is a lower bound.
 *
 * The data-live contract (see LiveStats.astro): an element that shows a live
 * fact carries data-live="<key>" with `stats.text[key]` as its text; a link
 * whose target moves with a release carries data-live-href="<key>" with
 * `stats.href[key]` as its href. The keys are listed on `TextKey` / `HrefKey`.
 *
 * Imports carry `.js` so the same file runs under Vite (Astro), under Vercel's
 * Node ESM function runtime (api/stats.ts), and under esbuild (the tests).
 */
import { APP, EXT, MERGE, FALLBACK_COUNTS } from '../consts.js';

const GH_API = 'https://api.github.com';
const GH_RAW = 'https://raw.githubusercontent.com';
const APP_REPO = 'GitStudioHQ/gitstudio';
const MS_REPO = 'GitStudioHQ/merge-studio';
const OPENVSX = 'https://open-vsx.org/api/gitstudio';
const MARKETPLACE = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';
const TIMEOUT_MS = 6000;
const MAX_RELEASE_PAGES = 5;

/** An installer file on the newest app-v* release. */
export interface Installer {
	os: string;
	arch: string;
	format: string;
	/** Stable key: the file name without "GitStudio-" and the version, lowercased, e.g. "arm64.dmg", "setup.exe". */
	key: string;
	url: string;
}

export interface Stats {
	/** ISO time the numbers were read. */
	fetchedAt: string;
	/** Which sources answered. A false one means its values are consts.ts fallbacks. */
	live: { github: boolean; mergeStudioGithub: boolean; openVsx: boolean; marketplace: boolean; manifest: boolean };
	ext: {
		version: string;
		/** Microsoft Marketplace "install" statistic. */
		marketplaceInstalls: number;
		/** Open VSX downloadCount (counts every VSIX download, updates included). */
		openVsxDownloads: number;
		rating: number;
		ratingCount: number;
		/** contributes.commands in the shipped package.json. */
		commands: number;
		/** engines.vscode minimum, "1.78". */
		minVsCode: string;
		vsix: { url: string; file: string; sizeMb: string; sha256: string; tag: string };
	};
	ms: {
		version: string;
		marketplaceInstalls: number;
		openVsxDownloads: number;
		rating: number;
		ratingCount: number;
		commands: number;
		minVsCode: string;
		vsix: { url: string; sizeMb: string; tag: string };
	};
	app: {
		version: string;
		/** "2.3" — the announce strip and the hero eyebrow speak in minors. */
		minor: string;
		tag: string;
		releaseUrl: string;
		sumsUrl: string;
		/** Every download of an installer, summed over all app-v* releases. */
		downloads: number;
		/** The curated matrix from consts.ts APP.downloads, with live URLs. */
		installers: Installer[];
	};
	/** data-live="<key>" → the text to show. */
	text: Record<TextKey, string>;
	/** data-live-href="<key>" → the URL. Includes one app.asset.<key> per installer. */
	href: Record<string, string>;
	/**
	 * The text/href keys whose value is a consts.ts fallback, not a live read.
	 * The client leaves those alone: a page built while a source was up already
	 * shows something newer than the fallback.
	 */
	stale: string[];
}

export type TextKey =
	| 'ext.version'
	| 'ext.installs'
	| 'ext.downloads'
	| 'ext.rating'
	| 'ext.commands'
	| 'ext.minVsCode'
	| 'ext.vsixSize'
	| 'ext.sha256'
	| 'ms.version'
	| 'ms.installs'
	| 'ms.downloads'
	| 'ms.rating'
	| 'ms.minVsCode'
	| 'ms.vsixSize'
	| 'app.version'
	| 'app.minor'
	| 'app.downloads';

export type HrefKey = 'ext.vsix' | 'ms.vsix' | 'app.release' | 'app.sums' | `app.asset.${string}`;

// ── helpers ──────────────────────────────────────────────────────────────────

/** "8738" → "8,738". */
export const fmtCount = (n: number) => Math.max(0, Math.floor(n)).toLocaleString('en-US');

/** Bytes → "3.1" (decimal MB, the way the site has always printed sizes). */
export const fmtMb = (bytes: number) => (bytes / 1e6).toFixed(1);

/** Numeric x.y.z compare; anything with a pre-release suffix is ignored by callers. */
export function cmpVersion(a: string, b: string): number {
	const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
	const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d) return d;
	}
	return 0;
}

const STABLE = /^\d+\.\d+\.\d+$/;

/** The newest stable version among candidates, or undefined. */
function newest(...vs: (string | undefined)[]): string | undefined {
	return vs.filter((v): v is string => !!v && STABLE.test(v)).sort(cmpVersion).pop();
}

/** "^1.78.0" → "1.78". */
const minEngine = (range: unknown) => {
	const m = typeof range === 'string' ? range.match(/(\d+)\.(\d+)/) : null;
	return m ? `${m[1]}.${m[2]}` : undefined;
};

/** Installer file name → stable key: "GitStudio-2.3.0-arm64.dmg" → "arm64.dmg", "GitStudio-Setup-2.3.0.exe" → "setup.exe". */
export function installerKey(fileName: string, version: string): string {
	return fileName
		.replace(/^GitStudio-/, '')
		.replace(`${version}-`, '')
		.replace(`-${version}`, '')
		.toLowerCase();
}

const INSTALLER = /\.(dmg|zip|exe|deb|rpm|AppImage|tar\.gz)$/;

const fileOf = (url: string) => decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));

type Fetch = typeof fetch;

interface GhAsset {
	name: string;
	size: number;
	download_count: number;
	browser_download_url: string;
	digest?: string | null;
}
interface GhRelease {
	tag_name: string;
	draft: boolean;
	prerelease: boolean;
	html_url: string;
	assets: GhAsset[];
}

function ghHeaders(token: string | undefined): Record<string, string> {
	const h: Record<string, string> = {
		accept: 'application/vnd.github+json',
		'x-github-api-version': '2022-11-28',
		'user-agent': 'gitstudio.dev-stats',
	};
	if (token) h.authorization = `Bearer ${token}`;
	return h;
}

async function getJson(f: Fetch, url: string, init: RequestInit = {}): Promise<{ body: unknown; res: Response }> {
	const res = await f(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
	if (!res.ok) throw new Error(`${res.status} ${url}`);
	return { body: await res.json(), res };
}

/**
 * GET a GitHub API URL. With a token first; if GitHub refuses the token (a
 * revoked or expired PAT), once more without it — public data needs none.
 */
async function ghJson(f: Fetch, url: string, token: string | undefined) {
	try {
		return await getJson(f, url, { headers: ghHeaders(token) });
	} catch (e) {
		if (token && /^40[13] /.test(String((e as Error).message))) return getJson(f, url, { headers: ghHeaders(undefined) });
		throw e;
	}
}

async function ghReleases(f: Fetch, repo: string, token: string | undefined, pages = MAX_RELEASE_PAGES): Promise<GhRelease[]> {
	const out: GhRelease[] = [];
	let url: string | undefined = `${GH_API}/repos/${repo}/releases?per_page=100`;
	for (let i = 0; url && i < pages; i++) {
		const { body, res } = await ghJson(f, url, token);
		if (!Array.isArray(body)) throw new Error(`releases: not a list (${repo})`);
		out.push(...(body as GhRelease[]));
		url = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
	}
	return out.filter((r) => !r.draft && !r.prerelease);
}

/** The newest release whose tag is `${prefix}x.y.z` and that has an asset passing `ready`. */
function newestRelease(rels: GhRelease[], prefix: string, ready: (r: GhRelease) => boolean) {
	let best: { rel: GhRelease; version: string } | undefined;
	for (const rel of rels) {
		if (!rel.tag_name.startsWith(prefix)) continue;
		const version = rel.tag_name.slice(prefix.length);
		if (!STABLE.test(version) || !ready(rel)) continue;
		if (!best || cmpVersion(version, best.version) > 0) best = { rel, version };
	}
	return best;
}

interface RegistryFacts {
	version?: string;
	count?: number;
	rating?: number;
	ratingCount?: number;
}

async function openVsx(f: Fetch, name: string): Promise<RegistryFacts> {
	const { body } = await getJson(f, `${OPENVSX}/${name}`, { headers: { accept: 'application/json' } });
	const b = body as { version?: string; downloadCount?: number };
	if (typeof b.downloadCount !== 'number') throw new Error(`open vsx: no downloadCount for ${name}`);
	return { version: b.version, count: b.downloadCount };
}

async function marketplace(f: Fetch, ids: string[]): Promise<Record<string, RegistryFacts>> {
	const { body } = await getJson(f, MARKETPLACE, {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/json;api-version=7.2-preview.1' },
		body: JSON.stringify({
			filters: [{ criteria: ids.map((value) => ({ filterType: 7, value })), pageSize: ids.length }],
			// IncludeVersions | IncludeFiles | IncludeVersionProperties | IncludeAssetUri | IncludeStatistics | IncludeLatestVersionOnly
			flags: 914,
		}),
	});
	const exts = (body as { results?: { extensions?: unknown[] }[] }).results?.[0]?.extensions ?? [];
	const out: Record<string, RegistryFacts> = {};
	for (const raw of exts as {
		publisher: { publisherName: string };
		extensionName: string;
		versions?: { version: string }[];
		statistics?: { statisticName: string; value: number }[];
	}[]) {
		const stat = (n: string) => raw.statistics?.find((s) => s.statisticName === n)?.value;
		const id = `${raw.publisher.publisherName}.${raw.extensionName}`.toLowerCase();
		out[id] = { version: raw.versions?.[0]?.version, count: stat('install'), rating: stat('averagerating'), ratingCount: stat('ratingcount') };
	}
	if (!Object.keys(out).length) throw new Error('marketplace: no extensions in the answer');
	return out;
}

async function manifest(f: Fetch, repo: string, ref: string, path: string) {
	const { body } = await getJson(f, `${GH_RAW}/${repo}/${encodeURIComponent(ref)}/${path}`);
	const pkg = body as { version?: string; engines?: { vscode?: string }; contributes?: { commands?: unknown[] } };
	const commands = pkg.contributes?.commands?.length;
	if (!commands) throw new Error(`manifest: no commands in ${repo}@${ref}`);
	return { commands, minVsCode: minEngine(pkg.engines?.vscode) };
}

/** Run a source; on any failure log one line (build logs / function logs) and answer undefined. */
async function soft<T>(label: string, p: () => Promise<T>): Promise<T | undefined> {
	try {
		return await p();
	} catch (e) {
		console.warn(`[stats] ${label} unavailable, using consts.ts: ${(e as Error).message}`);
		return undefined;
	}
}

// ── the fetcher ──────────────────────────────────────────────────────────────

export interface FetchOptions {
	/** Injected for tests; defaults to the global fetch. */
	fetch?: Fetch;
	/** Defaults to process.env.GITHUB_TOKEN. */
	githubToken?: string;
}

/** Read every source now. Never throws. */
export async function fetchStats(opts: FetchOptions = {}): Promise<Stats> {
	const f = opts.fetch ?? globalThis.fetch;
	const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
	// STATS_OFFLINE=1 skips the network entirely (offline builds, the fallback test).
	const offline = !!env.STATS_OFFLINE;
	const token = opts.githubToken ?? env.GITHUB_TOKEN ?? undefined;
	const on = <T>(label: string, p: () => Promise<T>) => (offline ? Promise.resolve(undefined) : soft(label, p));

	const [rels, msRels, ovsxExt, ovsxMs, market] = await Promise.all([
		on('GitHub releases (gitstudio)', () => ghReleases(f, APP_REPO, token)),
		on('GitHub releases (merge-studio)', () => ghReleases(f, MS_REPO, token, 1)),
		on('Open VSX (gitstudio)', () => openVsx(f, 'gitstudio')),
		on('Open VSX (merge-studio)', () => openVsx(f, 'merge-studio')),
		on('Marketplace', () => marketplace(f, [EXT.id, MERGE.id])),
	]);
	const mkExt = market?.[EXT.id.toLowerCase()];
	const mkMs = market?.[MERGE.id.toLowerCase()];

	// ── extension ──
	// The registries are what `--install-extension` hands out, so they name the
	// version; the GitHub release (attached before publishing) is the fallback.
	const extRel =
		rels &&
		newestRelease(rels, 'ext-v', (r) => r.assets.some((a) => a.name === EXT.vsixFile));
	const extVersion = newest(mkExt?.version, ovsxExt?.version) ?? extRel?.version ?? EXT.version;
	// The VSIX offered for download: the release of that exact version if it
	// has one, else the newest one that does.
	const extVsixRel =
		(rels && newestRelease(rels, 'ext-v', (r) => r.tag_name === `ext-v${extVersion}` && r.assets.some((a) => a.name === EXT.vsixFile))) ?? extRel;
	const vsixAsset = extVsixRel?.rel.assets.find((a) => a.name === EXT.vsixFile);
	const extVsix = vsixAsset
		? {
				url: vsixAsset.browser_download_url,
				file: EXT.vsixFile,
				sizeMb: fmtMb(vsixAsset.size),
				sha256: vsixAsset.digest?.startsWith('sha256:') ? vsixAsset.digest.slice(7) : '',
				tag: extVsixRel!.rel.tag_name,
			}
		: { url: EXT.vsixPath, file: EXT.vsixFile, sizeMb: EXT.vsixSizeMb, sha256: EXT.vsixSha256, tag: `ext-v${EXT.version}` };
	// The command count of the version on the registries; if that tag is not
	// readable, the one of the VSIX offered.
	const extPkg = await on('extension package.json', () =>
		manifest(f, APP_REPO, `ext-v${extVersion}`, 'apps/extension/package.json').catch((e) => {
			if (!extVsixRel || extVsixRel.rel.tag_name === `ext-v${extVersion}`) throw e;
			return manifest(f, APP_REPO, extVsixRel.rel.tag_name, 'apps/extension/package.json');
		}),
	);

	// ── Merge Studio ──
	const msRel = msRels && newestRelease(msRels, 'v', (r) => r.assets.some((a) => a.name.endsWith('.vsix')));
	const msVersion = newest(mkMs?.version, ovsxMs?.version) ?? msRel?.version ?? MERGE.version;
	const msAsset = msRel?.rel.assets.find((a) => a.name.endsWith('.vsix'));
	const msPkg = await on('Merge Studio package.json', () => manifest(f, MS_REPO, `v${msVersion}`, 'package.json'));

	// ── desktop ──
	const appRel =
		rels &&
		// Published with its checksums: finalize-release uploads SHA256SUMS.txt
		// after every installer, and only then un-drafts the release.
		newestRelease(rels, 'app-v', (r) => r.assets.some((a) => a.name === 'SHA256SUMS.txt'));
	const appVersion = appRel?.version ?? APP.version;
	const appTag = `app-v${appVersion}`;
	const appDl = `https://github.com/${APP_REPO}/releases/download/${appTag}`;
	const releaseUrl = appRel?.rel.html_url ?? APP.releaseUrl;
	const liveAssets = new Map(
		(appRel?.rel.assets ?? []).filter((a) => INSTALLER.test(a.name)).map((a) => [installerKey(a.name, appVersion), a.browser_download_url]),
	);
	const installers: Installer[] = APP.downloads.map((d) => {
		const key = installerKey(fileOf(d.url), APP.version);
		// A row the live release has no file for links to the release page, never to a 404.
		const url = appRel ? (liveAssets.get(key) ?? releaseUrl) : d.url;
		return { os: d.os, arch: d.arch, format: d.format, key, url };
	});
	const appDownloads = rels
		? rels
				.filter((r) => r.tag_name.startsWith('app-v'))
				.flatMap((r) => r.assets)
				.filter((a) => INSTALLER.test(a.name))
				.reduce((n, a) => n + a.download_count, 0)
		: undefined;

	const stats = {
		fetchedAt: new Date().toISOString(),
		live: {
			github: !!rels,
			mergeStudioGithub: !!msRels,
			openVsx: !!(ovsxExt && ovsxMs),
			marketplace: !!(mkExt && mkMs),
			manifest: !!(extPkg && msPkg),
		},
		ext: {
			version: extVersion,
			marketplaceInstalls: mkExt?.count ?? FALLBACK_COUNTS.ext.marketplaceInstalls,
			openVsxDownloads: ovsxExt?.count ?? FALLBACK_COUNTS.ext.openVsxDownloads,
			rating: mkExt?.rating ?? FALLBACK_COUNTS.ext.rating,
			ratingCount: mkExt?.ratingCount ?? FALLBACK_COUNTS.ext.ratingCount,
			commands: extPkg?.commands ?? EXT.commands,
			minVsCode: extPkg?.minVsCode ?? EXT.minVsCode,
			vsix: extVsix,
		},
		ms: {
			version: msVersion,
			marketplaceInstalls: mkMs?.count ?? FALLBACK_COUNTS.ms.marketplaceInstalls,
			openVsxDownloads: ovsxMs?.count ?? FALLBACK_COUNTS.ms.openVsxDownloads,
			rating: mkMs?.rating ?? MERGE.marketplaceStars,
			ratingCount: mkMs?.ratingCount ?? FALLBACK_COUNTS.ms.ratingCount,
			commands: msPkg?.commands ?? FALLBACK_COUNTS.ms.commands,
			minVsCode: msPkg?.minVsCode ?? MERGE.minVsCode,
			vsix: msAsset
				? { url: msAsset.browser_download_url, sizeMb: fmtMb(msAsset.size), tag: msRel!.rel.tag_name }
				: { url: `${MERGE.repoUrl}/releases/download/v${MERGE.version}/merge-studio.vsix`, sizeMb: MERGE.vsixSizeMb, tag: `v${MERGE.version}` },
		},
		app: {
			version: appVersion,
			minor: appVersion.split('.').slice(0, 2).join('.'),
			tag: appTag,
			releaseUrl,
			sumsUrl: appRel ? `${appDl}/SHA256SUMS.txt` : APP.sumsUrl,
			downloads: appDownloads ?? FALLBACK_COUNTS.app.downloads,
			installers,
		},
	};

	// A count read live prints exactly; a fallback is a hand-checked lower bound, so it gets a "+".
	const count = (n: number, live: boolean) => `${fmtCount(n)}${live ? '' : '+'}`;
	const text: Record<TextKey, string> = {
		'ext.version': stats.ext.version,
		'ext.installs': count(stats.ext.marketplaceInstalls, !!mkExt?.count),
		'ext.downloads': count(stats.ext.openVsxDownloads, !!ovsxExt),
		'ext.rating': stats.ext.rating.toFixed(1),
		'ext.commands': String(stats.ext.commands),
		'ext.minVsCode': stats.ext.minVsCode,
		'ext.vsixSize': stats.ext.vsix.sizeMb,
		'ext.sha256': stats.ext.vsix.sha256,
		'ms.version': stats.ms.version,
		'ms.installs': count(stats.ms.marketplaceInstalls, !!mkMs?.count),
		'ms.downloads': count(stats.ms.openVsxDownloads, !!ovsxMs),
		'ms.rating': stats.ms.rating.toFixed(1),
		'ms.minVsCode': stats.ms.minVsCode,
		'ms.vsixSize': stats.ms.vsix.sizeMb,
		'app.version': stats.app.version,
		'app.minor': stats.app.minor,
		'app.downloads': count(stats.app.downloads, appDownloads !== undefined),
	};
	const href: Record<string, string> = {
		'ext.vsix': stats.ext.vsix.url,
		'ms.vsix': stats.ms.vsix.url,
		'app.release': stats.app.releaseUrl,
		'app.sums': stats.app.sumsUrl,
	};
	for (const i of installers) href[`app.asset.${i.key}`] = i.url;

	const liveKey: Record<string, boolean> = {
		'ext.version': !!(mkExt?.version || ovsxExt?.version || extRel),
		'ext.installs': mkExt?.count !== undefined,
		'ext.rating': mkExt?.rating !== undefined,
		'ext.downloads': !!ovsxExt,
		'ext.commands': !!extPkg,
		'ext.minVsCode': !!extPkg?.minVsCode,
		'ext.vsixSize': !!vsixAsset,
		'ext.sha256': !!vsixAsset,
		'ext.vsix': !!vsixAsset,
		'ms.version': !!(mkMs?.version || ovsxMs?.version || msRel),
		'ms.installs': mkMs?.count !== undefined,
		'ms.rating': mkMs?.rating !== undefined,
		'ms.downloads': !!ovsxMs,
		'ms.minVsCode': !!msPkg?.minVsCode,
		'ms.vsixSize': !!msAsset,
		'ms.vsix': !!msAsset,
		'app.downloads': appDownloads !== undefined,
	};
	const stale = [...Object.keys(text), ...Object.keys(href)].filter((k) =>
		k in liveKey ? !liveKey[k] : k.startsWith('app.') ? !appRel : false,
	);

	return { ...stats, text, href, stale };
}

let buildStats: Promise<Stats> | undefined;

/**
 * The stats for this build: fetched once, shared by every page. Use this in
 * page frontmatter (`const stats = await getStats();`). The API route calls
 * fetchStats() instead, so a warm function never serves a stale memo.
 */
export function getStats(): Promise<Stats> {
	return (buildStats ??= fetchStats());
}
