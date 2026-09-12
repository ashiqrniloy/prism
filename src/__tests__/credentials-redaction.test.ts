import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CredentialResolver, OAuthLoginCallbacks, OAuthProvider } from "../index.js";
import {
  createEnvCredentialResolver,
  createExplicitCredentialResolver,
  createProviderRegistry,
  errorToErrorInfo,
  redactSecrets,
  refreshOAuthCredential,
  resolveCredentialValue,
} from "../index.js";

describe("credential boundary", () => {
  it("resolves credentials from direct value callback or resolver", async () => {
    const resolver: CredentialResolver = {
      resolve(request) {
        return { type: "api_key", value: `${request.provider}:token` };
      },
    };

    assert.equal(await resolveCredentialValue("literal", { name: "api" }), "literal");
    assert.equal(await resolveCredentialValue(() => "callback", { name: "api" }), "callback");
    assert.equal(await resolveCredentialValue(resolver, { name: "api", provider: "mock" }), "mock:token");
  });

  it("provider registry does not accept or store credentials", () => {
    const registry = createProviderRegistry();

    registry.register({
      id: "mock",
      async *generate() {
        yield { type: "done" };
      },
    });

    assert.deepEqual(Object.keys(registry.resolve("mock")), ["id", "generate"]);
  });

  it("credential resolution is explicit and not global", async () => {
    process.env.PRISM_TEST_API_KEY = "unused-test-secret";
    try {
      assert.equal(await resolveCredentialValue(undefined, { name: "apiKey", provider: "mock" }), undefined);
    } finally {
      delete process.env.PRISM_TEST_API_KEY;
    }
  });

  it("explicit credential resolver uses documented order", async () => {
    const resolver = createExplicitCredentialResolver([
      { name: "runtime", resolver: { resolve: () => ({ type: "api_key", value: "runtime-key" }) } },
      { name: "stored", resolver: { resolve: () => ({ type: "api_key", value: "stored-key" }) } },
      { name: "fallback", resolver: { resolve: () => ({ type: "api_key", value: "fallback-key" }) } },
    ]);

    assert.equal(await resolveCredentialValue(resolver, { name: "apiKey", provider: "mock" }), "runtime-key");
  });

  it("env credential resolver reads only passed env object", async () => {
    process.env.PRISM_TEST_API_KEY = "real-env-is-ignored";
    try {
      const resolver = createEnvCredentialResolver({ DEMO_API_KEY: "passed-env-key" }, { "mock:apiKey": "DEMO_API_KEY" });

      assert.equal(await resolveCredentialValue(resolver, { name: "apiKey", provider: "mock" }), "passed-env-key");
      assert.equal(
        await resolveCredentialValue(createEnvCredentialResolver({}, { mock: "PRISM_TEST_API_KEY" }), { name: "apiKey", provider: "mock" }),
        undefined,
      );
    } finally {
      delete process.env.PRISM_TEST_API_KEY;
    }
  });

  it("oauth callbacks typecheck and refresh updates caller store", async () => {
    const callbacks: OAuthLoginCallbacks = {
      onAuth(url) {
        assert.equal(url.startsWith("https://"), true);
      },
      onDeviceCode(code) {
        assert.equal(code.userCode, "ABCD");
      },
      onPrompt() {
        return "browser";
      },
      onSelect() {
        return "device";
      },
    };
    const provider: OAuthProvider = {
      id: "mock-oauth",
      async login(cb = callbacks) {
        await cb.onAuth?.("https://example.test/login");
        await cb.onDeviceCode?.({ userCode: "ABCD", verificationUri: "https://example.test/device" });
        return { access: "old-access", refresh: "refresh-token" };
      },
      refresh(credentials) {
        assert.equal(credentials.refresh, "refresh-token");
        return { access: "new-access", refresh: credentials.refresh };
      },
      getCredential(credentials) {
        return credentials.access ? { type: "bearer", value: credentials.access } : undefined;
      },
    };
    const stored: Array<[string, string | undefined]> = [];
    const credentials = await provider.login(callbacks);
    const refreshed = await refreshOAuthCredential({
      provider,
      credentials,
      store: {
        set: (providerId, next) => {
          stored.push([providerId, next.access]);
        },
      },
    });

    assert.equal(refreshed.access, "new-access");
    assert.deepEqual(stored, [["mock-oauth", "new-access"]]);
    assert.equal((await provider.getCredential?.(refreshed))?.value, "new-access");
  });
});

describe("redaction", () => {
  it("redacts known secret values from strings and objects", () => {
    const secret = "sk-test-123";

    assert.equal(redactSecrets(`token=${secret}`, [secret]), "token=[REDACTED]");
    assert.deepEqual(redactSecrets({ nested: [`Bearer ${secret}`] }, [secret]), {
      nested: ["Bearer [REDACTED]"],
    });
  });

  it("bounds recursion depth on hostile deep structures", () => {
    let deep: Record<string, unknown> = { leaf: "sk-deep-1" };
    for (let i = 0; i < 64; i += 1) deep = { next: deep };

    const redacted = redactSecrets(deep, ["sk-deep-1"]) as Record<string, unknown>;
    assert.ok(JSON.stringify(redacted).includes("[MaxDepth]"), "deep input yields a bounded placeholder");
  });

  it("redacts known secret values from error info", () => {
    const info = errorToErrorInfo(new Error("bad key sk-test-123"), ["sk-test-123"]);

    assert.equal(info.message, "bad key [REDACTED]");
  });

  it("handles self-referential objects without crashing", () => {
    const secret = "sk-cycle-1";
    const payload: { token: string; self?: unknown } = { token: secret };
    payload.self = payload;

    const redacted = redactSecrets(payload, [secret]) as { token: string; self: string };

    assert.equal(redacted.token, "[REDACTED]");
    assert.equal(redacted.self, "[Circular]");
  });

  it("handles mutual references and cyclic error cause", () => {
    const secret = "sk-cycle-2";
    const a: { secret: string; b?: unknown } = { secret };
    const b: { a?: unknown } = {};
    a.b = b;
    b.a = a;

    const redacted = redactSecrets(a, [secret]) as { secret: string; b: { a: string } };

    assert.equal(redacted.secret, "[REDACTED]");
    assert.equal(redacted.b.a, "[Circular]");

    const cyclic = new Error("boom");
    (cyclic as Error & { cause: unknown }).cause = cyclic;
    assert.doesNotThrow(() => errorToErrorInfo(cyclic, [secret]));
  });

  it("handles map set date regexp and typed arrays", () => {
    const secret = "sk-collection";
    const map = new Map([["key", `Bearer ${secret}`]]);
    const set = new Set([secret]);
    const date = new Date();
    const re = /pattern/;
    const bytes = new Uint8Array([1, 2, 3]);

    const redacted = redactSecrets({ map, set, date, re, bytes }, [secret]) as unknown as {
      map: Record<string, string>;
      set: string[];
      date: Date;
      re: RegExp;
      bytes: Uint8Array;
    };

    assert.equal(redacted.map.key, "Bearer [REDACTED]");
    assert.deepEqual(redacted.set, ["[REDACTED]"]);
    assert.equal(redacted.date, date);
    assert.equal(redacted.re, re);
    assert.equal(redacted.bytes, bytes);
  });

  it("does not mutate the input graph", () => {
    const secret = "sk-immutable";
    const payload = { nested: { token: secret }, list: [secret] };

    redactSecrets(payload, [secret]);

    assert.equal(payload.nested.token, secret);
    assert.equal(payload.list[0], secret);
  });

  it("errorToErrorInfo tolerates cyclic cause", () => {
    const secret = "sk-cause";
    const cyclic = new Error(`failed ${secret}`) as Error & { cause?: unknown };
    cyclic.cause = cyclic;

    const info = errorToErrorInfo(cyclic, [secret]);

    assert.equal(info.message, "failed [REDACTED]");
    assert.ok(typeof info.cause === "string");
  });
});

// Plan 070 Task 9: `redactSecrets` uses one left-to-right scan (a compiled alternation) for
// large strings when that is provably equivalent to the ordered split/join loop, and the loop
// otherwise. The loop is the contract; these tests pin both paths to it.
describe("redaction single-pass fast path", () => {
  // Must stay >= SINGLE_PASS_MIN_CHARS (16 KB) so the fast path is actually engaged.
  const FAST_PATH_CHARS = 16 * 1024;
  const filler = (chars: number) => "z".repeat(chars);
  const orderedLoop = (text: string, needles: readonly string[]) =>
    needles.reduce((current, secret) => current.split(secret).join("[REDACTED]"), text);

  it("keeps ordered split/join semantics wherever a single scan would diverge", () => {
    // First mention wins over leftmost position: "bc" is replaced first, so the leading "a" survives.
    assert.equal(redactSecrets("abc", ["bc", "ab"]), "a[REDACTED]");
    // Containment: the shorter needle is replaced first, leaving the leading "x".
    assert.equal(redactSecrets("xab", ["ab", "xab"]), "x[REDACTED]");
    // A needle that occurs inside the placeholder is redacted again by the later pass.
    assert.equal(redactSecrets("[REDACTED]", ["[REDACTED]", "RED"]), "[[REDACTED]ACTED]");
  });

  it("treats needles as literals, never as regex patterns", () => {
    assert.equal(redactSecrets("match .*+? here", [".*+?"]), "match [REDACTED] here");
    assert.equal(redactSecrets("axb a.b", ["a.b"]), "axb [REDACTED]");
    assert.equal(redactSecrets("cost $1 and $& now", ["$1", "$&"]), "cost [REDACTED] and [REDACTED] now");
    assert.equal(redactSecrets("path a\\b", ["a\\b"]), "path [REDACTED]");
    assert.equal(redactSecrets("brackets [x] (y) {z}", ["[x]", "(y)", "{z}"]), "brackets [REDACTED] [REDACTED] [REDACTED]");
  });

  it("filters empty needles, keeps whitespace needles, and renumbers colliding keys", () => {
    assert.equal(redactSecrets("a b", ["", " "]), "a[REDACTED]b");
    assert.deepEqual(redactSecrets({ "sk-1": "v", "[REDACTED]": "w" }, ["sk-1"]), {
      "[REDACTED]": "v",
      "[REDACTED]__2": "w",
    });
  });

  it("produces identical output above and below the single-scan threshold", () => {
    const needles = ["sk-live-alpha-0123456789", "sk-live-beta-9876543210", "token=gamma"];
    const body = `start ${needles[0]} middle ${needles[1]} ${needles[2]} end`;
    const small = redactSecrets(body, needles);
    const large = redactSecrets(`${body}${filler(FAST_PATH_CHARS)}`, needles);

    assert.equal(small, orderedLoop(body, needles));
    assert.equal(large, `${small as string}${filler(FAST_PATH_CHARS)}`);
    assert.ok(!(small as string).includes("sk-live"), "no needle survives");
  });

  it("stays on the ordered loop outside the fast-path needle envelope", () => {
    const single = ["sk-live-only-0123456789"];
    const many = Array.from({ length: 40 }, (_, index) => `sk-cap-${index}-${"y".repeat(20)}`);

    for (const needles of [single, many]) {
      const text = `${needles.join(" ")} ${filler(FAST_PATH_CHARS)}`;
      assert.equal(redactSecrets(text, needles), orderedLoop(text, needles));
    }
  });

  it("matches the ordered loop for adversarial needle sets and texts in one large pass", () => {
    let seed = 0x2f6e2b1;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const randomText = (alphabet: string, length: number) =>
      Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)]).join("");
    // "ab[]REDCT]" collides with the placeholder and with itself; "abcdefghijklm" cannot touch
    // the placeholder, so sets drawn from it usually keep the single-scan path engaged.
    for (const alphabet of ["ab[]REDCT]", "abcdefghijklm"]) {
      for (let round = 0; round < 24; round += 1) {
        const needles = [...new Set(Array.from({ length: 3 }, () => randomText(alphabet, 1 + Math.floor(next() * 4))))];
        const big = randomText(alphabet, FAST_PATH_CHARS + 512);
        assert.equal(redactSecrets(big, needles), orderedLoop(big, needles), `alphabet ${alphabet} round ${round}`);
      }
    }
  });
});
