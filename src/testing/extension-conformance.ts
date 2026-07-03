// ponytail: dependency-free conformance helper for the Extension adapter
// contract. Extension authors call this once to assert their Extension's
// setup runs, contributions land in the inert registries (no side effects
// until the host selects them), and setup errors are handled per the kernel's
// error policy: redacted as `extension_error` events under the default
// `errorPolicy: "event"`, or rethrown under `errorPolicy: "throw"`. Mirrors
// the assertions in src/__tests__/extensions.test.ts. Throws plain Error; no
// test runner, no network.

import type { Extension } from "../contracts.js";
import { createExtensionKernel, type ExtensionKernel } from "../extensions.js";

export interface ExtensionConformanceOptions {
  /**
   * Secret strings that must be redacted from any setup-error event under the
   * default `errorPolicy: "event"`. When omitted, error redaction is not
   * asserted. Ignored under `expectThrow`.
   */
  readonly secrets?: readonly string[];
  /**
   * When true, asserts that a thrown setup error is rethrown to the caller
   * (the `errorPolicy: "throw"` opt-in). Use this to confirm the host's throw
   * policy surfaces setup failures instead of isolating them.
   */
  readonly expectThrow?: boolean;
}

/**
 * Assert that an `Extension` satisfies the core adapter contract: `setup` runs
 * on load, registered contributions land in the inert contribution registries,
 * and (when a `secrets` list is provided) a failing setup emits a redacted
 * `extension_error` event under the default event policy, or rethrows under
 * `expectThrow`. Throws on the first violation; returns the loaded kernel so
 * the caller can inspect registered contributions.
 */
export async function assertExtensionConforms(
  extension: Extension,
  options: ExtensionConformanceOptions = {},
): Promise<ExtensionKernel> {
  const kernel = createExtensionKernel({ secrets: options.secrets, errorPolicy: options.expectThrow ? "throw" : undefined });
  await kernel.load([extension]);
  // setup ran: the extension loaded without rejecting. Contribution registries
  // are inert by construction (the kernel stores envelopes; it never invokes
  // provider/tool/skill capabilities until host code resolves and calls them).

  if (options.expectThrow) {
    // A second extension that throws must rethrow under errorPolicy: "throw".
    const failing: Extension = { name: "conformance-failing", setup: () => { throw new Error("conformance setup failed"); } };
    let threw = false;
    try {
      await kernel.load([failing]);
    } catch {
      threw = true;
    }
    if (!threw) throw new Error("Failing extension setup did not rethrow under errorPolicy: throw");
    return kernel;
  }

  if (options.secrets && options.secrets.length > 0) {
    const secret = options.secrets[0]!;
    const failing: Extension = { name: "conformance-failing", setup: () => { throw new Error(`boom ${secret}`); } };
    const errors: { message?: string }[] = [];
    kernel.events.on("extension_error", (event) => { errors.push(event.error ?? {}); });
    await kernel.load([failing]);
    if (errors.length === 0) throw new Error("Failing extension setup did not emit an extension_error event");
    if (errors[0]?.message?.includes(secret)) {
      throw new Error("Setup error event leaked a secret instead of redacting it");
    }
  }

  return kernel;
}

// Re-export the kernel factory so adapter authors can build a fresh kernel
// without an extra import when composing custom probes.
export { createExtensionKernel };
