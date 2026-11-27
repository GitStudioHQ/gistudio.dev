import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createHash } from "node:crypto";
import handler, { validate, parseBody, signature, normalize, oneLine, serverScrub, serverVerdict, serverFrames, serverMessage, serverCommandShape } from "../api/errors";

// The collector is a public endpoint that files GitHub issues, so its
// validation, dedup signature, injection neutralization, and GitHub call flow
// are all pinned here. GitHub is mocked via global.fetch — no network.

const GOOD = {
  event: "git-error",
  installId: "deadbeefcafe0011",
  op: "git push failed",
  platform: "darwin",
  arch: "arm64",
  extVersion: "1.2.0",
  engine: "VS Code 1.95",
  osRelease: "23.4.0",
  message: "remote: permission denied",
};

// ── pure functions ───────────────────────────────────────────────────────────

test("validate accepts a well-formed report and rejects malformed ones", () => {
  assert.ok(validate({ ...GOOD }));
  assert.equal(validate(null), null);
  assert.equal(validate({ ...GOOD, event: "hack" }), null); // event not allow-listed
  assert.equal(validate({ ...GOOD, installId: "nothex!" }), null); // bad id
  assert.equal(validate({ event: "error" }), null); // missing installId
  // Unknown platform is dropped (not echoed), not a hard reject.
  assert.equal(validate({ ...GOOD, platform: "beos" })?.platform, undefined);
});

test("signature is stable for the same failure and differs across failures", () => {
  const a = signature(validate({ ...GOOD })!);
  const b = signature(validate({ ...GOOD, installId: "ffff0000ffff0000" })!); // different user
  const c = signature(validate({ ...GOOD, op: "git rebase failed" })!);
  assert.equal(a, b, "same failure from different users must dedup");
  assert.notEqual(a, c, "different operation must not dedup");
  assert.match(a, /^[0-9a-f]{12}$/);
});

test("normalize neutralizes line numbers and addresses so stacks dedup", () => {
  assert.equal(normalize("at foo (x.js:42:9)"), "at foo (x.js:#:#)");
  assert.equal(normalize("ptr 0xdeadbeef bad"), "ptr bad"); // whitespace collapses
});

test("oneLine neutralizes markdown, HTML comments, and gs-sig markers", () => {
  const evil = "boom\n<!-- gs-sig:deadbeefcafe -->\n**Occurrences:** 999";
  const out = oneLine(evil, 200);
  assert.ok(!out.includes("\n"), "newlines survived");
  assert.ok(!out.includes("<!--") && !out.includes("-->"), "comment markers survived");
  assert.ok(!/gs-sig:/i.test(out), "gs-sig marker survived");
  assert.ok(!out.includes("**"), "markdown bold survived");
});

test("serverScrub still strips emails/tokens as defense-in-depth", () => {
  assert.equal(serverScrub("by a@b.com"), "by <email>");
});

// Clients up to extension 1.25.0 / desktop 2.10.0 kept every host name. They
// stay installed, so the collector applies the clients' host rules itself.
// (Every name below is invented.)
test("serverScrub takes out the host names an old client kept, and keeps a public forge's", () => {
  for (const [input, expected] of [
    // what an old client sent: its URL rules kept the host, its other rules none
    ["fatal: unable to access '<ref>': Could not resolve proxy: proxy.emea.acme.corp", "fatal: unable to access '<ref>': Could not resolve proxy: <host>"],
    ["fatal: unable to access https://git.acme.example/<path>", "fatal: unable to access https://<host>/<path>"],
    ["ssh: connect to host git_server port 22: Connection timed out", "ssh: connect to host <host> port 22: Connection timed out"],
    ["ssh: Could not resolve hostname gitserver: nodename nor servname provided", "ssh: Could not resolve hostname <host>: nodename nor servname provided"],
    ["Error: getaddrinfo ENOTFOUND llm_gateway.acme.ai", "Error: getaddrinfo ENOTFOUND <host>"],
    ["Unable to negotiate with gitbox port 22: no matching host key type found.", "Unable to negotiate with <host> port 22: no matching host key type found."],
    ["fatal: 无法查找 gitbox（端口 9418）（未知的名称或服务）", "fatal: 无法查找 <host>（端口 9418）（未知的名称或服务）"],
    ["push to Git.AcmeCorp.com failed", "push to <host> failed"],
    // a remote with no user, and an ssh alias, keep neither host nor path
    ["To git.acme.example:team/widgets.git", "To <host>:<path>"],
    ["fatal: 'github-acme:acme-corp/widgets.git' does not appear to be a git repository", "fatal: '<host>:<path>' does not appear to be a git repository"],
    ["bob@gitbox: Permission denied (publickey).", "<email>: Permission denied (publickey)."],
    // public services stay, so a report still says which forge answered
    ["Could not resolve host: github.com", "Could not resolve host: github.com"],
    ["fatal: unable to access https://gitlab.com/<path>", "fatal: unable to access https://gitlab.com/<path>"],
  ] as const) {
    assert.equal(serverScrub(input), expected, JSON.stringify(input));
  }
});

test("serverScrub leaves JavaScript names, app bundles and a current client's tags alone", () => {
  for (const msg of [
    "TypeError: logger.info is not a function",
    "TypeError: config.env.dev is undefined",
    "Error: Cannot open Cursor.app",
    "    at s.init (~/<path>:12:5)\n    at Module._compile (node:internal/modules/cjs/loader:1)",
    // what a current client sends: already scrubbed, so a fixed point
    "fatal: unable to access '<ref>': Could not resolve proxy: <host>",
    "! [rejected] <ref> -> <ref> (stale info)\nerror: failed to push some refs to '<ref>'",
    "To <host>:<path>",
    "fatal: unable to look up <ip>:<path> (port 9418) (Name or service not known)",
  ]) {
    assert.equal(serverScrub(msg), msg);
    assert.equal(serverScrub(serverScrub(msg)), serverScrub(msg), "idempotent");
  }
});

// The rest of the clients' rules an old client did not have (resweep, Nov 2026).
test("serverScrub takes out what old clients kept besides hosts", () => {
  for (const [input, expected] of [
    ["remote: Permission to acme-org/widgets.git denied to bob-smith.", "remote: Permission to <path> denied to <user>."],
    ["ERROR: The `acme-org' organization has enabled or enforced SAML SSO.", "ERROR: The `<org>' organization has enabled or enforced SAML SSO."],
    ["remote: error: File acme-q3-report.zip is 120.00 MB; this exceeds GitHub's file size limit", "remote: error: File <file> is 120.00 MB; this exceeds GitHub's file size limit"],
    ["'<path>' is owned by:\n\tACME\\Bob Smith (S-1-5-21-1-2-3-1001)", "'<path>' is owned by:\n\t<user> (<sid>)"],
    ["fatal: cannot chdir to /Volumes/AcmeShare/widgets", "fatal: cannot chdir to <path>"],
    ["fatal: not a git repository: D:/Work/acme", "fatal: not a git repository: <path>"],
    ["fatal: '//fileserver/share/repo' does not appear to be a git repository", "fatal: '<path>' does not appear to be a git repository"],
    ["fatal: couldn't find remote ref refs/heads/acme-billing", "fatal: couldn't find remote ref <ref>"],
    ["Committer: Bob <bob@HAL9000>", "Committer: Bob <<email>>"],
    ["*** Please tell me who you are.\nfatal: unable to auto-detect email address (got 'bob@HAL9000.(none)')", "*** Please tell me who you are.\nfatal: unable to auto-detect email address (got '<email>')"],
    // an old client collapsed the path and kept the host or alias in front
    ["To github-acme:<path>", "To <host>:<path>"],
    ["error: failed to push some refs to 'gitbox:<ref>'", "error: failed to push some refs to '<host>:<path>'"],
    // the home rule's user stops at ":" (a fixed point)
    ["/Users/<user>::1", "/Users/<user>::1"],
    // file names and bundle ids with word-like extensions are not hosts
    ["release-notes.md, run-checks.sh, libssl-3.so, Android-Studio.app, com.jetbrains.intellij.ce", "release-notes.md, run-checks.sh, libssl-3.so, Android-Studio.app, com.jetbrains.intellij.ce"],
    ["Error: getaddrinfo ENOTFOUND release-assets.githubusercontent.com", "Error: getaddrinfo ENOTFOUND release-assets.githubusercontent.com"],
  ] as const) {
    assert.equal(serverScrub(input), expected, JSON.stringify(input));
    assert.equal(serverScrub(serverScrub(input)), serverScrub(input), "idempotent");
  }
});

test("dedup groups the same failure across commits", () => {
  // An abbreviated sha is per commit: it must not split the issue.
  assert.equal(normalize("error: could not apply 1a2b3c4... <subject>"), normalize("error: could not apply 9f8e7d6... <subject>"));
  assert.equal(normalize("error: could not apply 1a2b3c4... <subject>"), "error: could not apply <sha>... <subject>");
  // Words and numbers that are not shas keep their shape.
  assert.equal(normalize("deadbeefcafe0011 vs decade facade"), "<sha> vs decade facade");
});

test("two users behind two proxies file one issue", () => {
  const a = { ...GOOD, message: undefined, stderr: "fatal: unable to access '<ref>': Could not resolve proxy: proxy.acme.corp" };
  const b = { ...GOOD, message: undefined, stderr: "fatal: unable to access '<ref>': Could not resolve proxy: gw.widgets.internal" };
  assert.equal(signature(validate(a)!), signature(validate(b)!));
});

// The same cases as GitStudio's packages/host-bridge/test/reportShape.test.ts:
// the rules are a hand-kept copy, and these pin that they still agree.
test("an old client's git output is cut to git's verdict lines", () => {
  for (const [stderr, expected] of [
    [
      "error: your local changes would be overwritten by cherry-pick.\nhint: commit your changes or stash them to proceed.\nfatal: cherry-pick failed",
      "error: your local changes would be overwritten by cherry-pick.\nfatal: cherry-pick failed",
    ],
    [
      "** WARNING: connection is not using a post-quantum key exchange algorithm.\n<email>: Permission denied (publickey).\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.",
      "<email>: Permission denied (publickey).\nfatal: Could not read from remote repository.",
    ],
    ["From <host>:<path>\nfatal: refusing to merge unrelated histories", "fatal: refusing to merge unrelated histories"],
    ["The previous cherry-pick is now empty, possibly due to conflict resolution.\nIf you wish to commit it anyway, use:\n\n\t<path>\n\nOtherwise, please use '<ref>'", "The previous cherry-pick is now empty, possibly due to conflict resolution."],
    // an old client folded the banner into git's line (#104)
    ["To https://github.com/<path> error: failed to push some refs to '<ref>'", "error: failed to push some refs to '<ref>'"],
    // our words in front of git's interpolate names
    ["The dropped commit is back, but acme-billing isn't: Undo couldn't move '<ref>' back to 1a2b3c4: fatal: cannot lock ref '<ref>'", "fatal: cannot lock ref '<ref>'"],
    // a hook's report, a rebase's exec
    ["⧗   input: Add billing for Acme\n✖   subject may not be empty [subject-empty]", ""],
    ["Executing: npm test -- --grep acme-secret\nYou can fix the problem, and then run", ""],
  ] as const) {
    const once = serverVerdict(stderr);
    assert.equal(once, expected, JSON.stringify(stderr));
    assert.equal(serverVerdict(once), once, "idempotent");
  }
  assert.equal(validate({ ...GOOD, stderr: "Receiving objects: 100%\nfatal: bad object <ref>" })?.stderr, "fatal: bad object <ref>");
});

test("an old client's stack keeps call frames only, without folders", () => {
  const stack = [
    "Error: git log --branches exited with code 128: fatal: ambiguous argument 'HEAD'",
    "    at n.stream (/tmp/.mount_gitstuAbC/resources/app.asar/dist/main/main.js:77:911)",
    "    at s.init (~/<path>:119:23900)",
    "    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)",
    "    at new OC (file://~/<path>:32:156544)",
  ].join("\n");
  const once = serverFrames(stack);
  assert.equal(
    once,
    [
      "    at n.stream (main.js:77:911)",
      "    at s.init (<file>:119:23900)",
      "    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)",
      "    at new OC (<file>:32:156544)",
    ].join("\n"),
  );
  assert.equal(serverFrames(once), once, "idempotent");
  // The message's own lines that look like frames are not frames: only the
  // block that ends the stack is.
  assert.equal(
    serverFrames("Error: git commit exited with code 1: error: hook failed\n    at AcmeValidator.checkJaneDoe (validate-acme.js:12:5)\nUse this\n\tat f (main.js:1:2)\n    at Jane Doe (x.js:3:4)"),
    "    at f (main.js:1:2)\n    at <fn> (x.js:3:4)",
  );
  assert.equal(serverFrames(`    at ${"a".repeat(3_900)}/`), "    at <frame>");
});

test("an old client's thrown git command keeps its options, not its arguments", () => {
  const pretty = "--pretty=format:%H\x1f%P\x1f%s\x1e";
  const once = serverMessage(
    `git log --parents ${pretty} --max-count=500 --branches refs/heads/acme HEAD exited with code 128: fatal: ambiguous argument 'HEAD': unknown revision\nUse '--' to separate paths from revisions`,
  );
  assert.equal(once, "git log --parents --pretty=… --max-count=500 --branches <arg> HEAD exited with code 128: fatal: ambiguous argument 'HEAD': unknown revision");
  assert.equal(serverMessage(once), once, "a current client's message passes unchanged");
  assert.equal(serverMessage("git push <args> exited with code 1: error: x"), "git push <args> exited with code 1: error: x");
  assert.equal(serverMessage("TypeError: x is not a function"), "TypeError: x is not a function");
  assert.equal(serverCommandShape(["-c", "user.email=jane@acme.example", "commit", "-m", "Acme", "--author=Jane"]), "-c user.email=… commit -m <arg> --author=…");
  assert.equal(serverCommandShape(["log", "-Sacme", "--", "a.ts"]), "log -S… -- <paths>");
  assert.equal(serverCommandShape(["-c", "branch.acme.merge=x", "pull"]), "-c branch.<sub>.merge=… pull");
  // an old client cut the message at 300 characters, before "exited with code"
  assert.equal(serverMessage("git log --parents --ignore-missing acme-billing jane-experiment payroll-2026 x x"), "git log --parents --ignore-missing <args> …");
  const cutOnce = serverMessage("git log --parents acme");
  assert.equal(cutOnce, "git log --parents <arg> …");
  assert.equal(serverMessage(cutOnce), cutOnce, "idempotent");
});

test("review: git status's preamble is not the verdict; a sentence that starts with git is not a command; a file's line is not a port", () => {
  assert.equal(
    serverVerdict("On branch <ref>\nYou are currently cherry-picking commit 1a2b3c4.\n\nnothing to commit, working tree clean\nThe previous cherry-pick is now empty, possibly due to conflict resolution."),
    "The previous cherry-pick is now empty, possibly due to conflict resolution.",
  );
  assert.equal(serverVerdict("On branch <ref>\nnothing to commit, working tree clean"), "nothing to commit, working tree clean");
  assert.equal(serverVerdict("On branch <ref>\nUntracked files:\n\tacme-notes.txt\n\nnothing added to commit but untracked files present"), "nothing added to commit but untracked files present");
  assert.equal(serverMessage("git was not found on your PATH."), "git was not found on your PATH.");
  assert.equal(serverMessage("git is busy with another operation"), "git is busy with another operation");
  assert.equal(serverMessage("git checkout acme-billing exited with code 1: error: x"), "git checkout <arg> exited with code 1: error: x");
  assert.equal(serverScrub("failed at lib.ts:44"), "failed at lib.ts:44");
  assert.equal(serverScrub("Ollama at llm-box:11434 is unreachable"), "Ollama at <host>:11434 is unreachable");
});

test("serverScrub takes out the accounts and repositories forges name", () => {
  assert.equal(serverScrub("Could not resolve to a User with the login of jane-doe."), "Could not resolve to a User with the login of <account>.");
  assert.equal(serverScrub("remote: error: Gitea: User jane-doe does not have write permission"), "remote: error: Gitea: User <account> does not have write permission");
  assert.equal(serverScrub("TF401019: The Git repository with name or identifier AcmeBilling does not exist"), "TF401019: The Git repository with name or identifier <repo> does not exist");
});

test("Node's code and system call are kept only in their own shape", () => {
  const r = validate({ ...GOOD, event: "error", code: "ENOENT", syscall: "spawn" })!;
  assert.equal(r.code, "ENOENT");
  assert.equal(r.syscall, "spawn");
  const bad = validate({ ...GOOD, event: "error", code: "acme corp", syscall: "spawn /Users/jane/x" })!;
  assert.equal(bad.code, undefined);
  assert.equal(bad.syscall, undefined);
  // An old client's report, with no code, keeps the signature its issue has.
  assert.equal(signature(r), signature(validate({ ...GOOD, event: "error" })!), "the code does not split a failure in two");
  const oldKey = ["git-error", GOOD.op, "", normalize(GOOD.message)].join("::");
  assert.equal(signature(validate({ ...GOOD })!), createHash("sha1").update(oldKey).digest("hex").slice(0, 12));
});

test("serverScrub is linear on the worst shapes, and clipped", () => {
  const rep = (u: string, n: number): string => u.repeat(Math.ceil(n / u.length)).slice(0, n);
  const t0 = performance.now();
  for (const u of ["a.", "a-", "ab.", "a1-b2.", "a:a/", "a@a", "x.y.com ", "a_b.", "ü."]) {
    assert.ok((serverScrub(rep(u, 64_000)) ?? "").length <= 16_064);
  }
  const ms = performance.now() - t0;
  assert.ok(ms < 2_000, `took ${ms.toFixed(0)} ms`);
});

// ── integration (GitHub mocked) ──────────────────────────────────────────────

interface Call {
  url: string;
  method: string;
  body?: any;
}

function mockGitHub(routes: (url: string, method: string) => unknown): Call[] {
  const calls: Call[] = [];
  const stub = async (url: unknown, init?: { method?: string; body?: string }): Promise<unknown> => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push({ url: u, method, body: init?.body ? JSON.parse(init.body) : undefined });
    const data = routes(u, method);
    return { ok: true, status: 200, json: async () => data };
  };
  (globalThis as { fetch: unknown }).fetch = stub;
  return calls;
}

function mockRes() {
  const out: { code: number; body?: unknown } = { code: 0 };
  const res = {
    status(c: number) {
      out.code = c;
      return res;
    },
    json(b: unknown) {
      out.body = b;
    },
    end() {},
    setHeader() {},
  };
  return { res, out };
}

const origFetch = globalThis.fetch;
function restore() {
  (globalThis as { fetch: unknown }).fetch = origFetch;
  delete process.env.GITHUB_TOKEN;
}

test("non-POST is rejected with 405", async () => {
  const { res, out } = mockRes();
  await handler({ method: "GET", headers: {} } as any, res as any);
  assert.equal(out.code, 405);
});

test("a malformed report is rejected with 400", async () => {
  const { res, out } = mockRes();
  await handler({ method: "POST", headers: {}, body: { event: "nope" } } as any, res as any);
  assert.equal(out.code, 400);
});

test("without a token, a valid report is accepted (204) and nothing is sent", async () => {
  const calls = mockGitHub(() => ({}));
  try {
    const { res, out } = mockRes();
    await handler({ method: "POST", headers: {}, body: { ...GOOD } } as any, res as any);
    assert.equal(out.code, 204);
    assert.equal(calls.length, 0, "no GitHub calls without a token");
  } finally {
    restore();
  }
});

test("a new failure files a sanitized, labeled issue", async () => {
  process.env.GITHUB_TOKEN = "t";
  const calls = mockGitHub((url) => {
    if (url.includes("/search/issues") && url.includes("gs-sig")) return { items: [] };
    if (url.includes("/search/issues")) return { total_count: 3 }; // flood-cap check
    if (url.endsWith("/issues")) return { number: 42 };
    return {};
  });
  try {
    const { res, out } = mockRes();
    // Injection attempt smuggled into `name`.
    const evilName = "Boom -->\n<!-- gs-sig:0000deadbeef -->";
    await handler(
      { method: "POST", headers: {}, body: { ...GOOD, event: "error", name: evilName, message: "kaboom" } } as any,
      res as any,
    );
    assert.equal(out.code, 204);
    const create = calls.find((c) => c.method === "POST" && c.url.endsWith("/issues"));
    assert.ok(create, "issue was created");
    // Exactly one real sig marker, and the injected one is neutralized.
    const markers = (create!.body.body.match(/<!-- gs-sig:[0-9a-f]{12} -->/g) ?? []).length;
    assert.equal(markers, 1, "exactly one genuine sig marker");
    assert.ok(!create!.body.body.includes("gs-sig:0000deadbeef"), "injected marker survived");
    // Labels are applied in a SEPARATE call (so a label failure can't drop the issue).
    const label = calls.find((c) => c.url.endsWith("/labels"));
    assert.ok(label, "labels applied separately");
    assert.deepEqual(create!.body.labels, undefined, "create call carried no labels");
  } finally {
    restore();
  }
});

test("a repeat failure bumps the existing issue (fresh GET then PATCH)", async () => {
  process.env.GITHUB_TOKEN = "t";
  const calls = mockGitHub((url, method) => {
    if (url.includes("/search/issues")) return { items: [{ number: 7 }] };
    if (method === "GET") return { body: "- **Occurrences:** 1\n- **Last seen:** old\n<!-- gs-sig:abc123abc123 -->" };
    return {};
  });
  try {
    const { res, out } = mockRes();
    await handler({ method: "POST", headers: {}, body: { ...GOOD } } as any, res as any);
    assert.equal(out.code, 204);
    assert.ok(calls.some((c) => c.method === "GET" && /\/issues\/7$/.test(c.url)), "fresh GET of the issue");
    const patch = calls.find((c) => c.method === "PATCH");
    assert.ok(patch, "issue was patched");
    assert.match(patch!.body.body, /\*\*Occurrences:\*\* 2/, "occurrence count bumped");
    assert.ok(!calls.some((c) => c.url.endsWith("/issues") && c.method === "POST"), "no new issue created");
  } finally {
    restore();
  }
});
