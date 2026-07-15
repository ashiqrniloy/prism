import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { DEFAULT_FILE_MODE } from "./types.js";

export function atomicWriteFile(path: string, data: Buffer, mode = DEFAULT_FILE_MODE): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.${randomBytes(8).toString("hex")}.tmp`);
  writeFileSync(tmp, data, { flag: "wx", mode });
  renameSync(tmp, path);
  try {
    chmodSync(path, mode);
  } catch {
    // Best effort on platforms without chmod semantics.
  }
}

export function readFileIfExists(path: string): Buffer | undefined {
  if (!existsSync(path)) return undefined;
  return readFileSync(path);
}

export function removeFileIfExists(path: string): void {
  if (!existsSync(path)) return;
  unlinkSync(path);
}

export function assertRestrictiveFileMode(path: string): void {
  if (process.platform === "win32") return;
  const { mode } = statSync(path);
  const perms = mode & 0o777;
  if ((perms & 0o077) !== 0) {
    throw new Error(`Credential file permissions are too permissive: ${path}`);
  }
}
