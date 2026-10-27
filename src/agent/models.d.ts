/** `agent.models` (roadmap §2.3): list and resolve over the providers the agent can see. */
import type { ModelIndex, ModelSpec } from "../contracts.js";
import type { LoadedPackages } from "../packages/loader.js";
import type { SecretRedactor } from "../redaction.js";
export declare function createModelIndex(sources: {
    readonly configured: ModelSpec | undefined;
    readonly packages: () => LoadedPackages;
    readonly redactor: () => SecretRedactor | undefined;
}): ModelIndex;
