# Feature Request: Bounded Tool Calls in `generateValidateReviseLoop`

## Summary

Add opt-in, bounded tool-call dispatch to Prism's `generateValidateReviseLoop`, reusing the existing `LoopContext` dispatch, permission, validation, redaction, persistence, and event paths.

Proposed configuration:

```ts
await session.run(input, {
  maxToolRounds: 2,
  loop: {
    strategy: "generate-validate-revise",
    toolCalls: "bounded",
    parser,
    validator,
    repairer,
    maxRevisions: 2,
  },
});
```

`toolCalls` should default to `"disabled"` for backward compatibility. No new tool registry or dispatch API is requested.

## Environment Observed

- Package: `@arnilo/prism@0.0.5`
- Built-in strategy: `generateValidateReviseLoop`
- Existing bounded tool strategy: `singleShotLoop`

Prism's current agent-loop documentation explicitly states that tools in artifact revision turns are out of scope. Current implementation calls `ctx.generate(request)` but does not consume `ProviderTurnResult.calls`. If a provider returns a tool call, the loop joins text content, attempts to parse it, and commonly terminates on an empty/invalid artifact without dispatching the call.

At the same time, `LoopContext` already supplies everything needed:

- `maxToolRounds`;
- `toolConcurrency`;
- `dispatchToolCall(call)`;
- `isToolCallExclusive(call)`;
- `appendMessage(message)`;
- `emit(event)`;
- runtime-owned permission, validator, middleware, ledger, abort, and redaction behavior.

`singleShotLoop` already demonstrates the required dispatch path through `dispatchToolCallsInOrder`.

## Use Case

Artifact-authoring agents often need progressive disclosure before producing a final artifact. Examples include:

- reading one relevant schema/reference document;
- inspecting a bounded catalog surface;
- validating an intermediate assumption with a host-owned read-only tool;
- retrieving exact instructions only when needed rather than injecting every reference into every prompt.

Our immediate use case is a host-owned `read_authoring_reference` tool. References are boot-loaded, allowlisted, size-bounded, inert, and grant no permissions. We currently inject references through a lexical `ContextProvider` because the artifact loop advertises tool schemas but cannot execute calls. This workaround is functional but prevents model-directed progressive disclosure.

## Requested Semantics

When `toolCalls: "bounded"`:

1. Assemble and generate as today.
2. Persist the assistant message as today.
3. If the provider returned tool calls:
   - dispatch them through the existing `LoopContext.dispatchToolCall` path;
   - append tool-result transcript messages through the existing helper;
   - make those results visible to the next provider turn;
   - do **not** parse or validate that tool-calling response as the artifact;
   - continue generation until the provider returns a response with no tool calls.
4. Parse and validate only a call-free response.
5. On validation failure, run the existing repair flow. Tool calls must also work during a repair attempt.
6. Count `maxToolRounds` across the whole run, not once per revision attempt.
7. Tool rounds do not consume `maxRevisions`; only failed, parsed artifact attempts consume revision budget.
8. Keep dispatch sequential initially. Existing permission/validation/exclusive-tool behavior must remain authoritative.

This gives a predictable provider-turn ceiling:

```text
maximum provider turns = 1 + maxRevisions + maxToolRounds
```

## Limit Exhaustion

If a provider requests another tool after `maxToolRounds` is exhausted, fail closed:

- do not execute the extra call;
- emit a terminal artifact failure with a stable machine-readable reason such as `tool_round_limit`;
- preserve normal redaction and persistence behavior;
- return without an unbounded provider loop.

A concrete compatible failure shape could be:

```ts
{
  ok: false,
  errors: [{ message: "maximum tool rounds exceeded" }],
  metadata: { reason: "tool_round_limit" },
}
```

## Backward Compatibility

- Default `toolCalls: "disabled"` preserves `0.0.5` behavior and prevents previously inert tool schemas from unexpectedly executing.
- Runs with no tool calls retain current event ordering and revision behavior.
- `maxRevisions` keeps its current meaning and default.
- `RunOptions.maxToolRounds` remains the only tool-round bound.
- Hosts still explicitly register, filter, permit, and validate every tool. Skills and context never grant tool authority.

## Security Requirements

Every call must continue through existing Prism runtime guards:

1. active registry lookup and exact filtering;
2. permission policy;
3. object-argument and host validator checks;
4. middleware;
5. abort propagation;
6. secret redaction before events/store/ledger writes;
7. existing tool lifecycle events and `ToolCallRecord` persistence.

The artifact loop must not call `ToolDefinition.execute` directly, invent a second dispatcher, broaden the active registry, or treat tool output as trusted instructions.

## Acceptance Tests

1. **Initial lookup:** provider requests one tool, receives its result, then returns a valid artifact; tool executes once and validator runs once.
2. **Repair lookup:** first artifact fails validation, repair turn requests a tool, then returns a valid artifact; revision count is one, tool round count is one.
3. **Shared bound:** tool calls spread across initial and repair attempts cannot exceed run-level `maxToolRounds`.
4. **Turn ceiling:** total provider calls never exceed `1 + maxRevisions + maxToolRounds`.
5. **Limit failure:** an extra call after budget exhaustion is not executed and yields terminal `tool_round_limit` failure.
6. **Guard preservation:** denied, unknown, malformed, and validator-blocked calls use existing blocked results/events and never execute host code.
7. **Transcript correctness:** assistant tool-call and matching tool-result messages are persisted once and appear before the next provider response.
8. **Redaction:** tool arguments, errors, results, events, and ledger rows retain current redaction guarantees.
9. **Abort:** abort during dispatch or follow-up generation stops the loop without another provider call.
10. **Compatibility:** omitted/`"disabled"` mode and call-free runs preserve existing behavior and artifact event ordering.
11. **Initial-only mode:** `maxRevisions: 0` may still use bounded tool rounds before its single artifact candidate, without allowing a validation repair.

## Suggested Documentation Changes

Update:

- `docs/agent-loops.md` — option, budget semantics, provider-turn ceiling, event ordering;
- `docs/tools.md` — artifact-loop dispatch support;
- public `AgentLoopOptions` declarations;
- release notes for the version containing the change.

## Non-Goals

- Built-in application tools.
- Automatic tool discovery or activation.
- Per-tool retry policy.
- A second permission or validation system.
- Unbounded autonomous loops.
- Parallel artifact-loop tool execution in the first increment.
- Changing parser, validator, repairer, or structured-output contracts.
