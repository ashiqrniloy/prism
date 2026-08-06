import type { ExecutionPolicy, ToolEffectKey, ToolEffectStore, ToolEffectTransition } from "@arnilo/prism";
import { assertExecutionAllowed } from "@arnilo/prism";
import { sha256Hex } from "../artifacts.js";
import type { BoundGitRunner } from "../git-exec.js";
import { createBoundGitRunner } from "../git-exec.js";
import { HARD_MAX_GIT_REF_BYTES } from "../limits.js";
import type {
  CreateGitHubForgeOptions,
  ForgeCheck,
  ForgeErrorCode,
  ForgeOperations,
  ForgePullRequest,
  ResolvedForgeLimits,
} from "./types.js";
import { ForgeError, resolveForgeLimits } from "./types.js";

const API_BASE = "https://api.github.com";
const MUTATION_TTL_MS = 5 * 60_000;
const MAX_PAGE_SIZE = 100;

function canonical(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical((value as Record<string, unknown>)[key]);
    return out;
  }
  return null;
}

function hashJson(value: unknown): string {
  return sha256Hex(Buffer.from(JSON.stringify(canonical(value))));
}

function validateRef(ref: string, label: string): string {
  if (typeof ref !== "string" || ref.length === 0) throw new ForgeError("ERR_PRISM_FORGE_LIMIT", `${label} is required`);
  if (ref.includes("\0") || ref.includes("\n") || ref.includes("\r") || ref.startsWith("-")) {
    throw new ForgeError("ERR_PRISM_FORGE_LIMIT", `${label} must not start with '-' or contain NUL/newlines`);
  }
  if (Buffer.byteLength(ref, "utf8") > HARD_MAX_GIT_REF_BYTES) {
    throw new ForgeError("ERR_PRISM_FORGE_LIMIT", `${label} exceeds ${HARD_MAX_GIT_REF_BYTES} byte limit`);
  }
  return ref;
}

function validateNumber(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new ForgeError("ERR_PRISM_FORGE_LIMIT", `${label} must be a positive integer`);
  return value;
}

function truncate(text: string, maxBytes: number): string {
  return Buffer.byteLength(text, "utf8") <= maxBytes ? text : Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8");
}

/** Bounded single HTTP request against the GitHub REST API with rate-limit backoff. */
async function requestJson(
  token: string,
  method: string,
  path: string,
  limits: ResolvedForgeLimits,
  options: { readonly body?: unknown; readonly signal?: AbortSignal } = {},
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ readonly status: number; readonly headers: Headers; readonly json: unknown }> {
  const deadline = Date.now() + limits.requestTimeoutMs;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new ForgeError("ERR_PRISM_FORGE_RATE_LIMIT", "GitHub API request deadline exceeded");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetchImpl(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
        redirect: "manual",
      });
      const text = await readBounded(response, limits.payloadBytes);
      const json = parseJson(text);
      const rateLimited = response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0";
      if (rateLimited || response.status === 429) {
        const waitMs = backoffMs(response.headers.get("retry-after"), attempt, remaining);
        if (waitMs >= remaining) throw new ForgeError("ERR_PRISM_FORGE_RATE_LIMIT", "GitHub rate limit not cleared before deadline");
        await sleep(waitMs, controller.signal);
        continue;
      }
      if (response.status === 401) throw new ForgeError("ERR_PRISM_FORGE_AUTH", "GitHub API authentication failed");
      if (response.status === 403) throw new ForgeError("ERR_PRISM_FORGE_AUTH", "GitHub API authorization failed");
      return { status: response.status, headers: response.headers, json };
    } catch (error) {
      if (error instanceof ForgeError) throw error;
      if (options.signal?.aborted) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ForgeError("ERR_PRISM_FORGE_API", "GitHub API request timed out");
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new ForgeError("ERR_PRISM_FORGE_API", `GitHub API request failed: ${message}`);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new ForgeError("ERR_PRISM_FORGE_LIMIT", `GitHub response exceeds ${maxBytes} byte limit`);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ForgeError("ERR_PRISM_FORGE_LIMIT", `GitHub response exceeds ${maxBytes} byte limit`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJson(text: string): unknown {
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new ForgeError("ERR_PRISM_FORGE_API", "GitHub API returned malformed JSON");
  }
}

function backoffMs(retryAfter: string | null, attempt: number, remaining: number): number {
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, remaining);
  }
  return Math.min(500 * 2 ** Math.min(attempt - 1, 5), remaining);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function errorForStatus(status: number, json: unknown, fallback: string): ForgeError | undefined {
  if (status >= 200 && status < 300) return undefined;
  const message =
    json && typeof json === "object" && "message" in json && typeof json.message === "string" ? (json.message as string) : fallback;
  if (status === 404) return new ForgeError("ERR_PRISM_FORGE_API", message);
  if (status === 422) return new ForgeError("ERR_PRISM_FORGE_STALE", message);
  if (status >= 500) return new ForgeError("ERR_PRISM_FORGE_API", message);
  return new ForgeError("ERR_PRISM_FORGE_API", message);
}

function asRecord(json: unknown, label: string): Record<string, unknown> {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new ForgeError("ERR_PRISM_FORGE_API", `${label}: unexpected GitHub response shape`);
  }
  return json as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string, fallback = ""): string {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
}

function toForgePullRequest(record: Record<string, unknown>): ForgePullRequest {
  return {
    number: Number(record.number),
    state: record.state === "closed" ? "closed" : "open",
    merged: record.merged === true,
    head: stringField(record, "head", ""),
    base: stringField(record, "base", ""),
    title: stringField(record, "title"),
    body: stringField(record, "body"),
    url: stringField(record, "html_url"),
  };
}

function toForgeCheck(record: Record<string, unknown>): ForgeCheck {
  const conclusion = record.conclusion === null || record.conclusion === undefined ? undefined : String(record.conclusion);
  return {
    name: stringField(record, "name", "check"),
    status: (["queued", "in_progress", "completed"] as const).includes(record.status as never)
      ? (record.status as ForgeCheck["status"])
      : "queued",
    ...(conclusion === undefined ? {} : { conclusion }),
    ...(typeof record.details_url === "string" ? { detailsUrl: record.details_url } : {}),
  };
}

interface MutationContext {
  readonly identity: ToolEffectKey["identity"];
  readonly ownership: ToolEffectKey["ownership"];
  readonly sessionId: string;
  readonly runId: string;
  readonly store: ToolEffectStore;
}

export function createGitHubForge(options: CreateGitHubForgeOptions): ForgeOperations {
  const repository = options.repository;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new ForgeError("ERR_PRISM_FORGE_LIMIT", "repository must be 'owner/repo'");
  }
  const limits = resolveForgeLimits(options.limits);
  const identity = options.identity;
  const ownership = options.ownership;
  if (identity && ownership && identity.tenantId !== ownership.tenantId) {
    throw new ForgeError("ERR_PRISM_FORGE_OWNERSHIP", "identity and ownership tenants must match");
  }
  const policy: ExecutionPolicy | undefined = options.policy;
  const store: ToolEffectStore = options.effectStore;
  const fetchImpl: typeof fetch = options.fetch ?? globalThis.fetch;

  let runnerPromise: Promise<BoundGitRunner> | undefined;
  function runner(): Promise<BoundGitRunner> {
    runnerPromise ??= "exec" in options.git ? Promise.resolve(options.git) : createBoundGitRunner(options.git);
    return runnerPromise;
  }

  function mutationContext(): MutationContext {
    if (!identity || !ownership || !options.sessionId || !options.runId) {
      throw new ForgeError("ERR_PRISM_FORGE_LIMIT", "identity/ownership/sessionId/runId are required for forge mutations");
    }
    if (identity.tenantId !== ownership.tenantId) {
      throw new ForgeError("ERR_PRISM_FORGE_OWNERSHIP", "identity and ownership tenants must match");
    }
    return { identity, ownership, sessionId: options.sessionId, runId: options.runId, store };
  }

  async function gate(action: {
    readonly operation: string;
    readonly command?: string;
    readonly paths?: readonly string[];
    readonly metadata?: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    if (!policy) return;
    // Denials propagate as the core ExecutionDeniedError so hosts can distinguish
    // policy refusal from forge failures; no request is attempted.
    await assertExecutionAllowed(policy, {
      kind: "forge",
      operation: action.operation,
      command: action.command,
      paths: action.paths,
      risk: "high",
      metadata: { repository, ...action.metadata },
    });
  }

  async function resolveToken(): Promise<string> {
    const credential = await options.credentials.resolver.resolve({
      name: options.credentials.name,
      provider: "github",
      metadata: { repository },
    });
    if (!credential || typeof credential.value !== "string" || credential.value.length === 0) {
      throw new ForgeError("ERR_PRISM_FORGE_AUTH", "credential resolver returned no token");
    }
    return credential.value;
  }

  async function runMutation<T>(operation: string, args: unknown, execute: (token: string) => Promise<T>): Promise<T> {
    const ctx = mutationContext();
    const toolName = `forge.${operation}`;
    const toolCallId = `forge:${operation}`;
    const argumentsHash = hashJson(args);
    const key = `prism:forge:v1:${hashJson({ tenant: ctx.ownership.tenantId, session: ctx.sessionId, run: ctx.runId, toolName, argumentsHash })}`;
    const base: ToolEffectKey = {
      identity: ctx.identity,
      ownership: ctx.ownership,
      key,
      sessionId: ctx.sessionId,
      runId: ctx.runId,
      toolCallId,
      toolName,
      argumentsHash,
    };
    const { outcome, record } = await ctx.store.begin({ ...base, claimTtlMs: MUTATION_TTL_MS });
    if (outcome === "existing") {
      if (record.status === "completed" && record.result) return record.result.value as T;
      if (record.status === "failed_terminal" || record.status === "failed_retryable") {
        throw new ForgeError("ERR_PRISM_FORGE_API", `forge mutation previously failed (${record.failure?.code ?? "unknown"})`);
      }
      throw new ForgeError("ERR_PRISM_FORGE_API", "forge mutation outcome requires reconciliation; verify via reconcileHandoff");
    }
    if (!record.claimToken) {
      throw new ForgeError("ERR_PRISM_FORGE_API", "forge mutation claim is not usable; retry or reconcile");
    }
    const transition: ToolEffectTransition = { ...base, claimToken: record.claimToken, expectedVersion: record.version };
    const dispatched = await ctx.store.markDispatched(transition);
    const current = { ...transition, expectedVersion: dispatched.version };
    try {
      const result = await execute(await resolveToken());
      await ctx.store.complete({
        ...current,
        result: { toolCallId, name: toolName, content: [{ type: "text" as const, text: JSON.stringify(result) }], value: result },
      });
      return result;
    } catch (error) {
      const code: ForgeErrorCode = error instanceof ForgeError ? error.code : "ERR_PRISM_FORGE_API";
      try {
        await ctx.store.fail({ ...current, status: "failed_terminal", failure: { code } });
      } catch {
        // The mutation may or may not have landed; recovery goes through reconcileHandoff.
      }
      throw error;
    }
  }

  async function get(path: string, signal?: AbortSignal): Promise<{ status: number; json: unknown }> {
    const token = await resolveToken();
    const response = await requestJson(token, "GET", path, limits, { signal }, fetchImpl);
    return { status: response.status, json: response.json };
  }

  /** Fetch every page of a GET list up to the page cap; returns items from each page. */
  async function getPages(
    path: string,
    signal: AbortSignal | undefined,
    collect: (json: unknown) => readonly unknown[],
  ): Promise<unknown[]> {
    const items: unknown[] = [];
    for (let page = 1; page <= limits.pagesPerOperation; page += 1) {
      const { status, json } = await get(`${path}${path.includes("?") ? "&" : "?"}per_page=${MAX_PAGE_SIZE}&page=${page}`, signal);
      const error = errorForStatus(status, json, "GitHub list request failed");
      if (error) throw error;
      const pageItems = collect(json);
      if (pageItems.length === 0) break;
      items.push(...pageItems);
    }
    return items;
  }

  return {
    async issueContext(input) {
      const number = validateNumber(input.number, "issue number");
      const { status, json } = await get(`/repos/${repository}/issues/${number}`);
      const error = errorForStatus(status, json, "issue fetch failed");
      if (error) throw error;
      const record = asRecord(json, "issue");
      const labels = Array.isArray(record.labels)
        ? record.labels.map((label) => stringField(asRecord(label, "label"), "name")).filter(Boolean)
        : [];
      return {
        number,
        title: stringField(record, "title"),
        state: record.state === "closed" ? "closed" : "open",
        body: stringField(record, "body"),
        labels,
        author:
          typeof record.user === "object" && record.user !== null
            ? stringField(record.user as Record<string, unknown>, "login", "unknown")
            : "unknown",
        updatedAt: stringField(record, "updated_at"),
        url: stringField(record, "html_url"),
      };
    },

    async push(input) {
      await gate({ operation: "push", command: `git push origin ${input.refspec ?? "HEAD"}` });
      return runMutation("push", { refspec: input.refspec ?? null }, async (token) => {
        const bound = await runner();
        let ref = input.refspec;
        if (!ref) {
          const head = await bound.exec({ args: ["rev-parse", "--abbrev-ref", "HEAD"], cwd: options.cwd, maxOutputBytes: 4096 });
          if (head.exitCode !== 0) throw new ForgeError("ERR_PRISM_FORGE_API", "git rev-parse failed: no checked-out branch to push");
          ref = head.stdout.toString("utf8").trim();
        }
        validateRef(ref, "refspec");
        const remoteRef = ref.startsWith("refs/") ? ref : `refs/heads/${ref}`;
        const push = await bound.exec({
          args: ["push", "origin", ref],
          cwd: options.cwd,
          env: {
            GIT_CONFIG_COUNT: "1",
            GIT_CONFIG_KEY_0: "http.extraHeader",
            GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
          },
          timeoutMs: limits.requestTimeoutMs,
          maxOutputBytes: 256 * 1024,
        });
        if (push.exitCode !== 0) {
          throw new ForgeError("ERR_PRISM_FORGE_API", `git push failed (exit ${push.exitCode})`);
        }
        return { remoteRef };
      });
    },

    async createPullRequest(input) {
      const head = validateRef(input.head, "head");
      const base = validateRef(input.base, "base");
      if (typeof input.title !== "string" || input.title.length === 0) throw new ForgeError("ERR_PRISM_FORGE_LIMIT", "title is required");
      if (typeof input.body !== "string") throw new ForgeError("ERR_PRISM_FORGE_LIMIT", "body is required");
      await gate({ operation: "create_pull_request", metadata: { head, base } });
      return runMutation("createPullRequest", { head, base, title: input.title, body: input.body }, async (token) => {
        const { status, json } = await requestJson(
          token,
          "POST",
          `/repos/${repository}/pulls`,
          limits,
          {
            body: { head, base, title: input.title, body: input.body },
          },
          fetchImpl,
        );
        if (
          status === 422 &&
          typeof json === "object" &&
          json !== null &&
          "message" in json &&
          String(json.message).includes("already exists")
        ) {
          // Idempotent: an open PR for this head/base already exists — return it.
          const existing = await get(`/repos/${repository}/pulls?head=${repository.split("/")[0]}:${head}&state=open`);
          if (existing.status === 200 && Array.isArray(existing.json) && existing.json.length > 0) {
            return toForgePullRequest(asRecord(existing.json[0], "existing pull request"));
          }
        }
        const error = errorForStatus(status, json, "pull request creation failed");
        if (error) throw error;
        return toForgePullRequest(asRecord(json, "pull request"));
      });
    },

    async updatePullRequest(input) {
      const number = validateNumber(input.number, "pull request number");
      if (input.state !== undefined && input.state !== "open" && input.state !== "closed") {
        throw new ForgeError("ERR_PRISM_FORGE_LIMIT", "state must be 'open' or 'closed'");
      }
      await gate({ operation: "update_pull_request", metadata: { number } });
      const body: Record<string, unknown> = {};
      if (input.title !== undefined) body.title = input.title;
      if (input.body !== undefined) body.body = input.body;
      if (input.state !== undefined) body.state = input.state;
      if (Object.keys(body).length === 0) throw new ForgeError("ERR_PRISM_FORGE_LIMIT", "nothing to update");
      return runMutation("updatePullRequest", { number, ...body }, async (token) => {
        const { status, json } = await requestJson(token, "PATCH", `/repos/${repository}/pulls/${number}`, limits, { body }, fetchImpl);
        const error = errorForStatus(status, json, "pull request update failed");
        if (error) throw error;
        return toForgePullRequest(asRecord(json, "pull request"));
      });
    },

    async createReviewComment(input) {
      const number = validateNumber(input.number, "pull request number");
      const path = validateRef(input.path, "path");
      const line = validateNumber(input.line, "line");
      if (typeof input.body !== "string" || input.body.length === 0)
        throw new ForgeError("ERR_PRISM_FORGE_LIMIT", "comment body is required");
      await gate({ operation: "create_review_comment", metadata: { number, path, line } });
      return runMutation("createReviewComment", { number, path, line, body: input.body }, async (token) => {
        const { status, json } = await requestJson(
          token,
          "POST",
          `/repos/${repository}/pulls/${number}/comments`,
          limits,
          {
            body: { body: input.body, path, line },
          },
          fetchImpl,
        );
        const error = errorForStatus(status, json, "review comment creation failed");
        if (error) throw error;
        const record = asRecord(json, "review comment");
        return { id: Number(record.id) };
      });
    },

    async checks(input) {
      const ref = validateRef(input.ref, "ref");
      const checkRuns = await getPages(`/repos/${repository}/commits/${encodeURIComponent(ref)}/check-runs`, undefined, (json) => {
        const record = asRecord(json, "check-runs");
        return Array.isArray(record.check_runs) ? record.check_runs : [];
      });
      const statuses = await getPages(`/repos/${repository}/commits/${encodeURIComponent(ref)}/status`, undefined, (json) => {
        const record = asRecord(json, "statuses");
        return Array.isArray(record.statuses) ? record.statuses : [];
      });
      const out: ForgeCheck[] = [];
      const seen = new Set<string>();
      for (const item of checkRuns) {
        const check = toForgeCheck(asRecord(item, "check run"));
        if (seen.has(check.name)) continue;
        seen.add(check.name);
        out.push(check);
      }
      for (const item of statuses) {
        const record = asRecord(item, "commit status");
        const state = stringField(record, "state");
        const conclusion = state === "pending" ? undefined : state === "success" ? "success" : "failure";
        const name = stringField(record, "context", "status");
        if (seen.has(name)) continue;
        seen.add(name);
        out.push({ name, status: state === "pending" ? "in_progress" : "completed", ...(conclusion ? { conclusion } : {}) });
      }
      return out;
    },

    async reconcileHandoff(input) {
      const base = validateRef(input.base, "base");
      const head = validateRef(input.head, "head");
      const owner = repository.split("/")[0];
      const comparePath = `/repos/${repository}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
      const compare = await get(comparePath);
      if (compare.status === 404) {
        return {
          base,
          head,
          pushed: false,
          aheadBy: 0,
          behindBy: 0,
          alreadyUpToDate: false,
          alreadyMerged: false,
          checks: [],
          commits: [],
          changedPaths: [],
          diffstat: "",
          warnings: ["head ref not found on remote"],
        };
      }
      const error = errorForStatus(compare.status, compare.json, "compare failed");
      if (error) throw error;
      const warnings: string[] = [];
      const record = asRecord(compare.json, "compare");
      const aheadBy = Number(record.ahead_by ?? 0);
      const behindBy = Number(record.behind_by ?? 0);
      const commits = Array.isArray(record.commits)
        ? record.commits.slice(0, limits.pagesPerOperation * MAX_PAGE_SIZE).map((c) => {
            const commitRecord = asRecord(c, "commit");
            const inner = asRecord(commitRecord.commit ?? {}, "commit detail");
            return { sha: stringField(commitRecord, "sha"), subject: stringField(inner, "message", "").split("\n")[0] };
          })
        : [];
      const files = Array.isArray(record.files) ? record.files : [];
      const changedPaths = files.map((f) => stringField(asRecord(f, "file"), "filename")).filter(Boolean);
      const diffstat = truncate(
        files
          .map((f) => {
            const file = asRecord(f, "file");
            return `${stringField(file, "filename")} +${Number(file.additions ?? 0)}/-${Number(file.deletions ?? 0)}`;
          })
          .join("\n"),
        limits.payloadBytes,
      );

      const prResult = await get(`/repos/${repository}/pulls?head=${owner}:${head}&base=${base}&state=all`);
      let pullRequest: ForgePullRequest | undefined;
      if (prResult.status === 200 && Array.isArray(prResult.json) && prResult.json.length > 0) {
        pullRequest = toForgePullRequest(asRecord(prResult.json[0], "pull request"));
      }
      const alreadyMerged = pullRequest?.merged === true;
      if (alreadyMerged) warnings.push("pull request already merged; no new push or PR needed");
      if (aheadBy === 0 && behindBy === 0) warnings.push("head is up to date with base");

      const checkRuns = await getPages(`/repos/${repository}/commits/${encodeURIComponent(head)}/check-runs`, undefined, (json) => {
        const page = asRecord(json, "check-runs");
        return Array.isArray(page.check_runs) ? page.check_runs : [];
      });
      const checks = checkRuns.map((c) => toForgeCheck(asRecord(c, "check run")));

      return {
        base,
        head,
        pushed: aheadBy > 0 || behindBy > 0,
        aheadBy,
        behindBy,
        alreadyUpToDate: aheadBy === 0 && behindBy === 0,
        alreadyMerged,
        pullRequest,
        checks,
        commits,
        changedPaths,
        diffstat,
        warnings,
      };
    },
  };
}
