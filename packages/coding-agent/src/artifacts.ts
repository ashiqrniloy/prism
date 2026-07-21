/**
 * Host-owned artifact helpers for Git patch/bundle/PR-handoff spill.
 *
 * Prism never pushes, authenticates to GitHub/GitLab, or opens a PR. Artifacts
 * are written only through an explicit host callback or a bounded temp-file writer.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArtifactReference, ArtifactWriter } from "./git.js";

export function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Write artifacts under a host directory as `file://` URIs with SHA-256 metadata. */
export function createDirectoryArtifactWriter(rootDir: string): ArtifactWriter {
  return async ({ kind, filename, bytes }) => {
    const safeName = filename.replace(/[^A-Za-z0-9._-]+/g, "_");
    const dir = join(rootDir, kind);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${randomBytes(8).toString("hex")}-${safeName}`);
    await writeFile(path, bytes, { mode: 0o600 });
    return {
      kind,
      uri: `file://${path}`,
      sha256: sha256Hex(bytes),
      bytes: bytes.length,
    } satisfies ArtifactReference;
  };
}

/** Spill into the process temp directory (tests / ephemeral hosts). */
export function createTempArtifactWriter(prefix = "prism-git-artifact"): ArtifactWriter {
  const root = join(tmpdir(), `${prefix}-${randomBytes(6).toString("hex")}`);
  return createDirectoryArtifactWriter(root);
}
