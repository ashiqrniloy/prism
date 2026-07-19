import {
  chmodSync,
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { DEFAULT_FILE_MODE } from "./types.js";

function assertRestrictiveMode(mode: number, path: string): void {
  if (process.platform === "win32") return;
  const perms = mode & 0o777;
  if ((perms & 0o077) !== 0) throw new Error(`Credential file permissions are too permissive: ${path}`);
}

export function assertCredentialFileMode(mode: number): void {
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o777) throw new RangeError("fileMode must be an integer between 0 and 0o777");
  assertRestrictiveMode(mode, "configured file mode");
}

export function atomicWriteFile(path: string, data: Buffer, mode = DEFAULT_FILE_MODE): void {
  assertCredentialFileMode(mode);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.${randomBytes(16).toString("hex")}.tmp`);
  try {
    writeFileSync(tmp, data, { flag: "wx", mode });
    if (process.platform !== "win32") chmodSync(tmp, mode);
    renameSync(tmp, path);
  } catch (error) {
    try { unlinkSync(tmp); } catch { /* nothing published */ }
    throw error;
  }
}

export function readFileIfExists(path: string, maxBytes: number): Buffer | undefined {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    assertRestrictiveMode(stat.mode, path);
    if (!Number.isSafeInteger(stat.size) || stat.size > maxBytes) throw new RangeError(`Credential file exceeds ${maxBytes} byte limit`);
    const buffer = Buffer.allocUnsafe(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const bytesRead = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return buffer.subarray(0, offset);
  } finally {
    closeSync(fd);
  }
}

export function removeFileIfExists(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function assertRestrictiveFileMode(path: string): void {
  assertRestrictiveMode(statSync(path).mode, path);
}
