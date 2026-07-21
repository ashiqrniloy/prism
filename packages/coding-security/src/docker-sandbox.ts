import { randomUUID } from "node:crypto";
import { access, realpath } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { isAbsolute } from "node:path";
import { PassThrough } from "node:stream";
import {
  assertAbsoluteExecutable,
  createSecretRedactor,
  dockerOutputText,
  runDockerCli,
  type DockerRunner,
  DockerCliError,
} from "./docker-cli.js";
import {
  resolveDockerSandboxLimits,
  type DockerSandboxLimitOptions,
  type ResolvedDockerSandboxLimits,
} from "./sandbox-limits.js";
import { createImportTarStream, summarizeTarStream, SandboxTarError } from "./sandbox-tar.js";
import type {
  DisposableSandbox,
  SandboxCloseOptions,
  SandboxExecFileRequest,
  SandboxExecRequest,
  SandboxExportMetadata,
  SandboxStatus,
  SandboxStatusState,
} from "./sandbox.js";

const IMAGE_DIGEST_RE = /@sha256:[a-f0-9]{64}$/i;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const USER_RE = /^[0-9]{1,10}:[0-9]{1,10}$/;
const SOURCE_MOUNT = "/source";
const WORKSPACE_MOUNT = "/workspace";
const TMP_MOUNT = "/tmp";
const DOWNLOAD_MOUNT = "/downloads";
const KEEP_ALIVE = ["sleep", "infinity"] as const;

export type DockerNetworkConfig =
  | { readonly mode: "none" }
  | {
      readonly mode: "custom";
      /** Pre-created Docker network name. Adapter does not claim DNS/egress containment. */
      readonly name: string;
      /**
       * Optional host attestation that this network forces browser egress through a
       * controlled proxy/firewall. Required before treating custom networks as browse-ready.
       * Playwright routing remains defense in depth only.
       */
      readonly browserEgress?: {
        readonly proxyEndpoint: string;
        readonly denyDirectEgress: true;
      };
    };

/** Fail closed unless the sandbox network is none or carries browser egress attestation. */
export function assertBrowserSandboxNetwork(network: DockerNetworkConfig | undefined): void {
  const resolved = network ?? { mode: "none" as const };
  if (resolved.mode === "none") return;
  const attestation = resolved.browserEgress;
  if (!attestation || attestation.denyDirectEgress !== true || !attestation.proxyEndpoint) {
    throw new DockerSandboxError(
      "custom sandbox network requires browserEgress attestation (proxyEndpoint + denyDirectEgress) before browser use",
    );
  }
  try {
    const proxy = new URL(attestation.proxyEndpoint);
    if (proxy.protocol !== "http:" && proxy.protocol !== "https:" && proxy.protocol !== "socks5:") {
      throw new DockerSandboxError("browserEgress.proxyEndpoint must be http(s) or socks5");
    }
  } catch (error) {
    if (error instanceof DockerSandboxError) throw error;
    throw new DockerSandboxError("browserEgress.proxyEndpoint is not a valid URL");
  }
}

export interface CreateDockerSandboxOptions {
  /** Absolute path to the host Docker executable. */
  readonly docker: string;
  /** Digest-pinned image reference (`name@sha256:...`). */
  readonly image: string;
  /** Absolute host directory imported into the writable workspace. */
  readonly sourceRoot: string;
  /** Non-root `uid:gid` inside the container. */
  readonly user: string;
  readonly network?: DockerNetworkConfig;
  readonly limits?: DockerSandboxLimitOptions;
  /** Exact environment allow-list. Host environment is never inherited. */
  readonly env?: Readonly<Record<string, string>>;
  /** Secret canaries redacted from CLI errors. */
  readonly secrets?: readonly string[];
  readonly workdir?: string;
  readonly labels?: Readonly<Record<string, string>>;
  /** Test seam: replace Docker CLI execution. */
  readonly runner?: DockerRunner;
  /** Skip source import (tests only). */
  readonly skipImport?: boolean;
}

export class DockerSandboxError extends Error {
  readonly code = "ERR_PRISM_DOCKER_SANDBOX";
  constructor(message: string) {
    super(message);
    this.name = "DockerSandboxError";
  }
}

function formatTmpfs(path: string, sizeBytes: number, mode = "1777"): string {
  return `${path}:rw,nosuid,size=${sizeBytes},mode=${mode}`;
}

function validateImage(image: string): string {
  if (!image || typeof image !== "string") {
    throw new DockerSandboxError("image is required");
  }
  if (!IMAGE_DIGEST_RE.test(image)) {
    throw new DockerSandboxError("image must be digest-pinned as name@sha256:<64-hex>");
  }
  return image;
}

function validateUser(user: string): string {
  if (!USER_RE.test(user)) {
    throw new DockerSandboxError("user must be numeric uid:gid");
  }
  const [uid, gid] = user.split(":").map((part) => Number(part));
  if (uid === 0 || gid === 0) {
    throw new DockerSandboxError("user must be non-root (uid and gid != 0)");
  }
  return user;
}

function validateEnv(
  env: Readonly<Record<string, string>> | undefined,
  limits: ResolvedDockerSandboxLimits,
): Record<string, string> {
  const entries = Object.entries(env ?? {});
  if (entries.length > limits.maxEnvNames) {
    throw new DockerSandboxError(`env exceeds maxEnvNames (${limits.maxEnvNames})`);
  }
  let bytes = 0;
  const out: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!ENV_NAME_RE.test(name)) {
      throw new DockerSandboxError(`invalid env name: ${name}`);
    }
    if (typeof value !== "string") {
      throw new DockerSandboxError(`env value for ${name} must be a string`);
    }
    bytes += Buffer.byteLength(name, "utf8") + Buffer.byteLength(value, "utf8");
    if (bytes > limits.maxEnvBytes) {
      throw new DockerSandboxError(`env exceeds maxEnvBytes (${limits.maxEnvBytes})`);
    }
    out[name] = value;
  }
  return out;
}

function validateNetwork(network: DockerNetworkConfig | undefined): DockerNetworkConfig {
  if (!network || network.mode === "none") return { mode: "none" };
  if (network.mode !== "custom" || !network.name || /[\s\\]/.test(network.name)) {
    throw new DockerSandboxError("custom network requires a non-empty name without whitespace");
  }
  return network;
}

async function validateSourceRoot(sourceRoot: string): Promise<string> {
  if (!isAbsolute(sourceRoot)) {
    throw new DockerSandboxError("sourceRoot must be an absolute path");
  }
  try {
    await access(sourceRoot, fsConstants.R_OK);
  } catch {
    throw new DockerSandboxError(`sourceRoot is missing or unreadable: ${sourceRoot}`);
  }
  return await realpath(sourceRoot);
}

function buildCreateArgs(input: {
  image: string;
  sourceRoot: string;
  user: string;
  network: DockerNetworkConfig;
  limits: ResolvedDockerSandboxLimits;
  env: Record<string, string>;
  workdir: string;
  labels: Record<string, string>;
}): string[] {
  const args = [
    "create",
    "--pull=never",
    "--read-only",
    "--init",
    "--restart=no",
    `--user=${input.user}`,
    `--workdir=${input.workdir}`,
    `--pids-limit=${input.limits.maxPids}`,
    `--memory=${input.limits.memoryBytes}`,
    `--memory-swap=${input.limits.memoryBytes}`,
    `--cpus=${input.limits.cpus}`,
    "--ulimit",
    `nofile=${input.limits.maxFds}:${input.limits.maxFds}`,
    "--cap-drop=ALL",
    "--security-opt",
    "no-new-privileges=true",
    "--ipc=private",
    `--stop-timeout=${Math.max(1, Math.ceil(input.limits.stopGraceMs / 1000))}`,
    `--mount=type=bind,src=${input.sourceRoot},dst=${SOURCE_MOUNT},readonly`,
    "--tmpfs",
    formatTmpfs(WORKSPACE_MOUNT, input.limits.workspaceBytes, "1777"),
    "--tmpfs",
    formatTmpfs(TMP_MOUNT, input.limits.tmpBytes, "1777"),
    "--tmpfs",
    formatTmpfs(DOWNLOAD_MOUNT, input.limits.downloadBytes, "1777"),
  ];

  if (input.network.mode === "none") args.push("--network=none");
  else args.push(`--network=${input.network.name}`);

  for (const [key, value] of Object.entries(input.labels)) {
    args.push("--label", `${key}=${value}`);
  }
  for (const [key, value] of Object.entries(input.env)) {
    args.push("--env", `${key}=${value}`);
  }
  args.push(input.image, ...KEEP_ALIVE);
  return args;
}

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new DockerSandboxError("sandbox operation aborted");
    if (this.active < this.max) {
      this.active += 1;
      return () => this.release();
    }
    await new Promise<void>((resolve, reject) => {
      const waiter = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        const idx = this.waiters.indexOf(waiter);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new DockerSandboxError("sandbox operation aborted"));
      };
      this.waiters.push(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    this.active += 1;
    return () => this.release();
  }
  private release(): void {
    this.active = Math.max(0, this.active - 1);
    this.waiters.shift()?.();
  }
}

async function preflightDocker(
  docker: string,
  runner: DockerRunner,
  redact: (text: string) => string,
  timeoutMs: number,
): Promise<void> {
  await dockerOutputText(runner, {
    docker,
    args: ["version", "--format", "{{.Server.Version}}"],
    timeoutMs,
    redact,
  });
}

async function importSource(input: {
  docker: string;
  containerId: string;
  user: string;
  sourceRoot: string;
  limits: ResolvedDockerSandboxLimits;
  runner: DockerRunner;
  redact: (text: string) => string;
}): Promise<void> {
  const tarStream = createImportTarStream(input.sourceRoot, {
    maxEntries: input.limits.maxExportEntries,
    maxBytes: Math.min(input.limits.workspaceBytes, input.limits.maxExportBytes),
  });
  const result = await input.runner({
    docker: input.docker,
    args: ["exec", "-i", "-u", input.user, "-w", WORKSPACE_MOUNT, input.containerId, "tar", "-xf", "-"],
    stdin: tarStream,
    timeoutMs: input.limits.startupTimeoutMs,
    maxOutputBytes: 1 * 1024 * 1024,
    redact: input.redact,
  });
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString("utf8").trim() || `exit ${result.exitCode}`;
    throw new DockerSandboxError(input.redact(`workspace import failed: ${detail}`));
  }
}

class DockerSandboxSession implements DisposableSandbox {
  readonly id: string;
  private state: SandboxStatusState = "running";
  private commandCount = 0;
  private retainedArtifacts = 0;
  private readonly startedAt = Date.now();
  private lastActivityAt = Date.now();
  private closing: Promise<SandboxExportMetadata | undefined> | undefined;
  private readonly execLock: Semaphore;
  private readonly redact: (text: string) => string;

  constructor(
    private readonly opts: {
      readonly containerId: string;
      readonly docker: string;
      readonly image: string;
      readonly user: string;
      readonly workdir: string;
      readonly limits: ResolvedDockerSandboxLimits;
      readonly runner: DockerRunner;
      readonly secrets: readonly string[];
    },
  ) {
    this.id = opts.containerId;
    this.execLock = new Semaphore(opts.limits.maxConcurrentExecs);
    this.redact = createSecretRedactor(opts.secrets);
  }

  private touch(): void {
    this.lastActivityAt = Date.now();
  }

  private remainingWallMs(): number {
    return Math.max(1, this.opts.limits.wallTimeMs - (Date.now() - this.startedAt));
  }

  private assertActive(): void {
    if (this.state !== "running") throw new DockerSandboxError(`sandbox is ${this.state}`);
    const now = Date.now();
    if (now - this.startedAt > this.opts.limits.wallTimeMs) {
      this.state = "failed";
      throw new DockerSandboxError("sandbox wall time exceeded");
    }
    if (now - this.lastActivityAt > this.opts.limits.idleTimeoutMs) {
      this.state = "failed";
      throw new DockerSandboxError("sandbox idle timeout exceeded");
    }
  }

  async status(): Promise<SandboxStatus> {
    return {
      id: this.opts.containerId,
      state: this.state,
      image: this.opts.image,
      startedAt: this.startedAt,
      commandCount: this.commandCount,
      lastActivityAt: this.lastActivityAt,
    };
  }

  async exec(request: SandboxExecRequest): Promise<{ exitCode: number | null }> {
    return this.execFile({
      file: "/bin/sh",
      args: ["-c", request.command],
      cwd: request.cwd,
      env: request.env as Record<string, string> | undefined,
      onData: request.onData,
      signal: request.signal,
      timeout: request.timeout,
    });
  }

  async execFile(request: SandboxExecFileRequest): Promise<{ exitCode: number | null }> {
    this.assertActive();
    if (!request.file || request.file.includes("\0")) {
      throw new DockerSandboxError("execFile requires a non-empty file path");
    }
    if (!Array.isArray(request.args) || request.args.some((a) => typeof a !== "string" || a.includes("\0"))) {
      throw new DockerSandboxError("execFile args must be a string array without NUL");
    }
    if (this.commandCount >= this.opts.limits.maxCommands) {
      throw new DockerSandboxError(`sandbox exceeded maxCommands (${this.opts.limits.maxCommands})`);
    }
    const release = await this.execLock.acquire(request.signal);
    this.commandCount += 1;
    this.touch();
    try {
      this.assertActive();
      const cwd = request.cwd ?? this.opts.workdir;
      if (!cwd.startsWith("/") || cwd.includes("\0")) {
        throw new DockerSandboxError("cwd must be an absolute container path");
      }
      const args = ["exec", "-u", this.opts.user, "-w", cwd];
      const extraEnv = validateEnv(request.env, this.opts.limits);
      for (const [key, value] of Object.entries(extraEnv)) {
        args.push("-e", `${key}=${value}`);
      }
      args.push(this.opts.containerId, request.file, ...request.args);
      const timeoutMs =
        request.timeout !== undefined
          ? Math.min(request.timeout, this.remainingWallMs())
          : this.remainingWallMs();
      let outputBytes = 0;
      const result = await this.opts.runner({
        docker: this.opts.docker,
        args,
        signal: request.signal,
        timeoutMs,
        maxOutputBytes: this.opts.limits.maxOutputBytes,
        collectStdout: false,
        collectStderr: false,
        redact: this.redact,
        onData: (chunk) => {
          outputBytes += chunk.byteLength;
          if (outputBytes > this.opts.limits.maxOutputBytes) {
            throw new DockerSandboxError(
              `command output exceeded maxOutputBytes (${this.opts.limits.maxOutputBytes})`,
            );
          }
          request.onData?.(chunk);
        },
      });
      this.touch();
      return { exitCode: result.exitCode };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DockerSandboxError(this.redact(message));
    } finally {
      release();
    }
  }

  async stop(options?: { graceMs?: number; signal?: AbortSignal }): Promise<void> {
    if (this.state === "removed" || this.state === "stopped") return;
    const graceMs = Math.min(options?.graceMs ?? this.opts.limits.stopGraceMs, this.opts.limits.stopGraceMs);
    const seconds = Math.max(1, Math.ceil(graceMs / 1000));
    const result = await this.opts.runner({
      docker: this.opts.docker,
      args: ["stop", "--time", String(seconds), this.opts.containerId],
      signal: options?.signal,
      timeoutMs: this.opts.limits.cleanupDeadlineMs,
      redact: this.redact,
    });
    if (result.exitCode !== 0) {
      const detail = result.stderr.toString("utf8").trim();
      if (!/no such container/i.test(detail)) {
        throw new DockerSandboxError(this.redact(detail || "docker stop failed"));
      }
    }
    this.state = "stopped";
  }

  async kill(options?: { signal?: AbortSignal }): Promise<void> {
    if (this.state === "removed") return;
    const result = await this.opts.runner({
      docker: this.opts.docker,
      args: ["kill", this.opts.containerId],
      signal: options?.signal,
      timeoutMs: this.opts.limits.cleanupDeadlineMs,
      redact: this.redact,
    });
    if (result.exitCode !== 0) {
      const detail = result.stderr.toString("utf8").trim();
      if (!/no such container|is not running/i.test(detail)) {
        throw new DockerSandboxError(this.redact(detail || "docker kill failed"));
      }
    }
    this.state = "stopped";
  }

  private async remove(signal?: AbortSignal): Promise<void> {
    if (this.state === "removed") return;
    const result = await this.opts.runner({
      docker: this.opts.docker,
      args: ["rm", "-f", this.opts.containerId],
      signal,
      timeoutMs: this.opts.limits.cleanupDeadlineMs,
      redact: this.redact,
    });
    if (result.exitCode !== 0) {
      const detail = result.stderr.toString("utf8").trim();
      if (!/no such container/i.test(detail)) {
        throw new DockerSandboxError(this.redact(`cleanup failed: ${detail || "docker rm failed"}`));
      }
    }
    this.state = "removed";
  }

  private async exportTwoPass(
    write: NonNullable<SandboxCloseOptions["export"]>,
    signal?: AbortSignal,
  ): Promise<SandboxExportMetadata> {
    if (this.retainedArtifacts >= this.opts.limits.maxRetainedArtifacts) {
      throw new DockerSandboxError(
        `sandbox exceeded maxRetainedArtifacts (${this.opts.limits.maxRetainedArtifacts})`,
      );
    }

    const pass1 = new PassThrough();
    const summaryPromise = summarizeTarStream(pass1, {
      maxEntries: this.opts.limits.maxExportEntries,
      maxBytes: this.opts.limits.maxExportBytes,
    });
    const run1 = this.opts.runner({
      docker: this.opts.docker,
      args: ["exec", "-u", this.opts.user, "-w", WORKSPACE_MOUNT, this.opts.containerId, "tar", "-cf", "-", "."],
      signal,
      timeoutMs: this.remainingWallMs(),
      maxOutputBytes: this.opts.limits.maxExportBytes,
      collectStdout: false,
      collectStderr: true,
      redact: this.redact,
      onStdout: (chunk) => pass1.write(chunk),
    }).then((result) => {
      pass1.end();
      if (result.exitCode !== 0) {
        const detail = result.stderr.toString("utf8").trim() || `exit ${result.exitCode}`;
        throw new DockerSandboxError(this.redact(`export failed: ${detail}`));
      }
    });
    const summary = await summaryPromise;
    await run1;

    const metadata: SandboxExportMetadata = {
      sha256: summary.sha256,
      entryCount: summary.entryCount,
      byteCount: summary.byteCount,
      format: "tar",
    };

    const pass2 = new PassThrough();
    const hostStream = new PassThrough();
    const verifyPromise = summarizeTarStream(pass2, {
      maxEntries: this.opts.limits.maxExportEntries,
      maxBytes: this.opts.limits.maxExportBytes,
    });
    pass2.on("data", (chunk: Buffer) => hostStream.write(chunk));
    pass2.on("end", () => hostStream.end());
    pass2.on("error", (error) => hostStream.destroy(error));

    const hostWrite = write(hostStream, metadata);
    const run2 = this.opts.runner({
      docker: this.opts.docker,
      args: ["exec", "-u", this.opts.user, "-w", WORKSPACE_MOUNT, this.opts.containerId, "tar", "-cf", "-", "."],
      signal,
      timeoutMs: this.remainingWallMs(),
      maxOutputBytes: this.opts.limits.maxExportBytes,
      collectStdout: false,
      collectStderr: true,
      redact: this.redact,
      onStdout: (chunk) => pass2.write(chunk),
    }).then((result) => {
      pass2.end();
      if (result.exitCode !== 0) {
        const detail = result.stderr.toString("utf8").trim() || `exit ${result.exitCode}`;
        throw new DockerSandboxError(this.redact(`export failed: ${detail}`));
      }
    });

    try {
      const verify = await verifyPromise;
      await run2;
      await hostWrite;
      if (verify.sha256 !== metadata.sha256 || verify.byteCount !== metadata.byteCount) {
        throw new DockerSandboxError("export hash mismatch between passes");
      }
      this.retainedArtifacts += 1;
      this.touch();
      return metadata;
    } catch (error) {
      hostStream.destroy(error instanceof Error ? error : new Error(String(error)));
      const message = error instanceof Error ? error.message : String(error);
      throw new DockerSandboxError(this.redact(message));
    }
  }

  async close(options?: SandboxCloseOptions): Promise<SandboxExportMetadata | undefined> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      let metadata: SandboxExportMetadata | undefined;
      try {
        if (options?.export && this.state === "running") {
          metadata = await this.exportTwoPass(options.export, options.signal);
        }
      } catch (error) {
        try {
          await this.stop({ signal: options?.signal });
        } catch {
          await this.kill({ signal: options?.signal }).catch(() => undefined);
        }
        await this.remove(options?.signal).catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        throw new DockerSandboxError(this.redact(message));
      }

      try {
        await this.stop({ signal: options?.signal });
      } catch {
        await this.kill({ signal: options?.signal });
      }
      await this.remove(options?.signal);
      return metadata;
    })();
    return this.closing;
  }
}

export async function createDockerSandbox(
  options: CreateDockerSandboxOptions,
): Promise<DisposableSandbox> {
  const docker = await assertAbsoluteExecutable(options.docker, "docker");
  const image = validateImage(options.image);
  const user = validateUser(options.user);
  const limits = resolveDockerSandboxLimits(options.limits);
  const env = validateEnv(options.env, limits);
  const network = validateNetwork(options.network);
  const sourceRoot = await validateSourceRoot(options.sourceRoot);
  const workdir = options.workdir ?? WORKSPACE_MOUNT;
  if (!workdir.startsWith("/")) {
    throw new DockerSandboxError("workdir must be an absolute container path");
  }
  const runner = options.runner ?? runDockerCli;
  const secrets = options.secrets ?? [];
  const redact = createSecretRedactor(secrets);
  const sandboxKey = randomUUID();
  const labels: Record<string, string> = {
    "prism.sandbox": "1",
    "prism.sandbox.id": sandboxKey,
    ...(options.labels ?? {}),
  };
  for (const [key, value] of Object.entries(labels)) {
    if (!key || /[\s=]/.test(key) || value.includes("\n")) {
      throw new DockerSandboxError("invalid sandbox label");
    }
  }

  await preflightDocker(docker, runner, redact, limits.startupTimeoutMs);

  const createArgs = buildCreateArgs({
    image,
    sourceRoot,
    user,
    network,
    limits,
    env,
    workdir,
    labels,
  });

  let containerId = "";
  try {
    containerId = (
      await dockerOutputText(runner, {
        docker,
        args: createArgs,
        timeoutMs: limits.startupTimeoutMs,
        redact,
      })
    ).trim();
    if (!/^[a-f0-9]{12,64}$/i.test(containerId)) {
      throw new DockerSandboxError("docker create returned an invalid container id");
    }

    const start = await runner({
      docker,
      args: ["start", containerId],
      timeoutMs: limits.startupTimeoutMs,
      redact,
    });
    if (start.exitCode !== 0) {
      throw new DockerSandboxError(
        redact(start.stderr.toString("utf8").trim() || "docker start failed"),
      );
    }

    if (!options.skipImport) {
      await importSource({
        docker,
        containerId,
        user,
        sourceRoot,
        limits,
        runner,
        redact,
      });
    }

    return new DockerSandboxSession({
      containerId,
      docker,
      image,
      user,
      workdir,
      limits,
      runner,
      secrets,
    });
  } catch (error) {
    if (containerId) {
      await runner({
        docker,
        args: ["rm", "-f", containerId],
        timeoutMs: limits.cleanupDeadlineMs,
        redact,
      }).catch(() => undefined);
    }
    if (
      error instanceof DockerSandboxError ||
      error instanceof DockerCliError ||
      error instanceof SandboxTarError
    ) {
      throw new DockerSandboxError(redact(error.message));
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new DockerSandboxError(redact(message));
  }
}

/** @internal test helper: build create argv without starting Docker. */
export function buildDockerCreateArgsForTest(
  options: Omit<CreateDockerSandboxOptions, "docker" | "runner" | "skipImport">,
): string[] {
  const limits = resolveDockerSandboxLimits(options.limits);
  const env = validateEnv(options.env, limits);
  const network = validateNetwork(options.network);
  const user = validateUser(options.user);
  const image = validateImage(options.image);
  return buildCreateArgs({
    image,
    sourceRoot: options.sourceRoot,
    user,
    network,
    limits,
    env,
    workdir: options.workdir ?? WORKSPACE_MOUNT,
    labels: {
      "prism.sandbox": "1",
      "prism.sandbox.id": "test",
      ...(options.labels ?? {}),
    },
  });
}
