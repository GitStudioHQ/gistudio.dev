# GitStudio crash-report collector

`api/errors.ts` is a Vercel serverless function that receives anonymous, already-scrubbed crash reports from the GitStudio extension and files them as **deduplicated GitHub issues** in a private tracker repo — so we hear about failures during the beta without waiting for users to report them.

It lives in the root `/api` folder that Vercel serves as a function and touches none of the Astro build; the site stays fully static.

## How it works

1. When a GitStudio command fails, the extension POSTs a scrubbed JSON report to `https://gitstudio.dev/api/errors` (gated by the user's VS Code telemetry setting **and** `gitstudio.errorReporting.enabled`).
2. The function validates + re-scrubs the payload, computes a stable **signature** (event + operation + error name + normalized first message line), then:
   - if an **open** issue with that signature exists → bumps its `Occurrences` counter and `Last seen`;
   - otherwise → opens a new issue titled `[auto] …`, labeled `auto-report` and `platform:*`.
3. When you close a fixed issue, a later recurrence files a fresh one — so regressions resurface instead of hiding.

No payload contains identity, repo contents, file names, commit messages, branch names, or remotes. The extension scrubs first (`apps/extension/src/reporting/scrub.ts`); this function re-scrubs as defense-in-depth.

## One-time setup

1. **Create the private tracker repo** (default name; override with `REPORTS_REPO`):
   ```sh
   gh repo create GitStudioHQ/gitstudio-reports --private -d "Automated GitStudio crash reports"
   ```
2. **Create a fine-grained PAT** scoped to *only* that repo, with **Issues: Read and write** (nothing else). Copy the token.
3. **Add environment variables** to the Vercel project (Settings → Environment Variables, Production + Preview):
   - `GITHUB_TOKEN` = the PAT
   - `REPORTS_REPO` = `GitStudioHQ/gitstudio-reports` *(optional — this is the default)*
4. **Deploy** (push to the branch Vercel builds, or `vercel --prod`).

Until `GITHUB_TOKEN` is set the endpoint returns `204` and does nothing, so it's safe to deploy first and wire the secret afterward.

## Verify

```sh
curl -i -X POST https://gitstudio.dev/api/errors \
  -H 'content-type: application/json' \
  -d '{"event":"git-error","installId":"deadbeefcafe","op":"git push failed","platform":"darwin","extVersion":"1.2.0"}'
# => 204, and an "[auto] git push failed" issue appears in the tracker
```

## Notes / future hardening

- The abuse guard for the beta is **strict payload validation** (event allow-list, install-id format check, per-field size caps) plus signature **dedup**, which collapses floods of the *same* error into one issue.
- The endpoint is otherwise open (the client sends no secret). If abuse appears, add a per-IP rate limit (Vercel KV) or a shared HMAC the extension signs each report with.
- GitHub's search index is eventually consistent, so two identical reports within a few seconds can occasionally open two issues; merge them if it happens.
