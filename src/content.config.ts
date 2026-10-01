import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
	// Load Markdown and MDX files in the `src/content/blog/` directory.
	loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
	// Type-check frontmatter using a schema
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			// The line under the headline, on the blog list and in the RSS feed.
			description: z.string(),
			// What search results and link previews show, when `description` is longer
			// than the ~160 characters they display.
			metaDescription: z.string().max(160).optional(),
			// Transform string to Date object
			pubDate: z.coerce.date(),
			updatedDate: z.coerce.date().optional(),
			// Accepted but not rendered: posts have no hero image on the page.
			heroImage: z.optional(image()),
			// A 1200×630 social card under public/, e.g. '/og/blog-launch.png'
			// (scripts/og.mjs renders them). Defaults to /og/blog.png.
			ogImage: z.string().startsWith('/').optional(),
			// true keeps a post out of the list, the RSS feed and the build.
			draft: z.boolean().default(false),
		}),
});

export const collections = { blog };
