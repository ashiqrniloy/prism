import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent, createSessionEntry } from "@arnilo/prism";
import { mockProvider, packageConformance } from "@arnilo/prism/testing";
import definition, { createPostgresPersistence, type PostgresStoreConfig, postgresStore } from "../index.js";

const postgresUrl = process.env.PRISM_TEST_POSTGRES_URL;
const describeIntegration = postgresUrl ? describe : describe.skip;
const REPO_ROOT = fileURLToPath(new URL("../../../../..", import.meta.url));
const CANARY_ENV = "PRISM_TEST_POSTGRES_CANARY_URL";
const CANARY = "prism-canary-not-a-real-password";

/** A schema per test, so cases never observe each other's rows (the migrations create it). */
function uniqueSchema(): string {
  return `prism_t_${randomUUID().replace(/-/g, "")}`;
}

describe("postgres store package", () => {
  it("postgres_store_package_definition_conforms_without_a_database", async () => {
    // Definition-only, no server needed: a valid schema, the declared capabilities, and a ref-only url.
    assert.deepEqual(definition.capabilities, ["slot:store", "credentials"]);
    assert.equal(definition.config?.properties?.url?.["x-prism-secret"], true);
    assert.equal(definition.config?.required, undefined);
    const result = await packageConformance(postgresStore({ url: "env:PRISM_TEST_POSTGRES_URL" }));
    assert.equal(result.checks.find((check) => check.name === "config_schema_valid")?.ok, true);
  });

  it("refuses a config without url", async () => {
    await assert.rejects(async () => {
      await createAgent({
        model: { provider: "mock", model: "m" },
        packages: [postgresStore({} as PostgresStoreConfig)],
      });
    }, /prism-store-postgres: config needs url/);
  });

  it("unresolvable_url_ref_fails_create_agent_naming_ref_not_value", async () => {
    const ref = "env:PRISM_TEST_POSTGRES_URL_THAT_DOES_NOT_EXIST";
    const error = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [postgresStore({ url: ref })],
    }).then(
      () => undefined,
      (thrown: Error) => thrown,
    );
    assert.ok(error, "an unresolvable url ref fails the package setup");
    assert.ok(error.message.includes(ref), `the error names the ref: ${error.message}`);
    assert.ok(error.message.includes("@arnilo/prism-store-postgres"));
  });

  it("connection_string_canary_never_leaks", async () => {
    // A closed port, so `pg` fails fast with a host-naming error and no server is needed.
    const url = `postgres://prism:${CANARY}@127.0.0.1:1/prism`;
    const previous = process.env[CANARY_ENV];
    process.env[CANARY_ENV] = url;
    try {
      let agent: Awaited<ReturnType<typeof createAgent>> | undefined;
      const error = await createAgent({
        model: { provider: "mock", model: "m" },
        packages: [postgresStore({ url: `env:${CANARY_ENV}` })],
      }).then(
        (created) => {
          agent = created;
          return undefined;
        },
        (thrown: Error) => thrown,
      );
      if (agent) {
        const notes = JSON.stringify(agent.inspect());
        await agent.dispose();
        assert.equal(notes.includes(CANARY), false, "inspect() must not carry the connection string");
        return;
      }
      assert.ok(error, "a refused connection fails the setup");
      const text = `${error.message}\n${error.stack ?? ""}`;
      assert.equal(text.includes(CANARY), false, `the DSN password never reaches the error: ${text}`);
      assert.ok(text.includes("127.0.0.1"), `the pg failure names the host: ${error.message}`);
    } finally {
      if (previous === undefined) delete process.env[CANARY_ENV];
      else process.env[CANARY_ENV] = previous;
    }
  });

  it("pg_not_loaded_unless_store_postgres_listed", async () => {
    // Static: no source file value-imports the driver; the store requires it lazily, and the kernel
    // never names it (the enterprise and prompt trees peer on it as a type plus a dynamic import).
    const offenders: string[] = [];
    for (const dir of sourceDirs()) {
      for (const file of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
        if (!file.endsWith(".ts") || file.includes("__tests__")) continue;
        const text = readFileSync(join(dir, file), "utf8");
        if (/import\s+(?!type\b)[^;]*from\s*["']pg["']/.test(text)) offenders.push(`${dir}/${file}`);
      }
    }
    assert.deepEqual(offenders, [], "no source module may statically import pg");

    // Runtime: an agent that lists the sqlite store — with this package imported — never loads pg.
    // The `after` probe proves the loader can see `pg` when something does import it.
    const script = [
      'const postgres = await import("@arnilo/prism-store-postgres");',
      'const sqlite = (await import("@arnilo/prism-store-sqlite")).default;',
      'const { createAgent } = await import("@arnilo/prism");',
      'const agent = await createAgent({ model: { provider: "mock", model: "m" }, packages: [sqlite({ path: ":memory:" })] });',
      "await agent.dispose();",
      'const seen = () => Object.keys(require.cache ?? {}).some((key) => key.includes("node_modules/pg/"));',
      "const before = seen();",
      'await import("pg");',
      "const after = seen();",
      'console.log(JSON.stringify({ inert: typeof postgres.createPostgresPersistence === "function", before, after }));',
    ].join("\n");
    const result = spawnSync("bun", ["-e", script], { cwd: REPO_ROOT, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const probe = JSON.parse(result.stdout.trim()) as { inert: boolean; before: boolean; after: boolean };
    assert.equal(probe.inert, true, "the package module loads without the driver");
    assert.equal(probe.before, false, "pg is absent from the module graph of an agent that does not list this store");
    assert.equal(probe.after, true, "the probe can observe pg once it is loaded");
  });
});

describeIntegration("postgres store package with a database", () => {
  it("postgres_store_package_passes_package_conformance", async () => {
    const result = await packageConformance(postgresStore({ url: "env:PRISM_TEST_POSTGRES_URL" }));
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
    );
    assert.equal(result.ok, true);
  });

  it("claims the store slot and serves sessions, listing, and delete", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      // A literal connection string is refused by the kernel's secret_literal check, so the slot test
      // goes through the ref the same way a manifest does.
      packages: [mockProvider(), postgresStore({ url: "env:PRISM_TEST_POSTGRES_URL", schema: uniqueSchema() })],
    });

    const view = agent.inspect();
    assert.equal(view.slots.store, "@arnilo/prism-store-postgres");
    assert.deepEqual(view.store, {
      owner: "@arnilo/prism-store-postgres",
      capabilities: ["listSessions", "deleteSession", "searchSessions"],
    });

    const session = await agent.session({ id: "package-store", create: true });
    await session.run("hello from the package store");
    await session.close();

    const listed = await agent.sessions.list({ limit: 5 });
    assert.ok(listed.items.some((item) => item.sessionId === "package-store"));
    await agent.sessions.delete("package-store");
    assert.equal(await agent.sessions.get("package-store"), undefined);
    await agent.dispose();
  });

  it("mergeSessionMetadata merges into the session record and honors onlyIfMissing", async () => {
    const persistence = await createPostgresPersistence({ connectionString: postgresUrl as string, schema: uniqueSchema() });
    await persistence.append(
      createSessionEntry({
        id: "title-entry",
        sessionId: "title-session",
        kind: "label",
        label: "title probe",
      }),
    );
    const first = await persistence.mergeSessionMetadata("title-session", { title: "durable title" });
    assert.ok(first, "the merge reports the bumped record version");
    assert.equal((await persistence.listSessions({ limit: 5 })).items[0]?.title, "durable title");

    const guarded = await persistence.mergeSessionMetadata("title-session", { title: "second title" }, { onlyIfMissing: ["title"] });
    assert.equal(guarded, undefined, "an existing key makes the guarded merge a no-op");
    assert.equal((await persistence.listSessions({ limit: 5 })).items[0]?.title, "durable title");
    await persistence.close();
  });
});

/** Every source directory of the kernel and the packages, so the static scan sees all of them. */
function sourceDirs(): string[] {
  const dirs = [join(REPO_ROOT, "src")];
  for (const group of ["", "stores", "credentials", "providers", "integrations"]) {
    const parent = group === "" ? join(REPO_ROOT, "packages") : join(REPO_ROOT, "packages", group);
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const src = group === "" ? join(parent, entry.name, "src") : join(parent, entry.name, "src");
      if (existsSync(src) && entry.name !== "node_modules") dirs.push(src);
    }
  }
  return dirs;
}
