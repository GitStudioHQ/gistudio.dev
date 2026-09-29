// @ts-check
/**
 * Agent-readable output, written after the HTML is built:
 *
 *   - a Markdown twin of every indexable page (dist/index.md, dist/download.md,
 *     dist/blog/<slug>.md, ...). vercel.json serves it for `Accept: text/markdown`
 *     and every page names it in a Link rel="alternate" header. Marketing pages
 *     are converted from their own built <main>, so the Markdown says exactly
 *     what the HTML says; blog posts use their Markdown source.
 *   - /llms-full.txt: /llms.txt followed by every page's Markdown.
 *   - /.well-known/agent-skills/index.json: the Agent Skills discovery index
 *     (v0.2.0) over public/.well-known/agent-skills/<name>/SKILL.md, with the
 *     sha256 digest of each file exactly as it is served.
 *
 * Nothing here changes a built HTML file.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeRemark from 'rehype-remark';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';

/** Elements that carry no reading content, or only duplicate it. */
const DROP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'button', 'canvas', 'video', 'audio', 'iframe', 'form', 'input', 'select', 'textarea']);

/** @param {any} node @returns {boolean} */
const isDropped = (node) => {
	if (node.type === 'comment') return true;
	if (node.type !== 'element') return false;
	if (DROP_TAGS.has(node.tagName)) return true;
	const p = node.properties ?? {};
	if (p.ariaHidden === 'true' || p.ariaHidden === true) return true;
	if (p.hidden !== undefined && p.hidden !== false) return true;
	// Page chrome inside <main> that has its own markdown elsewhere.
	if (p.dataMdSkip !== undefined) return true;
	return false;
};

/** Inline elements that, laid out as separate chips, read as separate words. */
const INLINE = new Set(['a', 'span', 'strong', 'b', 'em', 'i', 'code', 'small', 'time', 'data', 'abbr', 'kbd', 'mark']);

/**
 * Strip non-content nodes, make every link and image absolute, and keep apart
 * the words that CSS lays out as separate chips ("v1.16.0" "548 installs")
 * but the markup writes back to back.
 * @param {string} pageUrl
 */
const rehypeClean = (pageUrl) => () => (/** @type {any} */ tree) => {
	/** @param {any} node */
	const walk = (node) => {
		if (!node.children) return;
		const kept = node.children.filter((/** @type {any} */ c) => !isDropped(c));
		node.children = [];
		for (const c of kept) {
			const prev = node.children[node.children.length - 1];
			if (prev?.type === 'element' && c.type === 'element' && INLINE.has(prev.tagName) && INLINE.has(c.tagName)) {
				node.children.push({ type: 'text', value: prev.tagName === 'span' && c.tagName === 'span' ? ' · ' : ' ' });
			}
			node.children.push(c);
		}
		for (const c of node.children) {
			if (c.type === 'element') {
				const p = c.properties ?? {};
				if (c.tagName === 'a' && typeof p.href === 'string') p.href = absolute(p.href, pageUrl);
				if (c.tagName === 'img' && typeof p.src === 'string') p.src = absolute(p.src, pageUrl);
				// A <picture> keeps only its <img>.
				if (c.tagName === 'picture') c.children = c.children.filter((k) => k.type === 'element' && k.tagName === 'img');
			}
			walk(c);
		}
	};
	walk(tree);
};

/** @param {string} href @param {string} base */
const absolute = (href, base) => (/^[a-z][a-z0-9+.-]*:/i.test(href) ? href : new URL(href, base).toString());

/** @param {any} node @param {string} tag @returns {any} */
const find = (node, tag) => {
	if (node.type === 'element' && node.tagName === tag) return node;
	for (const c of node.children ?? []) {
		const hit = find(c, tag);
		if (hit) return hit;
	}
	return undefined;
};

/** @param {string} html @returns {{ title: string; description: string; canonical: string; noindex: boolean }} */
const headOf = (html) => {
	const pick = (/** @type {RegExp} */ re) => decode(html.match(re)?.[1] ?? '');
	return {
		title: pick(/<title>([^<]*)<\/title>/),
		description: pick(/<meta name="description" content="([^"]*)"/),
		canonical: pick(/<link rel="canonical" href="([^"]*)"/),
		noindex: /<meta name="robots" content="noindex/.test(html),
	};
};

/** @param {string} s */
const decode = (s) =>
	s
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');

/** YAML scalar, always double-quoted. @param {string} s */
const yaml = (s) => JSON.stringify(s);

/** @param {{ title: string; description: string; canonical: string }} h @param {string} body */
const withFrontmatter = (h, body) =>
	`---\ntitle: ${yaml(h.title)}\ndescription: ${yaml(h.description)}\nurl: ${h.canonical}\n---\n\n${body.trim()}\n`;

/** The built <main> of a page, as GitHub-flavoured Markdown. @param {string} html @param {string} pageUrl */
const htmlToMarkdown = async (html, pageUrl) => {
	const processor = unified()
		.use(rehypeParse)
		.use(rehypeClean(pageUrl))
		.use(() => (/** @type {any} */ tree) => {
			const main = find(tree, 'main');
			return main ? { type: 'root', children: main.children } : tree;
		})
		.use(rehypeRemark)
		.use(remarkGfm)
		.use(remarkStringify, { bullet: '-', emphasis: '_', rule: '-', fences: true, listItemIndent: 'one' });
	const out = String(await processor.process(html));
	// Collapse the blank-line runs that stripped decoration leaves behind.
	return out.replace(/\n{3,}/g, '\n\n');
};

/** A blog post's Markdown source, without its frontmatter. @param {string} file */
const postBody = (file) => readFileSync(file, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');

/** @param {string} dir @returns {string[]} */
const walkFiles = (dir) =>
	readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? walkFiles(join(dir, e.name)) : [join(dir, e.name)],
	);

/** @returns {import('astro').AstroIntegration} */
export default function agentReady() {
	/** @type {string} */
	let site = 'https://gitstudio.dev/';
	/** @type {string} */
	let root = process.cwd();
	return {
		name: 'gitstudio:agent-ready',
		hooks: {
			'astro:config:done': ({ config }) => {
				site = String(config.site ?? site);
				root = fileURLToPath(config.root);
			},
			'astro:build:done': async ({ dir, logger }) => {
				const out = fileURLToPath(dir);
				const pages = walkFiles(out)
					.filter((f) => f.endsWith('.html'))
					.sort();

				/** @type {{ path: string; md: string }[]} */
				const written = [];
				for (const file of pages) {
					const html = readFileSync(file, 'utf8');
					const head = headOf(html);
					if (head.noindex || !head.canonical) continue;
					// dist/index.html → index.md, dist/download/index.html → download.md,
					// dist/blog/<slug>/index.html → blog/<slug>.md
					const rel = relative(out, file).replace(/\\/g, '/');
					const base = rel === 'index.html' ? 'index' : rel.replace(/\/index\.html$/, '');
					const mdRel = `${base}.md`;

					let body;
					const post = base.match(/^blog\/(.+)$/);
					const src = post && ['md', 'mdx'].map((x) => join(root, 'src/content/blog', `${post[1]}.${x}`)).find(existsSync);
					if (src) {
						const source = readFileSync(src, 'utf8');
						const fmTitle = source.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? '';
						const title = /^['"]/.test(fmTitle) ? fmTitle.slice(1, -1).replace(/\\(["'])/g, '$1') : fmTitle || head.title;
						// Root-relative links in the source become absolute: the Markdown is read away from the site.
						const text = postBody(src).trim().replace(/\]\(\/(?!\/)/g, `](${site.replace(/\/$/, '')}/`);
						body = `# ${title}\n\n${text}`;
					} else {
						body = await htmlToMarkdown(html, head.canonical);
					}
					const md = withFrontmatter(head, body);
					const target = join(out, mdRel);
					mkdirSync(dirname(target), { recursive: true });
					writeFileSync(target, md);
					written.push({ path: `/${mdRel}`, md });
				}
				logger.info(`${written.length} Markdown page(s): ${written.map((w) => w.path).join(' ')}`);

				// llms-full.txt: the llms.txt overview, then every page in full.
				const llms = join(out, 'llms.txt');
				if (existsSync(llms)) {
					const order = (/** @type {string} */ p) => (p === '/index.md' ? 0 : p.startsWith('/blog') ? 2 : 1);
					const full = [
						readFileSync(llms, 'utf8').trim(),
						...written
							.slice()
							.sort((a, b) => order(a.path) - order(b.path) || a.path.localeCompare(b.path))
							.map((w) => `---\n\nSource: ${new URL(w.path, site)}\n\n${w.md.replace(/^---\n[\s\S]*?\n---\n\n/, '').trim()}`),
					].join('\n\n');
					writeFileSync(join(out, 'llms-full.txt'), `${full}\n`);
					logger.info('llms-full.txt written');
				}

				// Agent Skills discovery index, digests over the exact bytes served.
				const skillsDir = join(out, '.well-known', 'agent-skills');
				if (existsSync(skillsDir)) {
					const skills = readdirSync(skillsDir, { withFileTypes: true })
						.filter((e) => e.isDirectory() && existsSync(join(skillsDir, e.name, 'SKILL.md')))
						.map((e) => {
							const bytes = readFileSync(join(skillsDir, e.name, 'SKILL.md'));
							const text = bytes.toString('utf8');
							const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
							const field = (/** @type {string} */ k) => fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
							const name = field('name');
							if (name !== e.name) throw new Error(`agent-skills/${e.name}/SKILL.md: frontmatter name "${name}" must match its folder`);
							return {
								name,
								type: 'skill-md',
								description: field('description'),
								url: `/.well-known/agent-skills/${e.name}/SKILL.md`,
								digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
							};
						})
						.sort((a, b) => a.name.localeCompare(b.name));
					const index = { $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json', skills };
					writeFileSync(join(skillsDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
					logger.info(`agent-skills index: ${skills.map((s) => s.name).join(', ')}`);
				}
			},
		},
	};
}
