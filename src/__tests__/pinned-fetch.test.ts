import assert from "node:assert/strict";
import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { MediaContentError } from "../content.js";
import { boundResponse, pinnedFetch, resolvePinnedAddress } from "../pinned-fetch.js";

function listen(handler: RequestListener): Promise<{ origin: string; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ origin: `http://127.0.0.1:${port}`, server });
    });
  });
}

/** Hostname-based URL on a local listener (IP literals skip the resolver, so rebinding/loopback tests need a name). */
function localUrl(origin: string, path: string): URL {
  return new URL(origin.replace("127.0.0.1", "localhost") + path);
}

const ssrfDenied = (error: unknown): boolean => error instanceof MediaContentError && error.code === "ssrf_denied";

describe("pinned fetch (DNS pinning)", () => {
  it("rejects private DNS answers (rebinding defense: every candidate is pinned before connect)", async () => {
    const { origin, server } = await listen((_request, response) => response.end("ok"));
    try {
      // A resolver that returns a loopback answer first then a private one on a
      // later resolve simulates DNS rebinding; the per-candidate check must reject
      // the private answer before any connect is attempted.
      const url = localUrl(origin, "/file");
      let fetches = 0;
      const rebindingFetch = () =>
        pinnedFetch(url, undefined, {
          allowLoopback: true,
          resolver: async () => {
            fetches += 1;
            return fetches === 1 ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "10.0.0.1", family: 4 }];
          },
        });
      assert.equal(await (await rebindingFetch()).text(), "ok");
      await assert.rejects(rebindingFetch(), ssrfDenied);
      assert.equal(fetches, 2);
      // Single private answer fails closed too, as do mixed public/private answers.
      for (const answers of [
        [{ address: "127.0.0.1", family: 4 as const }],
        [
          { address: "93.184.216.34", family: 4 as const },
          { address: "10.0.0.1", family: 4 as const },
        ],
        [{ address: "169.254.169.254", family: 4 as const }], // cloud metadata target
        [{ address: "::ffff:127.0.0.1", family: 6 as const }],
        [{ address: "fe80::1", family: 6 as const }],
      ]) {
        await assert.rejects(
          () =>
            pinnedFetch(new URL("https://media.example.test/file"), undefined, {
              resolver: async () => answers,
            }),
          ssrfDenied,
        );
      }
    } finally {
      server.close();
    }
  });

  it("rejects metadata and private hostnames at the URL precheck", async () => {
    for (const url of ["http://169.254.169.254/latest/meta-data", "http://metadata.google.internal/", "http://localhost:8080/x"]) {
      await assert.rejects(() => pinnedFetch(new URL(url), undefined), ssrfDenied);
    }
  });

  it("confines loopback resolution to loopback when opted in", async () => {
    const { origin, server } = await listen((_request, response) => response.end("ok"));
    try {
      const url = localUrl(origin, "/mcp");
      // loopback hostname resolving outside loopback fails closed
      await assert.rejects(
        () =>
          pinnedFetch(url, undefined, {
            allowLoopback: true,
            resolver: async () => [{ address: "10.0.0.1", family: 4 }],
          }),
        ssrfDenied,
      );
      // loopback confined to loopback works
      const response = await pinnedFetch(url, undefined, {
        allowLoopback: true,
        resolver: async () => [{ address: "127.0.0.1", family: 4 }],
      });
      assert.equal(await response.text(), "ok");
      // without the loopback opt-in the same URL is denied
      await assert.rejects(() => pinnedFetch(localUrl(origin, "/mcp"), undefined), ssrfDenied);
    } finally {
      server.close();
    }
  });

  it("rejects redirects outright without following Location", async () => {
    const { origin, server } = await listen((request, response) => {
      if (request.url === "/redirect") {
        response.writeHead(302, { location: "https://example.test/elsewhere" });
        response.end();
        return;
      }
      response.end("ok");
    });
    try {
      await assert.rejects(
        () => pinnedFetch(new URL(`${origin}/redirect`), undefined, { allowLoopback: true }),
        (error: unknown) => error instanceof MediaContentError && error.code === "redirect",
      );
    } finally {
      server.close();
    }
  });

  it("bounds address count and validates resolver family", async () => {
    await assert.rejects(
      () =>
        pinnedFetch(new URL("https://example.test/"), undefined, {
          resolver: async () => [],
        }),
      (error: unknown) => error instanceof MediaContentError && error.code === "fetch_failed",
    );
    await assert.rejects(
      () =>
        pinnedFetch(new URL("https://example.test/"), undefined, {
          resolver: async () => Array.from({ length: 33 }, () => ({ address: "93.184.216.34", family: 4 as const })),
        }),
      (error: unknown) => error instanceof MediaContentError && error.code === "fetch_failed",
    );
    await assert.rejects(
      () =>
        pinnedFetch(new URL("https://example.test/"), undefined, {
          resolver: async () => [{ address: "::1", family: 4 as const }],
        }),
      (error: unknown) => error instanceof MediaContentError && error.code === "fetch_failed",
    );
  });

  it("supports IPv4 and IPv6 literals without a resolver round trip", async () => {
    let resolverCalls = 0;
    const address = await resolvePinnedAddress(
      new URL("https://93.184.216.34/x"),
      async () => {
        resolverCalls += 1;
        return [];
      },
      undefined,
      false,
      undefined,
    );
    assert.deepEqual(address, { address: "93.184.216.34", family: 4 });
    assert.equal(resolverCalls, 0);
    // Literal IPv6 hosts fetch directly (no DNS round trip): serve a local
    // response instead of asserting connect-refused, which depends on the
    // port being free on the host running the suite.
    const server = createServer((_req, res) => {
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "::1", resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const response = await pinnedFetch(new URL(`http://[::1]:${port}/x`), undefined, { allowLoopback: true });
      assert.equal(await response.text(), "ok");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("aborts in-flight pinned requests", async () => {
    const { origin, server } = await listen((_request, response) => {
      setTimeout(() => response.end("late"), 200);
    });
    try {
      const controller = new AbortController();
      const pending = pinnedFetch(new URL(`${origin}/slow`), { signal: controller.signal }, { allowLoopback: true });
      controller.abort(new Error("stop"));
      await assert.rejects(pending, /stop|abort/i);
    } finally {
      server.close();
    }
  });

  it("bounds chunked response bodies and pre-checks content-length", async () => {
    const { origin, server } = await listen((_request, response) => {
      response.write("x".repeat(8));
      response.end("y".repeat(8));
    });
    try {
      const url = new URL(`${origin}/chunked`);
      const response = await pinnedFetch(url, undefined, { allowLoopback: true, maxResponseBytes: 10 });
      await assert.rejects(response.text(), /exceeds 10 bytes/);
      assert.throws(() => boundResponse(new Response("x".repeat(64), { headers: { "content-length": "64" } }), 16), /exceeds 16 bytes/);
      await assert.rejects(boundResponse(new Response("x".repeat(64)), 16).text(), /exceeds 16 bytes/);
    } finally {
      server.close();
    }
  });
});
