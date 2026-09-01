import { randomUUID } from "node:crypto";
import { type AgentIdentity, assertIdentityActive, type JsonObject } from "@arnilo/prism";
import { assertSafeArgv, createCliRunner, parseCliJson } from "./cli.js";
import { WorkToolError } from "./errors.js";
import { identityKey } from "./idempotency.js";
import { resolveWorkLimits } from "./limits.js";
import type { Microsoft365Adapter, Microsoft365Op, WorkCliRunner, WorkDraft, WorkLimits, WorkTokenProvider } from "./types.js";

/** Default ops enabled without capability gates. Teams/Planner/To Do stay opt-in. */
export const DEFAULT_M365_OPS: readonly Microsoft365Op[] = [
  "version",
  "mail.list",
  "mail.get",
  "mail.send",
  "calendar.list",
  "calendar.add",
  "file.list",
  "file.add",
  "file.copy",
  "file.share",
];

const GATED_DEFAULT_EXCLUDED: ReadonlySet<Microsoft365Op> = new Set([
  "todo.list",
  "todo.add",
  "todo.complete",
  "planner.list",
  "planner.add",
  "planner.complete",
]);

/** Ops excluded from DEFAULT_M365_OPS; host must pass them in allowedOps. */
export const GATED_M365_OPS = GATED_DEFAULT_EXCLUDED;

function reqString(args: JsonObject, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value) throw new WorkToolError("ERR_PRISM_WORK_INPUT", `${key} must be a non-empty string`);
  return value;
}

function optString(args: JsonObject, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value) throw new WorkToolError("ERR_PRISM_WORK_INPUT", `${key} must be a non-empty string`);
  return value;
}

/**
 * Hard-coded argv templates for @pnp/cli-microsoft365 (verified 2026-07-23 docs):
 * - outlook message list/get, outlook mail send
 * - outlook event list; outlook event add (newer CLI; draft path still requires approval)
 * - file list/add/copy; spo file sharinglink add
 * - todo task list/add/set (gated); planner task * (gated)
 */
export function buildMicrosoft365Argv(op: Microsoft365Op, args: JsonObject): string[] {
  switch (op) {
    case "version":
      return ["version", "--output", "json"];
    case "mail.list": {
      const argv = ["outlook", "message", "list", "--output", "json"];
      const folderName = optString(args, "folderName");
      const folderId = optString(args, "folderId");
      if (folderName && folderId) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "Specify folderName or folderId, not both");
      if (folderName) argv.push("--folderName", folderName);
      else if (folderId) argv.push("--folderId", folderId);
      else argv.push("--folderName", "inbox");
      const userName = optString(args, "userName");
      const userId = optString(args, "userId");
      if (userName && userId) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "Specify userName or userId, not both");
      if (userName) argv.push("--userName", userName);
      if (userId) argv.push("--userId", userId);
      return argv;
    }
    case "mail.get": {
      const argv = ["outlook", "message", "get", "--output", "json", "--id", reqString(args, "id")];
      const userName = optString(args, "userName");
      const userId = optString(args, "userId");
      if (userName && userId) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "Specify userName or userId, not both");
      if (userName) argv.push("--userName", userName);
      if (userId) argv.push("--userId", userId);
      return argv;
    }
    case "mail.send": {
      const argv = [
        "outlook",
        "mail",
        "send",
        "--output",
        "json",
        "--to",
        reqString(args, "to"),
        "--subject",
        reqString(args, "subject"),
        "--bodyContents",
        reqString(args, "bodyContents"),
      ];
      const cc = optString(args, "cc");
      const bcc = optString(args, "bcc");
      const bodyContentType = optString(args, "bodyContentType");
      if (cc) argv.push("--cc", cc);
      if (bcc) argv.push("--bcc", bcc);
      if (bodyContentType) argv.push("--bodyContentType", bodyContentType);
      return argv;
    }
    case "calendar.list": {
      const argv = ["outlook", "event", "list", "--output", "json"];
      const calendarId = optString(args, "calendarId");
      const calendarName = optString(args, "calendarName");
      if (calendarId && calendarName) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "Specify calendarId or calendarName, not both");
      if (calendarId) argv.push("--calendarId", calendarId);
      else argv.push("--calendarName", calendarName ?? "Calendar");
      const userName = optString(args, "userName");
      const userId = optString(args, "userId");
      if (userName && userId) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "Specify userName or userId, not both");
      if (userName) argv.push("--userName", userName);
      if (userId) argv.push("--userId", userId);
      const start = optString(args, "startDateTime");
      const end = optString(args, "endDateTime");
      if (start) argv.push("--startDateTime", start);
      if (end) argv.push("--endDateTime", end);
      return argv;
    }
    case "calendar.add": {
      // Docs: m365 outlook event add --subject --start --end (CLI ≥ issue #7123).
      const argv = [
        "outlook",
        "event",
        "add",
        "--output",
        "json",
        "--subject",
        reqString(args, "subject"),
        "--start",
        reqString(args, "start"),
        "--end",
        reqString(args, "end"),
      ];
      const calendarId = optString(args, "calendarId");
      const calendarName = optString(args, "calendarName");
      if (calendarId && calendarName) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "Specify calendarId or calendarName, not both");
      if (calendarId) argv.push("--calendarId", calendarId);
      if (calendarName) argv.push("--calendarName", calendarName);
      return argv;
    }
    case "file.list":
      return ["file", "list", "--output", "json", "--webUrl", reqString(args, "webUrl"), "--folderUrl", reqString(args, "folderUrl")];
    case "file.add":
      return [
        "file",
        "add",
        "--output",
        "json",
        "--folderUrl",
        reqString(args, "folderUrl"),
        "--filePath",
        reqString(args, "filePath"),
        ...(optString(args, "siteUrl") ? ["--siteUrl", optString(args, "siteUrl")!] : []),
      ];
    case "file.copy":
      return [
        "file",
        "copy",
        "--output",
        "json",
        "--webUrl",
        reqString(args, "webUrl"),
        "--sourceUrl",
        reqString(args, "sourceUrl"),
        "--targetUrl",
        reqString(args, "targetUrl"),
      ];
    case "file.share": {
      const fileUrl = optString(args, "fileUrl");
      const fileId = optString(args, "fileId");
      if ((fileUrl ? 1 : 0) + (fileId ? 1 : 0) !== 1) {
        throw new WorkToolError("ERR_PRISM_WORK_INPUT", "Specify fileUrl or fileId");
      }
      const type = reqString(args, "type");
      if (type !== "view" && type !== "edit") throw new WorkToolError("ERR_PRISM_WORK_INPUT", "type must be view or edit");
      const scope = optString(args, "scope") ?? "organization";
      if (scope === "anonymous")
        throw new WorkToolError("ERR_PRISM_WORK_POLICY", "Anonymous share denied; host must allow explicitly via policy override");
      if (scope !== "organization") throw new WorkToolError("ERR_PRISM_WORK_INPUT", "scope must be organization");
      const argv = [
        "spo",
        "file",
        "sharinglink",
        "add",
        "--output",
        "json",
        "--webUrl",
        reqString(args, "webUrl"),
        "--type",
        type,
        "--scope",
        scope,
      ];
      if (fileUrl) argv.push("--fileUrl", fileUrl);
      if (fileId) argv.push("--fileId", fileId);
      return argv;
    }
    case "todo.list": {
      const listName = optString(args, "listName");
      const listId = optString(args, "listId");
      if ((listName ? 1 : 0) + (listId ? 1 : 0) !== 1) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "Specify listName or listId");
      return ["todo", "task", "list", "--output", "json", ...(listName ? ["--listName", listName] : ["--listId", listId!])];
    }
    case "todo.add": {
      const listName = optString(args, "listName");
      const listId = optString(args, "listId");
      if ((listName ? 1 : 0) + (listId ? 1 : 0) !== 1) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "Specify listName or listId");
      return [
        "todo",
        "task",
        "add",
        "--output",
        "json",
        "--title",
        reqString(args, "title"),
        ...(listName ? ["--listName", listName] : ["--listId", listId!]),
      ];
    }
    case "todo.complete": {
      const listName = optString(args, "listName");
      const listId = optString(args, "listId");
      if ((listName ? 1 : 0) + (listId ? 1 : 0) !== 1) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "Specify listName or listId");
      return [
        "todo",
        "task",
        "set",
        "--output",
        "json",
        "--id",
        reqString(args, "id"),
        "--status",
        "completed",
        ...(listName ? ["--listName", listName] : ["--listId", listId!]),
      ];
    }
    case "planner.list":
      return ["planner", "task", "list", "--output", "json", "--planId", reqString(args, "planId")];
    case "planner.add":
      return [
        "planner",
        "task",
        "add",
        "--output",
        "json",
        "--title",
        reqString(args, "title"),
        "--planId",
        reqString(args, "planId"),
        "--bucketId",
        reqString(args, "bucketId"),
      ];
    case "planner.complete":
      return ["planner", "task", "set", "--output", "json", "--id", reqString(args, "id"), "--percentComplete", "100"];
    default: {
      const _exhaustive: never = op;
      throw new WorkToolError("ERR_PRISM_WORK_OP", `Unknown op ${_exhaustive}`);
    }
  }
}

export interface Microsoft365CliAdapterOptions {
  readonly binary: string;
  readonly identity: AgentIdentity;
  readonly configDir: string;
  readonly allowedOps?: readonly Microsoft365Op[];
  readonly limits?: WorkLimits;
  readonly runner?: WorkCliRunner;
  readonly env?: Readonly<Record<string, string>>;
  readonly minVersion?: string;
  /** Late-bound per-identity token source; undefined token fails the call closed. */
  readonly tokenProvider?: WorkTokenProvider;
}

export function createMicrosoft365CliAdapter(options: Microsoft365CliAdapterOptions): Microsoft365Adapter {
  assertIdentityActive(options.identity);
  const allowedOps = new Set(options.allowedOps ?? DEFAULT_M365_OPS);
  const limits = resolveWorkLimits(options.limits);
  const runner =
    options.runner ??
    createCliRunner({
      binary: options.binary,
      configDir: options.configDir,
      limits: options.limits,
      env: options.env,
    });
  const drafts = new Map<string, WorkDraft>();
  const idKey = identityKey(options.identity);
  let readyVersion: string | undefined;

  const assertAllowed = (op: Microsoft365Op) => {
    if (!allowedOps.has(op)) throw new WorkToolError("ERR_PRISM_WORK_CAPABILITY", `Operation ${op} not allowed for this identity`);
  };

  // Resolve the per-identity token env; a configured provider returning undefined means the
  // credential is missing/expired/revoked, so the call fails closed before any side effect.
  const tokenEnv = async (signal?: AbortSignal): Promise<Readonly<Record<string, string>> | undefined> => {
    if (!options.tokenProvider) return undefined;
    const envVars = await options.tokenProvider.tokenEnv(options.identity, signal);
    if (!envVars) throw new WorkToolError("ERR_PRISM_WORK_CREDENTIAL", "Connector credential unavailable, expired, or revoked");
    return envVars;
  };

  return {
    provider: "microsoft365",
    identity: options.identity,
    allowedOps,
    async ensureReady(signal) {
      if (readyVersion) return readyVersion;
      assertAllowed("version");
      const argv = buildMicrosoft365Argv("version", {});
      assertSafeArgv(argv);
      const result = await runner.exec(argv, { signal, env: await tokenEnv(signal) });
      if (result.exitCode !== 0) throw new WorkToolError("ERR_PRISM_WORK_CLI", `m365 version failed: ${result.stderr.slice(0, 200)}`);
      const parsed = parseCliJson(result.stdout, limits);
      const version =
        typeof parsed === "string"
          ? parsed
          : typeof (parsed as { version?: string })?.version === "string"
            ? (parsed as { version: string }).version
            : String(parsed);
      if (options.minVersion && version.replace(/^v/, "") < options.minVersion.replace(/^v/, "")) {
        throw new WorkToolError("ERR_PRISM_WORK_VERSION", `CLI version ${version} below required ${options.minVersion}`);
      }
      readyVersion = version;
      return version;
    },
    async runOp(op, args, signal) {
      assertAllowed(op);
      await this.ensureReady(signal);
      const argv = buildMicrosoft365Argv(op, args);
      assertSafeArgv(argv);
      // Body/request size check for send payloads.
      const body = typeof args.bodyContents === "string" ? args.bodyContents : "";
      if (Buffer.byteLength(body) > limits.maxRequestBytes) {
        throw new WorkToolError("ERR_PRISM_WORK_LIMIT", "Request body exceeds byte limit");
      }
      const result = await runner.exec(argv, { signal, env: await tokenEnv(signal) });
      if (result.exitCode !== 0) {
        throw new WorkToolError("ERR_PRISM_WORK_CLI", `m365 ${op} failed (exit ${result.exitCode})`);
      }
      return parseCliJson(result.stdout, limits);
    },
    createDraft(op, payload) {
      assertAllowed(op);
      const draft: WorkDraft = {
        draftId: randomUUID(),
        provider: "microsoft365",
        op,
        identityKey: idKey,
        payload: { ...payload },
        createdAt: new Date().toISOString(),
        status: "pending",
      };
      drafts.set(draft.draftId, draft);
      return draft;
    },
    getDraft(draftId) {
      return drafts.get(draftId);
    },
    markDraft(draftId, status, concurrencyToken) {
      const draft = drafts.get(draftId);
      if (!draft) throw new WorkToolError("ERR_PRISM_WORK_DRAFT", "Unknown draft");
      if (draft.identityKey !== idKey) throw new WorkToolError("ERR_PRISM_WORK_IDENTITY", "Draft identity mismatch");
      const next = { ...draft, status, concurrencyToken: concurrencyToken ?? draft.concurrencyToken };
      drafts.set(draftId, next);
      return next;
    },
  };
}
