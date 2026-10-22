import type { HostUiRequestKind } from "@arnilo/prism";
import { HeadlessError } from "./errors.js";

export const DEFAULT_MAX_ANSWERS = 1_000;
export const HARD_MAX_ANSWERS = 100_000;
export const HOST_UI_KINDS: readonly HostUiRequestKind[] = ["confirm", "select", "input", "secret", "open-url", "notify", "terminal"];

export function answerLimit(value = DEFAULT_MAX_ANSWERS): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > HARD_MAX_ANSWERS) throw new HeadlessError("invalid_limit");
  return value;
}
