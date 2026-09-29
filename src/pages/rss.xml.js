import { getCollection } from 'astro:content';
import rss from '@astrojs/rss';
import { SITE_TITLE } from '../consts';

export async function GET(context) {
	const posts = (await getCollection('blog', ({ data }) => !data.draft)).sort(
		(a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
	);
	return rss({
		title: `${SITE_TITLE} blog`,
		description:
			'Field guides and war stories from building GitStudio, a free, open-source Git and GitHub client for macOS, Windows, Linux, VS Code and Cursor.',
		site: context.site,
		items: posts.map((post) => ({
			title: post.data.title,
			description: post.data.description,
			pubDate: post.data.pubDate,
			link: `/blog/${post.id}/`,
		})),
		customData: '<language>en-us</language>',
	});
}
