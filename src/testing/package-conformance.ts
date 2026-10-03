/**
 * Package conformance (roadmap §2.2, `@arnilo/prism/testing`). Runs a `definePackage` definition
 * through the real loader twice and one mock session, and reports named check results instead of
 * throwing, so a package author sees every violation in one run. Imports no package: only the
 * kernel's own modules.
 */

import type { AgentInspection } from "../agent/inspect.js";
import { createAgent } from "../agent-session/create-agent.js";
import type { AgentConfig, AIProvider, JsonObject } from "../contracts.js";
import type { HostPort } from "../host/types.js";
import { createMockProvider } from "../mock-provider.js";
import type { PackageAPI, PackageDefinition, PackageInput, PackageInstance } from "../packages/api.js";
import type { Capability } from "../packages/capabilities.js";
import { definePackage } from "../packages/define.js";
import { PackageLoadError } from "../packages/errors.js";
import { assertJsonSchemaSupported, type JsonSchema, SECRET_REF, schemaDefaults, validateJsonSchema } from "../packages/schema.js";
import { providerDone, providerTextDelta } from "../provider-events.js";
import { createMemorySessionStore } from "../session-stores.js";
import { SLOT_NAMES } from "../slots/index.js";
import { createScriptedHostUi } from "./host-ui.js";

export type PackageConformanceCheckName =
  | "setup_dispose_idempotent"
  | "no_leaks_after_dispose"
  | "config_schema_valid"
  | "capabilities_cover_usage"
  | "no_secret_in_inspect"
  | "unavailable_fails_closed";

export interface ConformanceCheck {
  readonly name: PackageConformanceCheckName;
  readonly ok: boolean;
  /** Present when `ok` is false. Names the rule, never a secret value. */
  readonly message?: string;
}

export interface PackageConformanceOptions {
  /** Instance config for the definition under test. Validated against the definition's schema. */
  readonly config?: Readonly<Record<string, unknown>>;
  /** Drives the mock session. Defaults to one text turn on the built-in mock provider. */
  readonly mockProvider?: AIProvider;
}

export interface PackageConformanceResult {
  /** True only when every check passed. */
  readonly ok: boolean;
  readonly checks: readonly ConformanceCheck[];
}

const FAIL = (name: PackageConformanceCheckName, message: string): ConformanceCheck => ({ name, ok: false, message });
const PASS = (name: PackageConformanceCheckName): ConformanceCheck => ({ name, ok: true });

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asInstance(input: PackageInput, config: Readonly<Record<string, unknown>> | undefined): PackageInstance {
  if (typeof input === "function") return input(config as never);
  if (config !== undefined) return (input as { definition: PackageDefinition }).definition(config as never);
  return input;
}

/**
 * Re-defines the instance with a `setup` that sees a recording proxy of the real `PackageAPI`.
 * The proxy records every gated member the package touches (at setup time or later, through the
 * closure it kept) and forwards to the loader's implementation, so the kernel's own capability
 * enforcement still applies — the check never trusts what the package declares.
 */
function recordingInstance(instance: PackageInstance, used: Set<string>): PackageInstance {
  const source = instance.definition;
  const gated = <T extends object>(target: T, member: string, capability: string): T =>
    new Proxy(target, {
      get(target, prop) {
        if (prop === member) used.add(capability);
        return Reflect.get(target, prop);
      },
    });
  const recording = (prism: PackageAPI<any>): PackageAPI<any> =>
    new Proxy(prism, {
      get(target, prop) {
        if (prop === "models") return gated(target.models, "client", "models");
        if (prop === "credentials") return gated(target.credentials, "resolve", "credentials");
        if (prop === "state") return gated(target.state, "session", "session-state");
        if (prop === "host") return gated(target.host, "ui", "host-ui");
        if (prop === "slots") {
          return new Proxy(target.slots, {
            get(slots, slot) {
              if (typeof slot === "string" && (SLOT_NAMES as readonly string[]).includes(slot)) {
                return gated(Reflect.get(slots, slot), "provide", `slot:${slot}`);
              }
              return Reflect.get(slots, slot);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    });
  const wrapped = definePackage<any>({
    name: source.name,
    version: source.version,
    ...(source.description !== undefined ? { description: source.description } : {}),
    ...(source.requires !== undefined ? { requires: source.requires } : {}),
    ...(source.capabilities !== undefined ? { capabilities: [...source.capabilities] } : {}),
    ...(source.config !== undefined ? { config: source.config } : {}),
    setup: (prism) => source.setup(recording(prism)),
  });
  return wrapped(instance.config, { optional: instance.optional });
}

/** The `x-prism-secret` fields of a schema, as `[path, ref]` pairs. `ref` is the config value. */
function secretFields(schema: JsonSchema, config: unknown, prefix: string, out: { path: string; ref: unknown }[]): void {
  const properties = schema.properties;
  if (properties === undefined) return;
  const value = (config ?? {}) as Record<string, unknown>;
  for (const [key, property] of Object.entries(properties)) {
    const path = prefix === "" ? key : `${prefix}/${key}`;
    if (property["x-prism-secret"] === true) out.push({ path, ref: value?.[key] });
    if (property.type === "object" && property["x-prism-secret"] !== true) {
      secretFields(property, value?.[key], path, out);
    }
  }
}

/**
 * Sets a sentinel value for every unset `env:` ref a secret field names, so the run can prove the
 * value never surfaces. Returns what to restore. `keyring:` refs cannot be set here and are skipped.
 */
function setSentinels(refs: readonly { path: string; ref: unknown }[]): { names: string[]; restore: () => void } {
  const names: string[] = [];
  const restore: { name: string; had: boolean; previous: string | undefined }[] = [];
  for (const { ref } of refs) {
    if (typeof ref !== "string") continue;
    const match = SECRET_REF.exec(ref);
    if (match === null || !ref.startsWith("env:")) continue;
    const name = ref.slice("env:".length);
    names.push(name);
    if (!(name in process.env)) {
      restore.push({ name, had: false, previous: undefined });
      process.env[name] = `prism-conformance-secret-${Math.random().toString(36).slice(2)}`;
    }
  }
  return { names, restore: () => restore.forEach((entry) => delete process.env[entry.name]) };
}

/** Compareable form of an inspection: status-note timestamps are the only unstable field. */
function stable(inspection: AgentInspection): string {
  return JSON.stringify({ ...inspection, statusNotes: inspection.statusNotes.map(({ at, ...note }) => note) });
}

/** Contributions still owned by the package after `dispose()`, per inspect field. */
function leaksOf(inspection: AgentInspection, name: string): string[] {
  const leaks: string[] = [];
  for (const tool of inspection.tools) if (tool.package === name) leaks.push(`tool ${tool.name}`);
  for (const skill of inspection.skills) if (skill.package === name) leaks.push(`skill ${skill.name}`);
  for (const command of inspection.commands) if (command.package === name) leaks.push(`command ${command.name}`);
  for (const [hook, registrations] of Object.entries(inspection.hooks)) {
    for (const registration of registrations) if (registration.owner === name) leaks.push(`hook ${hook} (${registration.id})`);
  }
  for (const [slot, owner] of Object.entries(inspection.slots)) if (owner === name) leaks.push(`slot ${slot}`);
  // Services have no inspect surface; the loader deletes them on dispose (teardown scans services),
  // so a service leak is not observable here.
  return leaks;
}

export async function packageConformance(input: PackageInput, options: PackageConformanceOptions = {}): Promise<PackageConformanceResult> {
  const checks: ConformanceCheck[] = [];
  const instance = asInstance(input, options.config);
  const definition = instance.definition;
  const schema = definition.config;

  // --- config_schema_valid: supported subset, and the declared defaults validate against it.
  try {
    if (schema !== undefined) {
      assertJsonSchemaSupported(schema);
      const defaults = schemaDefaults(schema);
      const result = validateJsonSchema(schema, defaults);
      if (!result.ok) {
        checks.push(
          FAIL(
            "config_schema_valid",
            `schema defaults do not validate: ${result.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`,
          ),
        );
      } else {
        checks.push(PASS("config_schema_valid"));
      }
    } else {
      checks.push(PASS("config_schema_valid"));
    }
  } catch (error) {
    checks.push(FAIL("config_schema_valid", messageOf(error)));
  }

  // --- env sentinels for the secret check.
  const fields: { path: string; ref: unknown }[] = [];
  if (schema !== undefined) {
    const merged = { ...schemaDefaults(schema), ...(options.config as JsonObject | undefined) } as Record<string, unknown>;
    secretFields(schema, merged, "", fields);
  }
  const { names: secretNames, restore } = setSentinels(fields);

  const used = new Set<string>();
  const agentConfig = (host?: HostPort): AgentConfig => ({
    model: { provider: "mock", model: "conformance" },
    provider: options.mockProvider ?? createMockProvider([providerTextDelta("conformance"), providerDone()]),
    slots: { store: createMemorySessionStore() },
    ...(host ? { host } : {}),
    packages: [recordingInstance(instance, used)],
  });

  let inspectBefore: AgentInspection | undefined;
  let inspectAfter: AgentInspection | undefined;
  let loadError: unknown;
  let runError: unknown;
  const capabilities: readonly Capability[] = definition.capabilities ?? [];

  try {
    // --- load, dispose, load again, dispose twice.
    const first = await createAgent(agentConfig());
    const firstInspection = first.inspect();
    await first.dispose();
    const second = await createAgent(agentConfig());
    inspectBefore = second.inspect();
    // --- one mock session, so lazy gated members (a hook calling models.client mid-run) are seen.
    try {
      const session = await second.session({ id: "package-conformance", create: true });
      await session.run("conformance");
      await session.close();
    } catch (error) {
      runError = error;
    }
    await second.dispose();
    // ponytail: one macrotask before the leak scan, so a registration scheduled after teardown is seen.
    await new Promise((resolve) => setTimeout(resolve, 0));
    inspectAfter = second.inspect();
    await second.dispose();
    if (stable(firstInspection) !== stable(inspectBefore)) {
      checks.push(FAIL("setup_dispose_idempotent", "the two loads produced different inspect() snapshots"));
    } else {
      checks.push(PASS("setup_dispose_idempotent"));
    }
  } catch (error) {
    loadError = error;
    checks.push(FAIL("setup_dispose_idempotent", `load or dispose threw: ${messageOf(error)}`));
  }

  // --- capabilities_cover_usage: every gated member the recording proxy saw is declared, and the
  // kernel's own enforcement did not fire during load or the session run.
  const missing = [...used].filter((capability) => !capabilities.includes(capability as Capability));
  if (loadError instanceof PackageLoadError && loadError.code === "capability_missing") {
    checks.push(FAIL("capabilities_cover_usage", messageOf(loadError)));
  } else if (runError instanceof PackageLoadError && runError.code === "capability_missing") {
    checks.push(FAIL("capabilities_cover_usage", messageOf(runError)));
  } else if (missing.length > 0) {
    checks.push(FAIL("capabilities_cover_usage", `used ${missing.join(", ")} without declaring the capability`));
  } else {
    checks.push(PASS("capabilities_cover_usage"));
  }

  // --- no_leaks_after_dispose.
  if (inspectAfter === undefined) {
    checks.push(FAIL("no_leaks_after_dispose", "no inspection after dispose: the load failed"));
  } else {
    const leaks = leaksOf(inspectAfter, definition.name);
    checks.push(
      leaks.length === 0 ? PASS("no_leaks_after_dispose") : FAIL("no_leaks_after_dispose", `still registered: ${leaks.join(", ")}`),
    );
  }

  // --- no_secret_in_inspect: the env values behind every `env:` ref never appear in the snapshot.
  const values = secretNames.map((name) => process.env[name]).filter((value): value is string => value !== undefined);
  const snapshot = inspectBefore === undefined ? "" : JSON.stringify(inspectBefore);
  const leaked = values.filter((value) => value !== "" && snapshot.includes(value));
  checks.push(
    leaked.length === 0
      ? PASS("no_secret_in_inspect")
      : FAIL("no_secret_in_inspect", `${leaked.length} secret value(s) appear in inspect()`),
  );

  // --- unavailable_fails_closed: setup, the run, and every registered command also work against a
  // host that answers `unavailable` to everything. A named error (`code` present) is a package
  // failing closed; an untyped throw is the violation this check exists to catch — reading
  // `res.value` off an `unavailable` answer instead of branching on `status`.
  const scripted = createScriptedHostUi();
  try {
    const closed = await createAgent(agentConfig({ ui: scripted.ui }));
    const session = await closed.session({ id: "package-conformance-unavailable", create: true });
    await session.run("conformance");
    for (const command of closed.commands.list()) {
      try {
        await closed.commands.run(command.name, {});
      } catch (error) {
        // Conformance knows no valid args; a schema rejection is not the package misbehaving.
        if (error instanceof PackageLoadError && error.code === "command_args_invalid") continue;
        if (!(error instanceof Error) || !("code" in error)) throw error;
      }
    }
    await session.close();
    await closed.dispose();
    checks.push(PASS("unavailable_fails_closed"));
  } catch (error) {
    checks.push(FAIL("unavailable_fails_closed", `setup, a run, or a command did not fail closed on unavailable: ${messageOf(error)}`));
  }

  restore();
  return { ok: checks.every((check) => check.ok), checks };
}
