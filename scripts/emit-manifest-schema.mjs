#!/usr/bin/env bun
// Writes the published manifest v1 JSON Schema to the path `@arnilo/prism/manifest/schema.json`
// exports. The kernel publishes TypeScript source (plan 174 Task 8), so the target is a real
// repo path next to the `src/manifest` module that defines it — not a build output.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] ?? join(root, "manifest", "schema.json");
const { manifestSchemaDocument } = await import(pathToFileURL(join(root, "src", "manifest", "schema.ts")).href);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(manifestSchemaDocument(), null, 2)}\n`);
