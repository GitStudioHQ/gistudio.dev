#!/usr/bin/env node
// Renders the 1200×630 social cards in public/og/ from one HTML template, in
// Playwright's chrome-headless-shell (GS_CHROME, else the newest one in the
// Playwright cache — never the system Chrome).
//
//   node scripts/og.mjs            # every card
//   node scripts/og.mjs og blog    # just these
//
// Fonts come from Google Fonts (the same three the site uses), so it needs the
// network. The home card embeds a real capture from src/assets/shots.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'og');
const MARK = readFileSync(join(ROOT, 'src/assets/brand/gitstudio-mark.svg'), 'utf8').replace(/<\?xml[^>]*>/, '');

// `em` wraps the one word set in the serif italic, the site's signature device.
const CARDS = {
	og: {
		title: 'The full Git and GitHub workflow in one native <em>app.</em>',
		sub: 'Free and open source, for macOS, Windows &amp; Linux.',
		foot: ['Apache-2.0', 'No account'],
		shot: 'src/assets/shots/app-commits.png',
	},
	download: {
		title: 'Get GitStudio <em>Desktop.</em>',
		sub: 'macOS 12+, Windows 10/11 and Linux. One-line installers and a SHA-256 for every build.',
		foot: ['Apache-2.0', 'No account'],
	},
	extensions: {
		title: 'Bring GitStudio into your <em>editor.</em>',
		sub: 'Two open-source extensions for VS Code, Cursor, VSCodium, Windsurf &amp; code-server.',
		foot: ['Marketplace', 'Open VSX'],
	},
	'gitstudio-extension': {
		title: 'The whole Git workflow, in your <em>editor.</em>',
		sub: 'GitStudio for VS Code, Cursor &amp; every VS Code-compatible editor.',
		foot: ['Apache-2.0', 'Marketplace', 'Open VSX'],
	},
	'merge-studio-extension': {
		title: 'Resolve conflicts with <em>confidence.</em>',
		sub: 'Merge Studio: the three-pane merge editor and conflicts dashboard for VS Code &amp; Cursor.',
		foot: ['MIT + Apache-2.0', 'Marketplace', 'Open VSX'],
	},
	blog: {
		title: 'Built in the <em>open.</em>',
		sub: 'War stories and field guides from shipping developer tools.',
		foot: ['Free &amp; open source'],
	},
};

const page = (c) => {
	const shot = c.shot ? pathToFileURL(join(ROOT, c.shot)).href : null;
	return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400..700&family=Newsreader:ital,wght@1,500;1,600&family=JetBrains+Mono:wght@400;500&display=block" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1200px;height:630px;overflow:hidden}
body{position:relative;background:#0c0c16;color:#f2f1f8;font-family:Inter,sans-serif;-webkit-font-smoothing:antialiased}
.bg{position:absolute;inset:0;background:
	radial-gradient(60% 75% at 12% 0%,rgba(169,140,255,.16),transparent 70%),
	radial-gradient(40% 55% at 92% 30%,rgba(195,107,240,.08),transparent 70%),
	linear-gradient(180deg,#11111d,#0b0b14)}
.brand{position:absolute;left:84px;top:74px;display:flex;align-items:center;gap:22px}
.brand svg{width:60px;height:60px}
.wm{font-weight:650;font-size:38px;letter-spacing:-.03em}
.wm b{font-weight:650;background:linear-gradient(94deg,#a98cff,#8e78f6 48%,#c36bf0);-webkit-background-clip:text;background-clip:text;color:transparent}
.copy{position:absolute;left:84px;top:196px;right:84px}
.has-shot .copy{right:560px}
h1{font-weight:680;font-size:78px;line-height:1.04;letter-spacing:-.034em}
.has-shot h1{font-size:60px;line-height:1.06}
em{font-family:Newsreader,serif;font-style:italic;font-weight:600;font-size:1.06em;letter-spacing:-.01em;padding-right:.04em;
	background:linear-gradient(94deg,#a98cff,#8e78f6 48%,#c36bf0);-webkit-background-clip:text;background-clip:text;color:transparent}
p{margin-top:30px;font-size:31px;line-height:1.42;color:#c5c3d4;max-width:980px}
.has-shot p{font-size:26px}
.foot{position:absolute;left:84px;bottom:66px;font-family:'JetBrains Mono',monospace;font-size:21px;color:#8f8da2;display:flex;gap:16px;align-items:center}
.foot i{width:6px;height:6px;border-radius:50%;background:#a98cff;display:inline-block}
.foot .site{color:#c3aeff}
.lanes{position:absolute;right:0;top:64px;width:420px;height:96px}
.shot{position:absolute;left:668px;top:118px;width:740px;border-radius:16px;overflow:hidden;
	border:1px solid rgba(226,223,245,.18);
	box-shadow:0 30px 80px -20px rgba(0,0,0,.9),0 40px 120px -40px rgba(169,140,255,.35)}
.shot img{display:block;width:100%}
</style></head><body class="${shot ? 'has-shot' : ''}">
<div class="bg"></div>
<div class="brand">${MARK}<span class="wm">Git<b>Studio</b></span></div>
${shot ? '' : `<svg class="lanes" viewBox="0 0 420 96" fill="none" stroke-width="2.5" stroke-linecap="round">
	<path d="M0 48 H420" stroke="#a98cff" stroke-opacity=".9"/>
	<path d="M40 48 C70 48 70 14 100 14 H250 C280 14 280 48 310 48" stroke="#a98cff" stroke-opacity=".75"/>
	<path d="M120 48 C150 48 150 82 180 82 H330 C360 82 360 48 390 48" stroke="#c36bf0" stroke-opacity=".75"/>
	<g fill="#a98cff"><circle cx="40" cy="48" r="5"/><circle cx="160" cy="14" r="5"/><circle cx="230" cy="14" r="5"/><circle cx="310" cy="48" r="5"/><circle cx="120" cy="48" r="5"/></g>
	<g fill="#c36bf0"><circle cx="220" cy="82" r="5"/><circle cx="300" cy="82" r="5"/></g>
	<circle cx="410" cy="48" r="7" fill="#0c0c16" stroke="#a98cff" stroke-width="3"/>
</svg>`}
<div class="copy"><h1>${c.title}</h1><p>${c.sub}</p></div>
${shot ? `<div class="shot"><img src="${shot}" alt=""></div>` : ''}
<div class="foot">${[...c.foot, '<span class="site">gitstudio.dev</span>'].join('<i></i>')}</div>
</body></html>`;
};

const findChrome = () => {
	if (process.env.GS_CHROME && existsSync(process.env.GS_CHROME)) return process.env.GS_CHROME;
	const base = join(homedir(), 'Library/Caches/ms-playwright');
	for (const d of existsSync(base) ? readdirSync(base).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse() : []) {
		for (const sub of ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64', 'chrome-headless-shell-linux64']) {
			const p = join(base, d, sub, 'chrome-headless-shell');
			if (existsSync(p)) return p;
		}
	}
	throw new Error('no chrome-headless-shell: set GS_CHROME or `npx playwright install chromium-headless-shell`');
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9600 + Math.floor(Math.random() * 300);
const tmp = mkdtempSync(join(tmpdir(), 'gs-og-'));
const chrome = spawn(findChrome(), [`--remote-debugging-port=${PORT}`, `--user-data-dir=${join(tmp, 'profile')}`, '--hide-scrollbars', '--force-color-profile=srgb', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });

try {
	let ws;
	for (let i = 0; i < 60 && !ws; i++) {
		try {
			const t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.type === 'page');
			if (t) {
				ws = new WebSocket(t.webSocketDebuggerUrl);
				await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
			}
		} catch {
			await sleep(250);
		}
	}
	let id = 0;
	const pending = new Map();
	const waiters = [];
	ws.onmessage = (ev) => {
		const m = JSON.parse(ev.data);
		if (m.id && pending.has(m.id)) {
			pending.get(m.id)(m);
			pending.delete(m.id);
		} else if (m.method) waiters.filter((w) => w.method === m.method).forEach((w) => w.resolve(m.params));
	};
	const send = (method, params = {}) => new Promise((resolve) => {
		pending.set(++id, resolve);
		ws.send(JSON.stringify({ id, method, params }));
	});
	const once = (method) => new Promise((resolve) => waiters.push({ method, resolve }));
	await send('Page.enable');
	await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });

	const want = process.argv.slice(2);
	for (const [name, card] of Object.entries(CARDS)) {
		if (want.length && !want.includes(name)) continue;
		const file = join(tmp, `${name}.html`);
		writeFileSync(file, page(card));
		const loaded = once('Page.loadEventFired');
		await send('Page.navigate', { url: pathToFileURL(file).href });
		await loaded;
		await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 250)))', awaitPromise: true });
		const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } });
		writeFileSync(join(OUT, `${name}.png`), Buffer.from(shot.result.data, 'base64'));
		console.log(`public/og/${name}.png`);
	}
	ws.close();
} finally {
	chrome.kill('SIGKILL');
	rmSync(tmp, { recursive: true, force: true });
}
