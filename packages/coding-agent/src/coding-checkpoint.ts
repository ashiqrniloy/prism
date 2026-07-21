/**
 * Bounded durable coding-task checkpoint metadata.
 *
 * This is not a second runtime. Hosts persist plan/todo Markdown in the workspace
 * and store only references/hashes/summaries in workflow checkpoint state. Resume
 * revalidates fingerprints and artifact integrity before import/execution.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import type { JsonObject } from "@arnilo/prism";
import {
  DEFAULT_MAX_CHECK_SUMMARY_BYTES,
  DEFAULT_MAX_CODING_ARTIFACT_BYTES,
  DEFAULT_MAX_CODING_ARTIFACTS,
  DEFAULT_MAX_CODING_CHECKPOINT_BYTES,
  DEFAULT_MAX_PLAN_BYTES,
  DEFAULT_MAX_TODO_TEXT_BYTES,
  DEFAULT_MAX_TODOS,
  HARD_MAX_CHECK_SUMMARY_BYTES,
  HARD_MAX_CODING_ARTIFACT_BYTES,
  HARD_MAX_CODING_ARTIFACTS,
  HARD_MAX_CODING_CHECKPOINT_BYTES,
  HARD_MAX_PLAN_BYTES,
  HARD_MAX_TODO_TEXT_BYTES,
  HARD_MAX_TODOS,
  validateCodingLimit,
} from "./limits.js";
import { sha256Hex } from "./artifacts.js";

export const CODING_CHECKPOINT_SCHEMA_VERSION = 1 as const;
/** Workflow shared-state key that holds coding checkpoint metadata. */
export const CODING_STATE_KEY = "coding";

const SHA256_HEX = /^[a-f0-9]{64}$/;
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const BRANCH = /^[^\s]{1,255}$/;
const TODO_LINE = /^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/;
const FORBIDDEN_METADATA_KEYS = new Set([
  "credentials",
  "credential",
  "secret",
  "secrets",
  "token",
  "tokens",
  "password",
  "cookie",
  "cookies",
  "storageState",
  "storage_state",
  "authorization",
  "env",
  "processEnv",
  "commandOutput",
  "rawOutput",
  "stdout",
  "stderr",
]);

export type CodingArtifactKind = "plan" | "workspace" | "patch" | "bundle" | "diff" | "other";

export type CodingTaskStatus =
  | "planned"
  | "editing"
  | "checking"
  | "awaiting_approval"
  | "ready_for_handoff"
  | "completed"
  | "failed"
  | "cancelled";

export interface CodingArtifactRef {
  readonly kind: CodingArtifactKind;
  readonly uri: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface CodingTodoItem {
  readonly id: string;
  readonly text: string;
  readonly done: boolean;
}

export interface CodingCheckSummary {
  readonly name: string;
  readonly exitCode: number;
  readonly summary: string;
}

export interface CodingFingerprints {
  /** Workflow definition revision string. */
  readonly workflowRevision: string;
  /** Optional definition hash captured after `defineWorkflow`. */
  readonly definitionHash?: string;
  /** Host-pinned sandbox/image digest when a disposable sandbox is used. */
  readonly imageDigest?: string;
  /** Host-computed hash of the selected tool surface. */
  readonly toolFingerprint: string;
  /** Host-computed hash of the selected execution/approval policy. */
  readonly policyFingerprint: string;
}

export interface CodingHandoffSummary {
  readonly base: string;
  readonly head: string;
  readonly changedPathCount: number;
  readonly checkCount: number;
  readonly artifact?: CodingArtifactRef;
}

export interface CodingCheckpointMetadata {
  readonly schemaVersion: typeof CODING_CHECKPOINT_SCHEMA_VERSION;
  readonly taskId: string;
  readonly workspaceRoot: string;
  readonly baseBranch: string;
  readonly branch: string;
  readonly worktreePath?: string;
  /** Workspace-relative plan path (for example `plans/task-1.md`). */
  readonly planPath: string;
  readonly plan: CodingArtifactRef;
  readonly workspaceExport?: CodingArtifactRef;
  readonly artifacts: readonly CodingArtifactRef[];
  readonly checks: readonly CodingCheckSummary[];
  readonly handoff?: CodingHandoffSummary;
  readonly status: CodingTaskStatus;
  readonly fingerprints: CodingFingerprints;
  readonly todos: readonly CodingTodoItem[];
  readonly updatedAt: string;
}

export interface CodingCheckpointLimitOptions {
  readonly maxPlanBytes?: number;
  readonly maxTodos?: number;
  readonly maxTodoTextBytes?: number;
  readonly maxArtifacts?: number;
  readonly maxArtifactBytes?: number;
  readonly maxCheckSummaryBytes?: number;
  readonly maxCheckpointBytes?: number;
}

export interface ResolvedCodingCheckpointLimits {
  readonly maxPlanBytes: number;
  readonly maxTodos: number;
  readonly maxTodoTextBytes: number;
  readonly maxArtifacts: number;
  readonly maxArtifactBytes: number;
  readonly maxCheckSummaryBytes: number;
  readonly maxCheckpointBytes: number;
}

export class CodingCheckpointError extends Error {
  readonly code = "ERR_PRISM_CODING_CHECKPOINT";
  constructor(message: string) {
    super(message);
    this.name = "CodingCheckpointError";
  }
}

export function resolveCodingCheckpointLimits(
  options?: CodingCheckpointLimitOptions,
): ResolvedCodingCheckpointLimits {
  return {
    maxPlanBytes: validateCodingLimit(
      "maxPlanBytes",
      options?.maxPlanBytes ?? DEFAULT_MAX_PLAN_BYTES,
      HARD_MAX_PLAN_BYTES,
    ),
    maxTodos: validateCodingLimit("maxTodos", options?.maxTodos ?? DEFAULT_MAX_TODOS, HARD_MAX_TODOS),
    maxTodoTextBytes: validateCodingLimit(
      "maxTodoTextBytes",
      options?.maxTodoTextBytes ?? DEFAULT_MAX_TODO_TEXT_BYTES,
      HARD_MAX_TODO_TEXT_BYTES,
    ),
    maxArtifacts: validateCodingLimit(
      "maxArtifacts",
      options?.maxArtifacts ?? DEFAULT_MAX_CODING_ARTIFACTS,
      HARD_MAX_CODING_ARTIFACTS,
    ),
    maxArtifactBytes: validateCodingLimit(
      "maxArtifactBytes",
      options?.maxArtifactBytes ?? DEFAULT_MAX_CODING_ARTIFACT_BYTES,
      HARD_MAX_CODING_ARTIFACT_BYTES,
    ),
    maxCheckSummaryBytes: validateCodingLimit(
      "maxCheckSummaryBytes",
      options?.maxCheckSummaryBytes ?? DEFAULT_MAX_CHECK_SUMMARY_BYTES,
      HARD_MAX_CHECK_SUMMARY_BYTES,
    ),
    maxCheckpointBytes: validateCodingLimit(
      "maxCheckpointBytes",
      options?.maxCheckpointBytes ?? DEFAULT_MAX_CODING_CHECKPOINT_BYTES,
      HARD_MAX_CODING_CHECKPOINT_BYTES,
    ),
  };
}

/** Deterministic SHA-256 fingerprint over a JSON-stable encoding. */
export function fingerprintJson(value: unknown): string {
  return sha256Hex(Buffer.from(stableStringify(value), "utf8"));
}

export function createCodingArtifactRef(input: {
  readonly kind: CodingArtifactKind;
  readonly uri: string;
  readonly bytes: Buffer;
  readonly maxBytes?: number;
}): CodingArtifactRef {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_CODING_ARTIFACT_BYTES;
  if (input.bytes.length > maxBytes) {
    throw new CodingCheckpointError(`Artifact exceeds ${maxBytes} byte limit`);
  }
  if (!isNonEmptyString(input.uri) || input.uri.length > 2_048) {
    throw new CodingCheckpointError("Artifact URI must be a non-empty string at most 2048 characters");
  }
  return {
    kind: input.kind,
    uri: input.uri,
    sha256: sha256Hex(input.bytes),
    bytes: input.bytes.length,
  };
}

export function verifyCodingArtifactBytes(
  ref: CodingArtifactRef,
  bytes: Buffer,
  limits?: CodingCheckpointLimitOptions,
): void {
  const resolved = resolveCodingCheckpointLimits(limits);
  if (ref.bytes > resolved.maxArtifactBytes || bytes.length > resolved.maxArtifactBytes) {
    throw new CodingCheckpointError(`Artifact exceeds ${resolved.maxArtifactBytes} byte limit`);
  }
  if (bytes.length !== ref.bytes) {
    throw new CodingCheckpointError(
      `Artifact byte count mismatch: expected ${ref.bytes}, got ${bytes.length}`,
    );
  }
  const digest = sha256Hex(bytes);
  if (digest !== ref.sha256) {
    throw new CodingCheckpointError("Artifact SHA-256 mismatch");
  }
}

export function createCodingPlanMarkdown(input: {
  readonly title: string;
  readonly taskId: string;
  readonly status?: CodingTaskStatus;
  readonly todos: readonly { readonly id?: string; readonly text: string; readonly done?: boolean }[];
  readonly notes?: string;
  readonly limits?: CodingCheckpointLimitOptions;
}): string {
  const limits = resolveCodingCheckpointLimits(input.limits);
  if (input.todos.length > limits.maxTodos) {
    throw new CodingCheckpointError(`Plan exceeds ${limits.maxTodos} todo limit`);
  }
  const lines = [
    `# ${input.title.trim() || "Coding task"}`,
    "",
    `- Task ID: \`${input.taskId}\``,
    `- Status: \`${input.status ?? "planned"}\``,
    "",
    "## Todos",
    "",
  ];
  for (const todo of input.todos) {
    const text = todo.text.trim();
    assertTodoText(text, limits.maxTodoTextBytes);
    const mark = todo.done ? "x" : " ";
    const idPrefix = todo.id ? `[${todo.id}] ` : "";
    lines.push(`- [${mark}] ${idPrefix}${text}`);
  }
  if (input.notes?.trim()) {
    lines.push("", "## Notes", "", input.notes.trim(), "");
  } else {
    lines.push("");
  }
  const markdown = lines.join("\n");
  assertByteLimit("plan", markdown, limits.maxPlanBytes);
  return markdown;
}

export function parseCodingPlanTodos(
  markdown: string,
  limits?: CodingCheckpointLimitOptions,
): CodingTodoItem[] {
  const resolved = resolveCodingCheckpointLimits(limits);
  assertByteLimit("plan", markdown, resolved.maxPlanBytes);
  const todos: CodingTodoItem[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = TODO_LINE.exec(line);
    if (!match) continue;
    const done = match[1]!.toLowerCase() === "x";
    const raw = match[2]!.trim();
    assertTodoText(raw, resolved.maxTodoTextBytes);
    const idMatch = /^\[([A-Za-z0-9._-]{1,64})\]\s+(.+)$/.exec(raw);
    const id = idMatch?.[1] ?? `todo-${todos.length + 1}`;
    const text = idMatch?.[2] ?? raw;
    assertTodoText(text, resolved.maxTodoTextBytes);
    todos.push({ id, text, done });
    if (todos.length > resolved.maxTodos) {
      throw new CodingCheckpointError(`Plan exceeds ${resolved.maxTodos} todo limit`);
    }
  }
  return todos;
}

export async function writeCodingPlanFile(input: {
  readonly workspaceRoot: string;
  readonly planPath: string;
  readonly markdown: string;
  readonly limits?: CodingCheckpointLimitOptions;
}): Promise<CodingArtifactRef> {
  const limits = resolveCodingCheckpointLimits(input.limits);
  assertByteLimit("plan", input.markdown, limits.maxPlanBytes);
  const absolute = resolveUnderWorkspace(input.workspaceRoot, input.planPath);
  await mkdir(dirname(absolute), { recursive: true });
  const bytes = Buffer.from(input.markdown, "utf8");
  await writeFile(absolute, bytes, { mode: 0o600 });
  return createCodingArtifactRef({
    kind: "plan",
    uri: `file://${absolute}`,
    bytes,
    maxBytes: limits.maxPlanBytes,
  });
}

export async function readCodingPlanFile(input: {
  readonly workspaceRoot: string;
  readonly planPath: string;
  readonly expected?: CodingArtifactRef;
  readonly limits?: CodingCheckpointLimitOptions;
}): Promise<{ markdown: string; artifact: CodingArtifactRef; todos: CodingTodoItem[] }> {
  const limits = resolveCodingCheckpointLimits(input.limits);
  const absolute = resolveUnderWorkspace(input.workspaceRoot, input.planPath);
  const bytes = await readFile(absolute);
  if (bytes.length > limits.maxPlanBytes) {
    throw new CodingCheckpointError(`Plan exceeds ${limits.maxPlanBytes} byte limit`);
  }
  const artifact = createCodingArtifactRef({
    kind: "plan",
    uri: `file://${absolute}`,
    bytes,
    maxBytes: limits.maxPlanBytes,
  });
  if (input.expected) {
    verifyCodingArtifactBytes(input.expected, bytes, limits);
  }
  const markdown = bytes.toString("utf8");
  return {
    markdown,
    artifact,
    todos: parseCodingPlanTodos(markdown, limits),
  };
}

export function buildCodingCheckpointMetadata(input: {
  readonly taskId: string;
  readonly workspaceRoot: string;
  readonly baseBranch: string;
  readonly branch: string;
  readonly planPath: string;
  readonly plan: CodingArtifactRef;
  readonly fingerprints: CodingFingerprints;
  readonly status?: CodingTaskStatus;
  readonly todos?: readonly CodingTodoItem[];
  readonly worktreePath?: string;
  readonly workspaceExport?: CodingArtifactRef;
  readonly artifacts?: readonly CodingArtifactRef[];
  readonly checks?: readonly CodingCheckSummary[];
  readonly handoff?: CodingHandoffSummary;
  readonly updatedAt?: string;
  readonly limits?: CodingCheckpointLimitOptions;
}): CodingCheckpointMetadata {
  const metadata: CodingCheckpointMetadata = {
    schemaVersion: CODING_CHECKPOINT_SCHEMA_VERSION,
    taskId: input.taskId,
    workspaceRoot: input.workspaceRoot,
    baseBranch: input.baseBranch,
    branch: input.branch,
    worktreePath: input.worktreePath,
    planPath: input.planPath,
    plan: input.plan,
    workspaceExport: input.workspaceExport,
    artifacts: input.artifacts ?? [],
    checks: input.checks ?? [],
    handoff: input.handoff,
    status: input.status ?? "planned",
    fingerprints: input.fingerprints,
    todos: input.todos ?? [],
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
  return validateCodingCheckpointMetadata(metadata, input.limits);
}

export function validateCodingCheckpointMetadata(
  value: unknown,
  limits?: CodingCheckpointLimitOptions,
): CodingCheckpointMetadata {
  const resolved = resolveCodingCheckpointLimits(limits);
  if (!isPlainObject(value)) {
    throw new CodingCheckpointError("Coding checkpoint metadata must be an object");
  }
  assertNoForbiddenKeys(value);

  if (value.schemaVersion !== CODING_CHECKPOINT_SCHEMA_VERSION) {
    throw new CodingCheckpointError(`Unsupported coding checkpoint schemaVersion: ${String(value.schemaVersion)}`);
  }
  const taskId = requireString(value.taskId, "taskId");
  if (!TASK_ID.test(taskId)) {
    throw new CodingCheckpointError("taskId has invalid format");
  }
  const workspaceRoot = requireAbsolutePath(value.workspaceRoot, "workspaceRoot");
  const baseBranch = requireBranch(value.baseBranch, "baseBranch");
  const branch = requireBranch(value.branch, "branch");
  const planPath = requireRelativePath(value.planPath, "planPath");
  const plan = validateArtifactRef(value.plan, resolved, { requireKind: "plan" });
  const worktreePath =
    value.worktreePath === undefined ? undefined : requireAbsolutePath(value.worktreePath, "worktreePath");
  const workspaceExport =
    value.workspaceExport === undefined
      ? undefined
      : validateArtifactRef(value.workspaceExport, resolved);
  const artifacts = requireArray(value.artifacts, "artifacts").map((item, index) =>
    validateArtifactRef(item, resolved, { label: `artifacts[${index}]` }),
  );
  if (artifacts.length > resolved.maxArtifacts) {
    throw new CodingCheckpointError(`Coding checkpoint exceeds ${resolved.maxArtifacts} artifact references`);
  }
  const checks = requireArray(value.checks, "checks").map((item, index) =>
    validateCheckSummary(item, resolved, `checks[${index}]`),
  );
  if (checks.length > HARD_MAX_CODING_ARTIFACTS) {
    throw new CodingCheckpointError("Too many check summaries");
  }
  const todos = requireArray(value.todos, "todos").map((item, index) =>
    validateTodo(item, resolved, `todos[${index}]`),
  );
  if (todos.length > resolved.maxTodos) {
    throw new CodingCheckpointError(`Coding checkpoint exceeds ${resolved.maxTodos} todos`);
  }
  const fingerprints = validateFingerprints(value.fingerprints);
  const status = requireStatus(value.status);
  const updatedAt = requireString(value.updatedAt, "updatedAt");
  if (Number.isNaN(Date.parse(updatedAt))) {
    throw new CodingCheckpointError("updatedAt must be an ISO-8601 timestamp");
  }
  const handoff =
    value.handoff === undefined ? undefined : validateHandoffSummary(value.handoff, resolved);

  const metadata: CodingCheckpointMetadata = {
    schemaVersion: CODING_CHECKPOINT_SCHEMA_VERSION,
    taskId,
    workspaceRoot,
    baseBranch,
    branch,
    worktreePath,
    planPath,
    plan,
    workspaceExport,
    artifacts,
    checks,
    handoff,
    status,
    fingerprints,
    todos,
    updatedAt,
  };

  const encoded = Buffer.byteLength(JSON.stringify(metadata), "utf8");
  if (encoded > resolved.maxCheckpointBytes) {
    throw new CodingCheckpointError(
      `Coding checkpoint metadata exceeds ${resolved.maxCheckpointBytes} byte limit`,
    );
  }
  return metadata;
}

/**
 * Fail closed before resume/import when ownership-equivalent fingerprints diverge
 * or artifact references cannot be verified.
 */
export function assertCodingResumeAllowed(input: {
  readonly metadata: CodingCheckpointMetadata;
  readonly expected: CodingFingerprints;
  readonly expectedWorkspaceRoot?: string;
  readonly expectedBaseBranch?: string;
  readonly planBytes?: Buffer;
  readonly workspaceExportBytes?: Buffer;
  readonly limits?: CodingCheckpointLimitOptions;
}): CodingCheckpointMetadata {
  const metadata = validateCodingCheckpointMetadata(input.metadata, input.limits);
  assertFingerprintsMatch(metadata.fingerprints, input.expected);
  if (
    input.expectedWorkspaceRoot !== undefined &&
    resolve(input.expectedWorkspaceRoot) !== resolve(metadata.workspaceRoot)
  ) {
    throw new CodingCheckpointError("Workspace root mismatch on coding resume");
  }
  if (input.expectedBaseBranch !== undefined && input.expectedBaseBranch !== metadata.baseBranch) {
    throw new CodingCheckpointError("Base branch mismatch on coding resume");
  }
  if (input.planBytes) {
    verifyCodingArtifactBytes(metadata.plan, input.planBytes, input.limits);
  }
  if (input.workspaceExportBytes) {
    if (!metadata.workspaceExport) {
      throw new CodingCheckpointError("Workspace export bytes provided without metadata reference");
    }
    verifyCodingArtifactBytes(metadata.workspaceExport, input.workspaceExportBytes, input.limits);
  }
  return metadata;
}

/** Extract and validate `state.coding` when present. */
export function readCodingCheckpointFromState(
  state: Readonly<Record<string, unknown>>,
  limits?: CodingCheckpointLimitOptions,
): CodingCheckpointMetadata | undefined {
  if (!(CODING_STATE_KEY in state)) return undefined;
  return validateCodingCheckpointMetadata(state[CODING_STATE_KEY], limits);
}

export function codingCheckpointStatePatch(
  metadata: CodingCheckpointMetadata,
): JsonObject {
  return { [CODING_STATE_KEY]: validateCodingCheckpointMetadata(metadata) } as unknown as JsonObject;
}

function assertFingerprintsMatch(actual: CodingFingerprints, expected: CodingFingerprints): void {
  if (actual.workflowRevision !== expected.workflowRevision) {
    throw new CodingCheckpointError("Workflow revision fingerprint mismatch on coding resume");
  }
  if (actual.toolFingerprint !== expected.toolFingerprint) {
    throw new CodingCheckpointError("Tool fingerprint mismatch on coding resume");
  }
  if (actual.policyFingerprint !== expected.policyFingerprint) {
    throw new CodingCheckpointError("Policy fingerprint mismatch on coding resume");
  }
  if (expected.definitionHash !== undefined) {
    if (actual.definitionHash !== expected.definitionHash) {
      throw new CodingCheckpointError("Definition hash mismatch on coding resume");
    }
  }
  if (expected.imageDigest !== undefined) {
    if (actual.imageDigest !== expected.imageDigest) {
      throw new CodingCheckpointError("Image digest mismatch on coding resume");
    }
  }
}

function validateFingerprints(value: unknown): CodingFingerprints {
  if (!isPlainObject(value)) {
    throw new CodingCheckpointError("fingerprints must be an object");
  }
  assertNoForbiddenKeys(value);
  const workflowRevision = requireString(value.workflowRevision, "fingerprints.workflowRevision");
  const toolFingerprint = requireFingerprint(value.toolFingerprint, "fingerprints.toolFingerprint");
  const policyFingerprint = requireFingerprint(
    value.policyFingerprint,
    "fingerprints.policyFingerprint",
  );
  const definitionHash =
    value.definitionHash === undefined
      ? undefined
      : requireFingerprint(value.definitionHash, "fingerprints.definitionHash");
  const imageDigest =
    value.imageDigest === undefined
      ? undefined
      : requireString(value.imageDigest, "fingerprints.imageDigest");
  if (imageDigest !== undefined && !/sha256:[a-f0-9]{64}/.test(imageDigest) && !SHA256_HEX.test(imageDigest)) {
    // Allow either raw hex or docker digest form.
    if (!imageDigest.includes("@sha256:") && !imageDigest.startsWith("sha256:")) {
      throw new CodingCheckpointError("fingerprints.imageDigest must be a digest string");
    }
  }
  return {
    workflowRevision,
    definitionHash,
    imageDigest,
    toolFingerprint,
    policyFingerprint,
  };
}

function validateArtifactRef(
  value: unknown,
  limits: ResolvedCodingCheckpointLimits,
  options?: { readonly requireKind?: CodingArtifactKind; readonly label?: string },
): CodingArtifactRef {
  const label = options?.label ?? "artifact";
  if (!isPlainObject(value)) {
    throw new CodingCheckpointError(`${label} must be an object`);
  }
  assertNoForbiddenKeys(value);
  const kind = requireString(value.kind, `${label}.kind`) as CodingArtifactKind;
  if (!["plan", "workspace", "patch", "bundle", "diff", "other"].includes(kind)) {
    throw new CodingCheckpointError(`${label}.kind is unsupported`);
  }
  if (options?.requireKind && kind !== options.requireKind) {
    throw new CodingCheckpointError(`${label}.kind must be ${options.requireKind}`);
  }
  const uri = requireString(value.uri, `${label}.uri`);
  if (uri.length > 2_048) {
    throw new CodingCheckpointError(`${label}.uri exceeds 2048 characters`);
  }
  const sha256 = requireString(value.sha256, `${label}.sha256`).toLowerCase();
  if (!SHA256_HEX.test(sha256)) {
    throw new CodingCheckpointError(`${label}.sha256 must be a 64-char hex digest`);
  }
  const bytes = requireSafeInt(value.bytes, `${label}.bytes`);
  if (bytes < 0 || bytes > limits.maxArtifactBytes) {
    throw new CodingCheckpointError(`${label}.bytes out of range`);
  }
  return { kind, uri, sha256, bytes };
}

function validateCheckSummary(
  value: unknown,
  limits: ResolvedCodingCheckpointLimits,
  label: string,
): CodingCheckSummary {
  if (!isPlainObject(value)) {
    throw new CodingCheckpointError(`${label} must be an object`);
  }
  assertNoForbiddenKeys(value);
  const name = requireString(value.name, `${label}.name`);
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) {
    throw new CodingCheckpointError(`${label}.name has invalid format`);
  }
  const exitCode = requireSafeInt(value.exitCode, `${label}.exitCode`);
  if (exitCode < 0 || exitCode > 255) {
    throw new CodingCheckpointError(`${label}.exitCode out of range`);
  }
  const summary = requireString(value.summary, `${label}.summary`);
  assertByteLimit(`${label}.summary`, summary, limits.maxCheckSummaryBytes);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(summary)) {
    throw new CodingCheckpointError(`${label}.summary contains control characters`);
  }
  return { name, exitCode, summary };
}

function validateTodo(
  value: unknown,
  limits: ResolvedCodingCheckpointLimits,
  label: string,
): CodingTodoItem {
  if (!isPlainObject(value)) {
    throw new CodingCheckpointError(`${label} must be an object`);
  }
  assertNoForbiddenKeys(value);
  const id = requireString(value.id, `${label}.id`);
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(id)) {
    throw new CodingCheckpointError(`${label}.id has invalid format`);
  }
  const text = requireString(value.text, `${label}.text`);
  assertTodoText(text, limits.maxTodoTextBytes);
  if (typeof value.done !== "boolean") {
    throw new CodingCheckpointError(`${label}.done must be a boolean`);
  }
  return { id, text, done: value.done };
}

function validateHandoffSummary(
  value: unknown,
  limits: ResolvedCodingCheckpointLimits,
): CodingHandoffSummary {
  if (!isPlainObject(value)) {
    throw new CodingCheckpointError("handoff must be an object");
  }
  assertNoForbiddenKeys(value);
  const base = requireString(value.base, "handoff.base");
  const head = requireString(value.head, "handoff.head");
  const changedPathCount = requireSafeInt(value.changedPathCount, "handoff.changedPathCount");
  const checkCount = requireSafeInt(value.checkCount, "handoff.checkCount");
  if (changedPathCount < 0 || checkCount < 0) {
    throw new CodingCheckpointError("handoff counts must be non-negative");
  }
  const artifact =
    value.artifact === undefined
      ? undefined
      : validateArtifactRef(value.artifact, limits, { label: "handoff.artifact" });
  return { base, head, changedPathCount, checkCount, artifact };
}

function requireStatus(value: unknown): CodingTaskStatus {
  const status = requireString(value, "status");
  const allowed: CodingTaskStatus[] = [
    "planned",
    "editing",
    "checking",
    "awaiting_approval",
    "ready_for_handoff",
    "completed",
    "failed",
    "cancelled",
  ];
  if (!allowed.includes(status as CodingTaskStatus)) {
    throw new CodingCheckpointError(`Unsupported coding task status: ${status}`);
  }
  return status as CodingTaskStatus;
}

function resolveUnderWorkspace(workspaceRoot: string, relativePath: string): string {
  const root = requireAbsolutePath(workspaceRoot, "workspaceRoot");
  const rel = requireRelativePath(relativePath, "planPath");
  const candidate = resolve(root, rel);
  const relToRoot = relative(root, candidate);
  if (relToRoot.startsWith("..") || isAbsolute(relToRoot)) {
    throw new CodingCheckpointError("Plan path escapes workspace root");
  }
  return candidate;
}

function requireAbsolutePath(value: unknown, label: string): string {
  const path = requireString(value, label);
  if (!isAbsolute(path)) {
    throw new CodingCheckpointError(`${label} must be an absolute path`);
  }
  const normalized = normalize(path);
  if (normalized.includes(`..${sep}`) || normalized.endsWith(`${sep}..`)) {
    throw new CodingCheckpointError(`${label} must not contain parent segments`);
  }
  return normalized;
}

function requireRelativePath(value: unknown, label: string): string {
  const path = requireString(value, label);
  if (isAbsolute(path) || path.split(/[\\/]/).includes("..")) {
    throw new CodingCheckpointError(`${label} must be a relative path without parent segments`);
  }
  if (!path || path === "." ) {
    throw new CodingCheckpointError(`${label} must be a non-empty relative path`);
  }
  return path.replace(/\\/g, "/");
}

function requireBranch(value: unknown, label: string): string {
  const branch = requireString(value, label);
  if (!BRANCH.test(branch) || branch.includes("..")) {
    throw new CodingCheckpointError(`${label} has invalid format`);
  }
  return branch;
}

function requireFingerprint(value: unknown, label: string): string {
  const digest = requireString(value, label).toLowerCase();
  if (!SHA256_HEX.test(digest)) {
    throw new CodingCheckpointError(`${label} must be a 64-char hex digest`);
  }
  return digest;
}

function assertTodoText(text: string, maxBytes: number): void {
  if (!text) {
    throw new CodingCheckpointError("Todo text must be non-empty");
  }
  assertByteLimit("todo text", text, maxBytes);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) {
    throw new CodingCheckpointError("Todo text contains control characters");
  }
}

function assertByteLimit(label: string, text: string, maxBytes: number): void {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > maxBytes) {
    throw new CodingCheckpointError(`${label} exceeds ${maxBytes} byte limit`);
  }
}

function assertNoForbiddenKeys(value: Record<string, unknown>, path = ""): void {
  for (const [key, child] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_METADATA_KEYS.has(key) || FORBIDDEN_METADATA_KEYS.has(lower)) {
      throw new CodingCheckpointError(`Forbidden coding checkpoint field: ${path}${key}`);
    }
    if (isPlainObject(child)) {
      assertNoForbiddenKeys(child, `${path}${key}.`);
    }
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CodingCheckpointError(`${label} must be a non-empty string`);
  }
  return value;
}

function requireSafeInt(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new CodingCheckpointError(`${label} must be a safe integer`);
  }
  return value as number;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new CodingCheckpointError(`${label} must be an array`);
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortValue(value[key]);
    }
    return out;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new CodingCheckpointError("Fingerprint input must not contain non-finite numbers");
  }
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    throw new CodingCheckpointError("Fingerprint input contains unsupported values");
  }
  return value;
}

/** Exported for tests that need a quick digest helper without importing crypto. */
export function codingSha256Hex(data: Buffer | string): string {
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return createHash("sha256").update(bytes).digest("hex");
}

// Keep path join available for hosts constructing plan paths.
export function codingPlanPathForTask(taskId: string): string {
  if (!TASK_ID.test(taskId)) {
    throw new CodingCheckpointError("taskId has invalid format");
  }
  const safe = taskId.replace(/[^A-Za-z0-9._-]+/g, "_");
  return join("plans", `${safe}.md`).replace(/\\/g, "/");
}
