/**
 * GET /api/stats — the live product facts (versions, install and download
 * counts, command counts, installer and VSIX URLs) as JSON.
 *
 * The same fetcher the build uses (src/lib/stats.ts), so the page's build-time
 * numbers and these agree in shape. src/components/LiveStats.astro reads this
 * once per page view and refreshes every [data-live] / [data-live-href]
 * element, so a release shows up on the site without a redeploy.
 *
 * Cheap: Vercel's CDN keeps an answer 15 minutes (s-maxage) and serves the
 * last one for up to a day while it refetches in the background, so the
 * upstream APIs see a few requests an hour whatever the traffic. It never
 * errors because a source is down — stats.ts falls back to src/consts.ts.
 *
 * GITHUB_TOKEN (already set for api/errors.ts) lifts GitHub's 60-an-hour
 * anonymous limit; public release data needs no scope, and a refused token is
 * retried without it.
 */
import { fetchStats } from '../src/lib/stats.js';

// Minimal structural request/response types — avoids a @vercel/node dependency.
interface Req {
	method?: string;
}
interface Res {
	status(code: number): Res;
	json(body: unknown): void;
	end(): void;
	setHeader(name: string, value: string): void;
}

export default async function handler(req: Req, res: Res): Promise<void> {
	if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
		res.setHeader('Allow', 'GET, HEAD');
		res.status(405).end();
		return;
	}
	const stats = await fetchStats();
	// An answer with a source missing is kept only two minutes, so an outage
	// does not pin fallback numbers on the CDN for the full quarter hour.
	const whole = Object.values(stats.live).every(Boolean);
	res.setHeader('Cache-Control', `s-maxage=${whole ? 900 : 120}, stale-while-revalidate=86400`);
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.status(200).json(stats);
}
