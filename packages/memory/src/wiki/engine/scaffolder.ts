import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createEmptyManifest, saveManifest } from "../manifest.js";
import { resolveProfile } from "../profiles/hybrid.js";
import type { WikiManifest, WikiProfileType } from "../types.js";
import { prependLog, renderDirIndex, renderRootIndex, renderSchema, wikiDate } from "./okf.js";

export interface ScaffoldOptions {
  readonly wikiRoot: string;
  readonly rawRoots?: readonly string[];
  readonly profile?: WikiProfileType;
  readonly sampleFiles?: readonly string[];
}

export interface ScaffoldResult {
  readonly wikiRoot: string;
  readonly profile: WikiProfileType;
  readonly createdFiles: readonly string[];
  readonly manifest: WikiManifest;
}

export async function scaffoldWiki(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const wikiRoot = options.wikiRoot;
  const rawRoots = options.rawRoots ?? ["."];
  const sampleFiles = options.sampleFiles ?? [];
  const profileInstance = resolveProfile(options.profile ?? "auto", sampleFiles);

  const subdirs = [wikiRoot, join(wikiRoot, "entities"), join(wikiRoot, "decisions"), join(wikiRoot, "concepts")];

  for (const dir of subdirs) {
    await mkdir(dir, { recursive: true });
  }

  const createdFiles: string[] = [];

  const schemaPath = join(wikiRoot, "SCHEMA.md");
  await writeFile(schemaPath, renderSchema(profileInstance.name, profileInstance.generateSchemaRules()), "utf8");
  createdFiles.push(schemaPath);

  const indexPath = join(wikiRoot, "index.md");
  await writeFile(indexPath, renderRootIndex([]), "utf8");
  createdFiles.push(indexPath);

  for (const dir of ["entities", "decisions", "concepts"] as const) {
    const dirIndex = join(wikiRoot, dir, "index.md");
    await writeFile(dirIndex, renderDirIndex(dir, []), "utf8");
    createdFiles.push(dirIndex);
  }

  const logPath = join(wikiRoot, "log.md");
  await writeFile(
    logPath,
    prependLog(undefined, wikiDate(), [
      {
        verb: "Initialized",
        text: `Wiki Scaffolding of \`${wikiRoot}\` under profile \`${profileInstance.name}\`.`,
      },
    ]),
    "utf8",
  );
  createdFiles.push(logPath);

  // 4. .manifest.json
  const manifest = createEmptyManifest(wikiRoot, rawRoots, profileInstance.name);
  await saveManifest(wikiRoot, manifest);
  createdFiles.push(join(wikiRoot, ".manifest.json"));

  return {
    wikiRoot,
    profile: profileInstance.name,
    createdFiles,
    manifest,
  };
}
