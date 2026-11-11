import { redactSecrets, trimTrailingSlashes } from "@arnilo/prism";
import { readBoundedResponseJson, readBoundedResponseText, type SecretSource } from "@arnilo/prism/provider-kit";
import { assertLiteLLMBaseUrl } from "./base-url.js";
import { LITELLM_DEFAULT_BASE_URL } from "./models.js";

/** One page of `/spend/logs/v2` at the largest size the pinned proxy accepts cheaply. */
const SPEND_PAGE_SIZE = 100;
/** `/spend/logs` is unbounded server-side; a 4 GiB body would otherwise be read into memory. */
const SPEND_BODY_BYTES = 4_194_304;
/** Measured write delay was 11.8 s (Task 1b); two flush windows, capped at the acceptance bound. */
export const LITELLM_SPEND_WAIT_MS = 24_000;
export const LITELLM_SPEND_WAIT_CAP_MS = 60_000;
/** Up to 20 ids are read one indexed `request_id` at a time; more use a paged range read. */
const SPEND_EXACT_ID_LIMIT = 20;
const SPEND_PAGE_CAP = 50;
const DEFAULT_WINDOW_MS = 3_600_000;

/**
 * A spend log row reduced to what reconciliation needs. Built field by field, so `messages`,
 * `response`, `proxy_server_request`, `api_key`, `api_base` and `metadata` can never leak out
 * (plan 214 Task 3).
 */
export interface LiteLLMSpendRow {
  readonly callId: string;
  readonly model: string;
  readonly modelGroup: string;
  readonly modelId?: string;
  readonly spend: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cacheReadTokens?: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly status?: string;
}

export interface LiteLLMSpendLogsOptions {
  readonly baseUrl?: string;
  readonly apiKey?: SecretSource;
  /** Omit to read a date range instead. */
  readonly callIds?: readonly string[];
  /** Defaults to one hour before `until`. */
  readonly since?: string | Date;
  /** Defaults to now. */
  readonly until?: string | Date;
  /** How long to keep polling for rows the proxy has not flushed yet. Defaults to 24 s, capped at 60 s. */
  readonly waitMs?: number;
  /** Delay between polls. */
  readonly pollIntervalMs?: number;
  readonly provider?: string;
  readonly signal?: AbortSignal;
  readonly fetch?: typeof fetch;
}

export interface LiteLLMSpendLogsResult {
  readonly rows: readonly LiteLLMSpendRow[];
  readonly missing: readonly string[];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function optionalCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : undefined;
}

/**
 * A cache hit is written under `"{request_id}_cache_hit{epoch}"` so the primary key stays unique;
 * `litellm_call_id` keeps the id the client minted (spend_tracking_utils.py:780-783).
 */
function callIdOf(row: Record<string, unknown>): string {
  const minted = text(row.litellm_call_id).trim();
  if (minted !== "") return minted;
  return text(row.request_id)
    .trim()
    .replace(/_cache_hit\d+(?:\.\d+)?$/, "");
}

/** Pure: raw spend log row → the reconciliation row, or `undefined` when it names no call. */
export function normalizeSpendRow(raw: unknown): LiteLLMSpendRow | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const row = raw as Record<string, unknown>;
  const callId = callIdOf(row);
  if (callId === "") return undefined;
  const details =
    typeof row.prompt_tokens_details === "object" && row.prompt_tokens_details !== null
      ? (row.prompt_tokens_details as Record<string, unknown>)
      : undefined;
  const cacheReadTokens = optionalCount(row.cache_read_input_tokens) ?? optionalCount(details?.cached_tokens);
  const status = text(row.status).trim();
  return {
    callId,
    model: text(row.model),
    modelGroup: text(row.model_group),
    ...(text(row.model_id).trim() === "" ? {} : { modelId: text(row.model_id).trim() }),
    spend: typeof row.spend === "number" && Number.isFinite(row.spend) ? row.spend : 0,
    promptTokens: count(row.prompt_tokens),
    completionTokens: count(row.completion_tokens),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    startTime: text(row.startTime),
    endTime: text(row.endTime),
    ...(status === "" ? {} : { status }),
  };
}

/** `/spend/logs` returns a bare list; `/spend/logs/v2` wraps it with paging metadata. */
function rowsOf(payload: unknown): { data: readonly unknown[]; totalPages?: number } {
  if (Array.isArray(payload)) return { data: payload };
  if (typeof payload !== "object" || payload === null) throw new Error("ERR_LITELLM_SPEND_LOGS: response was not a list");
  const body = payload as Record<string, unknown>;
  const data = Array.isArray(body.data) ? body.data : Array.isArray(body.response) ? body.response : undefined;
  if (!data) throw new Error("ERR_LITELLM_SPEND_LOGS: response carried no data array");
  const totalPages = typeof body.total_pages === "number" && Number.isFinite(body.total_pages) ? body.total_pages : undefined;
  return { data, totalPages };
}

/**
 * Reads LiteLLM's spend log for the given calls (plan 214 Task 3). Costs no model calls: up to
 * `callIds.length` indexed reads for a small set, otherwise up to 50 pages of a date range filtered
 * locally by id. Every returned row is filtered to a requested call id, so a key that can read
 * other tenants' rows still yields only its own.
 */
export async function litellmSpendLogs(options: LiteLLMSpendLogsOptions = {}): Promise<LiteLLMSpendLogsResult> {
  const _provider = options.provider ?? "litellm";
  const baseUrl = trimTrailingSlashes(options.baseUrl ?? LITELLM_DEFAULT_BASE_URL);
  assertLiteLLMBaseUrl(baseUrl);
  const token = await options.apiKey?.();
  if (token === undefined || token.trim() === "")
    throw new Error("ERR_LITELLM_SPEND_LOGS: no API key; a virtual key can read its own rows, a proxy without one cannot");
  const fetchImpl = options.fetch ?? fetch;
  const wanted = [...new Set((options.callIds ?? []).map((id) => String(id).trim()).filter((id) => id !== ""))];
  const waitMs = Math.min(Math.max(options.waitMs ?? LITELLM_SPEND_WAIT_MS, 0), LITELLM_SPEND_WAIT_CAP_MS);
  // A zero interval would spin the proxy for the whole window; 50 ms is the floor, 3 s the default.
  const pollIntervalMs = Math.max(options.pollIntervalMs ?? 3_000, 50);

  const get = async (path: string): Promise<unknown> => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) {
      const body = await readBoundedResponseText(response, { secrets: [token] });
      const detail =
        response.status === 401 || response.status === 403
          ? "the key may not read spend logs (a plain virtual key needs an internal_user owner; see the package README)"
          : redactSecrets(body, [token]).slice(0, 500);
      throw new Error(`ERR_LITELLM_SPEND_LOGS: ${response.status} ${detail}`);
    }
    return readBoundedResponseJson<unknown>(response, { maxResponseBodyBytes: SPEND_BODY_BYTES });
  };

  const collect = (rows: readonly LiteLLMSpendRow[], into: Map<string, LiteLLMSpendRow>): void => {
    const allowed = wanted.length > 0 ? new Set(wanted) : undefined;
    for (const row of rows) {
      if (allowed && !allowed.has(row.callId)) continue;
      if (!into.has(row.callId)) into.set(row.callId, row);
    }
  };

  const readExact = async (ids: readonly string[], into: Map<string, LiteLLMSpendRow>): Promise<void> => {
    for (const id of ids) {
      const { data } = rowsOf(await get(`/spend/logs?request_id=${encodeURIComponent(id)}`));
      collect(
        data.map(normalizeSpendRow).filter((row): row is LiteLLMSpendRow => row !== undefined),
        into,
      );
    }
  };

  const readRange = async (into: Map<string, LiteLLMSpendRow>): Promise<void> => {
    const until = new Date(options.until ?? Date.now());
    const since = new Date(options.since ?? until.getTime() - DEFAULT_WINDOW_MS);
    if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime()))
      throw new Error("ERR_LITELLM_SPEND_LOGS: since/until must be valid dates");
    for (let page = 1; page <= SPEND_PAGE_CAP; page += 1) {
      const query = new URLSearchParams({
        start_date: since.toISOString(),
        end_date: until.toISOString(),
        page: String(page),
        page_size: String(SPEND_PAGE_SIZE),
      });
      const { data, totalPages } = rowsOf(await get(`/spend/logs/v2?${query.toString()}`));
      collect(
        data.map(normalizeSpendRow).filter((row): row is LiteLLMSpendRow => row !== undefined),
        into,
      );
      if (data.length < SPEND_PAGE_SIZE || (totalPages !== undefined && page >= totalPages)) return;
    }
  };

  const found = new Map<string, LiteLLMSpendRow>();
  const deadline = Date.now() + waitMs;
  const readPending = async (): Promise<void> => {
    const pending = wanted.filter((id) => !found.has(id));
    if (pending.length > 0 && pending.length <= SPEND_EXACT_ID_LIMIT) {
      await readExact(pending, found);
    } else if (pending.length > SPEND_EXACT_ID_LIMIT) {
      await readRange(found);
    } else if (wanted.length === 0) {
      await readRange(found);
    }
  };

  await readPending();
  while (wanted.some((id) => !found.has(id)) && Date.now() + pollIntervalMs <= deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    await readPending();
  }

  const rows =
    wanted.length > 0 ? wanted.map((id) => found.get(id)).filter((row): row is LiteLLMSpendRow => row !== undefined) : [...found.values()];
  const missing = wanted.filter((id) => !found.has(id));
  return { rows, missing };
}
