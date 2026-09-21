#!/usr/bin/env node
import { spawnSync } from "node:child_process";
// Post-publish verification: install the release packages into a fresh consumer project
// and exercise one real behavior per headline surface.
//
//   node scripts/post-publish-smoke.mjs                    # from the registry (after publish)
//   node scripts/post-publish-smoke.mjs --local            # from local tarballs (pre-publish parity)
//   node scripts/post-publish-smoke.mjs --version 0.10.0   # pin the version
//
// Registry mode is the post-publish gate: it proves the published artifacts (not the working
// tree) resolve `./fabric`, `./scoped`, and the hooks adapter. `--local` runs the same checks
// against `npm pack` output, so a broken `files` entry or subpath export fails before the tag
// is pushed. Network-free after install; exit code 1 on any failed check.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const local = argv.includes("--local");
const versionIndex = argv.indexOf("--version");
const version = versionIndex === -1 ? null : argv[versionIndex + 1];
if (versionIndex !== -1 && !version) throw new Error("--version requires a value");

const PACKAGES = ["@arnilo/prism", "@arnilo/prism-memory", "@arnilo/prism-hooks"];
const resolvedVersion = version ?? JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: options.quiet ? "pipe" : "inherit", ...options });
  if (result.status !== 0) {
    if (options.quiet && result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return result.stdout ?? "";
}

const workdir = mkdtempSync(join(tmpdir(), "prism-post-publish-smoke-"));
const consumer = join(workdir, "consumer");
run("mkdir", ["-p", consumer]);
writeFileSync(
  join(consumer, "package.json"),
  `${JSON.stringify({ name: "prism-post-publish-smoke", private: true, type: "module" }, null, 2)}\n`,
);

let specs;
if (local) {
  specs = PACKAGES.map((pkg) => {
    const workspace = pkg === "@arnilo/prism" ? [] : ["--workspace", pkg];
    const packed = run("npm", ["pack", "--silent", "--pack-destination", workdir, ...workspace], { cwd: root, quiet: true })
      .trim()
      .split("\n")
      .pop();
    return join(workdir, packed);
  });
} else {
  specs = PACKAGES.map((pkg) => `${pkg}@${resolvedVersion}`);
}
console.log(`post-publish smoke: ${local ? "local tarballs" : "registry"} — ${specs.join(" ")}`);

run("npm", ["install", ...specs, "--prefer-offline", "--no-audit", "--no-fund", "--silent"], { cwd: consumer });
writeFileSync(join(consumer, "smoke.mjs"), smokeSource());
run("node", ["smoke.mjs"], { cwd: consumer });
console.log(`post-publish smoke: PASS (${local ? "local tarballs" : `registry @${resolvedVersion}`})`);

// The consumer-side checks: one import per headline surface plus one real behavior each.
function smokeSource() {
  return `import { mkdtemp } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent, forwardAgentEvents, createExtensionKernel, activateKernel, providerTextDelta, providerDone } from "@arnilo/prism";
import { createMemory, createHashEmbedder } from "@arnilo/prism-memory";
import { createMemoryFabric } from "@arnilo/prism-memory/fabric";
import { createScopedMemoryPolicy } from "@arnilo/prism-memory/scoped";
import { parseHooksConfig, createHooksExtension } from "@arnilo/prism-hooks";

const checks = [];
checks.push(["root: createAgent + event bridge + kernel", [createAgent, forwardAgentEvents, createExtensionKernel, activateKernel].every((f) => typeof f === "function")]);
checks.push(["memory root: createMemory", typeof createMemory === "function"]);
checks.push(["memory ./fabric subpath", typeof createMemoryFabric === "function"]);
checks.push(["memory ./scoped subpath", typeof createScopedMemoryPolicy === "function"]);
checks.push(["hooks adapter exports", typeof parseHooksConfig === "function" && typeof createHooksExtension === "function"]);

const codex = parseHooksConfig({ hooks: { UserPromptSubmit: [{ matcher: "*", hooks: [{ type: "command", command: "true" }] }] } });
const claude = parseHooksConfig({ UserPromptSubmit: [{ matcher: "*", hooks: [{ type: "command", command: "true" }] }] });
checks.push(["parseHooksConfig accepts both shapes", Array.isArray(codex.events?.UserPromptSubmit) && Array.isArray(claude.events?.UserPromptSubmit)]);
const hooks = createHooksExtension(codex);
checks.push(["createHooksExtension returns extension + guardrails", typeof hooks?.setup === "function" && typeof hooks?.guardrails === "object"]);

const scopeRoot = await mkdtemp(join(tmpdir(), "prism-scoped-smoke-"));
const memory = createMemory({ tenantId: "smoke", resourceId: scopeRoot, threadId: "scoped", embedder: createHashEmbedder({ dimensions: 8 }) });
const fabric = createMemoryFabric({ memory, consolidate: false });
const policy = createScopedMemoryPolicy({ memory, fabric, scopeRoot });
const miss = await policy.recall("unladenswallow airspeed");
checks.push(["scoped recall abstains below the floor", miss.hits.length === 0 && miss.abstained === true]);
await policy.reviewSession("remember", { reviewer: async () => [{ kind: "fact", content: "alphazebra uniquequeryxyz staging ssh listens on port 2222", sourceEntryIds: ["aaaaaaaaaaaa"] }] });
const hit = await policy.recall("alphazebra uniquequeryxyz staging ssh");
checks.push(["scoped write then recall above the floor", !hit.abstained && hit.hits.length >= 1]);
checks.push(["scoped ledger written", readFileSync(join(scopeRoot, ".memory", "state.json"), "utf8").length > 0]);

const provider = { id: "mock", async *generate() { yield providerTextDelta("ok"); yield providerDone(); } };
const agent = createAgent({ model: { provider: "mock", model: "smoke" }, provider, stopHooks: [{ name: "smoke", decide: async () => ({ action: "stop" }) }] });
const session = agent.createSession({ id: "post-publish-smoke" });
const result = await session.run("hi");
checks.push(["run with a stop hook settles", typeof result?.status === "string"]);
checks.push(["AgentSession.close() present", typeof session.close === "function"]);
await session.close();
await session.close();
checks.push(["close() is idempotent", true]);

for (const [name, ok] of checks) console.log(\`\${ok ? "PASS" : "FAIL"} \${name}\`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
`;
}
