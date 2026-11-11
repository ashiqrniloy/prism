import type { ModelProvider } from "@arnilo/prism";
import { runProviderLiveScenarios } from "@arnilo/prism/testing";

import { createOpenAICodexProvider } from "../index.js";

/**
 * The grant lives in the keyring, not in an environment variable, so this suite is the one provider
 * suite that opens a store instead of reading a secret ref the kernel can resolve. It runs only when
 * a sign-in has happened (or a record was imported) AND the opt-in flags are set; otherwise it skips
 * with the reason.
 */
const CREDENTIAL = process.env.PRISM_LIVE_OPENAI_CODEX_CREDENTIAL ?? "keyring:openai-codex";
const MODEL = process.env.PRISM_LIVE_OPENAI_CODEX_MODEL ?? "gpt-6.1-sol";

let grant: string | undefined;

async function keyringRecord(): Promise<string | false> {
  // Opt-in first: a skipped suite never touches the OS keychain (CI runners have no usable backend).
  if (process.env.PRISM_LIVE_PROVIDER_TESTS !== "1") return "set PRISM_LIVE_PROVIDER_TESTS=1 to run provider live tests";
  const keyring = await import("@arnilo/prism-extensions/keyring").catch(() => undefined);
  if (!keyring) return "install @arnilo/prism-extensions/keyring to read the grant";
  if (typeof keyring.createKeychainCredentialStore !== "function") return "the keyring package has no OS backend";
  const probe = await keyring.probeKeychainAvailability({ service: keyring.KEYRING_DEFAULT_SERVICE }).catch(() => undefined);
  if (probe?.status !== "available") return `OS keyring unavailable: ${probe?.message ?? "probe failed"}`;
  const resolver = keyring.createKeyringCredentialResolver({
    store: keyring.createKeychainCredentialStore({ service: keyring.KEYRING_DEFAULT_SERVICE }),
  });
  let secret: Awaited<ReturnType<typeof resolver.resolve>>;
  try {
    secret = await resolver.resolve(CREDENTIAL, {});
  } catch (error) {
    return `OS keyring read failed: ${error instanceof Error ? error.name : "unknown error"}`;
  }
  if (secret === undefined || secret.value === "") return `sign in with ChatGPT first: no credential at ${CREDENTIAL}`;
  grant = secret.value;
  return false;
}

const recordMissing = await keyringRecord();

runProviderLiveScenarios({
  provider: async (opts): Promise<ModelProvider> => {
    const keyring = await import("@arnilo/prism-extensions/keyring");
    const resolver = keyring.createKeyringCredentialResolver({
      store: keyring.createKeychainCredentialStore({ service: keyring.KEYRING_DEFAULT_SERVICE }),
    });
    // A read-only slot: the suite never rotates the owner's grant, so a refresh inside the margin
    // would serve this process only.
    const readGrant = async () => (await resolver.resolve(CREDENTIAL, {}))?.value ?? "";
    return createOpenAICodexProvider({ apiKey: readGrant, fetch: opts?.fetch });
  },
  routes: {
    responses: {
      model: MODEL,
      structuredOutput: "json_schema",
      // The shared default prefix is ~700 tokens, under this route's cache minimum; the probe below
      // is the ~7 KB prefix the plan-204 measurements reused 0.921 and 0.913 of.
      cachePrefix: Array.from(
        { length: 90 },
        (_, i) => `Line ${i + 1}: the prism wire probe keeps this prefix byte-identical across turns so the prompt cache can match it.`,
      ).join("\n"),
    },
  },
  // The grant is injected by the factory above; the leak scan still runs against it.
  secrets: grant ? [grant] : [],
  skipUnless: () => recordMissing,
  title: "@arnilo/prism-ai/openai-codex live tests",
});
