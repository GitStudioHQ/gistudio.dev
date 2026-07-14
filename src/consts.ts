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

/** GitStudio — the flagship VS Code / Cursor extension. */
export const EXT = {
	id: 'gitstudio.gitstudio',
	version: '0.1.23',
	license: 'Apache-2.0',
	vsixPath: '/downloads/gitstudio-0.1.23.vsix',
	vsixFile: 'gitstudio-0.1.23.vsix',
	vsixSizeMb: '2.3',
	vsixSha256: '519c910d8d4bde294f5bf397b0af8fc838a2a465947b36d6510e1986fc119929',
	// Marketplace listings are rolling out; flip these to real URLs when live.
	marketplaceUrl: null as string | null,
	openVsxUrl: null as string | null,
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

/** GitStudio Desktop — Electron app, beta. */
export const APP = {
	version: '0.1.0',
	license: 'Apache-2.0',
	releasesUrl: GITHUB_RELEASES_URL,
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
