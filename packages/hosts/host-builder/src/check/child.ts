/**
 * The check child: `bun child.ts <inspect|manifest|conformance> <resultFile> [<file> <export>] [--trust-project]`.
 * It runs inside the host project (the runner sets the cwd and a filtered environment), imports the host's own
 * code, and writes `{ ok, value | code, message }` to `resultFile`. Nothing here is imported by the server.
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HostBuilderError } from "../errors.js";

type Reported = { ok: true; value: unknown } | { ok: false; code?: string; message: string; value?: unknown };

function report(resultFile: string, value: Reported): void {
  writeFileSync(resultFile, JSON.stringify(value));
}

/** Resolves a kernel subpath from the host project, not from this package, so the check uses the host's install. */
async function kernel<T>(subpath: string): Promise<T> {
  return (await import(createRequire(join(process.cwd(), "noop.js")).resolve(`@arnilo/prism/${subpath}`))) as T;
}

async function exported(file: string, name: string): Promise<unknown> {
  const module = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  if (!(name in module)) throw new HostBuilderError("ERR_PRISM_HOST_BUILDER_ENTRY", `${file} has no export named "${name}".`);
  return module[name];
}

/** Outbound `fetch` during a check is a model call or its stand-in: refuse it and remember it. */
function guardFetch(): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url.replace(/[?#].*$/, ""));
    throw new Error("Outbound requests are refused while a host-builder check runs.");
  }) as typeof fetch;
  return calls;
}

async function inspect(file: string, name: string): Promise<unknown> {
  const calls = guardFetch();
  const factory = await exported(file, name);
  if (typeof factory !== "function") throw new HostBuilderError("ERR_PRISM_HOST_BUILDER_ENTRY", `${name} in ${file} is not a function.`);
  const agent = (await factory()) as {
    inspect?: () => unknown;
    dispose?: () => Promise<void>;
    sessions?: { list?: () => Promise<{ items?: unknown[] }> };
  };
  if (typeof agent?.inspect !== "function" || typeof agent.dispose !== "function")
    throw new HostBuilderError("ERR_PRISM_HOST_BUILDER_ENTRY", `${name} in ${file} did not return an Agent (no inspect() or dispose()).`);
  try {
    const inspection = agent.inspect();
    let sessions = 0;
    try {
      sessions = (await agent.sessions?.list?.())?.items?.length ?? 0;
    } catch {
      // A store without `listSessions` cannot tell; the fetch guard still covers a real provider.
    }
    if (calls.length > 0 || sessions > 0)
      throw new HostBuilderError(
        "ERR_PRISM_HOST_BUILDER_CHECK_MODEL_CALL",
        calls.length > 0
          ? `The factory made an outbound request (${calls[0]}). An inspection factory must build the agent on the mock provider and run nothing.`
          : `The factory ran ${sessions} session(s). An inspection factory must build the agent on the mock provider and run nothing.`,
      );
    return inspection;
  } finally {
    await agent.dispose();
  }
}

async function conformance(file: string, name: string): Promise<unknown> {
  const input = await exported(file, name);
  if (input === undefined || input === null || (typeof input !== "function" && typeof input !== "object"))
    throw new HostBuilderError("ERR_PRISM_HOST_BUILDER_ENTRY", `${name} in ${file} is not a package definition or instance.`);
  const testing = await kernel<{ packageConformance: (input: unknown) => Promise<{ ok: boolean }> }>("testing");
  return await testing.packageConformance(input);
}

async function manifest(trustProject: boolean): Promise<unknown> {
  const { verify } = await kernel<{ verify: (options: unknown) => Promise<Array<{ ok: boolean }>> }>("manifest");
  const results = await verify({ root: process.cwd(), trustProject: () => trustProject });
  return { ok: results.every((entry) => entry.ok), packages: results };
}

async function main(argv: string[]): Promise<void> {
  const [kind, resultFile, file, name] = argv;
  if (resultFile === undefined) throw new Error("child: missing result file");
  try {
    let value: unknown;
    if (kind === "inspect") value = await inspect(file as string, name as string);
    else if (kind === "conformance") value = await conformance(file as string, name as string);
    else if (kind === "manifest") value = await manifest(argv.includes("--trust-project"));
    else throw new Error(`child: unknown check "${kind}"`);
    report(resultFile, { ok: true, value });
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    report(resultFile, {
      ok: false,
      ...(typeof code === "string" ? { code } : {}),
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

await main(process.argv.slice(2));
// Host code can leave handles open (timers, sockets); the result is written, so end the process here.
process.exit(0);
