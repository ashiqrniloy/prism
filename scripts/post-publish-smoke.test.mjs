import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPackedConsumer } from "./fixtures/packed-consumer.mjs";
import { loadRelease } from "./release.mjs";

// Registry-shaped proof before these versions exist on npm; only external peers use npmjs.
test("post_publish_smoke_specs_follow_bundle_map and registry_consumer_runs_packed_bytes", async () => {
  const release = loadRelease();
  const fixture = createPackedConsumer(release.packages.map((pkg) => ({ name: pkg.manifest.name, dir: pkg.path })));
  let server;
  try {
    assert.equal(fixture.installStatus, 0, fixture.installOut);
    const overrides = JSON.parse(readFileSync(join(fixture.consumer, "package.json"), "utf8")).overrides;
    const requests = new Set();
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        if (request.method !== "GET") return new Response("read only", { status: 405 });
        const path = decodeURIComponent(new URL(request.url).pathname.slice(1));
        if (path.startsWith("tarballs/")) {
          const name = path.slice("tarballs/".length);
          if (!overrides[name]) return new Response("missing", { status: 404 });
          requests.add(name);
          return new Response(readFileSync(overrides[name].slice(5)));
        }
        const pkg = release.byName.get(path);
        if (pkg) {
          const { manifest } = pkg;
          const bytes = readFileSync(overrides[path].slice(5));
          return Response.json({
            name: path,
            "dist-tags": { [pkg.experimental ? "experimental" : "latest"]: manifest.version },
            versions: {
              [manifest.version]: {
                ...manifest,
                dist: {
                  tarball: `${server.url}tarballs/${path}`,
                  integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
                },
              },
            },
          });
        }
        if (path.startsWith("@arnilo/")) return new Response("unknown first-party name", { status: 404 });
        const upstream = await fetch(`https://registry.npmjs.org/${new URL(request.url).pathname.slice(1)}`);
        const headers = new Headers(upstream.headers);
        headers.delete("content-encoding");
        headers.delete("content-length");
        return new Response(upstream.body, { status: upstream.status, headers });
      },
    });
    const child = spawn(
      process.execPath,
      ["scripts/post-publish-smoke.mjs", "--version", release.byName.get("@arnilo/prism").manifest.version],
      {
        env: { ...process.env, BUN_CONFIG_REGISTRY: server.url.href },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      // Kill the installers too: they inherit the smoke process's group and output pipes.
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
        child.stdout.destroy();
        child.stderr.destroy();
      }
    }, 120_000);
    let status;
    try {
      status = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
    } finally {
      clearTimeout(timer);
    }
    assert.equal(status, 0, stdout + stderr);
    assert.match(stdout, /post-publish smoke: PASS \(registry @0\.13\.0\)/);
    assert.match(stdout, /@arnilo\/prism-memory-system@experimental/);
    assert.match(stdout, /@arnilo\/prism-knowledge@experimental/);
    for (const name of [
      "@arnilo/prism",
      "@arnilo/prism-extensions",
      "@arnilo/prism-tools",
      "@arnilo/prism-memory-system",
      "@arnilo/prism-knowledge",
    ]) {
      assert.ok(requests.has(name), `must download ${name} from the fixture registry`);
    }
  } finally {
    server?.stop(true);
    fixture.cleanup();
  }
});
