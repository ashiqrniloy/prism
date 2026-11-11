import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Repo-wide host-surface gate (plan 162 Task 5). It scans every non-test module of `packages/hosts/*`
 * (`src/` and `bin/`) and fails when a host library reaches past the public `Agent` surface. It is a
 * static regex-over-source scan with no dependencies, the same shape as `kernel-imports-no-package`.
 * `PRISM_HOST_GATE_ROOT` points the scan at a fixture tree. It exists to prove each rule fails; normal runs leave it unset.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ROOT = process.env.PRISM_HOST_GATE_ROOT ?? REPO;

const KERNEL = "@arnilo/prism";
/** Kernel subpaths a host module may import. `manifest` is the public loader a bin uses to build an agent from a manifest; `driver-kit` is the driver contract a host adapter implements (roadmap §2.8 `serveTools`); `net` (SSRF-safe fetch, loopback checks) and `artifacts` (artifact and citation records) left the root for their own subpaths in plan 215 Task 26. `testing`, `provider-kit`, `node/*` and `src/*` are not host surface. */
const PUBLIC_SUBPATHS = new Set(["manifest", "driver-kit", "net", "artifacts"]);
/**
 * 0.12 family subpaths retired into packages (plan 168 Tasks 6-7). A host library must
 * never reach them: the engine is `@arnilo/prism-extensions/workflows` and the timeline is `@arnilo/prism-extensions/observability`.
 */
const RETIRED_FAMILY = "@arnilo/" + "prism-core";

// Static `import` / `export … from`, with the clause kept so the names can be read.
const FROM_CLAUSE = /\b(?:import|export)\s+(?:type\s+)?([^'"`;]*?)\s*from\s*["']([^"']+)["']/g;
// Side-effect `import "x"`, and dynamic `import("x")` including the type form `import("x").Name`.
const BARE_OR_DYNAMIC = /\bimport\s*\(?\s*["']([^"']+)["'](?:\s*\))?(?:\s*\.\s*([A-Za-z_$][\w$]*))?/g;
// Any dynamic `import(...)` call with its argument, so a non-literal specifier can be rejected.
const DYNAMIC_IMPORT_CALL = /\bimport\s*\(([^()]*)\)/g;
const LITERAL_SPECIFIER = /^["'][^"']+["']$/;
const CREATE_AGENT_CALL = /\bcreateAgent\s*\(/g;
// A spread whose operand is an agent: `...agent`, `...this.agent`, `...prismAgent`.
const AGENT_SPREAD = /\.\.\.\s*(?:[\w$]+\.)*(?:agent|[\w$]*Agent)\s*[,})]/g;
const IMPLEMENTS_AGENT = /\bimplements\s+(?:[\w$.]+\s*,\s*)*Agent\b/g;

interface HostModule {
  path: string;
  rel: string;
  lib: string;
  bin: boolean;
  text: string;
}

interface Scan {
  libs: Set<string>;
  modules: number;
  importViolations: string[];
  constructViolations: string[];
  usedRootNames: Set<string>;
}

function hostModules(root: string): HostModule[] {
  const hosts = join(root, "packages/hosts");
  const out: HostModule[] = [];
  const walk = (dir: string, lib: string, bin: boolean): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name !== "__tests__") walk(path, lib, bin);
      } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
        out.push({ path, rel: relative(root, path), lib, bin, text: readFileSync(path, "utf8") });
      }
    }
  };
  for (const lib of readdirSync(hosts)) {
    if (lib === "driver-process") continue; // Native driver package, not an Agent-serving host library.
    for (const sub of ["src", "bin"]) {
      const dir = join(hosts, lib, sub);
      if (existsSync(dir)) walk(dir, lib, sub === "bin");
    }
  }
  return out;
}

/** Names a clause imports from the kernel root, or `null` when the clause hides them (namespace, default, or star). */
function clauseNames(clause: string): string[] | null {
  if (clause.includes("*")) return null;
  const braces = clause.match(/\{([\s\S]*)\}/);
  const head = clause
    .replace(/\{[\s\S]*\}/, "")
    .replace(/,/g, "")
    .trim();
  if (!braces || head) return null;
  return braces[1]!
    .split(",")
    .map((part) =>
      part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]!
        .trim(),
    )
    .filter(Boolean);
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function scanHostSurface(root: string, allowed: Set<string>): Scan {
  const modules = hostModules(root);
  const scan: Scan = {
    libs: new Set(modules.map((mod) => mod.lib)),
    modules: modules.length,
    importViolations: [],
    constructViolations: [],
    usedRootNames: new Set(),
  };
  for (const mod of modules) {
    const lines = mod.text.split("\n");
    const specs: Array<{ spec: string; clause?: string; member?: string; index: number }> = [];
    for (const m of mod.text.matchAll(FROM_CLAUSE)) specs.push({ spec: m[2]!, clause: m[1], index: m.index! });
    for (const m of mod.text.matchAll(BARE_OR_DYNAMIC)) specs.push({ spec: m[1]!, member: m[2], index: m.index! });

    for (const { spec, clause, member, index } of specs) {
      const where = `${mod.rel}:${lineOf(mod.text, index)}`;
      if (spec === KERNEL) {
        // A static clause names its imports; `import("@arnilo/prism").Name` names one; anything else hides them.
        const names = clause !== undefined ? clauseNames(clause) : member !== undefined ? [member] : null;
        if (names === null) {
          scan.importViolations.push(`${where} imports the kernel root without named imports`);
          continue;
        }
        for (const name of names) {
          scan.usedRootNames.add(name);
          // `createAgent` is the one construction a bin may make (plan 161 Task 1 (a)); it is not an allow-listed name.
          if (mod.bin && name === "createAgent") continue;
          if (!allowed.has(name)) scan.importViolations.push(`${where} imports ${name}, which is not on the host-surface allow-list`);
        }
      } else if (spec === RETIRED_FAMILY || spec.startsWith(`${RETIRED_FAMILY}/`)) {
        scan.importViolations.push(`${where} imports ${spec}, a retired 0.12 family package`);
      } else if (spec.startsWith(`${KERNEL}/`)) {
        const sub = spec.slice(KERNEL.length + 1);
        if (sub.startsWith("src/")) scan.importViolations.push(`${where} imports a deep kernel path: ${spec}`);
        else if (!PUBLIC_SUBPATHS.has(sub)) scan.importViolations.push(`${where} imports ${spec}, which is not a host-surface subpath`);
      } else if (spec.startsWith(".")) {
        const libRoot = join(root, "packages/hosts", mod.lib);
        const target = resolve(dirname(mod.path), spec);
        if (target !== libRoot && !target.startsWith(libRoot + sep) && target !== join(root, "packages/hosts/package.json")) {
          scan.importViolations.push(`${where} relative import ${spec} leaves packages/hosts/${mod.lib}`);
        }
      }
    }

    if (mod.text.includes(RETIRED_FAMILY)) {
      scan.importViolations.push(`${mod.rel}:1 names ${RETIRED_FAMILY}, a retired 0.12 family package`);
    }
    for (const m of mod.text.matchAll(DYNAMIC_IMPORT_CALL)) {
      const arg = (m[1] ?? "").trim();
      if (LITERAL_SPECIFIER.test(arg)) continue;
      // The one justified exception: a module path the host receives at runtime (a conformance
      // factory, a CLI argument). It must say so, with a reason, on its own line or the line above.
      const line = mod.text.slice(0, m.index!).split("\n").length;
      const marker = [lines[line - 1] ?? "", lines[line - 2] ?? ""].some((source) => /\/\/\s*host-gate:\s*\S/.test(source));
      if (marker) continue;
      scan.importViolations.push(
        `${mod.rel}:${lineOf(mod.text, m.index!)} uses a computed import specifier: import(${arg.slice(0, 60)}) — use a string literal, or a "// host-gate: <reason>" comment for a runtime module path`,
      );
    }
    for (const m of mod.text.matchAll(CREATE_AGENT_CALL)) {
      if (!mod.bin) scan.constructViolations.push(`${mod.rel}:${lineOf(mod.text, m.index!)} calls createAgent outside a bin`);
    }
    for (const m of mod.text.matchAll(AGENT_SPREAD)) {
      scan.constructViolations.push(`${mod.rel}:${lineOf(mod.text, m.index!)} spreads an agent value into a new object`);
    }
    for (const m of mod.text.matchAll(IMPLEMENTS_AGENT)) {
      scan.constructViolations.push(`${mod.rel}:${lineOf(mod.text, m.index!)} implements Agent`);
    }
  }
  return scan;
}

type Allowlist = Record<string, string[]>;

/**
 * Checks the shared allow-list itself. Every group is `frozen` (the Phase 4 freeze contract, no tag) or a
 * phase-tagged extra. A tagged extra that no host library imports is stale and fails.
 *
 * `frozen` is exempt from the usage check on purpose: its payload types (`Message`, `JsonValue`, `RunOptions`, …)
 * are the types of frozen members, so host code names them through those members, not by import.
 */
function allowlistFindings(allow: Allowlist, usedRootNames: Set<string>): string[] {
  const findings: string[] = [];
  const owner = new Map<string, string>();
  for (const [group, names] of Object.entries(allow)) {
    if (group !== "frozen" && !/^phase\d+$/.test(group)) findings.push(`allow-list group "${group}" has no owning phase`);
    for (const name of names) {
      if (owner.has(name)) findings.push(`${name} is listed in both ${owner.get(name)} and ${group}`);
      owner.set(name, group);
    }
  }
  for (const [group, names] of Object.entries(allow)) {
    if (group === "frozen") continue;
    for (const name of names) {
      if (!usedRootNames.has(name)) findings.push(`${name} (${group}) is imported by no host library; prune it`);
    }
  }
  return findings;
}

function loadAllowlist(root: string): Allowlist {
  return JSON.parse(readFileSync(join(root, "scripts/host-surface-allowlist.json"), "utf8")) as Allowlist;
}

describe("host surface gate", () => {
  it("host_libraries_import_only_allowlisted_kernel_names", () => {
    const allow = loadAllowlist(ROOT);
    const scan = scanHostSurface(ROOT, new Set(Object.values(allow).flat()));
    // Guard against a vacuous pass: every host library directory must contribute modules to the scan.
    const hostDirs = readdirSync(join(ROOT, "packages/hosts"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "driver-process")
      .map((entry) => entry.name);
    assert.deepEqual([...scan.libs].sort(), hostDirs.sort(), "every host library must be scanned");
    assert.deepEqual(scan.importViolations, [], `host libraries must import only the public surface:\n${scan.importViolations.join("\n")}`);
  });

  it("host_libraries_construct_no_agent", () => {
    const scan = scanHostSurface(ROOT, new Set(Object.values(loadAllowlist(ROOT)).flat()));
    assert.ok(scan.modules > 0, "the gate scanned no host modules");
    assert.deepEqual(
      scan.constructViolations,
      [],
      `host libraries must not construct an agent (createAgent is allowed only in bin/):\n${scan.constructViolations.join("\n")}`,
    );
  });

  it("host_surface_rejects_prism_core_and_non_literal_import_specifiers", () => {
    const fixture = mkdtempSync(join(tmpdir(), "prism-host-gate-"));
    const probe = join(fixture, "packages", "hosts", "probe", "src");
    try {
      mkdirSync(probe, { recursive: true });
      writeFileSync(
        join(probe, "static.ts"),
        `import type { A2AClient } from "${RETIRED_FAMILY}/runtime/supervisor";\nexport type C = A2AClient;\n`,
      );
      writeFileSync(
        join(probe, "hidden.ts"),
        `const pkg = "${RETIRED_FAMILY}/validation/json-schema";\nexport const load = () => import(pkg);\n`,
      );
      writeFileSync(join(probe, "computed.ts"), 'export const load = () => import("@arnilo/" + "prism-workflows");\n');
      // A package specifier hidden behind a bound variable: no retired-family name in the import call itself.
      writeFileSync(
        join(probe, "indirect.ts"),
        'const pkg = "@arnilo/prism-extensions/observability";\nexport const load = () => import(pkg);\n',
      );
      // The sanctioned exception: a runtime module path, declared with a reason on the line above.
      writeFileSync(
        join(probe, "runtime.ts"),
        "export const load = (modulePath: string) => () =>\n  // host-gate: the factory module path is supplied by the caller\n  import(modulePath);\n",
      );
      // A marker with no reason is not a marker.
      writeFileSync(
        join(probe, "unreasoned.ts"),
        "export const load = (modulePath: string) => () =>\n  // host-gate:\n  import(modulePath);\n",
      );
      const scan = scanHostSurface(fixture, new Set());
      assert.ok(
        scan.importViolations.some((violation) => violation.includes("static.ts")),
        `a static retired-family import must fail:\n${scan.importViolations.join("\n")}`,
      );
      assert.ok(
        scan.importViolations.some((violation) => violation.includes("hidden.ts")),
        `a computed retired-family import must fail:\n${scan.importViolations.join("\n")}`,
      );
      assert.ok(
        scan.importViolations.some((violation) => violation.includes("computed.ts") && violation.includes("computed import specifier")),
        `a concatenated import specifier must fail:\n${scan.importViolations.join("\n")}`,
      );
      assert.ok(
        scan.importViolations.some((violation) => violation.includes("indirect.ts") && violation.includes("computed import specifier")),
        `a specifier bound to a variable must fail:\n${scan.importViolations.join("\n")}`,
      );
      assert.deepEqual(
        scan.importViolations.filter((violation) => violation.includes("runtime.ts")),
        [],
        `a declared runtime module path must pass:\n${scan.importViolations.join("\n")}`,
      );
      assert.ok(
        scan.importViolations.some((violation) => violation.includes("unreasoned.ts") && violation.includes("computed import specifier")),
        `a host-gate marker without a reason must fail:\n${scan.importViolations.join("\n")}`,
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("host_surface_allowlist_entries_are_used_and_tagged", () => {
    const allow = loadAllowlist(ROOT);
    const scan = scanHostSurface(ROOT, new Set(Object.values(allow).flat()));
    const findings = allowlistFindings(allow, scan.usedRootNames);
    assert.deepEqual(findings, [], `the allow-list has stale or untagged entries:\n${findings.join("\n")}`);
  });
});
