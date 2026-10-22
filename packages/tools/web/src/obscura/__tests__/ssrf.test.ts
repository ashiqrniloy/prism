import assert from "node:assert/strict";
import { test } from "bun:test";
import { validateObscuraWebUrl } from "../cli.js";
import { ObscuraError } from "../errors.js";

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
