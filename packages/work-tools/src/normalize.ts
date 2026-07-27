import type { WorkCalendarEvent, WorkFileItem, WorkMailMessage, WorkPage, WorkProvider, WorkTaskItem } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Map provider-specific mail payloads onto the shared WorkMailMessage shape. */
export function normalizeMailMessage(provider: WorkProvider, raw: unknown, citationId?: string): WorkMailMessage {
  const obj = asRecord(raw) ?? {};
  const resourceId = str(obj.id) ?? str(obj.messageId) ?? citationId;
  return {
    citationId: citationId ?? resourceId ?? `${provider}:mail`,
    provider,
    resourceId,
    subject: str(obj.subject) ?? str(obj.Subject),
    preview: str(obj.preview) ?? str(obj.snippet) ?? str(obj.bodyPreview),
    from: (() => {
      const direct = str(obj.from);
      if (direct) return direct;
      const nested = asRecord(obj.from);
      const addr = asRecord(nested?.emailAddress);
      return str(addr?.address) ?? str(nested?.email);
    })(),
    to: Array.isArray(obj.to) ? obj.to.filter((v): v is string => typeof v === "string") : undefined,
    receivedAt: str(obj.receivedAt) ?? str(obj.receivedDateTime) ?? str(obj.internalDate),
    isDraft: typeof obj.isDraft === "boolean" ? obj.isDraft : undefined,
    changeKey: str(obj.changeKey) ?? str(obj.etag) ?? str(obj.historyId),
    untrusted: true,
  };
}

/** Map provider-specific calendar payloads onto WorkCalendarEvent. */
export function normalizeCalendarEvent(provider: WorkProvider, raw: unknown, citationId?: string): WorkCalendarEvent {
  const obj = asRecord(raw) ?? {};
  const start = asRecord(obj.start);
  const end = asRecord(obj.end);
  const resourceId = str(obj.id) ?? citationId;
  return {
    citationId: citationId ?? resourceId ?? `${provider}:event`,
    provider,
    resourceId,
    subject: str(obj.subject) ?? str(obj.summary),
    start: str(obj.start) ?? str(start?.dateTime) ?? str(start?.date),
    end: str(obj.end) ?? str(end?.dateTime) ?? str(end?.date),
    changeKey: str(obj.changeKey) ?? str(obj.etag),
    untrusted: true,
  };
}

/** Map provider-specific file payloads onto WorkFileItem. */
export function normalizeFileItem(provider: WorkProvider, raw: unknown, citationId?: string): WorkFileItem {
  const obj = asRecord(raw) ?? {};
  const resourceId = str(obj.id) ?? citationId;
  return {
    citationId: citationId ?? resourceId ?? `${provider}:file`,
    provider,
    resourceId,
    name: str(obj.name) ?? str(obj.Name),
    size: num(obj.size) ?? num(obj.Size),
    eTag: str(obj.eTag) ?? str(obj.etag),
    mimeType: str(obj.mimeType) ?? str(obj.MimeType),
    untrusted: true,
  };
}

/** Map provider-specific task payloads onto WorkTaskItem. */
export function normalizeTaskItem(provider: WorkProvider, raw: unknown, citationId?: string): WorkTaskItem {
  const obj = asRecord(raw) ?? {};
  const resourceId = str(obj.id) ?? citationId;
  return {
    citationId: citationId ?? resourceId ?? `${provider}:task`,
    provider,
    resourceId,
    title: str(obj.title) ?? str(obj.Title),
    status: str(obj.status) ?? str(obj.Status),
    changeKey: str(obj.changeKey) ?? str(obj.etag),
    untrusted: true,
  };
}

function extractArray(raw: unknown, keys: readonly string[]): unknown[] {
  if (Array.isArray(raw)) return raw;
  const obj = asRecord(raw);
  if (!obj) return [];
  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

export function normalizeMailPage(provider: WorkProvider, raw: unknown, nextCursor?: string): WorkPage<WorkMailMessage> {
  const items = extractArray(raw, ["messages", "value", "items"]).map((item, i) =>
    normalizeMailMessage(provider, item, `${provider}:mail:${i}`),
  );
  return { items, nextCursor, untrusted: true };
}

export function normalizeCalendarPage(provider: WorkProvider, raw: unknown, nextCursor?: string): WorkPage<WorkCalendarEvent> {
  const items = extractArray(raw, ["items", "value"]).map((item, i) => normalizeCalendarEvent(provider, item, `${provider}:event:${i}`));
  return { items, nextCursor, untrusted: true };
}

export function normalizeFilePage(provider: WorkProvider, raw: unknown, nextCursor?: string): WorkPage<WorkFileItem> {
  const items = extractArray(raw, ["files", "value", "items"]).map((item, i) => normalizeFileItem(provider, item, `${provider}:file:${i}`));
  return { items, nextCursor, untrusted: true };
}

export function normalizeTaskPage(provider: WorkProvider, raw: unknown, nextCursor?: string): WorkPage<WorkTaskItem> {
  const items = extractArray(raw, ["items", "value"]).map((item, i) => normalizeTaskItem(provider, item, `${provider}:task:${i}`));
  return { items, nextCursor, untrusted: true };
}
