# Astro Starter Kit: Blog

```sh
npm create astro@latest -- --template blog
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

Features:

- ✅ Minimal styling (make it your own!)
- ✅ 100/100 Lighthouse performance
- ✅ SEO-friendly with canonical URLs and Open Graph data
- ✅ Sitemap support
- ✅ RSS Feed support
- ✅ Markdown & MDX support

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
├── public/
├── src/
│   ├── assets/
│   ├── components/
│   ├── content/
│   ├── layouts/
│   └── pages/
├── astro.config.mjs
├── README.md
├── package.json
└── tsconfig.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

The `src/content/` directory contains "collections" of related Markdown and MDX documents. Use `getCollection()` to retrieve posts from `src/content/blog/`, and type-check your frontmatter using an optional schema. See [Astro's Content Collections docs](https://docs.astro.build/en/guides/content-collections/) to learn more.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## Search engines and agents

What the site publishes for crawlers and AI agents, and where it comes from:

| URL | Source |
| --- | --- |
| `/robots.txt` (Content Signals, sitemap, Agentmap) | `public/robots.txt` |
| `/sitemap-index.xml` with `<lastmod>` | `@astrojs/sitemap` + `integrations/lastmod.mjs` |
| `/llms.txt` | `src/pages/llms.txt.ts` (live stats at build time) |
| `/llms-full.txt`, `/<page>.md` (Markdown twin of every page) | `integrations/agent-ready.mjs`, after the build |
| `/.well-known/agent-skills/index.json` (digests computed at build) | `public/.well-known/agent-skills/*/SKILL.md` + `integrations/agent-ready.mjs` |
| `/.well-known/api-catalog`, `/openapi.json`, `/docs/stats-api.md` | `public/` (describe `api/stats.ts` only) |
| `/.well-known/ai-catalog.json` | `public/.well-known/ai-catalog.json` |
| WebMCP tools `get_latest_versions`, `get_install_instructions` | `src/components/WebMcp.astro` |
| `Link` headers, `Accept: text/markdown` → `.md`, `Vary: Accept`, content types | `vercel.json` (`routes`) |

`vercel.json` uses `routes` rather than `rewrites`/`redirects`/`headers`: Vercel applies `rewrites` only after it has looked for a static file, so a rewrite can never swap `/download/index.html` for `/download.md`. A route with a `has` condition on the `Accept` header runs before that lookup. Vercel does not allow `routes` beside `redirects`/`headers`, so the three old redirects are routes too.

Edit a SKILL.md freely: its `sha256` digest in the index is recomputed on every build. Keep its frontmatter `name` equal to its folder name (the build fails otherwise).

### After a production deploy: IndexNow

```sh
npm run indexnow            # ping Bing, Yandex, Seznam and the other IndexNow engines with every sitemap URL
npm run indexnow -- --dry-run
```

The key is `public/<key>.txt` (its body is the key); it must be live before the ping, which the script checks. Google does not use IndexNow; it reads the sitemap from robots.txt and Search Console.

## 👀 Want to learn more?

Check out [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).

## Credit

This theme is based off of the lovely [Bear Blog](https://github.com/HermanMartinus/bearblog/).
