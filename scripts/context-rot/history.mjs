/**
 * Pinned, checksummed public-repo snapshot and the unrelated completed tool history built from it.
 *
 * The snapshot is read as data only. Text files are extracted under the cache root with read-only
 * permissions; nothing in the snapshot is executable, imported or evaluated.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, normalize, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { estimateMessageTokens } from "@arnilo/prism";

export class ContextRotHistoryError extends Error {
  name = "ContextRotHistoryError";
}

/** Immutable source for the stale tool history. Commit URL and archive checksum pin the bytes. */
export const EXPRESS_PIN = Object.freeze({
  id: "expressjs-express",
  commit: "1c6f1b0fe4000977b9a7b4f34097e4d527dd9824",
  file: "express-1c6f1b0fe4000977b9a7b4f34097e4d527dd9824.tar.gz",
  bytes: 136_167,
  sha256: "aadc004d85e8b9c9959e8281a89913d336bda069dadc423a4900fb8fb125789b",
  license: "MIT",
  url: "https://github.com/expressjs/express/archive/1c6f1b0fe4000977b9a7b4f34097e4d527dd9824.tar.gz",
  licenseUrl: "https://github.com/expressjs/express/blob/1c6f1b0fe4000977b9a7b4f34097e4d527dd9824/LICENSE",
});

export function cacheRoot(env = process.env) {
  return join(env.PRISM_CACHE_DIR ?? join(homedir(), ".cache/prism"), "context-rot");
}

export function verifyPinnedBytes(bytes, pin = EXPRESS_PIN) {
  if (bytes.byteLength !== pin.bytes) throw new ContextRotHistoryError(`Snapshot size mismatch for ${pin.file}`);
  if (createHash("sha256").update(bytes).digest("hex") !== pin.sha256)
    throw new ContextRotHistoryError(`Snapshot checksum mismatch for ${pin.file}; remove the corrupt cache file explicitly`);
}

/** Read the pinned archive from cache, or download it once. A mismatch always fails closed. */
export async function loadPinnedBytes(pin = EXPRESS_PIN, { cache = cacheRoot(), fetch: transport = fetch } = {}) {
  await mkdir(cache, { recursive: true });
  const path = join(cache, pin.file);
  if (existsSync(path)) {
    const bytes = new Uint8Array(await readFile(path));
    verifyPinnedBytes(bytes, pin);
    return bytes;
  }
  const response = await transport(pin.url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new ContextRotHistoryError(`Snapshot download failed (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  verifyPinnedBytes(bytes, pin);
  const temp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temp, bytes);
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
  await writeFile(`${path}.license.json`, `${JSON.stringify({ license: pin.license, source: pin.licenseUrl, commit: pin.commit }, null, 2)}\n`);
  return bytes;
}

/** Minimal ustar reader: regular text files only, first path component stripped. */
export function readTarTextFiles(archive) {
  const tar = gunzipSync(archive);
  const files = [];
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = cString(header.subarray(0, 100));
    const sizeText = cString(header.subarray(124, 136)).trim();
    const type = String.fromCharCode(header[156] ?? 0);
    const prefix = cString(header.subarray(345, 500));
    const size = Number.parseInt(sizeText || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0) throw new ContextRotHistoryError("Malformed snapshot tar size");
    const body = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type !== "0" && type !== "\0") continue;
    const raw = prefix ? `${prefix}/${name}` : name;
    const slash = raw.indexOf("/");
    const path = slash === -1 ? "" : raw.slice(slash + 1);
    if (!path || path.startsWith("..") || path.includes("\\")) continue;
    if (size === 0 || size > 512 * 1024) continue;
    if (body.subarray(0, Math.min(8192, body.length)).includes(0)) continue;
    files.push({ path, content: body.toString("utf8") });
  }
  return files;
}

function cString(bytes) {
  const end = bytes.indexOf(0);
  return Buffer.from(end === -1 ? bytes : bytes.subarray(0, end)).toString("utf8");
}

/** Extract the pinned text snapshot once, read-only. Returns the snapshot root. */
export async function extractSnapshot(pin = EXPRESS_PIN, { cache = cacheRoot() } = {}) {
  const bytes = await loadPinnedBytes(pin, { cache });
  const root = join(cache, `${pin.id}-${pin.commit}`);
  if (existsSync(join(root, ".complete"))) return root;
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  for (const file of readTarTextFiles(bytes)) {
    if (!safeRelative(file.path)) throw new ContextRotHistoryError(`Unsafe snapshot path: ${file.path}`);
    const target = join(root, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
    await chmod(target, 0o444);
  }
  await writeFile(join(root, ".complete"), `${pin.commit}\n`, "utf8");
  return root;
}

function safeRelative(path) {
  const normalized = normalize(path);
  return normalized !== ".." && !normalized.startsWith(`..${sep}`) && !normalized.startsWith(sep);
}

export async function readSnapshotFiles(root) {
  const files = [];
  async function walk(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".complete" || entry.name === ".git") continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(join(directory, entry.name), relative);
        continue;
      }
      if (!entry.isFile()) continue;
      const content = await readFile(join(directory, entry.name), "utf8").catch(() => undefined);
      if (content === undefined || content.includes("\0") || content.length > 200_000) continue;
      files.push({ path: relative, content });
    }
  }
  await walk(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function cloneHistory(messages) {
  return messages.map((message) => ({
    ...message,
    content: message.content.map((block) => (block.type === "tool_call" ? { ...block, arguments: { ...block.arguments } } : { ...block })),
    ...(message.metadata ? { metadata: { ...message.metadata } } : {}),
  }));
}

/**
 * Build the shared history for one length. Each entry is one completed assistant tool call plus its
 * result: alternating file reads and grep output from the pinned snapshot. The same array is reused
 * for every task at that length so the provider prefix can cache.
 */
export function buildHistoryMessages(files, targetTokens) {
  if (files.length === 0) throw new ContextRotHistoryError("Snapshot has no text files");
  if (targetTokens <= 0) return [];
  const messages = [];
  let tokens = 0;
  let turn = 0;
  let index = 0;
  while (tokens < targetTokens) {
    const file = files[index % files.length];
    const id = `history-${String(turn + 1).padStart(4, "0")}`;
    const isRead = index % 3 !== 2;
    const text = isRead ? readText(file) : grepText(file);
    const args = isRead ? { path: file.path } : { pattern: "function", path: file.path };
    const call = { id, name: isRead ? "read_file" : "grep", arguments: args };
    const assistant = {
      id: `${id}-call`,
      role: "assistant",
      content: [{ type: "tool_call", ...call }],
    };
    const result = {
      id: `${id}-result`,
      role: "tool",
      content: [{ type: "tool_result", toolCallId: id, name: call.name, result: text }],
      metadata: { prismToolResultTurn: turn + 1 },
    };
    const pairTokens = estimateMessageTokens(assistant) + estimateMessageTokens(result);
    if (messages.length >= 4 && tokens + pairTokens > targetTokens * 1.04) break;
    messages.push(assistant, result);
    tokens += pairTokens;
    turn += 1;
    index += 1;
  }
  return messages;
}

function readText(file) {
  const cap = 24_000;
  const body = file.content.length > cap ? `${file.content.slice(0, cap)}\n… [truncated]` : file.content;
  return `${file.path}\n${body}`;
}

function grepText(file) {
  const lines = file.content.split("\n");
  const hits = [];
  for (let index = 0; index < lines.length && hits.length < 24; index += 1) {
    if (lines[index].includes("function") || lines[index].includes("require(")) hits.push(`${file.path}:${index + 1}:${lines[index]}`);
  }
  if (hits.length === 0) hits.push(...lines.slice(0, 12).map((line, index) => `${file.path}:${index + 1}:${line}`));
  return hits.join("\n");
}

export function lastHistoryMessageId(messages) {
  return messages.at(-1)?.id;
}
