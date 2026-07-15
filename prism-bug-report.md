# Bug: revision turn crashes with `TypeError: message.content is not iterable` when a redactor is configured

**Package:** `@arnilo/prism`
**Version tested:** `0.0.3`
**Severity:** High — any agent using the generate→validate→revise loop with a secret redactor crashes on the first revision turn.

---

## Summary

When an agent is configured with **both** the generate→validate→revise loop (`generateValidateReviseLoop`) **and** a secret redactor (`createSecretRedactor(...)`), the first revision turn throws:

```
TypeError: message.content is not iterable
```

The crash happens **before** the provider stream starts, during provider-request assembly (`toOpenAIRequest`). It only triggers when the model's turn-1 output **fails validation** (so a repair/revision turn is actually entered). A model that returns valid output on turn 1 never exercises the revision path, so the bug stays hidden.

## Root cause

Three things combine. The first is the actual defect; the other two are what turn it into a hard crash.

### 1. The revision loop shares repair-message object identity between `history` and `nextInput`

`agent-loops.js` → `generateValidateReviseLoop`, revision block:

```js
const repairMessages = inputMessages(repair).map((m) => ({ ...m, id: randomId("msg") }));
for (const message of repairMessages) {
    ctx.history.push(message);        // ← same object goes into history
    await ctx.appendMessage(message);
}
nextInput = repairMessages;           // ← same array/objects reused as next input
```

On the next `ctx.assemble(nextInput)`, the default input builder flattens **both** `history` and `inputMessages(nextInput)` into `request.messages`. Because both reference the same objects, the request contains the same message identity twice (a diamond, not a cycle).

### 2. The redactor collapses repeated references to the literal string `"[Circular]"`

`redaction.js` → `redact`:

```js
const redact = (input, seen = new WeakSet()) => {
    if (typeof input === "string") return redactString(input);
    if (input === null || typeof input !== "object") return input;
    if (input instanceof Date || input instanceof RegExp) return input;
    if (ArrayBuffer.isView(input) || input instanceof ArrayBuffer) return input;
    if (seen.has(input)) return "[Circular]";   // ← fires on diamond refs too
    seen.add(input);
    ...
};
```

The `seen` WeakSet is shared across the whole redaction pass. The history copy of the repair message is cloned first (added to `seen`); the input copy — **same identity** — hits `seen.has(input)` and is replaced wholesale with the string `"[Circular]"`. The redactor cannot distinguish a true cycle from a diamond (shared reference), so a benign shared reference becomes a destructive replacement.

### 3. The OpenAI-compatible provider assumes every message is a well-formed object

`providers/openai-compatible.js` → `toOpenAIRequest`:

```js
const content = [];
for (const part of message.content) { ... }   // message === "[Circular]"
```

When `message` is the string `"[Circular]"`, `message.content` is `undefined` → `for...of undefined` → native `TypeError: message.content is not iterable`. (The `message.role === "assistant"` branch above would similarly crash on `message.content.filter(...)` for a malformed message.)

## Evidence

Diagnostic logging of `request.messages` on the crashing turn (revision turn) showed:

```
msg 0: system     array(1)       // system instructions
msg 1: user       array(1)       // original prompt
msg 2: assistant  array(N)       // turn-1 model output (text IR)
msg 3: user       array(1)       // repair message ("Fix these issues: ...") — from history
msg 4: "[Circular]"              // repair message — from input, CORRUPTED
```

`msg 4` should be the repair user message; instead it is the literal string `"[Circular]"`. The provider then crashes iterating its `.content`.

## Minimal reproduction

Any agent that (a) uses the revision loop, (b) has a redactor, and (c) gets turn-1 output that fails validation:

```js
import {
  createAgent,
  createAgentSession,
  createSecretRedactor,
  generateValidateReviseLoop,
  // ...provider, model, tools
} from "@arnilo/prism";

const agent = createAgent({
  name: "repro",
  provider,                         // any provider whose request builder iterates message.content
  model,
  tools,
  loop: generateValidateReviseLoop({ maxRevisions: 3 }),
  redactor: createSecretRedactor(["any-secret-value"]), // ← a redactor must be present
  validator: (text) => ({ ok: false, errors: ["fail"] }), // ← force turn-1 to fail → triggers revision
});

const session = createAgentSession(agent, /* ... */);
await session.run("produce some artifact");
// turn 1: model output fails validation
// turn 2 (revision): throws `TypeError: message.content is not iterable`
```

Notes:
- Remove the `redactor` → no crash (but no secret redaction).
- Make the validator pass on turn 1 → no crash (revision path never entered).
- Tested on Node 22 and Node 24; the bug is engine-independent (pure JS logic producing a native `TypeError`).

## Recommended fixes

### Fix A (required — resolves the crash)

Break the identity sharing in the revision loop. `agent-loops.js`:

```diff
- nextInput = repairMessages;
+ nextInput = repairMessages.map((m) => ({ ...m }));
```

History and input must not share message object identity. (Equivalently, push clones to history instead.)

### Fix B (recommended — removes a duplicate message in the request)

Even after Fix A, the repair message appears **twice** in the assembled request (once via `history`, once via `input`), so the model receives the revision instructions twice. Turn 1 does not have this problem because its input is pushed to history **after** `assemble`; the revision path pushes to history **before** assemble.

Pick one:
- **Mirror turn-1 ordering:** push repair messages to history *after* `assemble`/generate (verify this doesn't change `appendMessage` persistence expectations).
- **Deduplicate at assembly:** in `input.js` (`flattenInputGroups` / default input builder), drop `input` messages that are already the trailing entries of `history`.

The final request should contain the revision prompt exactly once, as the last user message.

### Fix C (defensive — redactor)

The WeakSet guard treats diamonds (shared references) as cycles and replaces them with a non-object string, which is destructive at any level where the caller expects structured data. At minimum, never replace a top-level element of the array being redacted with a string (skip or throw with context instead). A robust fix would distinguish cycles from diamonds (e.g. a clone that preserves sharing, or a path-aware guard).

### Fix D (defensive — provider)

`toOpenAIRequest` should validate message shape before iterating:

```js
if (!message || typeof message !== "object" || !Array.isArray(message.content)) {
  throw new Error(`Invalid message at index ${i}: expected object with array content, got ${typeof message}`);
}
```

A malformed message should produce a clear, attributable error rather than a cryptic `TypeError: message.content is not iterable`.

## Impact

- **Fix A alone** resolves the crash and unblocks agents that rely on the revision loop with a redactor.
- Fixes B/C/D are low-risk hardening that prevent recurrence with other callers, providers, or redactor configurations.

## Environment

- `@arnilo/prism` 0.0.3
- Node 22.x and 24.x
- Observed with an OpenAI-compatible provider; any provider whose request builder iterates `message.content` without a guard is affected.
