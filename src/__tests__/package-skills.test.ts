import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, it } from "bun:test";
import { definePackage, type PackageInstance } from "../index.js";
// @ts-expect-error the gate is a plain .mjs script with no declarations
import * as gate from "../../scripts/package-skills-conformance.mjs";

interface Failure {
  readonly package: string;
  readonly skill?: string;
  readonly check: string;
  readonly message: string;
}
interface Report {
  readonly ok: boolean;
  readonly ms: number;
  readonly packages: readonly { package: string; skills: readonly string[] }[];
  readonly catalogs: readonly { name: string; entries: number; bytes: number }[];
  readonly failures: readonly Failure[];
}
interface Fixture {
  readonly dir: string;
  readonly build: () => Promise<PackageInstance[]>;
  readonly dependencies: readonly string[];
}

const run = gate.runPackageSkillsGate as (options?: Record<string, unknown>) => Promise<Report>;
const budgets = (await import("../../scripts/budgets.json", { with: { type: "json" } })).default as unknown as {
  packageSkills: Record<string, number>;
};

const scratch = mkdtempSync(join(tmpdir(), "prism-package-skills-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;

/** A synthetic package on disk: a `package.json`, one skill, and a package that registers a tool and the skill. */
function synthetic(options: {
  readonly skillName?: string;
  readonly description?: string;
  readonly body?: string;
  readonly frontmatter?: string;
  readonly files?: readonly string[];
  readonly tools?: readonly string[];
  readonly name?: string;
  readonly dependencies?: readonly string[];
}): Fixture {
  counter += 1;
  const name = options.name ?? `@fixture/skills-${counter}`;
  const dir = join(scratch, `pkg-${counter}`);
  const skillName = options.skillName ?? "fixture-skill";
  mkdirSync(join(dir, "skills", skillName), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "0.0.0", files: options.files ?? ["skills"] }));
  writeFileSync(
    join(dir, "skills", skillName, "SKILL.md"),
    `---\nname: ${skillName}\ndescription: ${options.description ?? "Use when testing. Covers the fixture."}\n${options.frontmatter ?? ""}---\n\n${options.body ?? "1. Do the thing.\n"}`,
  );
  const tools = options.tools ?? ["fixture_read"];
  return {
    dir,
    dependencies: options.dependencies ?? [],
    build: async () => [
      definePackage({
        name,
        version: "0.0.0",
        requires: { api: 1 },
        setup: (prism) => {
          for (const tool of tools) {
            prism.tools.register({
              name: tool,
              description: tool,
              effects: ["read"],
              parameters: { type: "object", properties: {} },
              execute: async (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: tool, value: true }),
            });
          }
          prism.skills.addDir(join(dir, "skills"));
        },
      })(),
    ],
  };
}

async function gateOn(fixtures: readonly Fixture[], extra: Record<string, unknown> = {}): Promise<Report> {
  return run({ fixtures, referenceHost: false, ...extra });
}

function checks(report: Report): string[] {
  return report.failures.map((failure) => failure.check);
}

describe("package skills", () => {
  it("package_skills_conform", async () => {
    const report = await run();
    assert.deepEqual(report.failures, []);
    assert.equal(report.ok, true);
    const shipped = report.packages.flatMap((entry) => entry.skills).sort();
    assert.deepEqual(shipped, [
      "computer-use-linux",
      "docx",
      "pdf",
      "powerpoint",
      "research-report",
      "research-scoping",
      "research-synthesis",
      "source-triage",
      "xlsx",
    ]);
    // The gate builds every package once on the mock provider; the budget is wall-clock.
    console.log(`package-skills gate: ${report.ms} ms`);
    assert.ok(report.ms < 30_000, `the gate took ${report.ms} ms`);
  });

  it("synthetic_conforming_package_passes", async () => {
    const report = await gateOn([
      synthetic({ frontmatter: "metadata:\n  prism-requires-tools: fixture_read\n", body: "1. Call `fixture_read`.\n" }),
    ]);
    assert.deepEqual(report.failures, []);
  });

  it("skill_naming_unregistered_tool_fails", async () => {
    const other = synthetic({ name: "@fixture/other", tools: ["fixture_other"], skillName: "other-skill" });
    const report = await gateOn([other, synthetic({ body: "1. Call `fixture_other`.\n" })]);
    assert.ok(
      report.failures.some((failure) => failure.check === "unregistered_tool" && failure.skill === "fixture-skill"),
      JSON.stringify(report.failures),
    );
  });

  it("a_declared_dependency_may_supply_the_tool", async () => {
    const dep = synthetic({ name: "@fixture/dep", tools: ["fixture_dep"], skillName: "dep-skill" });
    const own = synthetic({
      dependencies: ["@fixture/dep"],
      frontmatter: "metadata:\n  prism-requires-tools: fixture_dep\n",
      body: "1. Call `fixture_dep`.\n",
    });
    // Each fixture builds its own agent, so the dependency is part of the dependent's package list.
    const withDep: Fixture = { ...own, build: async () => [...(await dep.build()), ...(await own.build())] };
    const report = await gateOn([withDep]);
    assert.deepEqual(report.failures, []);
  });

  it("requires_tools_naming_an_unregistered_tool_fails", async () => {
    const report = await gateOn([synthetic({ frontmatter: "metadata:\n  prism-requires-tools: nothing_here\n" })]);
    assert.ok(checks(report).includes("requires_tools"), JSON.stringify(report.failures));
  });

  it("skill_naming_retired_tool_fails", async () => {
    // The inventory is the source of truth; naming one of its entries here would trip the wiki retired-name sweep.
    const retired = [...(gate.loadRetiredToolNames() as Map<string, string>)].find(([, by]) => by === "plan 207");
    assert.ok(retired, "the inventory records plan 207's removals");
    const report = await gateOn([synthetic({ body: `1. Call \`${retired[0]}\`.\n` })]);
    assert.ok(
      report.failures.some((failure) => failure.check === "retired_tool" && /plan 207/.test(failure.message)),
      JSON.stringify(report.failures),
    );
  });

  it("skill_with_over_cap_description_fails", async () => {
    const report = await gateOn([synthetic({ description: `Use when testing. ${"x".repeat(budgets.packageSkills.descriptionBytesMax)}` })]);
    assert.ok(checks(report).includes("description"), JSON.stringify(report.failures));
  });

  it("skill_with_over_cap_body_fails", async () => {
    const report = await gateOn([synthetic({ body: `1. ${"x".repeat(budgets.packageSkills.bodyBytesMax)}\n` })]);
    assert.ok(checks(report).includes("body"), JSON.stringify(report.failures));
  });

  it("skill_name_outside_the_spec_rule_fails", async () => {
    const report = await gateOn([synthetic({ skillName: "Fixture_Skill" })]);
    assert.ok(checks(report).includes("name"), JSON.stringify(report.failures));
  });

  it("missing_files_entry_fails", async () => {
    const report = await gateOn([synthetic({ files: ["src"] })]);
    assert.ok(checks(report).includes("files"), JSON.stringify(report.failures));
  });

  it("duplicate_skill_name_across_packages_fails", async () => {
    const report = await gateOn([synthetic({ name: "@fixture/a" }), synthetic({ name: "@fixture/b" })]);
    assert.ok(checks(report).includes("duplicate"), JSON.stringify(report.failures));
  });

  it("optional_tool_outside_conditional_heading_fails", async () => {
    const outside = await gateOn([synthetic({ tools: ["fixture_read", "fixture_extra"], body: "1. Maybe call `fixture_extra`.\n" })]);
    assert.ok(checks(outside).includes("optional_tool"), JSON.stringify(outside.failures));

    const inside = await gateOn([
      synthetic({
        tools: ["fixture_read", "fixture_extra"],
        body: "1. Done.\n\n## If `fixture_extra` is available\n\nCall `fixture_extra`.\n",
      }),
    ]);
    assert.deepEqual(inside.failures, []);

    const afterSection = await gateOn([
      synthetic({
        tools: ["fixture_read", "fixture_extra"],
        body: "## If `fixture_extra` is available\n\nCall it.\n\n## Stop\n\nNever `fixture_extra`.\n",
      }),
    ]);
    assert.ok(checks(afterSection).includes("optional_tool"), "a later sibling heading ends the conditional section");
  });

  it("skill_body_contains_no_secret_ref", async () => {
    const ref = await gateOn([synthetic({ body: "1. Use the key at env:FIXTURE_API_KEY.\n" })]);
    assert.ok(checks(ref).includes("secret"), JSON.stringify(ref.failures));
    const keyring = await gateOn([synthetic({ body: "1. Read keyring:fixture/token.\n" })]);
    assert.ok(checks(keyring).includes("secret"), JSON.stringify(keyring.failures));
  });

  it("a_package_with_a_skills_directory_that_registers_none_fails_closed", async () => {
    const fixture = synthetic({});
    const silent: Fixture = {
      ...fixture,
      build: async () => [definePackage({ name: "@fixture/silent", version: "0.0.0", requires: { api: 1 }, setup: () => {} })()],
    };
    const report = await gateOn([{ ...silent }]);
    assert.ok(checks(report).includes("load"), JSON.stringify(report.failures));
  });

  it("a_skill_that_fails_to_load_fails_the_gate_instead_of_being_skipped", async () => {
    const fixture = synthetic({ frontmatter: "metadata:\n  prism-requires-tools: not a valid name!!\n" });
    const report = await gateOn([fixture]);
    assert.ok(
      report.failures.some((failure) => failure.check === "load" && /setup failed/.test(failure.message)),
      JSON.stringify(report.failures),
    );
  });

  it("a_workspace_package_that_ships_skills_without_a_fixture_fails", () => {
    const uncovered = gate.findUncoveredSkillPackages([]) as string[];
    assert.ok(uncovered.includes("packages/tools/research"), JSON.stringify(uncovered));
    assert.ok(!uncovered.includes("packages/context/files"), "the file-based skill loader ships no skills of its own");
    assert.deepEqual(gate.findUncoveredSkillPackages(gate.defaultFixtures()), []);
  });

  it("every_workspace_tool_name_scan_finds_the_known_tools", () => {
    const names = gate.scanWorkspaceToolNames() as Set<string>;
    for (const name of ["work_exec", "web_fetch", "browser_snapshot"]) assert.ok(names.has(name), name);
  });
});

describe("reference host catalog budget", () => {
  it("reference_host_skill_catalog_within_budget", async () => {
    const report = await run();
    const agents = report.catalogs.map((entry) => entry.name);
    assert.deepEqual(agents.sort(), ["apps/prism-agent coding", "apps/prism-agent orchestrator", "apps/prism-agent research"]);
    for (const entry of report.catalogs) {
      assert.ok(entry.entries <= budgets.packageSkills.catalogEntriesMax, `${entry.name}: ${entry.entries} entries`);
      assert.ok(entry.bytes <= budgets.packageSkills.catalogBytesMax, `${entry.name}: ${entry.bytes} bytes`);
    }
  });

  it("an_extra_300_byte_skill_pushes_an_agent_over_budget", () => {
    const budget = budgets.packageSkills;
    const filler = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ name: `skill-${index}`, description: "x".repeat(300) }));
    const underBudget = Math.floor(budget.catalogBytesMax / 310);
    const fits = gate.checkCatalogBudget([{ name: "agent", skills: filler(underBudget), tools: [] }], budget);
    assert.deepEqual(fits.failures, []);
    const over = gate.checkCatalogBudget([{ name: "agent", skills: filler(underBudget + 1), tools: [] }], budget);
    assert.ok(
      over.failures.some((failure: Failure) => /catalog bytes/.test(failure.message)),
      JSON.stringify(over.failures),
    );

    const entries = gate.checkCatalogBudget(
      [
        {
          name: "agent",
          skills: Array.from({ length: budget.catalogEntriesMax + 1 }, (_, index) => ({ name: `s${index}`, description: "d" })),
          tools: [],
        },
      ],
      budget,
    );
    assert.ok(entries.failures.some((failure: Failure) => /catalog entries/.test(failure.message)));
  });

  it("a_skill_whose_required_tool_is_absent_is_not_counted", () => {
    const measured = gate.measureCatalog({
      name: "agent",
      skills: [
        { name: "needs-it", description: "d", requiresTools: ["gone"] },
        { name: "plain", description: "d" },
      ],
      tools: ["here"],
    });
    assert.equal(measured.entries, 1);
  });
});
