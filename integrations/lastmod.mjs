// @ts-check
/**
 * <lastmod> for every sitemap URL, from what the page is actually built from:
 *
 *   - a blog post: its updatedDate, else its pubDate (frontmatter);
 *   - every other page: the newest git commit that touched its page file or
 *     the shared code every page renders (components, layouts, styles,
 *     consts); the blog index also counts its newest post.
 *
 * A date that cannot be read (no git, a shallow clone without the commit) is
 * left out rather than guessed; the sitemap protocol makes <lastmod> optional.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SHARED = ['src/components', 'src/layouts', 'src/styles', 'src/consts.ts', 'src/lib'];

/** @param {string} root @param {string[]} paths @returns {Date | undefined} */
const gitDate = (root, paths) => {
	try {
		const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', ...paths], {
			cwd: root,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
		const d = out ? new Date(out) : undefined;
		return d && !Number.isNaN(d.valueOf()) ? d : undefined;
	} catch {
		return undefined;
	}
};

/** @param {(Date | undefined)[]} dates */
const newest = (dates) => {
	const ok = /** @type {Date[]} */ (dates.filter(Boolean));
	return ok.length ? new Date(Math.max(...ok.map((d) => d.valueOf()))) : undefined;
};

/** @param {string} text @param {string} key */
const fmDate = (text, key) => {
	const raw = text.match(new RegExp(`^${key}:\\s*['"]?([^'"\\n]+)['"]?\\s*$`, 'm'))?.[1];
	const d = raw ? new Date(raw) : undefined;
	return d && !Number.isNaN(d.valueOf()) ? d : undefined;
};

/**
 * A lookup from a sitemap URL's pathname to its last-modified date.
 * @param {string} root the project root
 * @returns {(pathname: string) => Date | undefined}
 */
export function lastmodFor(root) {
	const blogDir = join(root, 'src/content/blog');
	/** @type {Map<string, Date>} */
	const posts = new Map();
	if (existsSync(blogDir)) {
		for (const f of readdirSync(blogDir)) {
			const m = f.match(/^(.+)\.mdx?$/);
			if (!m) continue;
			const text = readFileSync(join(blogDir, f), 'utf8');
			if (/^draft:\s*true\s*$/m.test(text)) continue;
			const d = fmDate(text, 'updatedDate') ?? fmDate(text, 'pubDate');
			if (d) posts.set(m[1], d);
		}
	}
	/** @type {Map<string, Date | undefined>} */
	const cache = new Map();
	return (pathname) => {
		const path = pathname.replace(/^\/+|\/+$/g, '');
		if (cache.has(path)) return cache.get(path);
		let date;
		const post = path.match(/^blog\/(.+)$/);
		if (post) {
			date = posts.get(post[1]);
		} else if (path === 'blog') {
			date = newest([gitDate(root, ['src/pages/blog/index.astro', ...SHARED]), ...posts.values()]);
		} else {
			const page = `src/pages/${path || 'index'}.astro`;
			date = existsSync(join(root, page)) ? gitDate(root, [page, ...SHARED]) : undefined;
		}
		cache.set(path, date);
		return date;
	};
}
