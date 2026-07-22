import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// @ts-expect-error stdlib-only release security scripts intentionally ship as runnable JavaScript.
import { verifySbom } from "../../scripts/verify-sbom.mjs";
// @ts-expect-error stdlib-only release security scripts intentionally ship as runnable JavaScript.
import { scanSecrets } from "../../scripts/scan-secrets.mjs";
// @ts-expect-error stdlib-only release security scripts intentionally ship as runnable JavaScript.
import { runCanaries } from "../../scripts/live-canary.mjs";

const policy = JSON.parse(readFileSync("security/license-policy.json", "utf8"));
const sbom = (license = "MIT") => ({ spdxVersion: "SPDX-2.3", packages: [{ name: "fixture", licenseDeclared: license }] });

function canaryEnv() {
  return {
    PRISM_LIVE_CANARIES: "1", PRISM_CANARY_TIMEOUT_MS: "1000",
    PRISM_CANARY_PROVIDER_URL: "https://provider.example/v1/chat/completions", PRISM_CANARY_PROVIDER_API_KEY: "provider-canary", PRISM_CANARY_PROVIDER_MODEL: "model",
    PRISM_CANARY_MCP_URL: "https://mcp.example/rpc", PRISM_CANARY_MCP_TOKEN: "mcp-canary",
    PRISM_CANARY_A2A_URL: "https://a2a.example/rpc", PRISM_CANARY_A2A_TOKEN: "a2a-canary",
    PRISM_BRAVE_SEARCH_TOKEN: "brave-canary",
  };
}

test("SPDX policy allows frozen licenses and rejects prohibited or missing licenses", () => {
  assert.deepEqual(verifySbom(sbom(), policy), { packages: 1, licenses: 1 });
  assert.throws(() => verifySbom(sbom("GPL-3.0"), policy), /license policy rejected/);
  assert.throws(() => verifySbom({ spdxVersion: "SPDX-2.3", packages: [{ name: "x" }] }, policy), /NOASSERTION/);
  assert.deepEqual(verifySbom({ spdxVersion: "SPDX-2.3", packages: [{ name: "@ag-ui/core", versionInfo: "0.0.57", licenseDeclared: "NOASSERTION" }] }, policy), { packages: 1, licenses: 1 });
  assert.throws(() => verifySbom({ spdxVersion: "SPDX-2.3", packages: [{ name: "@ag-ui/core", versionInfo: "0.0.58", licenseDeclared: "NOASSERTION" }] }, policy), /NOASSERTION/);
});

test("source/artifact scanner detects representative credentials without echoing them", async () => {
  const root = mkdtempSync(join(tmpdir(), "prism-secret-scan-"));
  writeFileSync(join(root, "safe.txt"), "not a credential\n");
  assert.equal((await scanSecrets([root])).findings, 0);
  const canary = "AK" + "IA" + "A".repeat(16);
  writeFileSync(join(root, "unsafe.txt"), canary);
  await assert.rejects(() => scanSecrets([root]), (error: Error) => error.message.includes("aws-access-key") && !error.message.includes(canary));
});

test("live canaries skip without gate and emit bounded credential-free aggregate results", async () => {
  assert.equal((await runCanaries({ env: {}, fetcher: async () => assert.fail("network called") })).skipped, true);
  await assert.rejects(() => runCanaries({ env: { PRISM_LIVE_CANARIES: "1" }, fetcher: async () => assert.fail("network called") }), /configuration missing/);
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    const headers = String(url).includes("mcp.example") ? { "mcp-session-id": "opaque-session" } : undefined;
    return Response.json({ jsonrpc: "2.0", id: 1, result: {} }, { headers });
  };
  const report = await runCanaries({ env: canaryEnv(), fetcher });
  assert.equal(report.maximumRequests, 5);
  assert.equal(report.providerMaxOutputTokens, 1);
  assert.deepEqual(report.results.map((item: { kind: string }) => item.kind), ["provider", "mcp", "a2a", "web"]);
  const serialized = JSON.stringify(report);
  for (const secret of ["provider-canary", "mcp-canary", "a2a-canary", "brave-canary", "opaque-session"]) assert.ok(!serialized.includes(secret));
  assert.equal(calls.length, 5);
});

test("live canary failures and timeout are bounded and redacted", async () => {
  const env = canaryEnv();
  await assert.rejects(() => runCanaries({ env, fetcher: async () => new Response("secret body provider-canary", { status: 401 }) }), (error: Error) => /HTTP 401/.test(error.message) && !error.message.includes("provider-canary"));
  await assert.rejects(() => runCanaries({ env, fetcher: async (_url: string | URL, init: RequestInit = {}) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })) }), /provider canary timeout/);
});

test("security workflows pin actions, isolate live secrets, and gate publication", () => {
  const files = [".github/workflows/release.yml", ".github/workflows/security.yml", ".github/workflows/live-canaries.yml"];
  const workflows = files.map((file) => readFileSync(file, "utf8"));
  for (const [index, workflow] of workflows.entries()) {
    assert.ok(!workflow.includes("pull_request_target"), `${files[index]} uses pull_request_target`);
    for (const uses of workflow.matchAll(/uses:\s*([^\s#]+)/g)) assert.match(uses[1]!, /@[a-f0-9]{40}$/, `${files[index]} action is not immutable: ${uses[1]}`);
  }
  const release = workflows[0]!; const security = workflows[1]!; const live = workflows[2]!;
  assert.match(release, /needs: \[verify, node20-compat, postgres-integration, codeql-release, supply-chain\]/);
  assert.match(release, /attestations:\s*write/);
  assert.match(release, /subject-path: release-artifacts\/\*\.tgz/);
  assert.match(release, /134217728/);
  assert.match(release, /NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/);
  assert.match(security, /security-events:\s*write/);
  assert.match(security, /dependency-review-action@[a-f0-9]{40}/);
  assert.match(security, /134217728/);
  assert.match(live, /environment: live-canaries/);
  assert.ok(!live.includes("pull_request:"));
  assert.match(live, /retention-days:\s*7/);
});
