// /llms.txt — the site in brief for language models, per https://llmstxt.org.
// Versions and counts come from the same build-time stats as the pages
// (src/lib/stats.ts); /llms-full.txt is this file followed by every page in
// full, written after the build by integrations/agent-ready.mjs.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { getStats } from '../lib/stats';
import { APP, DOCS_AI_URL, EDITORS, EXT, GITHUB_REPO_URL, MERGE, SITE_DESCRIPTION } from '../consts';

const SITE = 'https://gitstudio.dev';

export const GET: APIRoute = async () => {
	const stats = await getStats();
	const t = stats.text;
	const posts = (await getCollection('blog', ({ data }) => !data.draft)).sort(
		(a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
	);
	const editors = EDITORS.map((e) => e.label).join(', ');
	const date = stats.fetchedAt.slice(0, 10);

	const body = `# GitStudio

> ${SITE_DESCRIPTION}

GitStudio is made of three products, all free, with no account and no paid tier:

- **GitStudio Desktop** ${t['app.version']}: a Git and GitHub client for macOS (12 Monterey or later, Apple Silicon and Intel), Windows 10/11 (x64) and Linux (x86-64, glibc 2.35+). Apache-2.0. Commit graph, repositories as tabs, a three-pane merge editor with a conflicts dashboard, interactive rebase, Undo for Git operations, pull requests, issues and the rest of GitHub in the app, a real terminal, and an optional AI assistant that runs on your own API keys or local models (Ollama, LM Studio). It ships a local MCP server so outside agents can use the same Git tools.
- **GitStudio extension** (\`${EXT.id}\`) ${t['ext.version']}: the same engine as a VS Code extension, with ${t['ext.commands']} commands: commit graph, inline blame, hunk and line staging, stashes, the merge editor, interactive rebase, worktrees and GitHub pull requests. Apache-2.0.
- **Merge Studio** (\`${MERGE.id}\`) ${t['ms.version']}: only the three-pane merge editor and conflicts dashboard, with a named undo history. MIT, with the bundled GitStudio merge packages under Apache-2.0.

The extensions run in ${editors}. VS Code installs from the Visual Studio Marketplace; every other editor installs the identical build from Open VSX. GitStudio runs the Git already installed on the computer and does not bundle one. The desktop builds are not code-signed or notarized yet; every installer is built by CI from the public repository and published with a SHA256SUMS.txt.

Numbers as of ${date}: GitStudio extension ${t['ext.installs']} Marketplace installs and ${t['ext.downloads']} Open VSX downloads; Merge Studio ${t['ms.installs']} Marketplace installs and ${t['ms.downloads']} Open VSX downloads; GitStudio Desktop ${t['app.downloads']} installer downloads. Live values: ${SITE}/api/stats

## Install

- macOS and Linux: \`${APP.install.macos}\` (verifies the checksum; on macOS it installs to /Applications and clears the quarantine flag, on Linux it installs the AppImage under ~/.local)
- macOS with Homebrew: \`${APP.install.macosBrew}\`
- Windows (PowerShell): \`${APP.install.windows}\`
- Installers (.dmg, .zip, .exe, .deb, .rpm, .AppImage, .tar.gz) and SHA256SUMS.txt: ${stats.app.releaseUrl}
- GitStudio extension: \`code --install-extension ${EXT.id}\` (VS Code), \`cursor --install-extension ${EXT.id}\` (Cursor); [Marketplace](${EXT.marketplaceUrl}), [Open VSX](${EXT.openVsxUrl})
- Merge Studio: \`code --install-extension ${MERGE.id}\`, \`cursor --install-extension ${MERGE.id}\`; [Marketplace](${MERGE.marketplaceUrl}), [Open VSX](${MERGE.openVsxUrl})

## Pages

- [GitStudio Desktop](${SITE}/index.md): the desktop app, feature by feature, a comparison with GitKraken, GitLens and the built-in Git tools, and the FAQ
- [Download](${SITE}/download.md): every installer, the one-line installers, checksums, system requirements, Gatekeeper and SmartScreen steps, building from source
- [Editor extensions](${SITE}/extensions.md): the two extensions compared, and which registry each editor uses
- [GitStudio extension](${SITE}/gitstudio-extension.md): what the extension does and how to install it
- [Merge Studio extension](${SITE}/merge-studio-extension.md): the merge editor and conflicts dashboard
- [Blog](${SITE}/blog.md): field guides and war stories from shipping GitStudio

Every page is also served as Markdown when requested with \`Accept: text/markdown\`.

## Docs

- [Source code](${GITHUB_REPO_URL}): the monorepo with the desktop app, the GitStudio extension and the MCP server (Apache-2.0)
- [Merge Studio source](${MERGE.repoUrl})
- [AI and agents](${DOCS_AI_URL}): connecting a model to GitStudio, and exposing a repository to outside agents over MCP
- [MCP server](${GITHUB_REPO_URL}/blob/main/apps/mcp/README.md): the stdio MCP server (\`gitstudio-mcp\`) the desktop app ships: tools, permissions, resources and prompts
- [Releases](${GITHUB_REPO_URL}/releases): release notes and every build
- [Issues](${GITHUB_REPO_URL}/issues): bug reports and feature requests

## For agents

- [Agent skills](${SITE}/.well-known/agent-skills/index.json): install-gitstudio (install the app or the extensions) and gitstudio-mcp (connect an AI agent to GitStudio's MCP server)
- [Stats API](${SITE}/docs/stats-api.md): \`GET ${SITE}/api/stats\`, public and read-only, no authentication; [OpenAPI](${SITE}/openapi.json), [API catalog](${SITE}/.well-known/api-catalog)
- [AI catalog](${SITE}/.well-known/ai-catalog.json)

## Blog

${posts.map((p) => `- [${p.data.title}](${SITE}/blog/${p.id}.md): ${p.data.description}`).join('\n')}

## Optional

- [llms-full.txt](${SITE}/llms-full.txt): this file followed by the full text of every page
- [RSS feed](${SITE}/rss.xml)
`;
	return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
