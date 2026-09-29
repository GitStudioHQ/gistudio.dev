// graphMotif — build-time geometry for the commit-graph drawings: the hero's
// self-drawing lanes (HeroGraph.astro) and the page's faint background lanes
// (GraphTexture.astro).
//
// The hero animates each lane with stroke-dashoffset on pathLength="1", so the
// drawn tip is at `progress × length` along the path. To make a commit dot
// appear exactly when the tip reaches it, and a branch start exactly when its
// parent lane reaches the fork, we need path lengths and the fraction of the
// length at which each point sits. Browsers know that (getTotalLength), but
// the page must not need JavaScript to animate, so it is computed here.
//
// Supported path data: absolute M, V, H, L and C — all the drawings use.

type Pt = { x: number; y: number };

/** Sample a path into a polyline with cumulative lengths. */
export function samplePath(d: string, step = 0.02): { pts: Pt[]; cum: number[]; length: number } {
	const tokens = d.match(/[MVHLC]|-?\d*\.?\d+/g) ?? [];
	const pts: Pt[] = [];
	let cur: Pt = { x: 0, y: 0 };
	let i = 0;
	const num = () => Number(tokens[i++]);
	let cmd = '';
	while (i < tokens.length) {
		if (/[MVHLC]/.test(tokens[i])) cmd = tokens[i++];
		if (cmd === 'M') {
			cur = { x: num(), y: num() };
			pts.push(cur);
		} else if (cmd === 'V') {
			cur = { x: cur.x, y: num() };
			pts.push(cur);
		} else if (cmd === 'H') {
			cur = { x: num(), y: cur.y };
			pts.push(cur);
		} else if (cmd === 'L') {
			cur = { x: num(), y: num() };
			pts.push(cur);
		} else if (cmd === 'C') {
			const p0 = cur;
			const p1 = { x: num(), y: num() };
			const p2 = { x: num(), y: num() };
			const p3 = { x: num(), y: num() };
			for (let t = step; t <= 1 + 1e-9; t += step) {
				const u = 1 - t;
				pts.push({
					x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
					y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
				});
			}
			cur = p3;
		} else {
			throw new Error(`graphMotif: unsupported path command "${cmd}" in ${d}`);
		}
	}
	// straight runs are sampled densely too, so a point on them is found precisely
	const dense: Pt[] = [pts[0]];
	for (let k = 1; k < pts.length; k++) {
		const a = pts[k - 1];
		const b = pts[k];
		const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
		for (let s = 1; s <= n; s++) dense.push({ x: a.x + ((b.x - a.x) * s) / n, y: a.y + ((b.y - a.y) * s) / n });
	}
	const cum = [0];
	for (let k = 1; k < dense.length; k++) cum.push(cum[k - 1] + Math.hypot(dense[k].x - dense[k - 1].x, dense[k].y - dense[k - 1].y));
	return { pts: dense, cum, length: cum[cum.length - 1] };
}

/** Fraction (0–1) of the path's length at which it passes closest to p, or null if it passes further than `tol`. */
export function fractionAt(path: ReturnType<typeof samplePath>, p: Pt, tol = 1.5): number | null {
	let best = Infinity;
	let at = 0;
	for (let k = 0; k < path.pts.length; k++) {
		const dd = Math.hypot(path.pts[k].x - p.x, path.pts[k].y - p.y);
		if (dd < best) {
			best = dd;
			at = path.cum[k];
		}
	}
	return best <= tol ? at / path.length : null;
}

export interface LaneIn {
	d: string;
	/** Start time in seconds for a lane that starts on its own (a root). Lanes
	 *  whose first point lies on an earlier lane start when that lane's tip
	 *  reaches it, and this is ignored. */
	at?: number;
}
export interface LaneOut {
	d: string;
	delay: number;
	dur: number;
	length: number;
}
export interface NodeOut {
	cx: number;
	cy: number;
	delay: number;
}

/**
 * Schedule a drawing: every lane's tip moves at `speed` units per second
 * (linear, so "where the tip is" is simple and the travelling light reads as
 * travel); a branch starts when its parent's tip reaches the fork; each commit
 * dot appears when the first tip reaches it.
 */
export function choreograph(lanes: LaneIn[], nodes: Pt[], speed: number): { lanes: LaneOut[]; nodes: NodeOut[] } {
	const sampled = lanes.map((l) => samplePath(l.d));
	const out: LaneOut[] = lanes.map((l, i) => ({ d: l.d, delay: l.at ?? NaN, dur: sampled[i].length / speed, length: sampled[i].length }));
	// resolve branch starts in order: a lane may fork from any lane before it
	for (let i = 0; i < lanes.length; i++) {
		const start = sampled[i].pts[0];
		for (let j = 0; j < i; j++) {
			const f = fractionAt(sampled[j], start);
			if (f !== null && f > 0.001) {
				out[i].delay = out[j].delay + f * out[j].dur;
				break;
			}
		}
		if (Number.isNaN(out[i].delay)) throw new Error(`graphMotif: lane ${i} has no parent and no start time`);
	}
	const nodeOut = nodes.map((p) => {
		let t = Infinity;
		sampled.forEach((s, i) => {
			const f = fractionAt(s, p);
			if (f !== null) t = Math.min(t, out[i].delay + f * out[i].dur);
		});
		if (!Number.isFinite(t)) throw new Error(`graphMotif: commit at ${p.x},${p.y} is on no lane`);
		return { cx: p.x, cy: p.y, delay: t };
	});
	return { lanes: out, nodes: nodeOut };
}
