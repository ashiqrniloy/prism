import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, it } from "bun:test";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory-core";
import { createMarkdownMemoryStores } from "@arnilo/prism-memory-core/fabric";
import { createSqliteMemoryStores } from "@arnilo/prism-memory-core/sqlite";
import { assertScopeIsolation } from "./scope-isolation.js";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fabric-isolation-"));
  dirs.push(dir);
  return dir;
}

it("scope_isolation_holds_on_every_store", async () => {
  const embedder = createHashEmbedder({ dimensions: 32 });
  const cases = [
    {
      name: "memory",
      open: async () => ({ vectorStore: createMemoryVectorStore(), close: () => {} }),
    },
    {
      name: "sqlite",
      open: async () => {
        const stores = await createSqliteMemoryStores({ path: join(tempDir(), "memory.sqlite"), dimensions: 32 });
        return { vectorStore: stores.vectorStore, close: () => stores.close() };
      },
    },
    {
      name: "markdown",
      open: async () => {
        const stores = await createMarkdownMemoryStores({ root: join(tempDir(), "notes"), dimensions: 32 });
        return { vectorStore: stores.vectorStore, close: () => stores.close() };
      },
    },
  ];
  for (const storeCase of cases) {
    const stores = await storeCase.open();
    try {
      await assertScopeIsolation(stores, embedder);
    } catch (error) {
      throw new Error(`${storeCase.name} store: ${(error as Error).message}`, { cause: error });
    } finally {
      await stores.close();
    }
  }
  assert.ok(cases.length === 3);
});
