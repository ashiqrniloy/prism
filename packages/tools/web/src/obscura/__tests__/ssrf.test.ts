import assert from "node:assert/strict";
import { test } from "bun:test";
import { obscuraVersionIsGuarded, parseObscuraVersion, probeObscuraVersion, runObscuraCli, validateObscuraWebUrl } from "../cli.js";
import { ObscuraError } from "../errors.js";
import { fakeObscuraCliPath } from "./fake-cli.js";

const FAKE = fakeObscuraCliPath();

test("obscura_rejects_private_resolution", async () => {
  // Injected resolver returning private IPv4 (RFC 1918)
  await assert.rejects(
    validateObscuraWebUrl("https://private.example/data", {
      resolver: async () => [{ address: "192.168.1.1", family: 4 }],
    }),
    (error: unknown) => {
      assert.ok(error instanceof ObscuraError);
      assert.equal(error.code, "ERR_OBSCURA_SSRF");
      assert.match(error.message, /private or denied/i);
      return true;
    },
  );

  // Injected resolver returning loopback IPv4
  await assert.rejects(
    validateObscuraWebUrl("https://loopback.example/data", {
      resolver: async () => [{ address: "127.0.0.1", family: 4 }],
    }),
    (error: unknown) => {
      assert.ok(error instanceof ObscuraError);
      assert.equal(error.code, "ERR_OBSCURA_SSRF");
      return true;
    },
  );

  // Injected resolver returning cloud metadata address
  await assert.rejects(
    validateObscuraWebUrl("https://meta.example/data", {
      resolver: async () => [{ address: "169.254.169.254", family: 4 }],
    }),
    (error: unknown) => {
      assert.ok(error instanceof ObscuraError);
      assert.equal(error.code, "ERR_OBSCURA_SSRF");
      return true;
    },
  );

  // Injected resolver returning loopback IPv6
  await assert.rejects(
    validateObscuraWebUrl("https://ipv6-loop.example/data", {
      resolver: async () => [{ address: "::1", family: 6 }],
    }),
    (error: unknown) => {
      assert.ok(error instanceof ObscuraError);
      assert.equal(error.code, "ERR_OBSCURA_SSRF");
      return true;
    },
  );

  // Injected resolver returning unique local IPv6 (fc00::/7)
  await assert.rejects(
    validateObscuraWebUrl("https://ipv6-priv.example/data", {
      resolver: async () => [{ address: "fd00::1", family: 6 }],
    }),
    (error: unknown) => {
      assert.ok(error instanceof ObscuraError);
      assert.equal(error.code, "ERR_OBSCURA_SSRF");
      return true;
    },
  );

  // Injected resolver returning mixed public and private answers fails closed
  await assert.rejects(
    validateObscuraWebUrl("https://mixed.example/data", {
      resolver: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
    }),
    (error: unknown) => {
      assert.ok(error instanceof ObscuraError);
      assert.equal(error.code, "ERR_OBSCURA_SSRF");
      return true;
    },
  );

  // Injected resolver returning empty addresses fails closed
  await assert.rejects(
    validateObscuraWebUrl("https://empty.example/data", {
      resolver: async () => [],
    }),
    (error: unknown) => {
      assert.ok(error instanceof ObscuraError);
      assert.equal(error.code, "ERR_OBSCURA_SSRF");
      return true;
    },
  );
});

test("obscura_allows_public_resolution", async () => {
  const result = await validateObscuraWebUrl("https://safe.example/data", {
    resolver: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  assert.equal(result, "https://safe.example/data");

  const v6Result = await validateObscuraWebUrl("https://v6.example/page", {
    resolver: async () => [{ address: "2606:4700:4700::1111", family: 6 }],
  });
  assert.equal(v6Result, "https://v6.example/page");
});

test("obscura_version_parse_and_guard_boundary", () => {
  assert.equal(parseObscuraVersion("obscura 0.2.5\n"), "0.2.5");
  assert.equal(parseObscuraVersion("Obscura 0.1.8\n"), "0.1.8");
  assert.equal(parseObscuraVersion("0.1.0-dev+abc123\n"), undefined, "a source build is never trusted");
  assert.equal(parseObscuraVersion("obscura (no version information)"), undefined);
  assert.equal(obscuraVersionIsGuarded(undefined), false);
  assert.equal(obscuraVersionIsGuarded("0.1.7"), false);
  assert.equal(obscuraVersionIsGuarded("0.1.8"), true);
  assert.equal(obscuraVersionIsGuarded("0.2.5"), true);
  assert.equal(obscuraVersionIsGuarded("1.0.0"), true);
});

test("obscura_version_probe_fails_closed", async () => {
  const probe = (version: string) =>
    probeObscuraVersion({ command: process.execPath, argsBefore: [FAKE], env: { OBSCURA_FAKE_VERSION: version } });
  assert.deepEqual(await probe("0.1.7"), { version: "0.1.7", guarded: false });
  assert.deepEqual(await probe("0.1.8"), { version: "0.1.8", guarded: true });
  assert.deepEqual(await probe("0.2.5"), { version: "0.2.5", guarded: true });
  assert.deepEqual(await probe("0.2.5-dev+abc123"), { guarded: false });
  assert.deepEqual(await probe("garbage"), { guarded: false });
  assert.deepEqual(await probe("fail"), { guarded: false }, "a failing probe is not a package failure");
});

test("obscura_runner_never_enables_private_network", async () => {
  const previous = { network: process.env.OBSCURA_ALLOW_PRIVATE_NETWORK, proxy: process.env.OBSCURA_PROXY };
  process.env.OBSCURA_ALLOW_PRIVATE_NETWORK = "1";
  process.env.OBSCURA_PROXY = "http://proxy.test:8080";
  try {
    const run = await runObscuraCli({
      command: process.execPath,
      argsBefore: [FAKE],
      args: ["fetch", "https://example.com/"],
      env: { OBSCURA_FAKE: "env" },
    });
    const report = JSON.parse(run.stdout) as { argv: string[]; privateNetwork: string | null; proxy: string | null };
    assert.deepEqual(report.argv, ["fetch", "https://example.com/"], "Prism passes no private-network flag");
    assert.equal(report.privateNetwork, null, "OBSCURA_ALLOW_PRIVATE_NETWORK is not inherited");
    assert.equal(report.proxy, null, "OBSCURA_PROXY is not inherited");
  } finally {
    if (previous.network === undefined) delete process.env.OBSCURA_ALLOW_PRIVATE_NETWORK;
    else process.env.OBSCURA_ALLOW_PRIVATE_NETWORK = previous.network;
    if (previous.proxy === undefined) delete process.env.OBSCURA_PROXY;
    else process.env.OBSCURA_PROXY = previous.proxy;
  }
});
