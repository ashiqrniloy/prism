import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The reference-host import allow-list, shared by the boundary gate
 * (`reference-host-boundary.test.ts`) and the README snippet check
 * (`docs.test.ts`, plan 173 Task 9). Keeping one implementation means a
 * snippet the gate would reject cannot ship in the walkthrough.
 */

const KERNEL = "@arnilo/prism";
const KERNEL_SUBPATHS = new Set(["manifest", "driver-kit"]);
export const REJECT = new Set(["@arnilo/" + "prism-core", "@arnilo/prism-" + "coding-tools", "@arnilo/prism-" + "agent-sdk", "@arnilo/prism-code"]);
const BUILTINS = new Set(builtinModules);

function exportSubpaths(exports: unknown): Set<string> {
  const subs = new Set<string>();
  if (!exports || typeof exports !== "object" || Array.isArray(exports)) return subs;
  for (const key of Object.keys(exports as Record<string, unknown>)) {
    if (key.startsWith("./") && key !== ".") subs.add(key.slice(2));
  }
  return subs;
}

/** Non-private `packages/<group>/<name>` names, minus the explicit reject list. */
export function referenceHostPackages(repo = join(dirname(fileURLToPath(import.meta.url)), "../..")): Map<string, Set<string>> {
  const allowed = new Map<string, Set<string>>();
  const packages = join(repo, "packages");
  for (const group of readdirSync(packages)) {
    const groupDir = join(packages, group);
    if (!statSync(groupDir).isDirectory() || existsSync(join(groupDir, "package.json"))) continue;
    for (const name of readdirSync(groupDir)) {
      const manifestPath = join(groupDir, name, "package.json");
      if (!existsSync(manifestPath)) continue;
      const pkg = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: string; private?: boolean; exports?: unknown };
      if (pkg.private === true || typeof pkg.name !== "string" || REJECT.has(pkg.name)) continue;
      allowed.set(pkg.name, exportSubpaths(pkg.exports));
    }
  }
  return allowed;
}

function testingAllowed(appRoot: string, file: string): boolean {
  const rel = relative(appRoot, file).replaceAll("\\", "/");
  return rel.split("/").includes("__tests__") || rel.split("/").includes("scenarios");
}

/** `undefined` when the specifier is allowed, otherwise the reason it is not. */
export function classify(spec: string, file: string, appRoot: string, packages: Map<string, Set<string>>): string | undefined {
  if (spec.startsWith(".")) {
    const target = resolve(dirname(file), spec);
    const root = resolve(appRoot);
    if (target !== root && !target.startsWith(root + sep)) return `relative import leaves the app: ${spec}`;
    return;
  }
  if (spec.startsWith("node:") || spec === "bun" || spec.startsWith("bun:") || BUILTINS.has(spec)) return;
  if (spec === KERNEL) return;
  if (spec === `${KERNEL}/testing` || spec.startsWith(`${KERNEL}/testing/`)) {
    return testingAllowed(appRoot, file) ? undefined : `testing import outside scenarios and tests: ${spec}`;
  }
  if (spec.startsWith(`${KERNEL}/`)) {
    const sub = spec.slice(KERNEL.length + 1);
    return KERNEL_SUBPATHS.has(sub) ? undefined : `kernel subpath not allowed: ${spec}`;
  }
  const match = /^(?<name>@arnilo\/prism-[^/]+)(?:\/(?<sub>.*))?$/.exec(spec);
  if (!match?.groups?.name) return `specifier not on the reference-host allow-list: ${spec}`;
  const allowed = packages.get(match.groups.name);
  if (!allowed) return `package not on the reference-host allow-list: ${spec}`;
  if (match.groups.sub && !allowed.has(match.groups.sub)) return `deep or undeclared package path: ${spec}`;
  return;
}
