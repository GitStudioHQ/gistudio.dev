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
  /** Node's error code ("ENOENT") and system call ("spawn"), from current clients. */
  code?: string;
  syscall?: string;
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
    // Scrubbed, then cut down to what helps fix the failure (serverMessage,
    // serverFrames, serverVerdict): an old client sent git's whole output and
    // stacks with every folder in them. A current client's report is already
    // that shape, and passes through unchanged.
    message: serverMessage(serverScrub(str(raw.message, 2000))),
    stack: serverFrames(serverScrub(str(raw.stack, 4000))),
    op: str(raw.op, 100),
    stderr: serverVerdict(serverScrub(str(raw.stderr, 2000))),
    code: match(str(raw.code, 41), /^[A-Z][A-Z0-9_]{1,40}$/),
    syscall: match(str(raw.syscall, 21), /^[a-z][a-z_]{0,20}$/),
  };
}

/**
 * Belt-and-suspenders scrub in case an old/rogue client sends raw text.
 *
 * Clients up to extension 1.25.0 / desktop 2.10.0 kept every host name, so a
 * self-hosted forge's or a company proxy's name ("Could not resolve proxy:
 * proxy.<office>.<company>.corp") reached the tracker. Those clients stay
 * installed, so the host rules are applied here too — the same rules as the
 * clients' shared scrubber (GitStudio's packages/host-bridge/src/scrub.ts),
 * ported, and kept in step with it by hand. On a current client's report they
 * change nothing: everything they match is already a tag.
 */
export function serverScrub(s: string | undefined): string | undefined {
  if (!s) {
    return s;
  }
  return scrubHosts(
    clipForScrub(s, MAX_SCRUB_INPUT)
      // Every rule starts only where a run of its characters starts (the
      // lookbehinds): a `\b` start made a long "a.a.a…" quadratic.
      .replace(NET_USERINFO, "$1")
      .replace(NET_PATH, "$1/<path>")
      .replace(/(?<![\w.+-])([\w.+-]+@[\w.-]+):[\w./~+-]+/g, "$1:<path>")
      .replace(/(?<![\w.+-])[\w.+-]+@[\w-]+\.\(none\)/g, "<email>")
      .replace(/(?<![\w.+-])[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
      .replace(/(?<![\w.+-])[\w.+-]+@[\p{L}\p{N}_-]+(?:\.\(none\))?(?=$|[\s:'"),;\]>])/gmu, "<email>")
      // A home's user, then paths outside a home and UNC / drive paths (an
      // old client kept these). The user stops at ":" too, so a fixed point.
      .replace(/\/Users\/[^/\s"':]+/g, "/Users/<user>")
      .replace(/\/home\/[^/\s"':]+/g, "/home/<user>")
      .replace(/(?<![\w./-])refs\/(?:heads|remotes|tags)\/[^\s'"`),;:]+/g, "<ref>")
      .replace(/\b[A-Za-z]:\\[^\s"':]+/g, "<path>")
      .replace(/\b[A-Za-z]:\/(?!\/)[^\s"':]*/g, "<path>")
      .replace(/\\\\[^\s"':]+/g, "<path>")
      .replace(/(?<![:\w/>])\/\/[^\s"'/:]+\/[^\s"':]*/g, "<path>")
      .replace(
        /(?:(?<![\w.:/~<>-])|(?<=file:\/\/))\/(?:Volumes|mnt|media|opt|srv|data|root|workspaces?|projects|repos|code|work|src|var\/www|var\/lib|var\/opt)\/[^\s"':]*/g,
        "<path>",
      )
      // A remote with no user in front of it: "git.acme.example:team/widgets.git",
      // or "github-acme:<path>" as an old client collapsed it.
      .replace(HOST_PATH, (m: string, host: string) => (NOT_A_REMOTE.test(host) ? m : `${hostOr(host)}:<path>`))
      // Who a forge names: the account, the SAML organization, the file a size
      // limit refused; and the Windows accounts and SIDs of "dubious ownership".
      .replace(/\b(Permission to )\S+( denied\b)/g, "$1<path>$2")
      .replace(/\b(with the login of )[^\s.,;]+/g, "$1<account>")
      .replace(/\b(User )[\w.-]+( does not have\b)/g, "$1<account>$2")
      .replace(/\b(with name or identifier )\S+( does not exist\b)/g, "$1<repo>$2")
      .replace(/\b(denied to )[\w.-]+?(?=\.?(?:\s|$))/gm, "$1<user>")
      .replace(/\b(The [`'"])(?!<[a-z]+>)[^`'"\s]+(['"] organization\b)/g, "$1<org>$2")
      .replace(/\b(File )\S+( is \d+(?:\.\d+)? [KMG]B\b)/g, "$1<file>$2")
      .replace(/((?:is owned by|current user is):[ \t]*\r?\n[ \t]*)(?![ \t]|<[a-z]+>)[^\n(]*?(?= \(|[ \t]*\r?$)/gm, "$1<user>")
      .replace(/\bS-1-5-21(?:-\d+){2,}\b/g, "<sid>")
      .replace(/\b(gh[posur]_[A-Za-z0-9]{20,}|[A-Za-z0-9_-]{40,})\b/g, "<token>"),
  );
}

function match(v: string | undefined, re: RegExp): string | undefined {
  return v !== undefined && re.test(v) ? v : undefined;
}

// ── what a report keeps (ported from GitStudio's reportShape.ts) ─────────────
//
// A report carries only what helps fix a failure: a git command's subcommand
// and options (never its arguments), git's verdict lines (never its
// progress, hints, banners or file lists), and call frames without folders.
// Current clients send exactly that; these rules make an old client's report
// the same shape. Hand-kept in step with packages/host-bridge/src/
// reportShape.ts: change one, change the other. Each is idempotent.

/** The lines in which git, or the ssh under it, says what went wrong. */
const VERDICT =
  /^(?:(?:fatal|error|remote: (?:fatal|error)|ssh|kex_exchange_identification):|CONFLICT \(|! \[|Host key verification failed|Unable to negotiate|Connection (?:closed|reset|timed out|refused)\b|[^\n]{0,80}\bPermission denied \()/;

/** git's words inside a line of someone else's ("Undo couldn't …: fatal: …"). */
const GIT_INSIDE = /[:：\s]((?:fatal|error): [^\n]*)$/;

/** Lines that are never the failure: progress, banners, advice, a rebase's exec, file lists. */
const NOISE =
  /^(?:\s|hint:|remote:|To |From |\*\*|Cloning into|Receiving |Resolving |Counting |Compressing |Writing |Enumerating |Total |Unpacking |Updating |Fast-forward|Already up to date|Auto-merging |Delta compression|POST git-|Your branch |Please |and the repository exists|If you wish to|Otherwise,|You can |Use '|Executing: |Could not execute|Not committing merge|Resolve all conflicts|To abort|and then run|When you have resolved)/;

/** A line git or an app writes starts with a letter; a hook's report often doesn't. */
const PROSE = /^\p{L}/u;

/** git's verdict lines out of its (already scrubbed) output; at most four. */
export function serverVerdict(s: string | undefined): string | undefined {
  if (!s) return s;
  const lines = s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .map((l) => (VERDICT.test(l) ? l : (GIT_INSIDE.exec(l)?.[1] ?? l)));
  const verdicts = lines.filter((l) => VERDICT.test(l));
  const kept = verdicts.length > 0 ? verdicts : lines.filter((l) => !NOISE.test(l) && PROSE.test(l)).slice(0, 1);
  return [...new Set(kept)]
    .slice(0, 4)
    .map((l) => clipForScrub(l, 200))
    .join("\n")
    .slice(0, 600);
}

const GIT_REVISION =
  /^(?=.)(?:HEAD|FETCH_HEAD|ORIG_HEAD|MERGE_HEAD|CHERRY_PICK_HEAD|REVERT_HEAD|REBASE_HEAD|AUTO_MERGE|@(?!\{))?(?:@\{(?:u|upstream|push|-?\d{1,4})\})?(?:[~^]\d{0,3}){0,4}$/;
const TWO_WORD = new Set(["stash", "remote", "worktree", "notes", "bisect", "submodule", "sparse-checkout", "lfs", "reflog", "maintenance", "bundle", "commit-graph", "multi-pack-index"]);
const SECOND_WORDS = new Set([
  "push", "pop", "apply", "drop", "list", "show", "save", "clear", "create", "store", "branch", "add", "remove", "rm",
  "rename", "prune", "move", "lock", "unlock", "repair", "set-url", "get-url", "set-head", "set-branches", "update",
  "init", "status", "sync", "foreach", "deinit", "start", "good", "bad", "new", "old", "reset", "skip", "run", "log",
  "expire", "delete", "exists", "set", "get", "unset", "edit", "copy", "append", "merge", "absorbgitdirs", "fetch",
  "pull", "install", "track", "untrack", "verify", "write", "register", "unregister",
]);

/** A git command line with every argument the user gave it taken out. */
export function serverCommandShape(args: readonly string[]): string {
  const out: string[] = [];
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === "-c") {
      out.push("-c", configKey(args[++i]));
    } else if (a === "-C" || a === "--git-dir" || a === "--work-tree" || a === "--namespace" || a === "--exec-path") {
      out.push(a, "<path>");
      i++;
    } else if (a.startsWith("-")) {
      out.push(flag(a));
    } else {
      break;
    }
  }
  if (i < args.length) {
    const sub = args[i++];
    out.push(/^[a-z][a-z0-9-]{0,30}$/.test(sub) ? sub : "<arg>");
    if (TWO_WORD.has(sub) && i < args.length && SECOND_WORDS.has(args[i])) out.push(args[i++]);
  }
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      out.push("--");
      if (i + 1 < args.length) out.push("<paths>");
      break;
    }
    if (a.startsWith("-") && a.length > 1) out.push(flag(a));
    else if (GIT_REVISION.test(a) || /^\d{1,9}$/.test(a)) out.push(a);
    else out.push(a === "<args>" ? "<args>" : "<arg>");
  }
  const said: string[] = [];
  for (const w of out) {
    const last = said[said.length - 1];
    if ((w === "<arg>" || w === "<args>") && (last === "<arg>" || last === "<args>")) said[said.length - 1] = "<args>";
    else said.push(w);
  }
  return said.join(" ");
}

function flag(a: string): string {
  if (a.startsWith("--")) {
    const eq = a.indexOf("=");
    const name = eq < 0 ? a : a.slice(0, eq);
    const ok = /^--[a-z0-9][a-z0-9-]{0,40}$/.test(name) ? name : "--<option>";
    if (eq < 0) return ok;
    return `${ok}=${/^\d{1,9}$/.test(a.slice(eq + 1)) ? a.slice(eq + 1) : "…"}`;
  }
  if (/^-[A-Za-z]$/.test(a) || /^-\d{1,9}$/.test(a)) return a;
  return /^-[A-Za-z]/.test(a) ? `${a.slice(0, 2)}…` : "-…";
}

function configKey(kv: string | undefined): string {
  const m = /^([A-Za-z][\w.-]{0,60})=/.exec(kv ?? "");
  if (!m) return "<arg>";
  const parts = m[1].split(".");
  return `${parts.length > 2 ? `${parts[0]}.<sub>.${parts[parts.length - 1]}` : m[1]}=…`;
}

const THROWN_GIT = /^(?:Error: )?git ([\s\S]{1,4000}?) (?:exited with code (-?\d{1,4})|failed)(?:: ([\s\S]*))?$/;

/** A thrown "git <args> exited with code N: <stderr>" as its shape and verdict. */
export function serverMessage(s: string | undefined): string | undefined {
  if (!s) return s;
  const m = THROWN_GIT.exec(s);
  if (!m) {
    // An old client cut its message at 300 characters, sometimes before
    // "exited with code N": the arguments are all there is, and all go.
    const cut = /^(?:Error: )?git ([a-z][\s\S]*)$/.exec(s);
    return cut ? `git ${serverCommandShape(cut[1].replace(/ …$/, "").split(/\s+/).filter(Boolean))} …` : s;
  }
  const said = serverVerdict(m[3] ?? "");
  const how = m[2] === undefined ? "failed" : `exited with code ${m[2]}`;
  return `git ${serverCommandShape(m[1].split(/\s+/).filter(Boolean))} ${how}${said ? `: ${said}` : ""}`;
}

const FRAME_LINE = /^(?: {4}|\t)at (.+)$/;
const FN_NAME = /^(?:async |new )?[\w$.<>[\]]{1,100}(?: \[as [\w$.<>]{1,60}\])?$/;

/**
 * Call frames only, each a function and a file NAME with line and column:
 * the block of frames that ENDS the stack, since an old client's stack begins
 * with the message, whose lines can look like frames (a Node hook's stderr).
 */
export function serverFrames(s: string | undefined): string | undefined {
  if (!s) return s;
  const lines = s.split("\n");
  let from = lines.length;
  while (from > 0 && (FRAME_LINE.test(lines[from - 1]) || lines[from - 1] === "")) from--;
  const out: string[] = [];
  for (const line of lines.slice(from)) {
    const m = FRAME_LINE.exec(line);
    if (!m) continue;
    out.push(`    at ${m[1].length > 400 ? "<frame>" : frame(m[1].trim())}`);
    if (out.length >= 15) break;
  }
  return out.join("\n");
}

function frame(body: string): string {
  const open = body.indexOf(" (");
  if (open > 0 && body.endsWith(")")) {
    const fn = body.slice(0, open);
    return `${FN_NAME.test(fn) ? fn : "<fn>"} (${location(body.slice(open + 2, -1))})`;
  }
  return location(body);
}

function location(loc: string): string {
  if (/^node:[\w/.-]{1,80}(?::\d+){0,2}$/.test(loc) || /^(?:<anonymous>|native|index \d{1,4})$/.test(loc)) return loc;
  const tail = loc.slice(Math.max(loc.lastIndexOf("/"), loc.lastIndexOf("\\")) + 1);
  const at = /(?::\d{1,9}){1,2}$/.exec(tail);
  const name = at ? tail.slice(0, at.index) : tail;
  return `${/^[\w.@-]{1,60}$/.test(name) ? name : "<file>"}${at?.[0] ?? ""}`;
}

// ── host names (ported from GitStudio's scrub.ts) ────────────────────────────
//
// A host name is kept only when it is a PUBLIC service's; every other one
// becomes <host>. Found three ways: a URL's authority; where a network error
// names one ("Could not resolve proxy: X", "connect to host X port 22", …),
// taken whole; and anything else shaped like a host under a top-level domain,
// outside stack frames and the places a JavaScript name stands.

/** Hosts that name a public service, never a person or an organisation. Exact
 *  names only: a SUBDOMAIN of one is often the organisation itself
 *  (acme.visualstudio.com, acme.ghe.com, acme.github.io). */
const PUBLIC_HOSTS = new Set([
  // forges
  "github.com", "www.github.com", "api.github.com", "ssh.github.com", "gist.github.com",
  "codeload.github.com", "uploads.github.com", "raw.githubusercontent.com",
  "objects.githubusercontent.com", "docs.github.com", "git-lfs.github.com", "lfs.github.com", "git-lfs.com",
  "release-assets.githubusercontent.com", "objects-origin.githubusercontent.com", "avatars.githubusercontent.com",
  "support.github.com", "gh.io", "www.gravatar.com", "ollama.com",
  "gitlab.com", "www.gitlab.com", "altssh.gitlab.com", "registry.gitlab.com",
  "bitbucket.org", "api.bitbucket.org", "altssh.bitbucket.org",
  "gitee.com", "codeberg.org", "gitea.com", "git.sr.ht", "sr.ht",
  "sourceforge.net", "git.code.sf.net", "huggingface.co",
  "dev.azure.com", "ssh.dev.azure.com", "vs-ssh.visualstudio.com",
  // named in git's and ssh's own messages
  "git-scm.com", "openssh.com", "www.openssh.com", "aka.ms",
  // AI providers the apps connect to
  "api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com",
  "api.groq.com", "api.deepseek.com", "api.mistral.ai", "api.x.ai", "api.together.xyz", "openrouter.ai",
  // our own
  "gitstudio.dev", "localhost",
]);

/** Top-level domains that make even ONE dot a host: the common public ones,
 *  and the private ones companies name internal hosts under. */
const HOST_TLDS = new Set([
  "com", "net", "org", "edu", "gov", "mil", "io", "co", "dev", "cloud", "tech", "biz", "xyz", "online",
  "site", "systems", "company", "office", "vpn", "network", "eu", "uk", "de", "fr", "nl", "ch", "se",
  "dk", "fi", "ie", "es", "pt", "cz", "sk", "hu", "ro", "bg", "gr", "tr", "il", "ru", "ua", "cn", "hk",
  "tw", "jp", "kr", "sg", "th", "vn", "ph", "au", "nz", "ca", "mx", "br", "ar", "cl", "za", "ae", "sa",
  "corp", "lan", "internal", "intranet", "intra", "private", "localdomain", "example", "invalid", "arpa",
  "local", "home",
]);

/** TLDs that are also words or file extensions ("Cursor.app", "logger.info",
 *  "README.md", "build.sh"): a host only with two dots or a hyphen. Every other
 *  two-letter TLD (a country's) counts with two dots too. */
const WORDISH_TLDS = new Set([
  "ai", "me", "us", "in", "it", "is", "to", "so", "no", "at", "be", "by", "do", "my", "id", "pl", "sh", "gg",
  "ly", "md", "py", "rs", "cc", "ps", "mk", "am", "as", "ad", "app", "info", "test", "int",
  "group", "global", "services", "solutions", "zone", "host", "team", "works", "studio", "digital",
]);
/** …of which these are file extensions too: a hyphen alone never makes one a
 *  host ("release-notes.md", "run-checks.sh", "libssl-3.so", "Android-Studio.app"). */
const EXT_LIKE_TLDS = new Set(["md", "sh", "py", "rs", "so", "pl", "cc", "ps", "mk", "am", "as", "app", "ad"]);
/** Reverse-DNS identifiers start with a TLD ("com.jetbrains.intellij.ce"). */
const REVERSE_DNS_ROOTS = new Set(["com", "org", "net", "io", "dev", "app", "co", "me", "edu", "gov"]);

/** File extensions: never a host, however many dots ("index.d.ts", "vue.config.js"). */
const FILE_EXTS = new Set([
  "js", "mjs", "cjs", "ts", "mts", "cts", "jsx", "tsx", "json", "map", "node", "lock", "yml", "yaml", "toml",
  "ini", "cfg", "conf", "log", "exe", "dll", "dylib", "asar", "bat", "cmd", "java", "kt", "swift", "cpp",
  "hpp", "php", "lua", "vue", "svelte", "xml", "svg", "png", "jpg", "jpeg", "gif", "ico", "icns", "zip",
  "gz", "tgz", "tar", "dmg", "pkg", "msi", "deb", "rpm", "wasm", "bin", "dat", "db", "sqlite", "patch",
  "diff", "orig", "rej", "bak", "tmp", "pem", "crt", "key", "pub", "gpg", "asc", "sig", "plist", "pyc",
  "class", "jar", "war", "whl", "gem", "crate", "vsix", "csv", "tsv", "pdf", "doc", "docx", "xls", "xlsx",
  "ppt", "pptx", "rtf", "mp3", "mp4", "mov", "webm", "wav", "ttf", "otf", "woff", "woff2", "txt", "html",
  "htm", "css", "scss", "less", "env", "rb", "go", "cs",
]);

/** The first name of a JavaScript expression, never a host's first label. */
const JS_ROOTS = new Set([
  "this", "self", "globalthis", "window", "document", "process", "module", "exports", "require", "console",
  "navigator", "json", "math", "object", "array", "promise", "reflect", "symbol", "intl", "electron", "vscode",
]);

/** The network schemes whose URLs name a host (never file:, vscode-…:). */
const NET_SCHEMES = String.raw`(?:https?|ssh|git|git\+ssh|ssh\+git|ftps?|wss?|socks[45]?[ah]?|smb|afp|nfs|file)`;
// Not after a word, "-", "+" or ".": "vscode-file://vscode-app/…:1:2" is not a
// file: URL, and its frame's line and column must stay.
const SCHEME_START = String.raw`(?<![\w+.-])`;
const NET_USERINFO = new RegExp(String.raw`(${SCHEME_START}${NET_SCHEMES}:\/\/)[^/\s@"']*@`, "gi");
const NET_PATH = new RegExp(String.raw`(${SCHEME_START}${NET_SCHEMES}:\/\/[^/\s"']+)\/[^\s"')]*`, "gi");
const NET_HOST = new RegExp(String.raw`(${SCHEME_START}${NET_SCHEMES}:\/\/)([\p{L}\p{N}_][^/\s"'<>@:\[\]?#]*)`, "giu");

/** A remote spelled host:path (see scrub). The path holds a slash, or ends
 *  .git — or is already a tag: "github-acme:<path>" as an older client left it. */
const HOST_PATH =
  /(?<![\p{L}\p{N}_.@/\\:<>~-])([\p{L}\p{N}_][\p{L}\p{N}_-]*(?:\.[\p{L}\p{N}_-]+)*):(?!\/\/)((?:[\p{L}\p{N}_.~+-][^\s'"`),;:/]*)?\/[^\s'"`),;]*|[^\s'"`),;:/]*\.git\b|<(?:path|ref)>)/gu;
/** Not remotes: a drive letter, an all-capitals ref (HEAD:refs/…), a scheme. */
const NOT_A_REMOTE = /^(?:[A-Za-z]|[A-Z_]+|node|file|data|blob|about|chrome|electron|vscode(?:-[a-z]+)?|webpack|internal|https?|ssh|git|mailto|refs)$/;

/** A host as an error names it: a tag a rule above left (<ip>, <email>),
 *  optionally with what follows its colon, or the whole run of characters a
 *  host could be spelled with. Split into host and rest by hostToken. */
const TOK = String.raw`(<[a-z]+>(?::[^\s'"\`(),;<>\[\]（）：]+)?|[^\s'"\`(),;<>\[\]（）：]+)`;

/** Where a network error names a host, the host following directly. */
const HOST_IN_CONTEXT = new RegExp(
  String.raw`((?:\b(?:Could not resolve (?:hostname\b|host:?|proxy:?)|unable to look up|unable to connect to|getaddrinfo E[A-Z_]+\b|connect E[A-Z_]+\b|[Hh]ost key for|host key is known for|authenticity of host '|Permanently added '|host ?name ['(]|subject name ['(]|in connection to|connect failed:|No such host is known\.?[ \t]*\(|DNS:|Host:)|无法查找|无法连接到)[ \t]*\[?)` +
    TOK,
  "g",
);
/** Where ssh and curl name a host before its port ("connect to host X port
 *  22", "Unable to negotiate with X port 22", "Disconnected from X port 22"),
 *  or before ssh's own words about it. */
const HOST_BEFORE = new RegExp(
  // (A bounded run of blanks: a lookbehind is tried at every position, and an
  // unbounded one walked back over a 16k run of spaces from each — quadratic.)
  String.raw`(?<=(?:\b(?:to|by|from|with|host|for|Connection to|Timeout, server)|<user>)[ \t]{1,8}\[?)` +
    TOK +
    String.raw`(?=\]?(?:[ \t]+port[ \t]+\d|[ \t]+closed\b|[ \t]+not responding\b|[ \t]*[（(](?:port|Port|端口)[ \t]*\d))`,
  "g",
);
/** A host:port after the words that introduce an address ("Ollama at
 *  llm-box:11434", "using proxy gitproxy:3128", "Failed connect to X:443"). */
// A lookbehind, not a group: "server at llmbox:11434" and "host gitbox:22
// via proxy gitproxy:3128" have two lead words in a row, and a consumed lead
// used up the word that introduced the next host.
const HOST_PORT_AFTER = new RegExp(
  String.raw`(?<=\b(?:to|at|via|proxy|server|host|from|by|with|on|reach)[ \t]{1,8}\[?)` + TOK,
  "g",
);
/** A dotless host:port wherever it stands as one: "(llmbox:11434)", "llmbox:1234
 *  returned 404", "Stream from llmbox:1234 failed" — the shapes the AI
 *  providers' errors take with the user's own endpoint in them. */
const BARE_HOST_PORT =
  /(?<![\p{L}\p{N}_.@/\\:<>-])([\p{L}_][\p{L}\p{N}_-]*):(\d{2,5})(?![\p{L}\p{N}_.:/-])/gu;
/** Words that stand before ":<number>" and are not hosts. */
const NOT_HOST_WORDS = new Set([
  "line", "col", "column", "row", "port", "page", "id", "code", "status", "step", "attempt", "pid", "uid",
  "gid", "errno", "exit", "signal", "offset", "index", "length", "size", "count", "version", "v", "ver",
  "build", "http", "https", "ssh", "git", "file", "node", "localhost", "error", "warning", "fatal", "hint",
  "remote", "debug", "info", "trace", "at", "in", "of", "to", "chunk", "part", "level", "depth", "timeout",
]);
/** The AI providers' sentences that START with the endpoint ("llmbox request
 *  failed (HTTP 500).", "acme.ai returned 404 — …") or name it in "Stream from
 *  X failed" (packages/ai's openaiCompat). */
const AI_HOST_FIRST =
  /^([^\s'"`(),;<>[\]]+)(?= (?:request failed \(HTTP \d|returned \d{3}\b|rejected the API key|rate limit hit|refused the request))/gm;
const AI_STREAM_FROM = /(?<=\bStream from )([^\s'"`(),;<>[\]]+)(?= failed\b)/g;
/** "Couldn't reach llmbox (ENOTFOUND)": a lowercase name — a product's is capitalised. */
const REACH_HOST = /(?<=\b(?:Couldn't|could not|Could not) reach[ \t]{1,8})(\p{Ll}[\p{L}\p{N}_-]*)(?=[ \t]+\(E[A-Z_]+\))/gu;
/** Translated git:// lookups that put the host first: "Konnte X nicht nachschlagen". */
const HOST_THEN = new RegExp(String.raw`(\bKonnte[ \t]+)` + TOK + String.raw`(?=[ \t]+nicht nachschlagen)`, "g");
/** git://'s second line, the host first: "gitbox[0: <ip>]: errno=Connection refused". */
const HOST_LINE_START = /^([^\s'"`(),;<>[\]]+)(?=\[\d+: )/gm;
/** ssh's "… user bob gitbox port 22": the user before the host. */
const USER_BEFORE_HOST = /\b(user[ \t]+)[^\s<]+(?=[ \t]+\S+[ \t]+port[ \t]+\d)/g;

/** Rule 3: dotted labels in any script ending in a letters-only TLD. */
const DOTTED_HOST =
  /(?<![\p{L}\p{N}_.@/\\-])(?:[\p{L}\p{N}_](?:[\p{L}\p{N}_-]*[\p{L}\p{N}_])?\.)+(\p{L}{2,24})(?![\p{L}\p{N}_-]|\.[\p{L}\p{N}])(\/[^\s'"`),;]*)?/gu;

const isTag = (t: string): boolean => /^<[a-z]+>$/.test(t);

/** `host` as it may leave the machine: itself when public (or already a tag), else <host>. */
function hostOr(host: string): string {
  if (!host || isTag(host)) return host;
  return PUBLIC_HOSTS.has(host.toLowerCase().replace(/\.$/, "")) ? host : "<host>";
}

/** A port is kept; anything else after the host is part of an address. */
const restOr = (rest: string): string =>
  !rest || /^:\d+$/.test(rest) || !/[\p{L}\p{N}]/u.test(rest) ? rest : ":<path>";

/** A whole token where a host stands: the host, then a port or the rest of an
 *  address, then the sentence's own trailing "." or ":" (ssh's "X: …"). */
function hostToken(token: string): string {
  let end = token.length;
  while (end > 0 && (token[end - 1] === "." || token[end - 1] === ":")) end--;
  const core = token.slice(0, end);
  // An IPv6 literal, as Node prints one with its port ("::1:11434",
  // "fd00::1:8443"): the last group is the port when what is left still
  // reads as an address. Never ":<path>".
  if (/^[0-9a-f]*::?[0-9a-f:]*$/i.test(core) && core.includes(":") && /::/.test(core)) {
    const m = /^(.*::.*?[0-9a-f]?):(\d{1,5})$/i.exec(core);
    const port = m && !m[1].endsWith(":") ? `:${m[2]}` : "";
    return "<ip>" + port + token.slice(end);
  }
  const colon = core.indexOf(":");
  const host = colon < 0 ? core : core.slice(0, colon);
  return hostOr(host) + restOr(colon < 0 ? "" : core.slice(colon)) + token.slice(end);
}

/** Is this dotted match a host, given what stands around it? */
function dottedIsHost(match: string, tld: string, after: string): boolean {
  const t = tld.toLowerCase();
  if (FILE_EXTS.has(t)) return false;
  // Where a JavaScript name stands: "x.y is not a function", "x.y(", "this.x".
  if (/^\(|^[ \t]+is[ \t]+(?:not|undefined|null)\b/.test(after)) return false;
  const first = match.slice(0, match.indexOf(".")).toLowerCase();
  if (JS_ROOTS.has(first)) return false;
  const dots = match.split(".").length - 1;
  if (dots >= 2 && REVERSE_DNS_ROOTS.has(first)) return false;
  if (dots >= 2) {
    // camelCase is never a TLD ("e.repo.getFoo"); every listed TLD and every
    // country's two letters are.
    if (!/^(?:\p{Ll}+|\p{Lu}+|\p{Lu}\p{Ll}+)$/u.test(tld)) return false;
    return HOST_TLDS.has(t) || WORDISH_TLDS.has(t) || t.length === 2;
  }
  if (HOST_TLDS.has(t)) return true;
  return WORDISH_TLDS.has(t) && !EXT_LIKE_TLDS.has(t) && match.includes("-");
}

export function scrubHosts(input: string): string {
  return input
    .replace(NET_HOST, (_m, scheme: string, host: string) => scheme + hostOr(host))
    .replace(USER_BEFORE_HOST, "$1<user>")
    .replace(HOST_IN_CONTEXT, (_m, lead: string, token: string) => lead + hostToken(token))
    .replace(HOST_BEFORE, (_m, token: string) => hostToken(token))
    .replace(HOST_THEN, (_m, lead: string, token: string) => lead + hostToken(token))
    .replace(HOST_PORT_AFTER, (m: string, token: string) =>
      /^[^:]+\]?:\d{2,5}[.:]?$/.test(token) ? hostToken(token) : m,
    )
    .replace(REACH_HOST, (h: string) => hostOr(h))
    .replace(AI_HOST_FIRST, (_m, token: string) => hostToken(token))
    .replace(AI_STREAM_FROM, (_m, token: string) => hostToken(token))
    .replace(HOST_LINE_START, (_m, token: string) => hostToken(token))
    .replace(/^.*$/gm, (line) =>
      // A stack frame's function names are dotted too ("at s.init (…)"); its
      // file is a path, which the path rules have already taken.
      /^\s*at\s/.test(line)
        ? line
        : line
          .replace(BARE_HOST_PORT, (m: string, host: string, port: string) =>
            NOT_HOST_WORDS.has(host.toLowerCase()) ? m : `${hostOr(host)}:${port}`,
          )
          .replace(DOTTED_HOST, (m: string, tld: string, path: string | undefined, offset: number) => {
            // A host with a path after it ("gitlab.acme.example/team/widgets"):
            // the path is the org and repository, as in a URL.
            const h = path ? m.slice(0, m.length - path.length) : m;
            if (!dottedIsHost(h, tld, line.slice(offset + h.length, offset + h.length + 16))) return m;
            return hostOr(h) + (path && path !== "/" ? "/<path>" : (path ?? ""));
          }),
    );
}

/** Longest text scrubbed. The fields are capped at 2000/4000 characters by
 *  validate() already; this keeps the rules' cost bounded whatever calls them. */
const MAX_SCRUB_INPUT = 16_000;
function clipForScrub(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const cut = Math.max(head.lastIndexOf(" "), head.lastIndexOf("\n"), head.lastIndexOf("\t"));
  return cut > max / 2 ? head.slice(0, cut) : head;
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

/** Stable across users/versions: groups the same failure into one issue. Not
 *  the code: the message carries it, and an old client, which sends none,
 *  would file the same failure twice. */
export function signature(r: Report): string {
  const key = [r.event, r.op ?? r.where ?? "", r.name ?? "", normalize(r.message ?? r.stderr ?? "")].join("::");
  return createHash("sha1").update(key).digest("hex").slice(0, 12);
}

/** First line, with volatile bits (addresses, line numbers) neutralized. */
export function normalize(s: string): string {
  return (s.split(/\r?\n/)[0] ?? "")
    .replace(/0x[0-9a-f]+/gi, "")
    // An abbreviated commit sha ("could not apply 1a2b3c4...") is per commit,
    // never per failure: without this every commit filed its own issue.
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/gi, "<sha>")
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
    ...(r.code ? [`- **Code:** ${r.code}${r.syscall ? ` (${r.syscall})` : ""}`] : []),
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
