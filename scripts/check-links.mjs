#!/usr/bin/env node
// Link check over the BUILT site (run `npm run build` first).
//
//   node scripts/check-links.mjs            # internal + external
//   node scripts/check-links.mjs --internal # skip the network
//
// Internal: every href/src/srcset in dist/**/*.html must resolve to a file in
// dist/ (directory → index.html), to a redirect in vercel.json, or to /api/*,
// and every #fragment must name an id on the target page.
// External: each distinct URL gets a HEAD request (GET when a server refuses
// HEAD), following redirects. A 404/410 or a dead host fails the run; 401/403/
// 429 and bot walls are reported but pass, since they say nothing about the
// link. Mail links are skipped.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const SITE = 'https://gitstudio.dev';
const INTERNAL_ONLY = process.argv.includes('--internal');

if (!existsSync(DIST)) {
	console.error('dist/ is missing: run `npm run build` first');
	process.exit(2);
}

const redirects = new Set(
	(JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')).redirects ?? []).map((r) => r.source),
);

const walk = (dir) =>
	readdirSync(dir).flatMap((n) => {
		const p = join(dir, n);
		return statSync(p).isDirectory() ? walk(p) : [p];
	});
const pages = walk(DIST).filter((p) => p.endsWith('.html'));

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#38;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const idsOf = new Map();
const ids = (file) => {
	if (!idsOf.has(file)) {
		const html = readFileSync(file, 'utf8');
		idsOf.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => decode(m[1]))));
	}
	return idsOf.get(file);
};

/** dist file an internal path serves, or null. */
const fileFor = (path) => {
	const p = decodeURIComponent(path.split('?')[0]);
	const bare = p.replace(/\/$/, '');
	const candidates = [join(DIST, p), join(DIST, p, 'index.html'), join(DIST, `${bare}.html`)];
	return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
};

const problems = [];
const external = new Map(); // url -> [pages]

for (const page of pages) {
	// Script bodies build URLs out of string pieces; only markup is checked.
	const html = readFileSync(page, 'utf8')
		.replace(/<script\b(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script>/g, '')
		.replace(/<!--[\s\S]*?-->/g, '');
	const from = '/' + relative(DIST, page).replace(/index\.html$/, '').replace(/\.html$/, '');
	const refs = [];
	for (const m of html.matchAll(/\s(href|src)="([^"]*)"/g)) refs.push(decode(m[2]));
	for (const m of html.matchAll(/\ssrcset="([^"]*)"/g))
		for (const part of decode(m[1]).split(',')) refs.push(part.trim().split(/\s+/)[0]);
	for (const m of html.matchAll(/<meta\s+(?:property|name)="(?:og:image|twitter:image|og:url)"\s+content="([^"]+)"/g)) refs.push(decode(m[1]));

	for (let ref of refs) {
		if (!ref || ref.startsWith('data:') || ref.startsWith('mailto:') || ref.startsWith('javascript:')) continue;
		if (ref.startsWith(SITE)) ref = ref.slice(SITE.length) || '/';
		if (/^https?:\/\//.test(ref)) {
			if (!external.has(ref)) external.set(ref, new Set());
			external.get(ref).add(from);
			continue;
		}
		if (ref.startsWith('//')) {
			problems.push(`${from}: protocol-relative URL ${ref}`);
			continue;
		}
		const url = new URL(ref, `${SITE}${from}`);
		const path = url.pathname;
		if (path.startsWith('/api/')) continue;
		const target = redirects.has(path.replace(/\/$/, '')) ? 'redirect' : fileFor(path);
		if (!target) {
			problems.push(`${from}: broken internal link ${ref}`);
			continue;
		}
		if (url.hash && url.hash !== '#' && target !== 'redirect' && target.endsWith('.html')) {
			const id = decodeURIComponent(url.hash.slice(1));
			if (!ids(target).has(id)) problems.push(`${from}: missing anchor ${ref}`);
		}
	}
}

console.log(`internal: ${pages.length} pages checked, ${problems.length} problem(s)`);

const warnings = [];
if (!INTERNAL_ONLY) {
	const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0 Safari/537.36 gitstudio.dev-linkcheck';
	const check = async (url) => {
		for (const method of ['HEAD', 'GET']) {
			try {
				const res = await fetch(url, {
					method,
					redirect: 'follow',
					headers: { 'user-agent': UA, accept: '*/*' },
					signal: AbortSignal.timeout(20000),
				});
				if (method === 'GET') res.body?.cancel();
				if (res.ok) return { ok: true, status: res.status };
				if (method === 'HEAD' && [403, 404, 405, 429, 501].includes(res.status)) continue;
				return { ok: false, status: res.status };
			} catch (e) {
				if (method === 'GET') return { ok: false, status: e.name === 'TimeoutError' ? 'timeout' : e.cause?.code ?? e.message };
			}
		}
		return { ok: false, status: 'unreachable' };
	};
	const urls = [...external.keys()];
	const results = [];
	for (let i = 0; i < urls.length; i += 8) {
		results.push(...(await Promise.all(urls.slice(i, i + 8).map(async (u) => ({ u, ...(await check(u)) })))));
	}
	for (const r of results) {
		const where = [...external.get(r.u)].join(', ');
		if (r.ok) continue;
		if ([401, 403, 429, 999].includes(r.status)) warnings.push(`${r.status} ${r.u} (bot wall or auth; check by hand) — on ${where}`);
		else problems.push(`${r.status} ${r.u} — on ${where}`);
	}
	console.log(`external: ${urls.length} distinct URL(s) checked`);
}

for (const w of warnings) console.log(`warn  ${w}`);
for (const p of problems) console.log(`FAIL  ${p}`);
process.exit(problems.length ? 1 : 0);
