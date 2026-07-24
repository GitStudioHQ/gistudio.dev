import { strict as assert } from "node:assert";
import { test } from "node:test";
import handler, { validate, parseBody, signature, normalize, oneLine, serverScrub } from "../api/errors";

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
