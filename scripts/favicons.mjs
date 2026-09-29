#!/usr/bin/env node
// Regenerates every raster icon in public/ from the one vector source,
// public/favicon.svg — a copy of the brand master, brand/gitstudio-icon.svg in the
// gitstudio repo (the cube with the violet merge-Y), also at
// src/assets/brand/gitstudio-icon.svg. Copy the new master over both, then run this.
//
//   node scripts/favicons.mjs
//
// The rasters it replaces had been rendered at the wrong pixel ratio: the icon
// sat in the top-left quarter of apple-touch-icon.png and of every favicon.ico
// frame, and favicon-16/32.png were a single flat colour.
//
// Outputs (all square):
//   favicon.ico           16, 32, 48 (PNG frames)   browsers that ignore SVG icons
//   favicon-16.png, favicon-32.png                   legacy references
//   apple-touch-icon.png  180, opaque, full-bleed    iOS rounds the corners itself
//   icon-192.png, icon-512.png                       web manifest, "any"
//   icon-maskable-512.png full-bleed                 web manifest, "maskable" (the
//                                                    mark sits well inside the 80% safe zone)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const svg = readFileSync(join(PUBLIC, 'favicon.svg'), 'utf8');

// Full-bleed variant: square background, no hairline border. iOS and Android
// apply their own mask, and a transparent corner would show as black on iOS.
const fullBleed = svg
	.replace(/(<rect width="512" height="512") rx="[\d.]+"/, '$1')
	.replace(/<rect x="1\.5" y="1\.5"[^>]*\/>\n?/, '');
if (fullBleed === svg) throw new Error('favicon.svg changed shape; update the full-bleed rewrite');

const render = (source, size) =>
	sharp(Buffer.from(source), { density: Math.max(72, Math.ceil((72 * size) / 512) * 4) })
		.resize(size, size, { fit: 'fill', kernel: 'lanczos3' })
		.png({ compressionLevel: 9 })
		.toBuffer();

const out = async (name, buf) => {
	writeFileSync(join(PUBLIC, name), buf);
	// sharp cannot read an .ico back; its frames are the PNGs printed above it.
	const dims = name.endsWith('.ico') ? '16+32+48' : await sharp(buf).metadata().then((m) => `${m.width}x${m.height}`);
	console.log(`${name.padEnd(24)} ${dims} ${buf.length} B`);
};

// An .ico is a directory of images; modern ones hold PNGs verbatim.
const ico = (pngs) => {
	const head = Buffer.alloc(6 + 16 * pngs.length);
	head.writeUInt16LE(0, 0);
	head.writeUInt16LE(1, 2);
	head.writeUInt16LE(pngs.length, 4);
	let offset = head.length;
	pngs.forEach(({ size, buf }, i) => {
		const e = 6 + 16 * i;
		head.writeUInt8(size >= 256 ? 0 : size, e);
		head.writeUInt8(size >= 256 ? 0 : size, e + 1);
		head.writeUInt8(0, e + 2); // palette colours
		head.writeUInt8(0, e + 3); // reserved
		head.writeUInt16LE(1, e + 4); // colour planes
		head.writeUInt16LE(32, e + 6); // bits per pixel
		head.writeUInt32LE(buf.length, e + 8);
		head.writeUInt32LE(offset, e + 12);
		offset += buf.length;
	});
	return Buffer.concat([head, ...pngs.map((p) => p.buf)]);
};

const frames = [];
for (const size of [16, 32, 48]) frames.push({ size, buf: await render(svg, size) });
await out('favicon.ico', ico(frames));
await out('favicon-16.png', frames[0].buf);
await out('favicon-32.png', frames[1].buf);
await out(
	'apple-touch-icon.png',
	await sharp(await render(fullBleed, 180)).flatten({ background: '#0c0c16' }).png({ compressionLevel: 9 }).toBuffer(),
);
await out('icon-192.png', await render(svg, 192));
await out('icon-512.png', await render(svg, 512));
await out('icon-maskable-512.png', await render(fullBleed, 512));
