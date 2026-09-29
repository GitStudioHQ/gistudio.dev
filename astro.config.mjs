// @ts-check
import { fileURLToPath } from 'node:url';

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';
import agentReady from './integrations/agent-ready.mjs';
import { lastmodFor } from './integrations/lastmod.mjs';

const lastmod = lastmodFor(fileURLToPath(new URL('.', import.meta.url)));

/**
 * A Markdown task list renders disabled checkboxes with no accessible name.
 * Name each one after its state; the item's own text follows it.
 * @returns {(tree: any) => void}
 */
const rehypeTaskListLabels = () => (tree) => {
	/** @param {any} node */
	const walk = (node) => {
		if (node.type === 'element' && node.tagName === 'input' && node.properties?.type === 'checkbox') {
			node.properties.ariaLabel = node.properties.checked ? 'Done' : 'To do';
		}
		for (const child of node.children ?? []) walk(child);
	};
	walk(tree);
};

// https://astro.build/config
export default defineConfig({
	site: 'https://gitstudio.dev',
	markdown: {
		// github-dark's comments are 3.0:1 on its background; -default's pass AA.
		shikiConfig: { theme: 'github-dark-default' },
		rehypePlugins: [rehypeTaskListLabels],
	},
	integrations: [
		mdx(),
		sitemap({
			// Only indexable canonicals belong in the sitemap. 404 is noindex; the
			// old /desktop, /extension, /merge-studio slugs are 308 redirects
			// (their page files are deleted) so they never emit an entry.
			filter: (page) => !page.includes('/404'),
			// <lastmod> from the post's dates or the page's last commit (integrations/lastmod.mjs).
			serialize: (item) => {
				const date = lastmod(new URL(item.url).pathname);
				return date ? { ...item, lastmod: date.toISOString() } : item;
			},
		}),
		// Markdown twins of every page, llms-full.txt and the agent-skills index.
		agentReady(),
	],
	fonts: [
		{
			provider: fontProviders.google(),
			name: 'Inter',
			cssVariable: '--font-sans',
			weights: ['400 700'],
			styles: ['normal'],
			subsets: ['latin'],
			fallbacks: ['ui-sans-serif', 'system-ui', 'sans-serif'],
		},
		{
			provider: fontProviders.google(),
			name: 'Newsreader',
			cssVariable: '--font-serif',
			weights: [500, 600],
			styles: ['italic'],
			subsets: ['latin'],
			fallbacks: ['Georgia', 'serif'],
		},
		{
			provider: fontProviders.google(),
			name: 'JetBrains Mono',
			cssVariable: '--font-mono',
			weights: [400, 500, 600],
			styles: ['normal'],
			subsets: ['latin'],
			fallbacks: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
		},
	],
});
