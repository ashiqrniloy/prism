import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { agentRuntime } from "../agent-session/create-agent.js";
import type { AgentEvent, ModelProvider, ProviderEvent } from "../index.js";
import { createAgent, providerDone, providerTextDelta } from "../index.js";
import { providerPackage } from "../provider-kit/index.js";
import { createMockProvider, mockProvider, packageConformance } from "../testing/index.js";

const MODEL = { provider: "mock", model: "demo" } as const;

async function textOf(agent: Awaited<ReturnType<typeof createAgent>>, input: string, model?: string): Promise<string> {
  const session = await agent.session();
  let text = "";
  for await (const event of session.stream(input, model ? { model } : {})) {
    const item = event as AgentEvent;
    if (item.type === "message.delta" && item.content.type === "text") text += item.content.text;
  }
  return text;
}

describe("mockProvider package", () => {
  it("mock_provider_package_gives_each_call_its_own_step", async () => {
    const agent = await createAgent({
      model: MODEL,
      packages: [
        mockProvider([
          [providerTextDelta("one"), providerDone()],
          [providerTextDelta("two"), providerDone()],
        ]),
      ],
    });
    assert.equal(await textOf(agent, "a"), "one");
    assert.equal(await textOf(agent, "b"), "two");
    // The script is exhausted: the last step repeats, as the deleted `turns(...)` helpers did.
    assert.equal(await textOf(agent, "c"), "two");
    assert.equal(await textOf(agent, "d"), "two");
  });

  it("mock_provider_package_registers_its_id_and_reports_requests", async () => {
    const seen: string[] = [];
    const agent = await createAgent({
      model: { provider: "scripted", model: "demo" },
      packages: [mockProvider([[providerDone()]], { id: "scripted", onRequest: (request) => seen.push(request.model.provider) })],
    });
    await textOf(agent, "hi");
    assert.deepEqual(seen, ["scripted"]);
  });

  it("mock_provider_package_passes_package_conformance", async () => {
    const result = await packageConformance(mockProvider([[providerDone()]], { id: "scripted" }), {
      mockProvider: createMockProvider([providerDone()], { id: "conformance-host" }),
    });
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
    );
  });

  it("provider_package_registers_every_provider_in_order", async () => {
    const make = (id: string): ModelProvider => ({
      id,
      async *generate() {
        yield providerDone() as ProviderEvent;
      },
    });
    const agent = await createAgent({ model: { provider: "b", model: "x" }, packages: [providerPackage("pair", [make("a"), make("b")])] });
    const ids = agentRuntime(agent)
      .packages.providers()
      .map((entry) => entry.provider.id);
    assert.deepEqual(ids.slice(-2), ["a", "b"]);
  });
});

/** The top-level keys of every `createAgent(` object literal in `source`, with the literal's text. */
function agentLiterals(source: string): { keys: string[]; text: string }[] {
  const out: { keys: string[]; text: string }[] = [];
  for (const match of source.matchAll(/\bcreateAgent\(\{/g)) {
    const start = match.index! + match[0].length - 1;
    let depth = 0;
    let quote: string | undefined;
    const keys: string[] = [];
    let index = start;
    for (; index < source.length; index++) {
      const ch = source[index]!;
      if (quote) {
        if (ch === "\\") index++;
        else if (ch === quote) quote = undefined;
        continue;
      }
      if (ch === "/" && source[index + 1] === "/") index = source.indexOf("\n", index) - 1;
      else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{" || ch === "(" || ch === "[") depth++;
      else if (ch === "}" || ch === ")" || ch === "]") {
        depth--;
        if (depth === 0) break;
      } else if (depth === 1) {
        const prev = source.slice(Math.max(0, index - 1), index);
        if (!/[\s,{]/.test(prev || " ")) continue;
        if (source.startsWith("...", index)) keys.push("...");
        else {
          const key = /^([A-Za-z_$][\w$]*)\s*[:,}]/.exec(source.slice(index, index + 80));
          if (key) keys.push(key[1]!);
        }
      }
    }
    out.push({ keys, text: source.slice(start, index + 1) });
  }
  return out;
}

/** Files whose agent literals sit inside template strings (docs assertions, packed-install scripts). */
const EMBEDDED_CODE = ["mock-provider-package.test.ts", "docs.test.ts", "install-smoke.test.ts", "bundles-packed.test.mjs"];

function walk(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (/\.(ts|mjs)$/.test(name) && !EMBEDDED_CODE.some((name) => path.endsWith(name))) found.push(path);
  }
  return found;
}

describe("Task 5 codemod output", () => {
  it("codemod_preserved_model_and_packages_keys", () => {
    const offenders: string[] = [];
    let literals = 0;
    for (const file of [...walk("src"), ...walk("packages"), ...walk("examples"), ...walk("scripts")]) {
      if (file.startsWith("scripts/host-builder-evals/workspaces/upgrade-0-12/")) continue; // Deliberately unported input for the migration eval.
      const source = readFileSync(file, "utf8");
      for (const literal of agentLiterals(source)) {
        literals++;
        if (literal.keys.includes("provider") || literal.keys.includes("providerSource")) offenders.push(`${file}: removed provider field`);
        const usesPackage = /\b(mockProvider|providerPackage)\(/.test(literal.text);
        if (usesPackage) {
          const hasModel =
            literal.keys.includes("model") || literal.keys.includes("...") || /slots:\s*\{\s*loop:\s*modelLessLoop/.test(literal.text);
          const packageKeys = literal.keys.filter((key) => key === "packages").length;
          if (!hasModel) offenders.push(`${file}: model key lost`);
          if (packageKeys !== 1) offenders.push(`${file}: ${packageKeys} packages keys`);
        }
      }
    }
    assert.ok(literals > 150, `the scan saw ${literals} agent literals`);
    assert.deepEqual(offenders, []);
  });
});
