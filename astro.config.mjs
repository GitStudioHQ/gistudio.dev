// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: 'https://gitstudio.dev',
	integrations: [
		mdx(),
		sitemap({
			// Only indexable canonicals belong in the sitemap. 404 is noindex; the
			// old /desktop, /extension, /merge-studio slugs are 308 redirects
			// (their page files are deleted) so they never emit an entry.
			filter: (page) => !page.includes('/404'),
		}),
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
			// Variable range (not discrete weights) so the file carries the opsz
			// axis — font-optical-sizing then tunes the serif at display size.
			weights: ['500 600'],
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
