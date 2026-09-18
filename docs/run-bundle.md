# Effective run bundle snapshots

`snapshotRunBundle()` answers one question for a host harness: *what exactly ran?* It projects the inputs a
run resolves to — prompt contributions, skills, tools, guardrails, loop, limits, model, storage kinds — into
frozen JSON with one stable digest, so a harness registry can pin the bundle it evaluated and diff a later run
against it. It is the inspectable half of the durable-run fingerprint: same inputs, named fields, one hash.

## What it does

- Reads only in-process configuration: `agent` (plus optional `AgentSessionConfig` and `RunOptions` overrides).
- Returns frozen JSON with `schemaVersion`, a `sha256:` `digest`, and the durable `fingerprint` it corresponds to.
- Never opens a socket, never reads a store, never resolves a credential, and never emits a store connection
  string — only its kind and durability.
- Never emits bodies: prompt and skill instructions are digests, tool parameters are digests.
- Is synchronous, in-memory, and O(contributions): a 100-tool agent snapshots in well under a millisecond.

`digest` is SHA-256 over the canonicalized, redacted snapshot (the `digest` field itself excluded), prefixed
`sha256:`. Tool parameter schemas go through `canonicalizeJsonSchema()` first, so key order and `required`
ordering cannot fake a change. Identical configuration produces an identical digest; any listed contribution
change — a tool, a schema, a skill body, a guardrail revision, a limit, `thinkingLevel`, the loop revision, a
request policy, a store kind — produces a different one.

## When to use it

- Pin the bundle in a harness/eval registry next to the run or timeline id, then diff digests across releases.
- Explain a durable-resume failure: `fingerprint` is the value compare-and-set against stored run state, and
  the snapshot shows *which* field moved.
- Feed a release manifest or a support bundle: it is JSON, bounded (512 KiB), and secret-free by construction.

Do not use it as a substitute for `inspectHostComposition()` (that inspects a whole composition's readiness,
sandbox isolation, and credential references) or as a policy decision — it is a report, not a guard.

## Inputs

| Input | Purpose |
| --- | --- |
| `agent` | The agent to inspect; `agent.config` supplies tools, skills, guardrails, prompt, loop, limits, model. |
| `config` | Optional `AgentSessionConfig`: its `store` wins over `agent.config.store` for the reported session-store kind. |
| `run` | Optional `RunOptions`: run-level overrides (`limit`s, `thinkingLevel`, `systemPrompt`, `guardrails`, `loop`, `toolNames`, `attentionCompiler`, `providerRequestPolicies`, `runState.definitionRevision`, `effectStore`). |
| `memory` | Optional memory store instance. Only its kind and durability are read — never its contents. |

## Output

```ts
const bundle = snapshotRunBundle({ agent, run: { limits: { maxTurns: 12 }, toolNames: ["search"] } });

bundle.schemaVersion;                                      // 1
bundle.digest;                                             // "sha256:1ddd…" — pin this
bundle.fingerprint;                                        // agentFingerprint() for durable resume
bundle.agent;                                              // { id, definitionRevision }
bundle.systemPrompt;                                       // { disabled, instructionsDigest, contributions: [{ id, mode, source, digest }] }
bundle.skills;                                             // [{ name, instructionsDigest, toolNames }]
bundle.tools;                                              // [{ name, schemaDigest, exclusive, effect }] — run.toolNames already applied
bundle.guardrails;                                         // [{ name, stage, revision }]
bundle.loop;                                               // { strategy, revision }
bundle.limits;                                             // resolved ResolvedRunLimits
bundle.model;                                              // { provider, model }
bundle.storage;                                            // { sessionStore, checkpoints, effectStore, memory } → { kind, durable }
```

`tools` is the *effective* set: `RunOptions.toolNames` narrowing is applied, and an unknown name fails closed
exactly as it would during the run. `storage.*.kind` comes from the store's declared `kind` or constructor name
and is reduced to a plain token (`[a-z0-9_.-]`, ≤64 chars); anything URL-shaped is reported as `custom`, so a
connection string can never reach a pinned artifact.

## Example

```ts
import { createAgent, snapshotRunBundle } from "@arnilo/prism";

const agent = createAgent({ model: { provider: "anthropic", model: "claude-sonnet-4-5" }, /* … */ });
const bundle = snapshotRunBundle({ agent, run: { thinkingLevel: "high" } });

const pinned = bundle.digest; // store with the harness artifact
const next = snapshotRunBundle({ agent: changedAgent });
if (next.digest !== pinned) reportFields(next, pinned); // hosts diff by field, not by digest alone
```

## Redaction and limits

Every string field is passed through the host `SecretRedactor` (`RunOptions.redactor` ?? `AgentConfig.redactor`)
before hashing and before returning, so redaction is part of the pinned digest. The snapshot refuses to exceed
512 KiB — a bundle that large is a host wiring bug, not something to retain — and throws `TypeError` rather than
truncating. There is no network path, no store read, and no credential resolution in this function; a store that
throws on every method still snapshots fine.

## Related APIs

- [`agentFingerprint()`](durable-runs.md): the durable-resume identity this snapshot projects.
- [`inspectHostComposition()`](host-compositions.md): composition readiness, storage durability, sandbox isolation.
- [`ExecutionTimeline`](execution-timeline.md): what a run *did*; the snapshot is what it was *configured* with.
- [`RunRecord`](runs-and-usage.md): the ledger row a snapshotted run leaves behind.
