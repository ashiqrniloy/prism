#!/usr/bin/env bun
// Writes the published manifest v1 JSON Schema next to the built module (`@arnilo/prism/manifest/schema.json`).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] ?? join(root, "dist", "manifest", "packages.v1.schema.json");
const { manifestSchemaDocument } = await import(pathToFileURL(join(root, "dist", "manifest", "schema.js")).href);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(manifestSchemaDocument(), null, 2)}\n`);
