# Guardrails

## What it does

Guardrails are typed, fail-closed checks at input, completed provider output, tool input, and raw tool output boundaries. `session.run()` evaluates configured stages through one core runner; `dispatchToolCall()` uses same runner for direct, MCP-server, and workflow tool calls.

## When to use it

Use guardrails to block unsafe prompts, model responses, tool arguments, or tool results before their next boundary. Use a redactor for known secrets. Do not treat guardrails as a sandbox, secret detector, permission policy, or validation replacement.

## Inputs / request

```ts
import type { Guardrail, Guardrails } from "@arnilo/prism";

const pii: Guardrail<"input"> = {
  name: "pii",
  stage: "input",
  evaluate: ({ value }) => JSON.stringify(value).includes("SSN")
    ? { action: "tripwire", reason: "pii" }
    : { action: "allow" },
};

const guardrails: Guardrails = { input: [pii], maxConcurrency: 1 };
```

Set `AgentConfig.guardrails` for every session run or `RunOptions.guardrails` to append checks for one run. `DispatchToolCallOptions.guardrails`, workflow `RunWorkflowOptions.guardrails`, and MCP server `CreatePrismMcpServerOptions.guardrails` apply tool stages to direct calls. A stage has `Guardrail<"input" | "output" | "tool_input" | "tool_output">`, a name, optional revision, and `evaluate(context)` result.

`AgentSessionConfig.guardrailPacks` compiles declarative, restrictive-only rule sets onto the tool stages once per session (see [Guardrail packs](#guardrail-packs)). Session packs merge after `AgentConfig.guardrails` and before `RunOptions.guardrails`. Hosts that dispatch tools directly can compile the same config with `compileGuardrailPacks(refs)` and pass the result as `DispatchToolCallOptions.guardrails`.

Decisions are `allow`, `block`, `tripwire`, or `interrupt`. Evaluation defaults to declaration-order sequential. `maxConcurrency` may be 1–16; records are emitted in declaration order. Thrown or malformed decisions become a fail-closed tripwire. A throwing guardrail produces a `guardrail_failed` record whose `metadata.error` carries the underlying error message — redacted and bounded to 4 KiB — so failures stay diagnosable without leaking internals. Decision reasons are capped at 4 KiB and metadata at 16 KiB after JSON normalization and optional redaction.

## Outputs / response / events

Every evaluated guard produces a redacted `guardrail_decision` `AgentEvent` with a bounded `GuardrailRecord`. Optional OpenTelemetry instrumentation records only controlled stage/action on a short run-child span; guardrail name, reason, and metadata are excluded. An input or output terminal decision rejects the run with `GuardrailError`; `tripwire` stops remaining evaluation. A tool-input or tool-output `block` returns a redacted blocked `ToolResult`; a `tripwire` rejects the enclosing run. `interrupt` is reserved for durable runs: at the input stage of a fresh durable run it suspends the run for approval (persisted `input_guardrail` interruption); anywhere else it currently fails closed with `ERR_PRISM_GUARDRAIL_INTERRUPT_UNAVAILABLE`. Resuming a suspended durable run re-evaluates input guardrails on the stored input, and the resume decision itself counts as the approval: a repeated input-stage `interrupt` does not re-suspend or fail the resumed run, while `block`/`tripwire` still reject it.

Action outcome by stage:

| Stage | `block` | `tripwire` | `interrupt` |
| --- | --- | --- | --- |
| `input` | run rejected (`GuardrailError`); steered message: dropped + `steer_rejected`, run continues | run rejected; steered message: dropped + `steer_rejected`, run continues | fresh durable run: suspends for approval; otherwise fails closed |
| `output` | run rejected | run rejected | fails closed (`ERR_PRISM_GUARDRAIL_INTERRUPT_UNAVAILABLE`) |
| `tool_input` | blocked `ToolResult`, run continues | run rejected | fails closed |
| `tool_output` | blocked `ToolResult`, run continues | run rejected | fails closed |

The `GuardrailError` message names the stage so unsupported `interrupt` placements are diagnosable without reading core source.

Ordering is fixed:

1. input before session append, compaction, or provider work;
2. provider output is privately collected, then output checks run before any assistant message event or persistence;
3. tool input runs after tool-call middleware normalization and before lookup, permission, validation, execution policy, and side effect;
4. tool output runs after the side effect but before redaction, tool events, ledger rows, transcript append, or next turn.

With no output guardrails, provider streaming retains existing behavior. With output guardrails, message events are buffered until the completed provider turn is allowed.

## Request/response example

```json
{
  "event": {
    "type": "guardrail_decision",
    "record": { "guardrail": "pii", "stage": "input", "action": "tripwire", "reason": "pii" }
  }
}
```

## Implementation example

```ts
const agent = createAgent({ model, provider, guardrails: { input: [pii], output: [responseGuard] } });
await agent.createSession().run("Draft reply", { guardrails: { toolInput: [commandGuard] } });
```

## Guardrail packs

A pack is configuration, not code: rules compile once per session onto the existing `tool_input` / `tool_output` seams. Packs can only deny or tripwire — they never grant permissions, widen arguments, or add a stage. A rule that matches produces the standard refusal-shaped `ToolResult`; `tripwire` additionally rejects the enclosing run.

```ts
const session = agent.createSession({
  guardrailPacks: ["secrets-hygiene"],
  // or, with options / inline rules:
  guardrailPacks: [
    { id: "coding-standard", options: { cwd: "/repo", roots: ["/repo"] } },
    {
      id: "my-pack",
      version: 1,
      rules: [{ id: "no-etc", tool: "write", pattern: "^/etc/", reason: "system path" }],
    },
  ],
});
```

Built-in pack ids are public surface and versioned:

| Pack | Rules | Notes |
| --- | --- | --- |
| `coding-standard` | `no-unrelated-file-edits`, `no-test-rewrites` | Applies to `write`/`edit`/`delete`/`move`. `options.roots` defaults to `[process.cwd()]`; `options.cwd` is the resolution base. Containment is lexical — symlinks are not resolved, so an `ExecutionPolicy` remains the hard boundary. |
| `destructive-commands` | `no-recursive-force-delete`, `no-long-flag-force-delete`, `no-force-push` (includes `--force-with-lease`), `no-destructive-sql`, `no-device-overwrite` | Matched against the `shell` tool's `command` argument. |
| `validation-respect` | `no-mutation-after-failed-validation` | Observes `options.validationTools` (default `test`, `run_tests`, `validate`, `validation`, `lint`, `typecheck`, `check`). A result carrying an error or a non-zero `exitCode` marks validation failed; the next successful validation clears it. Opt `shell` in explicitly when validations run through the shell tool. |
| `secrets-hygiene` | `no-secret-material-in-arguments` | Scans argument strings (bounded depth and count) for credential shapes: `sk-`, `gh[pousr]_`, `AKIA…`, PEM private-key headers, JWTs, `xox[baprs]-`. Prism redaction replaces exact known values only, so these patterns ship with the pack. |

Inline rule shape: exactly one of `pattern` (string or `RegExp`, compiled once) or `deny(args, context)` (typed predicate, host-trusted like all host code); optional `tool` (name or names; omitted matches every tool), `argPath` (dot path or paths such as `command` or `["from", "to"]`; omitted scans every argument string), `action` (`deny` default, or `tripwire`), and `reason`. Predicates receive `{ toolName, toolCallId, sessionId, runId, metadata, state }`, where `state` is pack-local and read-only. `action: "ask"` is rejected: the tool stage has no deterministic approval seam.

Every evaluated rule emits a `guardrail_decision` event; the denying record's `guardrail` is `pack:<pack>/<rule>` and its `metadata` is `{ pack, rule, version }` — never tool arguments. `describeGuardrailPacks(refs)` returns the same identity rows (`pack:<pack>/<rule>`, stage, `pack@version`) that `snapshotRunBundle()` reports for the session config. Malformed config (unknown id, duplicate pack or rule id, both `pattern` and `deny`, invalid regex, `ask`) throws `GuardrailPackError` at session creation instead of silently dropping a rule.

On the observability timeline each guardrail step carries that identity in `metadata.guardrail` (with `status: "denied"` when it denied — the free-text reason stays off the step to keep metadata low-cardinality), so evals can grade enforcement without reading tool arguments: `createGuardrailPackScorer()` from `@arnilo/prism-core/governance/evals` scores a denied `pack:` rule as a failed trajectory and names it. The built-in packs are covered by violating/compliant scenario pairs in `packages/prism-core/src/governance/evals/__tests__/guardrail-pack-scenarios.test.ts` (see [Evaluations](evaluations.md#guardrail-pack-trajectory-scenarios-plan-092)).

## Claim grounding

`createClaimGroundingGuardrail(options: ClaimGroundingGuardrailOptions)` is a deterministic output guardrail for quantitative claims. It scans assistant text once, then attributes each number to a completed host tool result from **this run** or to a host-governed figure. It never calls a model, store, or network service.

```ts
import { createClaimGroundingGuardrail } from "@arnilo/prism";

const grounding = createClaimGroundingGuardrail({
  requireEvidenceForNumbers: true,
  evidenceSources: "tool_results", // default
  onViolation: "block", // default; "flag" records but permits output
});

const agent = createAgent({ model, provider, guardrails: { output: [grounding] } });
```

Numbers in an assistant text block pass when their exact numeric value occurs in a same-run successful tool result. The default is strict: `4,320.50` matches `4320.5`; `~4.3k` does not. Set `tolerance: "rounded"` to accept half the final printed unit, so `~4.3k` can match `4320.5`.

A host can supply governed figures without giving this package a storage dependency:

```ts
const grounding = createClaimGroundingGuardrail({
  requireEvidenceForNumbers: true,
  evidenceSources: ({ metadata }) =>
    metadata.metric === "revenue-q2" ? [{ value: 4320.5, ref: "metric:revenue-q2" }] : [],
});
// `Revenue is 999 [evidence:metric:revenue-q2]` cites that governed source.
```

An explicit citation is `[evidence:<ref>]`, immediately after its claim (within 96 characters). Tool-result refs are `tool:<toolCallId>`; extractor refs may contain only letters, digits, `.`, `_`, `:`, and `-` (1–128 chars). A citation must name an evidence ref the guardrail received; arbitrary labels do not pass.

With `onViolation: "block"`, the standard `GuardrailError` has `reason: "claim_ungrounded"` and bounded metadata `{ claim, contentIndex, start, end }` — never a full response body. `"flag"` returns `action: "allow"` plus that same metadata and `violation: true`, so the response stays visible while the normal `guardrail_decision` event and run ledger preserve the flag. Strict mode treats every standalone number (including dates, percentages, and versions) as a claim; use the option only where that law is wanted.

## Extension and configuration notes

Guardrails are callbacks supplied by the host. Prism does not discover, load, retry, or persist callback code. `createSecureAgent()` keeps configured guardrails and only appends run-level checks; it never lets a run remove secure defaults. Custom loops receive guarded `LoopContext.generate()` and `LoopContext.dispatchToolCall()`; host code that directly calls a provider or `ToolDefinition.execute()` is outside the runtime boundary. Guardrail packs follow the same rule: they are host-supplied config, compiled in memory per session, never discovered from disk or persisted by Prism.

## Security and performance notes

Optional `@arnilo/prism-core/governance/policy` can record guardrail outcomes via `recordGuardrailDecision` (evidence refs only; see [Policy and audit](policy-and-audit.md)).

Output buffering prevents blocked provider content from reaching subscribers, session entries, ledgers, parsers, delegation, or tools. Tool-output checks receive raw results but Prism discards blocked raw output before event, ledger, transcript, or MCP exposure. Redaction replaces exact known values only; it is not general secret detection. Guardrail-pack patterns compile once at session creation and argument scans are bounded (depth 8, 64 strings, 16 KiB per string), so rule cost stays off the provider path. Parallel checks receive an abort signal, but callback code must honor it to stop in-flight work. Browser snapshots and page text from the `browser` subpath are untrusted external content: never allow them to modify tools, permissions, credentials, or policy. Browser mutations still require host `ExecutionPolicy`/approval; prompt-injection text in a page cannot grant upload/download release.

## Related APIs

- [Policy and audit](policy-and-audit.md): optional attributable decision ledger for guardrail outcomes.
- [Agent/session runtime](agent-session-runtime.md)
- [Tools](tools.md)
- [Browser automation](browser-automation.md)
- [Agent events](agent-events.md)
- [Host security](host-security.md)
