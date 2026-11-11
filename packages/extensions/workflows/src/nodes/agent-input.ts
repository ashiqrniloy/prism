import type { Message } from "@arnilo/prism";

export function toAgentInput(input: unknown): string | Message | readonly Message[] {
  if (typeof input === "string") return input;
  if (isMessage(input)) return input;
  if (Array.isArray(input) && input.every(isMessage)) return input;
  return JSON.stringify(input ?? null);
}

function isMessage(value: unknown): value is Message {
  return Boolean(value && typeof value === "object" && "role" in value && "content" in value && Array.isArray((value as Message).content));
}
