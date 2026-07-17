// Single source of truth for site-wide data: product versions, links, and
// distribution channels. Update HERE when a release ships — every page reads
// from this file.

export const SITE_TITLE = 'GitStudio';
export const SITE_DESCRIPTION =
	'GitStudio is a free, open-source, native Git and GitHub client for macOS, Windows, and Linux, with editor extensions for VS Code and Cursor: a commit graph, a three-pane merge editor, interactive rebase, a universal undo, the full GitHub client, and AI on your own keys.';

export const GITHUB_ORG_URL = 'https://github.com/GitStudioHQ';
export const GITHUB_REPO_URL = 'https://github.com/GitStudioHQ/gitstudio';
export const GITHUB_RELEASES_URL = 'https://github.com/GitStudioHQ/gitstudio/releases';

// TODO: flip these to deep links (/blob/main/docs/ai-and-agents.md, /tree/main/brand)
// once the full codebase lands on the public main branch — deep links 404 today.
export const DOCS_AI_URL = GITHUB_REPO_URL;
export const BRAND_KIT_URL = GITHUB_REPO_URL;
export const LICENSE_URL = 'https://www.apache.org/licenses/LICENSE-2.0';

/** GitStudio — the flagship VS Code / Cursor extension. v1.0.0, live everywhere. */
export const EXT = {
	name: 'GitStudio',
	product: 'the GitStudio extension',
	route: '/gitstudio-extension',
	id: 'gitstudio.gitstudio',
	version: '1.0.0',
	license: 'Apache-2.0',
	marketplaceUrl: 'https://marketplace.visualstudio.com/items?itemName=gitstudio.gitstudio',
	openVsxUrl: 'https://open-vsx.org/extension/gitstudio/gitstudio',
	vsixPath: '/downloads/gitstudio-1.0.0.vsix',
	vsixFile: 'gitstudio-1.0.0.vsix',
	vsixSizeMb: '2.5',
	vsixSha256: '37d43b76929ca24d75d00ccafcb1bd86b6493b106424b82c9e9fed60ce3f00d3',
	minVsCode: '1.74',
	commands: 77,
};

/** Merge Studio — live on both registries. */
export const MERGE = {
	name: 'Merge Studio',
	product: 'the Merge Studio extension',
	route: '/merge-studio-extension',
	id: 'gitstudio.merge-studio',
	version: '0.3.4',
	license: 'MIT',
	marketplaceUrl: 'https://marketplace.visualstudio.com/items?itemName=gitstudio.merge-studio',
	openVsxUrl: 'https://open-vsx.org/extension/gitstudio/merge-studio',
	marketplaceStars: 5.0,
};

const APP_DL = 'https://github.com/GitStudioHQ/gitstudio/releases/download/app-v1.0.0';

/** GitStudio Desktop — v1.0.0, installers on GitHub Releases. */
export const APP = {
	version: '1.0.0',
	license: 'Apache-2.0',
	releasesUrl: GITHUB_RELEASES_URL,
	// The full artifact matrix. Every row renders as a download button and must
	// have a matching file on the GitHub Release (see the release/build pipeline).
	downloads: [
		{ os: 'macOS', arch: 'Apple Silicon', format: '.dmg', url: `${APP_DL}/GitStudio-1.0.0-arm64.dmg` },
		{ os: 'macOS', arch: 'Intel', format: '.dmg', url: `${APP_DL}/GitStudio-1.0.0-x64.dmg` },
		{ os: 'Windows', arch: 'x64', format: '.exe', url: `${APP_DL}/GitStudio-Setup-1.0.0.exe` },
		{ os: 'Windows', arch: 'ARM64', format: '.exe', url: `${APP_DL}/GitStudio-Setup-1.0.0-arm64.exe` },
		{ os: 'Linux', arch: 'Debian / Ubuntu', format: '.deb', url: `${APP_DL}/GitStudio-1.0.0-amd64.deb` },
		{ os: 'Linux', arch: 'Fedora / RHEL', format: '.rpm', url: `${APP_DL}/GitStudio-1.0.0-x86_64.rpm` },
		{ os: 'Linux', arch: 'Universal', format: '.AppImage', url: `${APP_DL}/GitStudio-1.0.0-x86_64.AppImage` },
		{ os: 'Linux', arch: 'Portable', format: '.tar.gz', url: `${APP_DL}/GitStudio-1.0.0-x86_64.tar.gz` },
	],
	// The one-line install per OS (package managers / install script). These
	// channels must be published for the commands to resolve.
	install: {
		macos: 'brew install --cask gitstudio',
		windows: 'winget install GitStudioHQ.GitStudio',
		linux: 'curl -fsSL https://gitstudio.dev/install.sh | sh',
	},
	platforms: [
		{ os: 'macOS', arch: 'Apple Silicon & Intel', format: '.dmg' },
		{ os: 'Windows', arch: 'x64 & ARM64', format: '.exe' },
		{ os: 'Linux', arch: 'x86-64', format: '.deb · .rpm · .AppImage · .tar.gz' },
	],
};

export const AI_PROVIDERS = [
	'Anthropic',
	'OpenAI',
	'Google Gemini',
	'OpenRouter',
	'Groq',
	'Mistral',
	'xAI',
	'DeepSeek',
	'Together',
	'Azure',
	'Ollama',
	'LM Studio',
];

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

/** Live Open VSX install counts (verified 2026-07-16) — social proof. */
export const OPENVSX_INSTALLS = { gitstudio: 156, mergeStudio: 852 };
