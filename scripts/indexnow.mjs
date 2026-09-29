// Tell IndexNow search engines (Bing, Yandex, Seznam, Naver, ...) that the
// site's pages changed, so they recrawl now instead of whenever they next pass.
// Run it after a production deploy:
//
//   npm run indexnow             every URL in the LIVE sitemap
//   npm run indexnow -- --dry-run  print what would be sent, send nothing
//
// The key is the file public/<key>.txt, whose body is the key itself; the
// engines fetch https://gitstudio.dev/<key>.txt to check we own the host, so
// it must be deployed before this runs. One ping reaches every IndexNow
// engine (they share submissions). Google does not use IndexNow; it reads the
// sitemap named in robots.txt.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SITE = 'https://gitstudio.dev';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const dryRun = process.argv.includes('--dry-run');

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const keyFile = readdirSync(publicDir).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) throw new Error('No IndexNow key file (public/<32 hex>.txt) found.');
const key = keyFile.slice(0, -4);
if (readFileSync(publicDir + keyFile, 'utf8').trim() !== key) throw new Error(`${keyFile} must contain exactly its own key.`);

/** @param {string} url */
async function text(url) {
	const r = await fetch(url);
	if (!r.ok) throw new Error(`GET ${url}: ${r.status}`);
	return r.text();
}
const locs = (/** @type {string} */ xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());

// The deployed key must answer, or every engine will reject the submission.
const live = await fetch(`${SITE}/${keyFile}`).then((r) => (r.ok ? r.text() : ''), () => '');
if (live.trim() !== key && !dryRun) {
	throw new Error(`${SITE}/${keyFile} does not serve the key yet. Deploy first, then run this.`);
}

const urls = [];
for (const sitemap of locs(await text(`${SITE}/sitemap-index.xml`))) urls.push(...locs(await text(sitemap)));
const urlList = [...new Set(urls)].filter((u) => u.startsWith(`${SITE}/`));

const body = { host: new URL(SITE).host, key, keyLocation: `${SITE}/${keyFile}`, urlList };
if (dryRun) {
	console.log(JSON.stringify(body, null, 2));
	console.log(`dry run: ${urlList.length} URL(s) not sent (key file live: ${live.trim() === key})`);
} else {
	const r = await fetch(ENDPOINT, {
		method: 'POST',
		headers: { 'content-type': 'application/json; charset=utf-8' },
		body: JSON.stringify(body),
	});
	// 200 = received, 202 = received and the key is still being checked.
	console.log(`IndexNow: ${r.status} ${r.statusText} for ${urlList.length} URL(s)`);
	if (r.status !== 200 && r.status !== 202) {
		console.error(await r.text());
		process.exitCode = 1;
	}
}
