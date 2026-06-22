---
title: 'Microsoft said my name was "suspicious content"'
description: 'What the VS Code Marketplace "Publisher Metadata has suspicious content" error actually is, how I figured it out after days of fighting it, and why the support reply is a rubber stamp. Plus: Open VSX is quietly the bigger marketplace.'
pubDate: 'Jun 22 2026'
heroImage: '../../assets/blog-placeholder-2.jpg'
---

I had a finished VS Code extension — **Merge Studio**, a JetBrains-style three-pane merge editor. Built, tested, polished, screenshots and a walkthrough, the works. The last step was supposed to be the easy one: create a publisher and hit *publish*.

It took days. Not the code. The **publisher name**.

If you've landed here because the Marketplace told you your publisher has *"suspicious content"* and you have no idea why — this post is for you. Here's what that error actually means, how I got past it, and the part that still annoys me.

> **Just want the steps?** I wrote a separate, no-gaps walkthrough: **[How to publish a VS Code extension on both marketplaces →](/blog/how-to-publish-a-vscode-extension-on-both-marketplaces)**. This post is the *why*.

## What the error actually is

To publish to the VS Code Marketplace you first create a **publisher** at `marketplace.visualstudio.com/manage`. I filled in the form:

- Publisher ID: `antonarnaudov`
- Display name: `Anton Arnaudov`

And got:

> **Publisher Metadata has suspicious content.**

No field. No reason. Just *suspicious*.

Here's the thing it took me embarrassingly long to accept: **this error has nothing to do with your extension.** You hit it *before you ever upload anything*. It's a content-moderation filter running on the **publisher form text itself** — your ID and display name — and it silently rejects some perfectly ordinary strings as if they were malware.

In my case, the "suspicious content" was my own name.

## The part where I lost a few days

I did what anyone does — I assumed I'd typed something wrong. So I varied it: shorter names, longer names, one word, two words, different capitalisation. Nothing. Then I changed the environment: different browsers, Edge, incognito, a VPN through the US. Nothing.

Then I went nuclear: a **brand-new Microsoft account**, fresh email, a new Azure account, a new Azure DevOps org — I even entered card details for the "pay-as-you-go" thing (yes, publishing a *free* extension now nudges you toward handing Microsoft a credit card). New everything.

**Same error.**

## The test that cracked it

The block followed my *name*, not my account. And I noticed something: another developer hitting the identical wall that week was `antoniofontes` — and the only thing our names share is the substring **`anton`**.

Two data points isn't proof, but it's a free experiment. So I created a publisher with a name that had nothing to do with me — `diffpane-tools`.

**It went through instantly.**

That was the whole bug. The filter was choking on a string in my name and labelling it "suspicious content." Not my account, not my extension — the *letters*.

## The bitter part

While I was at it, I emailed Marketplace support — politely, with full repro steps — asking them to whitelist `antonarnaudov`. The reply:

> Hi @Anton Arnaudov,
> Thank you for contacting Visual Studio Marketplace Support. After review, we are unable to approve it, as the Publisher's content does not align with the VS Marketplace policy. We appreciate your understanding.
> Regards, VS Marketplace Support Team *(Representative: 733be9c8)*

Here's the kicker. I sent that email **from the exact account that had, minutes earlier, successfully created a working publisher.** So the "review" approved me to publish on one name and, in the same breath, told me a different name "does not align with policy" — without ever saying *which* policy, *which* field, or *which* content.

It's not a review. It's a rubber stamp on top of a string match. "Disclosing specifics could compromise our monitoring mechanisms," they say. Translation: *we won't tell you which letters our filter doesn't like.*

## What to actually do

**Pick a brand name for your publisher, not your personal name.** Not for vanity — to walk around a landmine. A brand-like ID (`acme-tools`, `gitstudio`, whatever) sails through; a plain human name might not, and you'll get zero explanation when it doesn't.

Which leads to the one good thing that came out of this.

## The pivot

Being forced off my own name made me ask a better question: what's the *brand*? Merge Studio is really just the first of a family of Git tools I want to build. So I created a **`gitstudio`** publisher (no problem — no `anton` in it), and shipped Merge Studio as `gitstudio.merge-studio`, under a brand that has room to grow.

There's a real lesson hiding in the annoyance: **your publisher is your brand/umbrella; your extension is the product.** They're different things. Big suites ship under an org publisher, not a product-named one. The filter accidentally stopped me from baking a one-off product name into a permanent publisher slot.

## The plot twist: Open VSX is the bigger store

One more thing nobody tells you. "The VS Code Marketplace" is **Microsoft's**. Cursor, VSCodium, Gitpod, and Windsurf don't use it — they use **Open VSX**, a separate registry run by the Eclipse Foundation. If you only publish to Microsoft's, every Cursor user can't find you.

I published to both. Two days of data:

| Registry | Installs (first 2 days) |
|---|---|
| **Open VSX** (Cursor, VSCodium, …) | **418** |
| VS Code Marketplace | ~46 |
| (in-editor VS Code) | ~12 |

**Open VSX out-installed the official Marketplace by roughly 8×.** Early numbers are noisy and your mileage will vary — but if you were going to publish to "the marketplace" and stop, that's most of your audience left on the table. The registry that fought me the *least* is the one that mattered the *most*.

## TL;DR

- "Suspicious content" on publisher creation = a filter rejecting a *string in your publisher name*, before it ever sees your extension. Often a plain personal name.
- It follows the name across accounts/browsers/VPNs. Support won't tell you why.
- **Use a brand-like publisher name.** Test a neutral one to confirm it's the string.
- **Publish to both stores.** Open VSX may well be your bigger audience.

Now the actually-useful part — the full, step-by-step guide to doing all of this without the bruises: **[How to publish a VS Code extension on both marketplaces →](/blog/how-to-publish-a-vscode-extension-on-both-marketplaces)**
