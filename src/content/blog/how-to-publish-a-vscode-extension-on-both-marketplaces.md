---
title: 'How to publish a VS Code extension on both marketplaces'
description: 'A complete, no-gaps guide: build, publish, get approved, and get verified on the VS Code Marketplace AND Open VSX — including how to choose a publisher name that the content filter will actually accept.'
pubDate: 'Jun 22 2026'
heroImage: '../../assets/blog-placeholder-1.jpg'
---

This is the guide I wish I'd had. It takes you from *nothing* to *published and verified on both registries* — the VS Code Marketplace **and** Open VSX — with every gotcha called out inline. For the story of why I wrote it (and why Microsoft thinks names are "suspicious"), see [Microsoft said my name was "suspicious content"](/blog/microsoft-said-my-name-was-suspicious).

**Publish to both registries.** Microsoft's Marketplace serves stock VS Code. **Open VSX** serves Cursor, VSCodium, Gitpod, Windsurf, and code-server — and in my first two days it out-installed the Marketplace ~8×. Skipping it leaves most of your audience behind.

> First time? Budget ~30–45 minutes, most of it browser account setup. After that, releases are one `git tag`.

---

## 0. What you need

- **Node 18+** (use **22** — the test-runner `**` glob needs Node 21+).
- An extension that **bundles to a single file** (esbuild or webpack → e.g. `dist/extension.js`). Shipping raw `node_modules` is slow and can trip the Marketplace's "suspicious content" scanner.
- A **public GitHub repo** (you'll need it for Open VSX verification, and `vsce` uses it to fix relative image links in your README).
- The two CLI tools, via `npx` (no global install):
  ```bash
  npx @vscode/vsce --version   # the Marketplace tool
  npx ovsx --version           # the Open VSX tool
  ```

Your `package.json` essentials:
```jsonc
{
  "name": "my-extension",          // lowercase — half your extension id
  "publisher": "your-publisher",   // must EXACTLY match the publisher you create
  "version": "0.0.1",
  "engines": { "vscode": "^1.74.0" },
  "main": "./dist/extension.js",
  "repository": { "type": "git", "url": "https://github.com/you/my-extension.git" }
}
```
Your **extension id** is `publisher.name`. It is **permanent** once published — choose deliberately.

*(Want a ready-made, publish-configured starter with the whole pipeline built in? Fork [vscode-extension-starter](https://github.com/antonarnaudov/vscode-extension-starter) and skip the boilerplate.)*

---

## 1. Choosing your publisher name (read this first)

This is the step that derails people, so it goes first.

The **publisher** is your brand/identity; you create it once and it's **permanent** (you can't rename it). Two rules:

1. **Make it a brand, not your personal name.** The Marketplace runs an opaque content filter on the publisher form and **silently rejects some ordinary names** — *including plain human names* — as *"Publisher Metadata has suspicious content,"* with no explanation, across accounts and browsers. A brand-like id (`acme-tools`, `gitstudio`) clears it; `john-smith` might not. ([I lost days to this.](/blog/microsoft-said-my-name-was-suspicious))
2. **Think of it as an umbrella.** Your publisher hosts *all* your future extensions. Name it for the org/brand, not one product — `gitstudio`, not `merge-studio`. One verified-publisher badge then covers everything you ship.

> If creation fails with "suspicious content": switch to a clearly brand-like name and try again. If a clean brand name *still* fails, it's a backend false positive only Microsoft can lift — email **VSMarketplace@microsoft.com** (expect canned replies; be persistent).

Keep the same name on both registries so your extension id is identical everywhere.

---

## 2. VS Code Marketplace (Microsoft)

The Marketplace runs on Azure DevOps. Three browser steps, then one command.

### 2a. Azure DevOps organization
Sign in at **https://dev.azure.com** with the Microsoft account that will own this. If you have no org, accept the prompt to create one (the name doesn't show on your extension).

### 2b. Personal Access Token
User settings → **Personal access tokens** → **New Token**:
- **Organization: All accessible organizations** ⚠️ (a single org is the #1 cause of `403` on publish).
- **Scopes:** Show all scopes → **Marketplace → Manage**.

Copy it. Never commit it or paste it anywhere public.

> Azure DevOps retires *global* PATs on **Dec 1, 2026**. PATs still work today and are by far the simplest path for solo publishers; the Entra-ID flow is enterprise-only.

### 2c. Create the publisher
At **https://marketplace.visualstudio.com/manage** → **Create publisher**. Set the **ID** (lowercase, permanent, brand-like — see §1) and a display name. The ID **must match** `"publisher"` in `package.json`.

### 2d. Publish
```bash
# optional sanity check that the token is valid for the publisher:
VSCE_PAT=<pat> npx @vscode/vsce verify-pat <your-publisher>

# build + publish:
VSCE_PAT=<pat> npx @vscode/vsce publish
```
That runs your `vscode:prepublish` build, packages, and uploads. **Approval is automatic** — there's no human queue; an automated scan runs and the listing goes live within a few minutes at `marketplace.visualstudio.com/items?itemName=<publisher>.<name>`. (If the scan flags you — usually unbundled `node_modules` or a stray secret — you'll get "your extension has suspicious content"; bundle and check your `.vscodeignore`.)

---

## 3. Open VSX (Eclipse)

A **completely separate** system — different account, token, and rules. Your Marketplace setup does not carry over.

### 3a. Account + Publisher Agreement
Sign in at **https://open-vsx.org** with GitHub, then sign the **Eclipse Foundation Open VSX Publisher Agreement** (Settings; one-time, required before you can publish).

### 3b. Token
Settings → **Access Tokens** → create one.

### 3c. Create the namespace and publish
Your **namespace = your `publisher` value**.
```bash
OVSX_PAT=<token> npx ovsx create-namespace <your-publisher>
OVSX_PAT=<token> npx ovsx publish my-extension-0.0.1.vsix
```
(Build the `.vsix` with `npx @vscode/vsce package` if you don't have one.) Publishing is **automatic** — no approval queue. A new version can take a few minutes to surface in the API even after the CLI prints "Published."

---

## 4. Getting *verified* (the badges)

"Published" and "verified" are different. Each registry has its own verification, and they're unrelated.

### Open VSX — namespace ownership
A fresh namespace is **unverified**: your listing shows ⚠️ *"X is not a verified publisher of the namespace."* It's cosmetic (installs work — mine got 400+ with the warning up), but you'll want it gone. **A domain is NOT required** (common myth).

1. Log into open-vsx.org with a GitHub account that has **≥12 months** of public history.
2. File a claim: **github.com/EclipseFdn/open-vsx.org/issues/new/choose → "Claim namespace ownership."**
3. Easiest proof — **Option 1** (works when your namespace is also a Marketplace publisher whose extension links a repo you own): cite the repo from `package.json` and a **commit URL you authored**. No DNS, no domain.
   - Alternatives: namespace == your GitHub username; a DNS TXT record on a *matching* domain; or Marketplace reader access.
4. Eclipse staff review **manually** (auto-approval was disabled in 2025), so it sits in a queue for a few business days. When granted, the ⚠️ flips to ✓ — retroactively.

### VS Code Marketplace — verified publisher (the blue check)
Optional and slow: you verify a **domain** you own against the publisher (a DNS TXT record in the publisher's Details tab). Both the **publisher and the domain must be at least 6 months old** before you can apply — so set the TXT record early and let the clock run.

---

## 5. Automate it — never touch a token again

Hand-publishing once is fine. After that, use GitHub Actions. Add two repo secrets (**Settings → Secrets and variables → Actions**):

- `VSCE_PAT` — your Marketplace PAT
- `OVSX_PAT` — your Open VSX token

Then a release is just:
```bash
# bump "version" in package.json + a CHANGELOG entry, commit, then:
git tag v0.1.0
git push origin v0.1.0
```

A tag-triggered workflow builds, publishes to **both** registries, and attaches the `.vsix` to a GitHub Release. A copy-paste `release.yml` (with publish steps guarded so it skips — not fails — before the secrets exist) is in the [starter repo](https://github.com/antonarnaudov/vscode-extension-starter).

> You can't reuse a version number. After `0.1.0`, the next release is `0.1.1`+, even to fix a README typo on the live listing.

---

## 6. Gotchas (all learned the hard way)

| Symptom | Fix |
|---|---|
| **"Publisher Metadata has suspicious content"** | Filter rejecting your publisher *name*. Use a brand-like name (§1). |
| **`403` on `vsce publish`** | PAT scoped to one org (use **All accessible organizations**) or missing **Marketplace > Manage**, or the PAT's account doesn't own the publisher. |
| **"Your extension has suspicious content"** (on upload) | Usually unbundled `node_modules` or a leaked secret in the package. Bundle; check `.vscodeignore`. |
| **README badges show "retired badge"** | shields.io retired its VS Marketplace badge type. Use a static badge; the Open VSX shields badge still works. |
| **CI: `Could not find 'test/**'`** | The test-runner `**` glob needs Node 21+. Pin CI to Node 22. |
| **Listing shows old version right after publish** | Indexing lag. The CLI's "Published vX.Y.Z" is the truth. |
| **Want to remove an old Open VSX listing** | No self-serve delete — it's a staff-handled GitHub issue. **Deprecate, don't delete** if it has installs; removal strands users with no redirect. |

---

## The checklist

- [ ] `package.json`: `name`, **brand-like** `publisher`, `version`, `engines.vscode`, bundled `main`, `repository`
- [ ] Azure DevOps → PAT (**Marketplace > Manage**, **All accessible orgs**)
- [ ] Create the Marketplace publisher (matches `package.json`) → `vsce publish`
- [ ] Open VSX: sign the Publisher Agreement → token → `ovsx create-namespace` → `ovsx publish`
- [ ] File the Open VSX namespace-ownership claim (clears the ⚠️)
- [ ] Add `VSCE_PAT` + `OVSX_PAT` repo secrets → releases become `git tag && git push`
- [ ] (Optional) Marketplace verified badge: domain TXT record, 6-month clock

That's the whole thing. Publish to both, name your publisher like a brand, and budget an afternoon for the parts the official docs skip.
