import { createRequire } from "node:module";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { SecretRedactor } from "@arnilo/prism";
import { AiSdkProviderError } from "./errors.js";

export const SUPPORTED_AI_SDK_VERSION_MATRIX = [
  { providerVersion: "4.0.3", specificationVersion: "v4" },
  { providerVersion: "4.0.4", specificationVersion: "v4" },
  { providerVersion: "4.0.10", specificationVersion: "v4" },
  { providerVersion: "4.0.13", specificationVersion: "v4" },
] as const;

export const SUPPORTED_AI_SDK_SPECIFICATION = "v4" as const;

export interface AiSdkProviderOptions {
  /** Host-owned AI SDK language model implementing the pinned v4 ABI. */
  readonly model: LanguageModelV4;
  /** Redacts direct provider errors; agent runs apply their own active redactor. */
  readonly redactor?: SecretRedactor;
  /** Prism provider id. Defaults to `ai-sdk` or `ai-sdk:<model.provider>`. */
  readonly id?: string;
}

export function assertSupportedAiSdkVersion(version: string): void {
  if (SUPPORTED_AI_SDK_VERSION_MATRIX.some((entry) => entry.providerVersion === version)) return;
  throw new AiSdkProviderError(
    "unsupported_version",
    `Unsupported @ai-sdk/provider version "${version}"; supported versions: ${SUPPORTED_AI_SDK_VERSION_MATRIX.map((entry) => entry.providerVersion).join(", ")}`,
  );
}

let cachedInstalledVersion: string | undefined;

/**
 * Resolve the installed `@ai-sdk/provider` version. The optional peer is read lazily at factory and
 * setup time through `createRequire`, so importing this module never activates an adapter and never
 * fails when the peer is absent; the absence surfaces as a typed `unsupported_version` error.
 */
export function readInstalledAiSdkVersion(): string {
  if (cachedInstalledVersion === undefined) {
    try {
      const pkg = createRequire(import.meta.url)("@ai-sdk/provider/package.json") as { version?: unknown };
      if (typeof pkg.version !== "string") {
        throw new AiSdkProviderError("unsupported_version", "Could not determine installed @ai-sdk/provider version");
      }
      cachedInstalledVersion = pkg.version;
    } catch (error) {
      if (error instanceof AiSdkProviderError) throw error;
      throw new AiSdkProviderError(
        "unsupported_version",
        "@ai-sdk/provider is an optional peer of @arnilo/prism-provider-ai-sdk; install it to use createAiSdkProvider()",
        { cause: error },
      );
    }
  }
  return cachedInstalledVersion;
}

/** A non-throwing reading of the optional peer: `missing` (not installed) or `unsupported` (unlisted version). */
export type AiSdkPeerProbe =
  | { readonly ok: true; readonly version: string }
  | { readonly ok: false; readonly reason: "missing" | "unsupported"; readonly version?: string };

/**
 * Setup-time peer probe. The package records a status note and registers nothing when this fails
 * (roadmap §2.6: a package that cannot operate must not throw at setup), while
 * {@link assertSupportedAiSdkVersion} still fails closed for a direct factory call.
 */
export function probeAiSdkPeer(readVersion: () => string = readInstalledAiSdkVersion): AiSdkPeerProbe {
  let version: string;
  try {
    version = readVersion();
  } catch {
    return { ok: false, reason: "missing" };
  }
  return SUPPORTED_AI_SDK_VERSION_MATRIX.some((entry) => entry.providerVersion === version)
    ? { ok: true, version }
    : { ok: false, reason: "unsupported", version };
}
