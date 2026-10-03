import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type AIProvider, createAgent, providerDone, providerTextDelta, toolCallContent } from "@arnilo/prism";
import { configure, install, installedPackageDir, loadManifest, ManifestError, scopeDirs, setEnabled } from "@arnilo/prism/manifest";

/**
 * The manifest cycle (roadmap Phase 4): install a local package, load it into an agent, disable it,
 * reload, then show the three fail-closed paths. Real `bun add` of a `file:` spec into a temp root.
 *
 * 1. `install` records the package with its version, integrity hash and declared capabilities.
 * 2. `loadManifest` hands the agent the package; one turn uses its tool.
 * 3. `setEnabled(false)` and a reload: the tool is gone.
 * 4. An untrusted project manifest is skipped (no `trustProject`, no import).
 * 5. `configure` refuses a literal in a secret field and writes nothing.
 * 6. One installed byte changes: the load fails as `integrity_mismatch` before any import.
 *
 * Run: npm run build:core && bun examples/manifest.ts
 */

const FIXTURE = fileURLToPath(new URL("./fixtures/hello-package", import.meta.url));
const MODEL = { provider: "mock", model: "demo" } as const;

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ManifestError) return error.code;
    throw error;
  }
  return "none";
}

export async function demo(): Promise<Record<string, unknown>> {
  const started = Date.now();
  const root = await mkdtemp(join(tmpdir(), "prism-manifest-"));
  const home = await mkdtemp(join(tmpdir(), "prism-manifest-home-"));
  try {
    // 1. Install into the project scope.
    const entry = await install(`file:${FIXTURE}`, { scope: "project", root, home });

    // 2. Load and run one turn that calls the package's tool.
    const advertised: string[][] = [];
    let greeted: unknown;
    const provider: AIProvider = {
      id: "mock",
      async *generate(request) {
        advertised.push((request.tools ?? []).map((tool) => tool.name));
        const result = request.messages.flatMap((message) => message.content).find((block) => block.type === "tool_result");
        if (result?.type === "tool_result") greeted = result.result;
        if (result === undefined && advertised.at(-1)?.includes("hello_greet")) {
          yield { type: "tool_call" as const, call: toolCallContent("c1", "hello_greet", { name: "prism" }) };
        } else {
          yield providerTextDelta("done");
        }
        yield providerDone();
      },
    };
    const trusted = { root, home, trustProject: () => true };
    const run = async (): Promise<string> => {
      const agent = await createAgent({ id: "manifest-demo", model: MODEL, provider, packages: await loadManifest(trusted) });
      try {
        return (await (await agent.session()).run("greet prism")).status;
      } finally {
        await agent.dispose();
      }
    };
    const status = await run();

    // 3. Disable and reload: the tool is no longer advertised.
    await setEnabled(entry.name, false, { scope: "project", root, home });
    advertised.length = 0;
    await run();
    const toolAfterDisable = advertised.some((tools) => tools.includes("hello_greet"));
    await setEnabled(entry.name, true, { scope: "project", root, home });

    // 4. An untrusted project manifest is skipped: nothing loads and nothing is imported.
    const untrusted = await loadManifest({ root, home });

    // 5. A literal in a secret field is refused; the file is unchanged.
    const manifestPath = scopeDirs({ scope: "project", root, home }).manifestPath;
    const before = await readFile(manifestPath, "utf8");
    const literal = await codeOf(() => configure(entry.name, { apiKey: "a-literal-key-0123" }, { scope: "project", root, home }));
    const unchanged = (await readFile(manifestPath, "utf8")) === before;
    await configure(entry.name, { apiKey: "env:DEMO_HELLO_KEY" }, { scope: "project", root, home });

    // 6. Tamper with one installed file: the load fails closed.
    const file = join(installedPackageDir(scopeDirs({ scope: "project", root, home }).packagesDir, entry.name), "index.js");
    await writeFile(file, `${await readFile(file, "utf8")}// edited\n`);
    const tampered = await codeOf(() => loadManifest(trusted));

    return {
      installed: `${entry.name}@${entry.version}`,
      capabilities: entry.capabilities,
      status,
      greeted,
      toolAfterDisable,
      untrustedLoaded: untrusted.length,
      literal,
      unchanged,
      tampered,
      withinBudget: Date.now() - started < 5000,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
