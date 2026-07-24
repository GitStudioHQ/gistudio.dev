/**
 * GitStudio crash-report collector (Vercel serverless function).
 *
 * The GitStudio extension and desktop app POST an anonymous, already-scrubbed
 * report here when a command fails. This function de-duplicates by error
 * signature and files (or bumps) a GitHub issue in a PRIVATE tracker repo, so
 * maintainers get notified of real failures during the beta without users
 * having to report them.
 *
 * It stays fully static-site-friendly: it lives in the root `/api` folder that
 * Vercel serves as a function, and touches none of the Astro build.
 *
 * Hardening notes: the endpoint is reachable by anyone, so it (1) accepts only
 * well-formed reports, (2) re-scrubs and neutralizes all user text before it
 * enters an issue title/body (no markdown or dedup-marker injection), (3) files
 * the issue first and labels it best-effort (a label failure never drops a
 * report), and (4) refuses to open new issues past a ceiling (flood cap).
 *
 * Required environment variables (set in the Vercel project):
 *   GITHUB_TOKEN  fine-grained PAT with Issues: Read & Write on REPORTS_REPO.
 *   REPORTS_REPO  "owner/repo" of the private tracker (default below).
 *
 * Until GITHUB_TOKEN is set the endpoint still returns 204 and does nothing, so
 * it is safe to deploy before wiring up the secret. See ./README.md.
 */

import { createHash } from "node:crypto";

const DEFAULT_REPO = "GitStudioHQ/gitstudio-reports";
const GITHUB_API = "https://api.github.com";
const MAX_BODY_BYTES = 16 * 1024;
const MAX_OPEN_AUTO_ISSUES = 500;
const KNOWN_EVENTS = new Set(["error", "git-error"]);
const KNOWN_PLATFORMS = new Set(["darwin", "win32", "linux", "aix", "freebsd", "openbsd", "sunos"]);

// Minimal structural request/response types — avoids a @vercel/node dependency.
interface Req {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}
interface Res {
  status(code: number): Res;
  json(body: unknown): void;
  end(): void;
  setHeader(name: string, value: string): void;
}

export interface Report {
  event: string;
  installId: string;
  extVersion?: string;
  engine?: string;
  product?: string;
  platform?: string;
  arch?: string;
  osRelease?: string;
  where?: string;
  name?: string;
  message?: string;
  stack?: string;
  op?: string;
  stderr?: string;
}

export default async function handler(req: Req, res: Res): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const report = validate(parseBody(req.body));
  if (!report) {
    res.status(400).json({ error: "bad_report" });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.REPORTS_REPO || DEFAULT_REPO;

  // Deploy-before-secret: accept silently until a token is configured.
  if (token) {
    try {
      await fileOrBump(report, token, repo);
    } catch {
      // Never surface collector internals; the client ignores the response body.
    }
  }
  res.status(204).end();
}

// ── report handling ──────────────────────────────────────────────────────────

export function parseBody(body: unknown): Record<string, unknown> | null {
  if (body && typeof body === "object") {
    // Guard against a huge pre-parsed object (Vercel parses JSON for us).
    try {
      if (JSON.stringify(body).length > MAX_BODY_BYTES) {
        return null;
      }
    } catch {
      return null; // circular / unserializable
    }
    return body as Record<string, unknown>;
  }
  if (typeof body === "string") {
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(body);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Accept only well-formed reports (cheap abuse filter before touching GitHub). */
export function validate(raw: Record<string, unknown> | null): Report | null {
  if (!raw) {
    return null;
  }
  const str = (v: unknown, max: number): string | undefined =>
    typeof v === "string" && v.length <= max ? v : undefined;

  const event = str(raw.event, 32);
  const installId = str(raw.installId, 64);
  if (!event || !KNOWN_EVENTS.has(event) || !installId || !/^[a-f0-9]{8,64}$/.test(installId)) {
    return null;
  }
  const platform = str(raw.platform, 16);
  return {
    event,
    installId,
    extVersion: str(raw.extVersion, 32),
    engine: str(raw.engine, 32),
    product: str(raw.product, 48),
    platform: platform && KNOWN_PLATFORMS.has(platform) ? platform : undefined,
    arch: str(raw.arch, 16),
    osRelease: str(raw.osRelease, 48),
    where: str(raw.where, 80),
    name: str(raw.name, 80),
    message: serverScrub(str(raw.message, 2000)),
    stack: serverScrub(str(raw.stack, 4000)),
    op: str(raw.op, 100),
    stderr: serverScrub(str(raw.stderr, 2000)),
  };
}

/** Belt-and-suspenders scrub in case an old/rogue client sends raw text. */
export function serverScrub(s: string | undefined): string | undefined {
  if (!s) {
    return s;
  }
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
    .replace(/\b(gh[posur]_[A-Za-z0-9]{20,}|[A-Za-z0-9_-]{40,})\b/g, "<token>")
    .replace(/\/Users\/[^/\s"']+/g, "/Users/<user>")
    .replace(/\/home\/[^/\s"']+/g, "/home/<user>");
}

/**
 * Neutralize a single field for safe embedding in an issue title/bullet: one
 * line, no HTML-comment or `gs-sig:` markers (which would poison dedup), no
 * markdown-breaking runs. Kept human-readable.
 */
export function oneLine(s: string | undefined, max: number): string {
  return (s ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/<!--|-->/g, "")
    .replace(/gs-sig:/gi, "gs‐sig​:")
    .replace(/[`*_>#|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Stable across users/versions: groups the same failure into one issue. */
export function signature(r: Report): string {
  const key = [r.event, r.op ?? r.where ?? "", r.name ?? "", normalize(r.message ?? r.stderr ?? "")].join("::");
  return createHash("sha1").update(key).digest("hex").slice(0, 12);
}

/** First line, with volatile bits (addresses, line numbers) neutralized. */
export function normalize(s: string): string {
  return (s.split(/\r?\n/)[0] ?? "")
    .replace(/0x[0-9a-f]+/gi, "")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

async function fileOrBump(r: Report, token: string, repo: string): Promise<void> {
  const sig = signature(r);
  const existingNumber = await findOpenIssue(sig, token, repo);
  if (existingNumber !== null) {
    await bumpIssue(existingNumber, token, repo);
  } else {
    await createIssue(r, sig, token, repo);
  }
}

async function findOpenIssue(sig: string, token: string, repo: string): Promise<number | null> {
  const q = `repo:${repo} is:issue is:open in:body "gs-sig:${sig}"`;
  const url = `${GITHUB_API}/search/issues?q=${encodeURIComponent(q)}&per_page=1`;
  const data = (await gh(url, token, "GET")) as { items?: Array<{ number: number }> };
  const hit = data.items?.[0];
  return hit ? hit.number : null;
}

async function bumpIssue(issueNumber: number, token: string, repo: string): Promise<void> {
  // Fresh GET (not the search result, which can be stale/truncated) then PATCH.
  const issue = (await gh(`${GITHUB_API}/repos/${repo}/issues/${issueNumber}`, token, "GET")) as {
    body?: string;
  };
  const now = new Date().toISOString();
  let body = issue.body ?? "";
  body = body.replace(/(\*\*Occurrences:\*\*\s*)(\d+)/, (_m, p: string, n: string) => `${p}${Number(n) + 1}`);
  body = body.replace(/(\*\*Last seen:\*\*).*/, `$1 ${now}`);
  await gh(`${GITHUB_API}/repos/${repo}/issues/${issueNumber}`, token, "PATCH", { body });
}

async function createIssue(r: Report, sig: string, token: string, repo: string): Promise<void> {
  // Flood cap: refuse to open new issues past a ceiling (dedup already collapses
  // repeats; this bounds a burst of DISTINCT fabricated reports). Best-effort —
  // if the count can't be read, proceed rather than drop a legit report.
  try {
    const countUrl = `${GITHUB_API}/search/issues?q=${encodeURIComponent(
      `repo:${repo} is:issue is:open label:auto-report`,
    )}&per_page=1`;
    const count = (await gh(countUrl, token, "GET")) as { total_count?: number };
    if (typeof count.total_count === "number" && count.total_count >= MAX_OPEN_AUTO_ISSUES) {
      return;
    }
  } catch {
    // ignore — don't block a legitimate report on a failed count check
  }

  const now = new Date().toISOString();
  const subject =
    r.event === "git-error"
      ? oneLine(r.op, 90) || "git operation failed"
      : `${oneLine(r.name, 40) || "Error"}: ${normalize(r.message ?? "") || oneLine(r.where, 60) || "unknown"}`;
  const title = `[auto] ${oneLine(subject, 110)}`;
  const env = oneLine(
    `${r.product ?? "GitStudio"} ${r.extVersion ?? "?"} · engine ${r.engine ?? "?"} · ${r.platform ?? "?"}/${r.arch ?? "?"} ${r.osRelease ?? ""}`,
    120,
  );

  const body = [
    "**GitStudio crash report** — filed automatically from an anonymous, scrubbed failure signal.",
    "",
    `- **Type:** ${oneLine(r.event, 20)}`,
    `- **Where:** ${oneLine(r.op ?? r.where, 90) || "—"}`,
    `- **Error:** ${oneLine(r.name, 80) || "—"}`,
    "- **Occurrences:** 1",
    `- **First seen:** ${now}`,
    `- **Last seen:** ${now}`,
    `- **Seen on:** ${env}`,
    "",
    "### Message",
    codeBlock(r.message),
    "",
    "### Stack / stderr",
    codeBlock(r.stack ?? r.stderr),
    "",
    `<!-- gs-sig:${sig} -->`,
  ].join("\n");

  // File the issue FIRST (no labels), so a label failure can never drop it.
  const created = (await gh(`${GITHUB_API}/repos/${repo}/issues`, token, "POST", { title, body })) as {
    number?: number;
  };
  if (created && typeof created.number === "number") {
    try {
      await gh(`${GITHUB_API}/repos/${repo}/issues/${created.number}/labels`, token, "POST", {
        labels: ["auto-report", `platform:${r.platform ?? "unknown"}`],
      });
    } catch {
      // Labels are cosmetic — never fail the report over them.
    }
  }
}

/** Fenced code block with fences and dedup markers neutralized so embedded
 *  user text can't break out of the block or forge a `gs-sig:` marker. */
function codeBlock(s: string | undefined): string {
  const text = (s ?? "").trim();
  if (!text) {
    return "_(none)_";
  }
  const safe = text.replace(/```/g, "``​`").replace(/gs-sig:/gi, "gs‐sig​:");
  return "```\n" + safe + "\n```";
}

async function gh(url: string, token: string, method: string, body?: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const resp = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "gitstudio-error-collector",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`github ${resp.status}`);
    }
    return resp.status === 204 ? {} : await resp.json();
  } finally {
    clearTimeout(timer);
  }
}
