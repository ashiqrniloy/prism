import { randomUUID } from "node:crypto";
import { assertIdentityActive, type AgentIdentity, type JsonObject } from "@arnilo/prism";
import { assertSafeArgv, createCliRunner, parseCliJson, parseCliNdjson } from "./cli.js";
import { WorkToolError } from "./errors.js";
import { identityKey } from "./idempotency.js";
import { resolveWorkLimits } from "./limits.js";
import type {
  GoogleWorkspaceAdapter,
  GoogleWorkspaceOp,
  WorkCliRunner,
  WorkDraft,
  WorkLimits,
} from "./types.js";

/** Default ops enabled without Docs/Sheets/Slides capability gates. */
export const DEFAULT_GWS_OPS: readonly GoogleWorkspaceOp[] = [
  "version",
  "mail.list",
  "mail.get",
  "mail.send",
  "calendar.list",
  "calendar.add",
  "file.list",
  "file.add",
  "file.share",
  "task.list",
  "task.add",
  "task.complete",
];

/** Ops excluded from DEFAULT_GWS_OPS; host must pass them in allowedOps. */
export const GATED_GWS_OPS: ReadonlySet<GoogleWorkspaceOp> = new Set([
  "docs.create",
  "sheets.create",
  "slides.create",
]);

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

function paramsJson(value: JsonObject): string {
  return JSON.stringify(value);
}

/**
 * Hard-coded argv templates for @googleworkspace/cli (`gws`), verified 2026-07-24 docs:
 * - gmail users messages list/get; gmail +send
 * - calendar events list; calendar events insert
 * - drive files list/create; drive permissions create (domain only)
 * - tasks tasks list/insert/patch
 * - docs/sheets/slides create (capability-gated)
 * Never expose Discovery free-form (`schema`) or `auth`/`login`/`setup`.
 */
export function buildGoogleWorkspaceArgv(op: GoogleWorkspaceOp, args: JsonObject): string[] {
  switch (op) {
    case "version":
      return ["--version"];
    case "mail.list": {
      const q = optString(args, "q");
      const maxResults = optString(args, "maxResults");
      const params: JsonObject = {
        userId: optString(args, "userId") ?? "me",
        ...(q ? { q } : {}),
        ...(maxResults ? { maxResults: Number(maxResults) } : {}),
      };
      return [
        "gmail", "users", "messages", "list",
        "--params", paramsJson(params),
        "--fields", "messages(id,threadId,snippet)",
      ];
    }
    case "mail.get":
      return [
        "gmail", "users", "messages", "get",
        "--params", paramsJson({ userId: optString(args, "userId") ?? "me", id: reqString(args, "id") }),
        "--fields", "id,threadId,snippet,payload/headers,labelIds",
      ];
    case "mail.send": {
      // Convenience helper avoids model-controlled raw MIME/base64.
      const argv = [
        "gmail", "+send",
        "--to", reqString(args, "to"),
        "--subject", reqString(args, "subject"),
        "--body", reqString(args, "body"),
      ];
      const cc = optString(args, "cc");
      const bcc = optString(args, "bcc");
      const from = optString(args, "from");
      if (cc) argv.push("--cc", cc);
      if (bcc) argv.push("--bcc", bcc);
      if (from) argv.push("--from", from);
      return argv;
    }
    case "calendar.list": {
      const timeMin = optString(args, "timeMin");
      const timeMax = optString(args, "timeMax");
      const maxResults = optString(args, "maxResults");
      const params: JsonObject = {
        calendarId: optString(args, "calendarId") ?? "primary",
        ...(timeMin ? { timeMin } : {}),
        ...(timeMax ? { timeMax } : {}),
        ...(maxResults ? { maxResults: Number(maxResults) } : {}),
      };
      return [
        "calendar", "events", "list",
        "--params", paramsJson(params),
        "--fields", "items(id,summary,start,end,etag)",
      ];
    }
    case "calendar.add": {
      const calendarId = optString(args, "calendarId") ?? "primary";
      const body = {
        summary: reqString(args, "summary"),
        start: { dateTime: reqString(args, "start") },
        end: { dateTime: reqString(args, "end") },
      };
      return [
        "calendar", "events", "insert",
        "--params", paramsJson({ calendarId }),
        "--json", JSON.stringify(body),
      ];
    }
    case "file.list": {
      const q = optString(args, "q");
      const pageSize = optString(args, "pageSize");
      const params: JsonObject = {
        pageSize: pageSize ? Number(pageSize) : 10,
        ...(q ? { q } : {}),
      };
      const argv = [
        "drive", "files", "list",
        "--params", paramsJson(params),
        "--fields", "files(id,name,mimeType,size)",
      ];
      if (args.pageAll === true || args.pageAll === "true") argv.push("--page-all");
      return argv;
    }
    case "file.add": {
      const parentId = optString(args, "parentId");
      const meta = {
        name: reqString(args, "name"),
        ...(parentId ? { parents: [parentId] } : {}),
      };
      return [
        "drive", "files", "create",
        "--json", JSON.stringify(meta),
        "--upload", reqString(args, "filePath"),
      ];
    }
    case "file.share": {
      const type = reqString(args, "type");
      if (type === "anyone") throw new WorkToolError("ERR_PRISM_WORK_POLICY", "Anonymous share denied; host must allow explicitly via policy override");
      if (type !== "domain" && type !== "user") throw new WorkToolError("ERR_PRISM_WORK_INPUT", "type must be domain or user");
      const role = optString(args, "role") ?? "reader";
      if (role !== "reader" && role !== "writer" && role !== "commenter") {
        throw new WorkToolError("ERR_PRISM_WORK_INPUT", "role must be reader, writer, or commenter");
      }
      const body: Record<string, string> = { role, type };
      if (type === "domain") body.domain = reqString(args, "domain");
      else body.emailAddress = reqString(args, "emailAddress");
      return [
        "drive", "permissions", "create",
        "--params", paramsJson({ fileId: reqString(args, "fileId") }),
        "--json", JSON.stringify(body),
      ];
    }
    case "task.list":
      return [
        "tasks", "tasks", "list",
        "--params", paramsJson({ tasklist: optString(args, "tasklist") ?? "@default" }),
      ];
    case "task.add":
      return [
        "tasks", "tasks", "insert",
        "--params", paramsJson({ tasklist: optString(args, "tasklist") ?? "@default" }),
        "--json", paramsJson({ title: reqString(args, "title") }),
      ];
    case "task.complete":
      return [
        "tasks", "tasks", "patch",
        "--params", paramsJson({
          tasklist: optString(args, "tasklist") ?? "@default",
          task: reqString(args, "id"),
        }),
        "--json", paramsJson({ status: "completed" }),
      ];
    case "docs.create":
      return ["docs", "documents", "create", "--json", paramsJson({ title: reqString(args, "title") })];
    case "sheets.create":
      return [
        "sheets", "spreadsheets", "create",
        "--json", paramsJson({ properties: { title: reqString(args, "title") } }),
      ];
    case "slides.create":
      return ["slides", "presentations", "create", "--json", paramsJson({ title: reqString(args, "title") })];
    default: {
      const _exhaustive: never = op;
      throw new WorkToolError("ERR_PRISM_WORK_OP", `Unknown op ${_exhaustive}`);
    }
  }
}

export interface GoogleWorkspaceCliAdapterOptions {
  readonly binary: string;
  readonly identity: AgentIdentity;
  readonly configDir: string;
  readonly allowedOps?: readonly GoogleWorkspaceOp[];
  readonly limits?: WorkLimits;
  readonly runner?: WorkCliRunner;
  readonly env?: Readonly<Record<string, string>>;
  readonly minVersion?: string;
}

export function createGoogleWorkspaceCliAdapter(options: GoogleWorkspaceCliAdapterOptions): GoogleWorkspaceAdapter {
  assertIdentityActive(options.identity);
  const allowedOps = new Set(options.allowedOps ?? DEFAULT_GWS_OPS);
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

  const assertAllowed = (op: GoogleWorkspaceOp) => {
    if (!allowedOps.has(op)) throw new WorkToolError("ERR_PRISM_WORK_CAPABILITY", `Operation ${op} not allowed for this identity`);
  };

  return {
    provider: "google-workspace",
    identity: options.identity,
    allowedOps,
    async ensureReady(signal) {
      if (readyVersion) return readyVersion;
      assertAllowed("version");
      const argv = buildGoogleWorkspaceArgv("version", {});
      assertSafeArgv(argv);
      const result = await runner.exec(argv, { signal });
      if (result.exitCode !== 0) throw new WorkToolError("ERR_PRISM_WORK_CLI", `gws version failed: ${result.stderr.slice(0, 200)}`);
      const version = result.stdout.trim() || String(parseCliJson(result.stdout, limits) ?? "");
      if (options.minVersion && version.replace(/^v/, "") < options.minVersion.replace(/^v/, "")) {
        throw new WorkToolError("ERR_PRISM_WORK_VERSION", `CLI version ${version} below required ${options.minVersion}`);
      }
      readyVersion = version;
      return version;
    },
    async runOp(op, args, signal) {
      assertAllowed(op);
      await this.ensureReady(signal);
      const argv = buildGoogleWorkspaceArgv(op, args);
      assertSafeArgv(argv);
      const body = typeof args.body === "string" ? args.body : "";
      if (Buffer.byteLength(body) > limits.maxRequestBytes) {
        throw new WorkToolError("ERR_PRISM_WORK_LIMIT", "Request body exceeds byte limit");
      }
      const result = await runner.exec(argv, { signal });
      if (result.exitCode !== 0) {
        throw new WorkToolError("ERR_PRISM_WORK_CLI", `gws ${op} failed (exit ${result.exitCode})`);
      }
      if (argv.includes("--page-all")) {
        return parseCliNdjson(result.stdout, limits);
      }
      return parseCliJson(result.stdout, limits);
    },
    createDraft(op, payload) {
      assertAllowed(op);
      const draft: WorkDraft = {
        draftId: randomUUID(),
        provider: "google-workspace",
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
