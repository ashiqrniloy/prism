# Prism defect report / architectural change request: provider-mandatory wire requirements must be enforced by Prism, not opted-in by hosts

**Reporter:** Clay project
**Affected versions:** `@arnilo/prism` 0.5.0, `@arnilo/prism-providers` 0.5.0, `@arnilo/prism-memory` 0.5.0
**Scope:** provider request construction (agent-session policy chain, provider-owned header mapping, OM worker loop, LLM compaction strategy) and the host-contract wording in `docs/provider-packages.md`
**Reference docs:** `docs/provider-packages.md`, `docs/providers/opencode-go.md`, `docs/_evidence/phase37-provider-matrix.md`
**Companion reports:** `2026-09-05-prism-thinking-level-gaps-report.md` (same failure class: contract knowledge that only the provider owns, discovered by hosts through live wire errors)

## Summary

The architectural contract — *"Hosts decide which credential resolvers, env objects, OAuth stores, request policies, and prompt contributions become active"* (`docs/provider-packages.md:104`) — presumes hosts know each provider's wire-protocol mandates. They do not, and structurally cannot. Concrete failure found in Clay on 2026-09-07: the OpenCode Go gateway **hard-rejects every request that lacks `x-opencode-session`** with a 400, Prism's adapter maps that header from `ProviderRequestOptions.sessionId ?? cacheKey`, and **nothing in Prism populates those options deterministically** — doing so requires the host to discover an internal helper (`createSessionCachePolicy`) and wire it into every agent config. The header's existence is only discoverable from Prism's provider source/docs; its *mandatory* nature is only discoverable from a live 400.

The defect is not one missing header. It is that **provider-mandatory wire structures are enforced nowhere**: not at package declaration, not at request build, not at error enrichment. This report requests a change of architectural intent: **where a provider's protocol makes a structure mandatory, Prism enforces it deterministically for all hosts and all call sites; host request policies are demoted to optional behavior (cache retention hints, extra headers, structured-output hints) that is never required for request success.**

---

## Live evidence (Clay host, 2026-09-07)

Provider: `opencode-go`, model `deepseek-v4-flash` (OpenAI route), Clay daemon 0.5.0-pinned. First user prompt after provider setup:

```
OpenCode Go request failed: 400 {"type":"error","error":{"type":"MissingSessionID",
"message":"Error from provider (Console Go): Request is missing x-opencode-session and
cannot be routed efficiently. Please see https://opencode.ai/docs/go/#where-can-i-use-it"}}
```

Request-path walk (shipped 0.5.0 code):

1. Adapter maps the header only from request options: `opencodeSessionId()` reads `options?.cacheKey ?? options?.sessionId`, `opencodeOwnedHeaders()` emits `x-opencode-session` only when that resolves (`prism-providers/src/opencode-go/cache.ts:9-29`, applied at `provider.ts:44`).
2. No Prism layer populates those options by default. The agent session applies only host-registered policies — `const policies = [...policyList(this.agent.config.providerRequestPolicies), ...policyList(options.providerRequestPolicies)]` — and returns the request untouched when that list is empty (`prism/dist/agent-session/session.js:372-376`).
3. The opencode-go provider package registers provider + models + auth method but **no request policy** (`prism-providers/src/opencode-go/index.ts:19-24`), even though Prism's own package skeleton shows packages declaring `api.registerProviderRequestPolicy(createSessionCachePolicy(...))` in `setup()` (`docs/provider-packages.md:300-317`).
4. Net: `options.sessionId` is `undefined` → header omitted → upstream 400 on every request. A host following the documented contract has no failure signal until users hit live provider errors.

---

## Defect 1 — Provider-mandatory wire fields are host-opt-in (architectural)

Prism's stated value proposition to hosts is exactly this delegation: hosts pick providers and models; Prism owns vendor wire knowledge ("Core does not branch on provider names"; adapters decide "how to map those options to provider payloads", `docs/provider-packages.md:104`). Yet the mandatory-session-id requirement is:

- **invisible at selection time** — the package manifest, model catalog (`ModelConfig`), and `registerAuthMethod` all carry nothing about it;
- **documented as a mapping, not a mandate** — `docs/providers/opencode-go.md:51-52,72` says `cacheKey ?? sessionId` *maps to* the header, never that the gateway rejects requests without it;
- **enforceable only by host opt-in** — `createSessionCachePolicy` (`prism/dist/provider-request-policy.js:18-31`) exists precisely to inject `sessionId`/`cacheKey`, but activating it is host policy configuration.

Clay ships 0.5.0 pins across seven Prism families precisely because we delegate this class of knowledge to Prism. A host integrating N providers would need to read each adapter's source (or eat live 400s) to learn which optional policies are actually mandatory. That scales linearly with Prism's provider count (18 first-party adapters) and breaks silently on every new provider with a new mandate.

**Requested change:** provider packages declare their mandatory wire requirements, and Prism enforces them deterministically. Concretely (mechanisms in the "Requested architectural change" section below): the kernel/session layer always supplies a stable correlation id in `ProviderRequestOptions.sessionId`, and adapters that mandate one map it; adapters that mandate nothing ignore it. No host action, ever, for request success.

## Defect 2 — Host-side enforcement is structurally incomplete even when the host knows

Suppose a perfectly diligent host reads the source and wires `providerRequestPolicies: createSessionCachePolicy()` into every `AgentConfig` (Clay did — `clay-agent/src/host.ts`, both `createAgent` sites, plus the branch-summary worker agent). It still cannot cover Prism's own internal provider call sites:

- **Observational-memory workers** call `provider.generate` directly with only a thinking-level patch — no policy chain, no sessionId source, host-unreachable (`prism-memory/src/compaction/observational-memory/worker-loop.ts:52-63`). An opencode-go OM worker model 400s identically today; no host configuration can fix it.
- **LLM compaction** applies a *strategy-supplied* policy chain (`prism-memory/src/compaction/llm/strategy.ts:185-201`) — coverage depends on which strategy the host picked and whether the strategy plumbs the policy.

This is the decisive argument against "hosts decide" for mandates: the set of Prism-internal generate call sites is Prism's implementation detail, not part of any host contract. A requirement enforced only through host-visible configuration is unenforceable by construction. Deterministic enforcement must live inside Prism at the single choke point where session identity is known.

## Defect 3 — Failure mode is a fail-late opaque upstream 400

Nothing in the request path validates provider-mandatory fields before dispatch, and the adapter's error path surfaces the raw upstream body (`provider.ts` → `httpStatusError("OpenCode Go request failed", ...)`). The host cannot distinguish "provider contract violated by Prism wiring" from "model rejected the prompt". The 2026-09-05 thinking-level report established the cure for this class: declare provider-owned contract facts in data (there: `capabilities.thinkingLevels`), validate early, fail closed with a typed Prism error. Same medicine applies here: a declared mandatory-field set plus request-build validation turns an opaque 400 into `ERR_PRISM_PROVIDER_REQUIREMENT: opencode-go requires a session correlation id (missing options.sessionId)` at construction time.

---

## Requested architectural change

**Principle:** *Provider-mandatory wire requirements are provider-owned and enforced by Prism deterministically. Host request policies add optional behavior; they are never required for request success.*

**Mechanism (recommend a + b together):**

1. **Deterministic session correlation at the choke point.** The kernel/session layer always injects a stable correlation id into `ProviderRequestOptions.sessionId` (the kernel session id it already owns) for every provider request — agent sessions, OM workers, compaction summarizers. This stops being a policy; it is request construction. Adapters keep full control of the mapping (opencode-go → `x-opencode-session`; others ignore it). This single change fixes every current and future call site, including the ones hosts cannot reach.
2. **Declared mandates + fail-fast validation.** Provider packages declare mandatory request requirements (e.g. `requiresSessionCorrelation: true` on the package/model, or a `mandatoryRequestFields` manifest entry). The request-build path validates and throws a typed, redacted Prism error before dispatch instead of forwarding a doomed request. Hosts get a precise diagnostic at first use, not a user-visible 400 in a transcript.
3. **Package-declared policies auto-activate for their own providers** (aligned with the existing skeleton at `docs/provider-packages.md:300-317`): if a package declares a request policy in `setup()`, it is active for that package's providers without host registration. Host policies remain additive overrides for retention/hints. (Subsumed by 1 for session correlation, but keeps the skeleton honest for future optional policies.)

**Docs updates required with the change:** rewrite the `docs/provider-packages.md:104` "Hosts decide … request policies" sentence to the new contract; add a "mandatory wire fields" column to the provider matrix (`docs/_evidence/phase37-provider-matrix.md` already tracks `x-opencode-session` — promote it from a mapping note to a declared requirement); state in `docs/providers/opencode-go.md` that the gateway hard-rejects headerless requests.

**Migration/precedence note:** hosts that already register `createSessionCachePolicy` (Clay does) must keep working unchanged — specify whether an explicit host policy result overrides the deterministic injection or merges with it, and document it.

---

## Evidence index (shipped 0.5.0 code)

| Claim | Location |
|---|---|
| Header emitted only from `options.cacheKey ?? options.sessionId` | `prism-providers/src/opencode-go/cache.ts:9-29` |
| Owned headers applied after caller headers at dispatch | `prism-providers/src/opencode-go/provider.ts:40-50` |
| Package `setup()` registers provider/models/auth only — no policy | `prism-providers/src/opencode-go/index.ts:19-24` |
| Policy chain consumes host config + run options only; empty by default | `prism/dist/agent-session/session.js:372-376` |
| `createSessionCachePolicy` injects `sessionId`/`cacheKey`/retention | `prism/dist/provider-request-policy.js:18-31` |
| OM worker loop: raw `provider.generate`, no policy chain, no sessionId | `prism-memory/src/compaction/observational-memory/worker-loop.ts:52-63` |
| LLM compaction: strategy-supplied chain, host-dependent coverage | `prism-memory/src/compaction/llm/strategy.ts:185-201` |
| "Hosts decide … request policies" contract wording | `docs/provider-packages.md:104`, `:325-327` |
| Skeleton shows packages declaring the session policy (opencode-go does not) | `docs/provider-packages.md:300-317` |
| Mapping documented as mapping, never as gateway mandate | `docs/providers/opencode-go.md:51-52,72` |
| Matrix already tracks the header (mapping-level only) | `docs/_evidence/phase37-provider-matrix.md:91,175` |
| Live 400 payload (Clay, opencode-go + deepseek-v4-flash) | reproduced in "Live evidence" above |
| Clay stopgap (covers agent sessions only, not OM workers) | `clay-agent/src/host.ts` — `providerRequestPolicies: createSessionCachePolicy()` on both `createAgent` sites |

## Stopgap already shipped (not the fix)

Clay now injects `createSessionCachePolicy()` host-side, which unblocks OpenCode Go main sessions on 0.5.0. We flag explicitly that this is a workaround for the architectural gap, not a resolution: it covers agent-session requests only, it required reading Prism adapter source to discover, and it leaves OM workers and any future Prism-internal call site uncovered. We would rather delete the host-side policy than keep it.
