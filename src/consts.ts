// Site-wide data: product versions, links, and distribution channels.
//
// Versions, counts, command counts, VSIX/installer URLs and sizes are
// SUPERSEDED at build time by src/lib/stats.ts, which reads them from GitHub
// Releases, Open VSX and the VS Code Marketplace (and api/stats.ts serves the
// same JSON to the page at view time). The values here are only its FALLBACK
// when a source is down, so they no longer need a hand edit per release —
// refresh them now and then so a fallback build is never far behind.

export const SITE_TITLE = 'GitStudio';
export const SITE_DESCRIPTION =
	'GitStudio is a free, open-source Git and GitHub client for macOS, Windows, and Linux, with editor extensions for VS Code and Cursor: a commit graph, a three-pane merge editor, interactive rebase, a universal undo, the full GitHub client, and AI on your own keys.';

export const GITHUB_ORG_URL = 'https://github.com/GitStudioHQ';
export const GITHUB_REPO_URL = 'https://github.com/GitStudioHQ/gitstudio';
export const GITHUB_RELEASES_URL = 'https://github.com/GitStudioHQ/gitstudio/releases';

export const DOCS_AI_URL = `${GITHUB_REPO_URL}/blob/main/docs/ai-and-agents.md`;
export const BRAND_KIT_URL = `${GITHUB_REPO_URL}/tree/main/brand`;
export const LICENSE_URL = 'https://www.apache.org/licenses/LICENSE-2.0';

/** Ways to support the project. Shown in the footer of every page and near the end of the home page. */
export const SUPPORT = {
	sponsorUrl: 'https://github.com/sponsors/antonarnaudov',
	coffeeUrl: 'https://checkout.revolut.com/pay/7a6070ab-99ba-4170-a125-c5911b1a5c1d',
};

/** GitStudio — the flagship VS Code / Cursor extension. */
export const EXT = {
	name: 'GitStudio',
	product: 'the GitStudio extension',
	route: '/gitstudio-extension',
	id: 'gitstudio.gitstudio',
	version: '1.16.0',
	license: 'Apache-2.0',
	marketplaceUrl: 'https://marketplace.visualstudio.com/items?itemName=gitstudio.gitstudio',
	openVsxUrl: 'https://open-vsx.org/extension/gitstudio/gitstudio',
	// The VSIX is the GitHub release asset, not a copy in public/: the copy
	// sat at 1.0.0 for twelve extension releases. Size and SHA-256 are of the
	// ext-v* release asset (shasum -a 256 gitstudio.vsix).
	vsixPath: 'https://github.com/GitStudioHQ/gitstudio/releases/download/ext-v1.16.0/gitstudio.vsix',
	vsixFile: 'gitstudio.vsix',
	vsixSizeMb: '3.1',
	vsixSha256: 'e394b79f86bdfacb0457fa7c6cee274523c92d38dd8fb4714c304b2320d1f80f',
	// engines.vscode in the shipped package.json.
	minVsCode: '1.78',
	// contributes.commands in the shipped package.json.
	commands: 137,
};

/** Merge Studio — live on both registries. */
export const MERGE = {
	name: 'Merge Studio',
	product: 'the Merge Studio extension',
	route: '/merge-studio-extension',
	id: 'gitstudio.merge-studio',
	version: '1.1.0',
	// Merge Studio's own files are MIT; the GitStudio merge packages it bundles
	// are Apache-2.0 (package.json: "MIT AND Apache-2.0", see its NOTICE).
	license: 'MIT + Apache-2.0',
	licenseUrl: 'https://github.com/GitStudioHQ/merge-studio/blob/main/NOTICE',
	repoUrl: 'https://github.com/GitStudioHQ/merge-studio',
	marketplaceUrl: 'https://marketplace.visualstudio.com/items?itemName=gitstudio.merge-studio',
	openVsxUrl: 'https://open-vsx.org/extension/gitstudio/merge-studio',
	minVsCode: '1.82',
	vsixSizeMb: '3.2',
	// Average rating on the Marketplace (3 ratings, checked 2026-09-29).
	marketplaceStars: 5.0,
};

const APP_VERSION = '2.3.0';
const APP_TAG = `app-v${APP_VERSION}`;
const APP_DL = `https://github.com/GitStudioHQ/gitstudio/releases/download/${APP_TAG}`;

/** GitStudio Desktop — installers on GitHub Releases. */
export const APP = {
	version: APP_VERSION,
	license: 'Apache-2.0',
	releasesUrl: GITHUB_RELEASES_URL,
	releaseUrl: `${GITHUB_RELEASES_URL}/tag/${APP_TAG}`,
	sumsUrl: `${APP_DL}/SHA256SUMS.txt`,
	// The full artifact matrix: exactly the installers listed in the release's
	// SHA256SUMS.txt. Every row renders as a download button and must have a
	// matching file on the GitHub Release (see the release/build pipeline).
	downloads: [
		{ os: 'macOS', arch: 'Apple Silicon', format: '.dmg', url: `${APP_DL}/GitStudio-${APP_VERSION}-arm64.dmg` },
		{ os: 'macOS', arch: 'Intel', format: '.dmg', url: `${APP_DL}/GitStudio-${APP_VERSION}-x64.dmg` },
		{ os: 'macOS', arch: 'Apple Silicon', format: '.zip', url: `${APP_DL}/GitStudio-${APP_VERSION}-arm64.zip` },
		{ os: 'macOS', arch: 'Intel', format: '.zip', url: `${APP_DL}/GitStudio-${APP_VERSION}-x64.zip` },
		{ os: 'Windows', arch: 'x64', format: '.exe', url: `${APP_DL}/GitStudio-Setup-${APP_VERSION}.exe` },
		{ os: 'Linux', arch: 'Debian / Ubuntu', format: '.deb', url: `${APP_DL}/GitStudio-${APP_VERSION}-amd64.deb` },
		{ os: 'Linux', arch: 'Fedora / RHEL', format: '.rpm', url: `${APP_DL}/GitStudio-${APP_VERSION}-x86_64.rpm` },
		{ os: 'Linux', arch: 'Universal', format: '.AppImage', url: `${APP_DL}/GitStudio-${APP_VERSION}-x86_64.AppImage` },
		{ os: 'Linux', arch: 'Portable', format: '.tar.gz', url: `${APP_DL}/GitStudio-${APP_VERSION}-x64.tar.gz` },
	],
	// What each build runs on. 2.3.0 moved to Electron 41, which dropped macOS 11.
	requirements: {
		macos: 'macOS 12 Monterey or later',
		windows: 'Windows 10 or 11, x64',
		linux: 'x86-64, glibc 2.35+ (Ubuntu 22.04, Debian 12 or newer)',
	},
	// The one-line install per OS (package managers / install script). These
	// channels must be published for the commands to resolve.
	install: {
		// One line each, and each one is published. curl leads on macOS because
		// install.sh verifies the checksum AND clears the quarantine flag, so the
		// app opens on first launch; Homebrew is the second line because people
		// ask for it. There is no homebrew-core formula; the fully-qualified
		// name makes Homebrew tap GitStudioHQ/homebrew-gitstudio by itself, and
		// is Homebrew's own explicit-consent path for a third-party tap, so no
		// `brew tap` URL and no `brew trust` step.
		// `sh` is wrong for install.sh, which is a bash script; `winget` was
		// advertised with no manifest behind it, so Windows is the PowerShell
		// installer instead.
		macos: 'curl -fsSL https://gitstudio.dev/install.sh | bash',
		macosBrew: 'brew install --cask gitstudiohq/gitstudio/gitstudio',
		windows: 'irm https://gitstudio.dev/install.ps1 | iex',
		// Set once the winget-pkgs manifest is merged; empty hides the line.
		// (microsoft/winget-pkgs#437547 was still open on 2026-09-28.)
		windowsWinget: '',
		linux: 'curl -fsSL https://gitstudio.dev/install.sh | bash',
	},
	platforms: [
		{ os: 'macOS', arch: 'Apple Silicon & Intel', format: '.dmg · .zip' },
		{ os: 'Windows', arch: 'x64', format: '.exe' },
		{ os: 'Linux', arch: 'x86-64', format: '.deb · .rpm · .AppImage · .tar.gz' },
	],
};

/**
 * The editors the extensions run in, and how each one installs. VS Code pulls
 * from the Microsoft Marketplace; every other VS Code-compatible editor pulls
 * the identical build from Open VSX. Slug-independent — pages read from here so
 * install steps stay correct in one place.
 */
export const EDITORS = [
	{ key: 'vscode', label: 'VS Code', registry: 'Marketplace', cli: 'code', flagship: true },
	{ key: 'cursor', label: 'Cursor', registry: 'Open VSX', cli: 'cursor', flagship: true },
	{ key: 'vscodium', label: 'VSCodium', registry: 'Open VSX', cli: 'codium', flagship: false },
	{ key: 'windsurf', label: 'Windsurf', registry: 'Open VSX', cli: 'windsurf', flagship: false },
	{ key: 'code-server', label: 'code-server', registry: 'Open VSX', cli: 'code-server', flagship: false },
] as const;

export type EditorKey = (typeof EDITORS)[number]['key'];

/** The install command for an extension id in a given editor. */
export const installCmd = (cli: string, id: string) => `${cli} --install-extension ${id}`;

/** Registry URL for an editor + extension (Marketplace for VS Code, else Open VSX). */
export const registryUrl = (
	editorKey: EditorKey,
	ext: { marketplaceUrl: string; openVsxUrl: string },
) => (editorKey === 'vscode' ? ext.marketplaceUrl : ext.openVsxUrl);

/**
 * Hand-checked counts, the fallback for src/lib/stats.ts (checked 2026-09-29).
 * Marketplace: extensionquery statistics `install` / `averagerating` /
 * `ratingcount`. Open VSX: open-vsx.org/api/gitstudio/<name> `downloadCount`
 * — Open VSX counts every VSIX download (updates included), so pages say
 * "downloads" for it and "installs" only for the Marketplace number.
 * app.downloads: download_count summed over every installer on every app-v*
 * GitHub release. A fallback count is printed with a trailing "+".
 */
export const FALLBACK_COUNTS = {
	ext: { marketplaceInstalls: 531, openVsxDownloads: 8738, rating: 5.0, ratingCount: 2 },
	ms: { marketplaceInstalls: 576, openVsxDownloads: 2810, ratingCount: 3, commands: 13 },
	app: { downloads: 466 },
};

/**
 * @deprecated Read `stats.text['ext.downloads']` / `['ms.downloads']` from
 * src/lib/stats.ts (live at build time and at view time). Kept so pages not
 * yet moved over still build; derived from the fallback, rounded down.
 */
export const OPENVSX_DOWNLOADS = {
	gitstudio: `${(Math.floor(FALLBACK_COUNTS.ext.openVsxDownloads / 100) * 100).toLocaleString('en-US')}+`,
	mergeStudio: `${(Math.floor(FALLBACK_COUNTS.ms.openVsxDownloads / 100) * 100).toLocaleString('en-US')}+`,
};
