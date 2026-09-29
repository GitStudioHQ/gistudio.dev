// Runs src/lib/stats.ts against the LIVE APIs and prints what the site would
// show. Network required. Run: node scripts/stats.mjs
import { fetchStats } from '../src/lib/stats.js';

const s = await fetchStats();
console.log(JSON.stringify(s, null, 2));
const dead = Object.entries(s.live).filter(([, v]) => !v).map(([k]) => k);
if (dead.length) {
	console.error(`\nFELL BACK for: ${dead.join(', ')}`);
	process.exitCode = 1;
}
