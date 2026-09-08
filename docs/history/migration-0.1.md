# Migration archive — 0.1.x releases

## 0.1.7 → 0.2.0 fail-closed runtime and sandbox security (plan 020)


Release **0.2.0** (plan 020) is the first cut of the 0.2.x review-remediation line: it closes the three security blockers found in the 2026-08-12 comprehensive review. The API surface is **additive-only** (plain compat gate at 0.2.0 shows zero removed/changed declarations; no `--allow-break`), but three behaviors are deliberately tightened for security, so untyped/legacy callers may now fail where 0.1.7 silently proceeded:

1. **Durable-resume decision validation (core).** `resumeAgentRun`/`resumeAgentRunStream` (and the lifecycle/resume-stream entrypoints behind them) now validate the resume payload **before any state claim, checkpoint write, or tool execution**. Unknown legacy decisions (anything other than `approve`/`deny`), malformed decision batches, oversized reasons/elicitation, and duplicate approval ids fail closed with a stable `AgentDecisionError` (`ERR_PRISM_DECISION_INVALID`/`ERR_PRISM_DECISION_LIMIT`/`ERR_PRISM_DECISION_DUPLICATE`), leave the checkpoint version untouched, and execute no tool. In 0.1.7 an unknown decision string (e.g. `"sideways"`) was accepted, the checkpoint was CAS-claimed to `running`, and the suspended tool executed. The HTTP server parser (`readAgentDecisions`) is unchanged — it remains defense in depth, not the security boundary.

   ```js
   // 0.2.0: fails closed, no side effect, version untouched
   try {
     await resumeAgentRun(agent, ref, { expectedVersion: v, decision: "sideways" }, opts);
   } catch (error) {
     error.code; // "ERR_PRISM_DECISION_INVALID"
   }
   ```

2. **Work-tool subprocess environments (`@arnilo/prism-work-tools`).** `createCliRunner` no longer inherits the full host `process.env`. The child environment is now: fixed base allow-list (`PATH`, `LANG`, `LC_ALL`, `TZ`; Windows adds `SYSTEMROOT`/`SystemRoot`/`TEMP`/`TMP`/`PATHEXT`/`COMSPEC`), then explicit validated `options.env`, then forced controls (`HOME` = `configDir`, `CLIMICROSOFT365_DISABLETELEMETRY=1`), then the late-bound per-identity token layer (`M365_ACCESSTOKEN`/`GOOGLE_ACCESS_TOKEN` style). Caps: 64 names / 64 KiB total (`ERR_PRISM_WORK_ENV`). `binary` and `configDir` must now be **absolute paths** (`path.isAbsolute`), and output capture is linear (single final `Buffer.concat`, capped at `maxStdoutBytes`/`maxStderrBytes`). In 0.1.7 the child inherited every ambient host variable.

3. **Explicit sandbox capabilities (`@arnilo/prism-coding-security`).** `SandboxAdapter` gains the optional `capabilities` field — `workspaceCoherent`/`filesystemIsolated`/`networkIsolated`/`processIsolated`/`privilegeIsolated`/`egressRestricted` (immutable booleans). Omission or malformed metadata resolves every isolation field `false` (fail-closed). `SandboxCodingComposition` now carries a resolved `capabilities` object; the old boolean `containmentClaim` is **deprecated** and is the conservative projection `workspaceCoherent && filesystemIsolated && networkIsolated && processIsolated`. Built-ins: Docker reports `filesystemIsolated: true`/`processIsolated: true`/`networkIsolated: true` only for `--network=none`/attested networks, `privilegeIsolated: false` by default; native sandbox reports `networkIsolated: true`/`egressRestricted: true` but **never** filesystem/process/privilege isolation. In 0.1.7 any `DisposableSandbox`-shaped adapter could make `containmentClaim` report `true` with no isolation-capability inspection; in 0.2.0 an un-attested adapter claims `workspaceCoherent` at most. Authorization should read the individual capabilities, never the deprecated boolean.

**Store compatibility:** 0.2.0 is store-compatible with 0.1.7 in both directions — no persisted-shape change, no migration step. Checkpoint, session-store, approval, and registry payloads are byte-identical; only the resume *input* validation is new.

**Rollout:** upgrade core first (resume validation applies immediately to all hosts), then `@arnilo/prism-work-tools` (pass absolute `binary`/`configDir` and any ambient keys your connector needs via `options.env` — the allow-list is deny-by-default by design), then `@arnilo/prism-coding-security` (capability-aware policy code; the deprecated `containmentClaim` keeps working with the stricter semantics).

**Rollback risk:** restoring 0.1.7 restores all three defects — rollback is **not** a mitigation. Hosts that must roll back should disable resume side effects and work-tool execution at their own boundary until they can return to 0.2.0.

## 0.1.4 → 0.1.5 deprecated-option removal (documented breaking cut)


Release **0.1.5** (plan 017) removes the deprecated compatibility surface that 0.1.x kept after 0.0.19: the inert provider timeout/retry knobs, the `maxToolRounds` run-option alias, the pre-0.0.19 observational-memory flat keys and worker aliases, the read-tool `autoResizeImages` flag, and the `INIT_PROVIDERS` constant. This is the **documented breaking cut** announced in the 0.1.4 migration section; every other 0.1.x release keeps the compat baseline green. Three roadmap labels from the original 0.1.5 task were corrected during planning and are honored here:

1. **`RunOptions.maxToolRounds`** (not `AgentConfig.maxToolRounds`) is the removed alias → use `RunOptions.limits.maxToolRounds`. `AgentConfig.limits.maxToolRounds` and `RunLimits.maxToolRounds` stay supported.
2. **`ReadToolOptions.autoResizeImages`** is the removed flag; `transformImage` is the supported replacement (the roadmap text had the direction reversed).
3. **`INIT_PROVIDERS`** is the removed constant; `listInitProviders()` is the supported replacement that remains (the roadmap said to remove `listInitProviders`).

### Removed symbols and replacements

| Removed | Replaced by | Fail-closed behavior |
| --- | --- | --- |
| `ProviderRequestOptions.timeoutMs` | `ProviderRequest.signal` / `RunOptions.signal` (host-side abort) | removed from the type; untyped callers are refused with a `TypeError` naming the replacement before any provider call |
| `ProviderRequestOptions.maxRetries` | `AgentConfig.retry` / `RunOptions.retry` | same |
| `ProviderRequestOptions.maxRetryDelayMs` | `AgentConfig.retry` / `RunOptions.retry` | same |
| `RunOptions.maxToolRounds` | `RunOptions.limits.maxToolRounds` | removed from the type; untyped `{ maxToolRounds }` run input is refused before the agent starts |
| `ObservationalMemorySettingsInput.observeAfterTokens` | `observation.messageTokens` | flat key removed from the type; settings-provider JSON or untyped overrides carrying it throw a `TypeError` naming the nested replacement before any worker/provider call, compaction, or session append |
| `ObservationalMemorySettingsInput.reflectAfterTokens` | `reflection.observationTokens` | same |
| `ObservationalMemorySettingsInput.compactAfterTokens` | `context.compactAfterTokens` | same |
| `ObservationalMemorySettingsInput.keepRecentEntries` | `context.recentMessages` | same |
| `ObservationalMemorySettingsInput.recentMessageMaxTokens` | `context.recentMessageMaxTokens` | same |
| `ObservationalMemorySettingsInput.observationsPoolMaxTokens` | `context.observationsPoolMaxTokens` | same |
| `ObservationalMemorySettingsInput.observationsPoolTargetTokens` | `context.observationsPoolTargetTokens` | same |
| `ObservationalMemorySettingsInput.workerModel` | `observation.model` / `reflection.model` / `dropper.model` | same |
| `ObservationalMemorySettingsInput.thinkingLevel` | `observation.thinkingLevel` / `reflection.thinkingLevel` / `dropper.thinkingLevel` | same |
| `ObservationalMemorySettingsInput.requireExplicitModel` | `observation.requireExplicitModel` / `reflection.requireExplicitModel` / `dropper.requireExplicitModel` | same |
| `CreateObservationalMemoryOptions.workerProvider` / `workerModel` | `observation.provider` / `observation.model` (and the `reflection` / `dropper` equivalents) | removed from the type; the factories throw synchronously naming the replacement |
| `ObservationalMemoryRuntimeOptions.workerProvider` / `workerModel` | `observation` / `reflection` / `dropper` worker configs | same |
| `ReadToolOptions.autoResizeImages` | `transformImage` | removed from the type; `createReadTool` throws naming `transformImage` before any path resolution or filesystem access |
| `INIT_PROVIDERS` (root export) | `listInitProviders()` | removed; init parsing, usage text, validation, and tests all use the function |

### Before / after

Provider knobs were inert in first-party providers (hosts were always expected to abort/retry at their own layer):

```ts
// 0.1.4
const session = await agent.createSession();
await session.run("Hi", {
  provider: { timeoutMs: 30_000, maxRetries: 3, maxRetryDelayMs: 250 },
});

// 0.1.5
const session = await agent.createSession();
await session.run("Hi", {
  retry: { maxAttempts: 3, baseDelayMs: 250 },
  signal: AbortSignal.timeout(30_000),
});
```

`maxToolRounds` moves into the limits group (the CLI flag `--max-tool-rounds` is unchanged and maps to the nested limit):

```ts
// 0.1.4
await session.run("Hi", { maxToolRounds: 2 });

// 0.1.5
await session.run("Hi", { limits: { maxToolRounds: 2 } });
```

Observational-memory settings and workers become nested-only (0.0.19 already introduced the nested groups; the flat keys were kept for pre-1.0 hosts):

```ts
// 0.1.4
createObservationalMemoryRuntime({
  session,
  appendEntry: (entry) => store.append(entry),
  workerProvider,
  sessionModel: agent.config.model,
  overrides: { observeAfterTokens: 1, thinkingLevel: "low" },
});

// 0.1.5
createObservationalMemoryRuntime({
  session,
  appendEntry: (entry) => store.append(entry),
  observation: { provider: workerProvider, model: { provider: "neuralwatt", model: "glm-5.2-fast" } },
  sessionModel: agent.config.model,
  overrides: { observation: { messageTokens: 1, thinkingLevel: "low" } },
});
```

The read tool keeps only the host-owned resize callback:

```ts
// 0.1.4
createReadTool(cwd, { autoResizeImages: true });

// 0.1.5
createReadTool(cwd, {
  transformImage: async ({ buffer, mimeType }) => resize(buffer, mimeType),
});
```

### Dynamic-config refusal behavior

Removed members are also removed from the runtime resolver paths, so **untyped** callers (plain JS, `as any`, settings-provider JSON, persisted run input) are caught before any side effect:

- Provider request knobs and `maxToolRounds`: refused at the top of the run entry point (`runInternal`) with a `TypeError` naming `RunOptions.limits.maxToolRounds` (or the abort/retry replacement) — before the agent starts, no tool/provider call happens.
- Observational-memory flat keys: `assertNoRemovedFlatKeys` runs before any worker/provider call, compaction, or session append; it names the first offending key and its nested replacement. The worker aliases are refused synchronously at both factory boundaries.
- `autoResizeImages`: refused at `createReadTool` construction, before path resolution or `access`/`statFile`/`readFile`.
- `INIT_PROVIDERS`: reads of the removed constant yield `undefined`; use `listInitProviders()`.

### Store compatibility

**Compatible — no persisted shape change.** None of the removals touch the session-store schema, run-state checkpoint shape, event schema, or default behavior: the removed options were inert aliases, and the nested replacements resolve to the same active values (e.g. `maxToolRounds` default 8 / hard cap 64 in `DEFAULT_RUN_LIMITS` / `HARD_RUN_LIMITS` are unchanged).

### Rollback

Restore the 0.1.4 manifests/tag (or revert this commit) — no data migration. Configs and code written against 0.1.5 nested forms also work on 0.1.4 (the nested members are not new in 0.1.5), but `@ts-expect-error`-free code must drop any removed-key usage first. Stores never change.

## 0.1.3 → 0.1.4 internal reorganization behind barrel re-exports (no migration)


Release **0.1.4** (plan 016) is an **internal file reorganization behind barrel re-exports**: the root `src/agents.ts` and `src/contracts.ts` god-modules were split by concern into sibling modules (`contracts-core` / `contracts-run-state` / `contracts-protocol` behind the `contracts.ts` barrel; `agent-session` / `agent-run-lifecycle` / `agent-approval` / `agent-tool-dispatch` / `agent-run-state` / `agent-loops` / `compaction` behind the `agents.ts` barrel). **Public declaration surface unchanged** — the root entry surface is byte-identical to 0.1.3 (zero added/removed/changed on the public entry; the only union-surface additions are 14 internal cross-module helper exports that are not consumer-importable, see `scripts/compat-baseline/arnilo__prism.txt`). The optional `@arnilo/prism-browser` package extends additively with Chrome DevTools Protocol capabilities (0.1.4): `browser_evaluate`, `browser_observe`, and the `block_urls`/`unblock_urls`/`throttle`/`emulate` act actions on Chromium hosts, plus raw `{ css }`/`{ xpath }` targets — new exports and two optional structural interface members only, zero removals. **Store compatibility: compatible** — no persisted shape, event schema, or default behavior changed (no runtime path changed; the split is declaration-level). no migration step; rollback = restore the 0.1.3 manifests/tag (stores never change). The next line, **0.1.5**, is the documented **breaking cut** (deprecated-option removal); its migration section will list the removed symbols (the public-but-unused export candidates from `scripts/dead-exports.mjs`).

Release **0.1.3** (plan 015) is the dead-code and deprecation hygiene patch on the frozen 0.1.x line: benchmark-runner consolidation (one parameterized `scripts/benchmark.mjs --scenario <name>` replaces the per-version runners; 16 orphaned `benchmark-0.0.{8..16}` runner/test files removed, all `benchmark-*.json` evidence kept), the 12 `docs/review-coverage-2026-07-*.md` evidence files archived to the tarball-excluded `docs/_evidence/`, a non-blocking unused-code sweep (`npm run sweep:unused`, always exits 0, report to `scripts/unused-sweep-report.txt`), and opt-in checkpoint persistence (`persistSessionState: true` on durable run/resume options persists the loaded-skill name catalog ≤64 names in the run-state checkpoint and restores it on resume — bodies re-resolve from the live registry; `createReadPathSetPersistence` in `@arnilo/prism-coding-agent` persists the read-before-write path set through the host `CheckpointStore`, ≤1024 paths, ownership-scoped). **Store compatibility: compatible** — the persisted run-state schema stays at version 1 (the optional `sessionState` field is absent by default, so 0.1.2 checkpoints parse unchanged and opt-out checkpoints are byte-identical); no upgrade or rollback step exists (rollback = restore the 0.1.2 manifests/tag; stores never change). Declaration surface is additive-only vs the frozen 0.1.x contract (`scripts/compat-baseline` regenerated at 0.1.3 with zero breaking deltas, enforced by `node scripts/release.mjs gate`). No breaking defaults.

## 0.1.0 → 0.1.1 post-release hardening (additive, no migration)


Release **0.1.1** (plan 013) is a hardening patch on the frozen 0.1.x line: five scoped fixes — build single-flight (`npm run clean` removed from `npm run build`, standalone), deterministic MCP SSE relay test (`relayStatelessBody` internal export in `@arnilo/prism-mcp`, not in the package entry surface), combined core + workspace coverage summary (`scripts/coverage-summary.mjs`), canonical manifest-count narrative (49 publishable manifests = root + 48 workspace packages), and ACP modes/config ownership-scoped persistence guidance (the agent never persists `modeId`/`configValues`; host stores MUST key by `sessions.ownership`). **Store compatibility: compatible** — no persisted shape, event schema, or default behavior changed; the 0.0.28 → 0.1.0 → 0.1.1 lines all stay on the same checksum-protected contract, so no upgrade or rollback step exists (rollback = restore the 0.1.0 manifests/tag; stores never change). Declaration surface is additive-only vs the frozen 0.1.x contract (`scripts/compat-baseline` regenerated at 0.1.1 with zero breaking deltas, enforced by `node scripts/release.mjs gate`). No breaking defaults.
