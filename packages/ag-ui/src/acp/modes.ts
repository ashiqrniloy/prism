/**
 * Phase 10 Task 5 — session modes and configuration options.
 *
 * Modes are a pure host-side contribution overlay: the agent validates ids,
 * bounds the table, tracks the current mode per session, runs the host's
 * `apply` hook on switch, and emits `current_mode_update`. The host's `apply`
 * narrows its own tools/write/approval policy via closure — there is no
 * ACP-only policy engine. Unknown mode ids fail closed. Config options are
 * host-owned values validated against their declared type and bounds.
 */
import type { SessionConfigOption, SessionModeState } from "@agentclientprotocol/sdk";
import type { ResolvedAgUiLimits } from "../limits.js";
import { AcpError } from "./errors.js";

/** One selectable mode. `apply` runs on every switch (host-side overlay). */
export interface AcpSessionMode {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** Host hook: narrows (or host-authorized widens) tools/write/approval policy for the session. */
  readonly apply?: (input: {
    readonly sessionId?: string;
    /** Previous mode id, when the session already had one. */
    readonly fromModeId?: string;
    readonly modeId: string;
    readonly signal: AbortSignal;
  }) => void | Promise<void>;
}

/** Host mode table. `defaultModeId` defaults to the first mode. */
export interface AcpModesSeam {
  readonly modes: readonly AcpSessionMode[];
  readonly defaultModeId?: string;
}

/** Host-owned session configuration option (values are validated against the declared type). */
export type AcpConfigOption =
  | {
      readonly type: "boolean";
      readonly id: string;
      readonly name: string;
      readonly description?: string;
      readonly defaultValue: boolean;
    }
  | {
      readonly type: "select";
      readonly id: string;
      readonly name: string;
      readonly description?: string;
      readonly defaultValue: string;
      readonly options: readonly { readonly value: string; readonly name: string; readonly description?: string }[];
    };

/** Host config-option table; `onChange` runs after validation. */
export interface AcpConfigOptionsSeam {
  readonly options: readonly AcpConfigOption[];
  readonly onChange?: (input: {
    readonly sessionId: string;
    readonly configId: string;
    readonly value: boolean | string;
    readonly signal: AbortSignal;
  }) => void | Promise<void>;
}

/** Create-time validation: frozen count caps + default-mode membership. */
export function validateModeSeam(seam: AcpModesSeam | undefined, limits: ResolvedAgUiLimits): void {
  if (!seam) return;
  if (seam.modes.length === 0) throw new AcpError("ERR_PRISM_ACP_INPUT", "modes must not be empty");
  if (seam.modes.length > limits.acpModesPerSession) {
    throw new AcpError("ERR_PRISM_ACP_LIMIT", `modes exceeds ${limits.acpModesPerSession}`);
  }
  const ids = new Set(seam.modes.map((mode) => mode.id));
  if (ids.size !== seam.modes.length) throw new AcpError("ERR_PRISM_ACP_INPUT", "duplicate mode id");
  if (seam.defaultModeId !== undefined && !ids.has(seam.defaultModeId)) {
    throw new AcpError("ERR_PRISM_ACP_INPUT", `defaultModeId '${seam.defaultModeId}' is not a known mode`);
  }
}

export function validateConfigOptionsSeam(seam: AcpConfigOptionsSeam | undefined, limits: ResolvedAgUiLimits): void {
  if (!seam) return;
  if (seam.options.length > limits.acpConfigOptions) {
    throw new AcpError("ERR_PRISM_ACP_LIMIT", `configOptions exceeds ${limits.acpConfigOptions}`);
  }
  const ids = new Set(seam.options.map((option) => option.id));
  if (ids.size !== seam.options.length) throw new AcpError("ERR_PRISM_ACP_INPUT", "duplicate config option id");
}

export function initialModeId(seam: AcpModesSeam | undefined): string | undefined {
  if (!seam) return undefined;
  return seam.defaultModeId ?? seam.modes[0].id;
}

export function toSessionModeState(seam: AcpModesSeam, currentModeId: string): SessionModeState {
  return {
    currentModeId,
    availableModes: seam.modes.map((mode) => ({
      id: mode.id,
      name: mode.name,
      ...(mode.description ? { description: mode.description } : {}),
    })),
  };
}

export function initialConfigValues(seam: AcpConfigOptionsSeam | undefined): Map<string, boolean | string> {
  return new Map(seam?.options.map((option) => [option.id, option.defaultValue]) ?? []);
}

/** Validates a set_config_option payload against the declared type; returns the normalized value. */
export function validateConfigOptionValue(option: AcpConfigOption, value: unknown): boolean | string {
  if (option.type === "boolean") {
    if (typeof value !== "boolean") throw new AcpError("ERR_PRISM_ACP_INPUT", `config option '${option.id}' expects a boolean`);
    return value;
  }
  if (typeof value !== "string" || !option.options.some((choice) => choice.value === value)) {
    throw new AcpError("ERR_PRISM_ACP_INPUT", `config option '${option.id}' has no select value '${String(value)}'`);
  }
  return value;
}

export function toSessionConfigOptions(seam: AcpConfigOptionsSeam, values: ReadonlyMap<string, boolean | string>): SessionConfigOption[] {
  return seam.options.map((option) => {
    const currentValue = values.get(option.id) ?? option.defaultValue;
    const base = { id: option.id, name: option.name, ...(option.description ? { description: option.description } : {}) };
    if (option.type === "boolean") {
      return { ...base, type: "boolean", defaultValue: option.defaultValue, currentValue: currentValue as boolean };
    }
    return {
      ...base,
      type: "select",
      defaultValue: option.defaultValue,
      currentValue: currentValue as string,
      options: option.options.map((choice) => ({
        value: choice.value,
        name: choice.name,
        ...(choice.description ? { description: choice.description } : {}),
      })),
    };
  });
}
