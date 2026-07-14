// Single source of truth for site-wide data: product versions, links, and
// distribution channels. Update HERE when a release ships — every page reads
// from this file.

export const SITE_TITLE = 'GitStudio';
export const SITE_DESCRIPTION =
	'GitStudio is a free, open-source, JetBrains-grade Git suite for VS Code, Cursor, and the desktop — commit graph, three-pane merge, interactive rebase with a universal Undo, in-editor pull requests, and bring-your-own-key AI.';

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
	id: 'gitstudio.merge-studio',
	version: '0.3.4',
	license: 'MIT',
	marketplaceUrl: 'https://marketplace.visualstudio.com/items?itemName=gitstudio.merge-studio',
	openVsxUrl: 'https://open-vsx.org/extension/gitstudio/merge-studio',
};

const APP_DL = 'https://github.com/GitStudioHQ/gitstudio/releases/download/app-v1.0.0';

/** GitStudio Desktop — v1.0.0, installers on GitHub Releases. */
export const APP = {
	version: '1.0.0',
	license: 'Apache-2.0',
	releasesUrl: GITHUB_RELEASES_URL,
	downloads: [
		{ os: 'macOS', arch: 'Apple Silicon', format: '.dmg', url: `${APP_DL}/GitStudio-1.0.0-arm64.dmg` },
		{ os: 'macOS', arch: 'Intel', format: '.dmg', url: `${APP_DL}/GitStudio-1.0.0-x64.dmg` },
		{ os: 'Windows', arch: 'x64', format: '.exe', url: `${APP_DL}/GitStudio-Setup-1.0.0.exe` },
		{ os: 'Linux', arch: 'universal', format: '.AppImage', url: `${APP_DL}/GitStudio-1.0.0-x86_64.AppImage` },
		{ os: 'Linux', arch: 'Debian / Ubuntu', format: '.deb', url: `${APP_DL}/GitStudio-1.0.0-amd64.deb` },
	],
	platforms: [
		{ os: 'macOS', arch: 'Apple Silicon & Intel', format: '.dmg / .zip' },
		{ os: 'Windows', arch: 'x64', format: '.exe (NSIS)' },
		{ os: 'Linux', arch: 'x64', format: '.AppImage / .deb' },
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
