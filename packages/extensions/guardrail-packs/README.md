# @arnilo/prism-extensions/guardrail-packs

Built-in guardrail packs over tool calls, run input, model output, and tool results. Restrictive only: a pack narrows what the agent may do or removes content, never widens or adds anything.

## Install

```bash
prism add @arnilo/prism-extensions/guardrail-packs
```

```ts
import guardrailPacks from "@arnilo/prism-extensions/guardrail-packs";
import toolsCoding from "@arnilo/prism-tools/coding";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model,
  packages: [
    toolsCoding({ root }),
    guardrailPacks({
      packs: ["destructive-commands", "secrets-hygiene", { id: "coding-standard", options: { cwd: "/repo", roots: ["/repo"] } }],
    }),
  ],
});
```

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `packs` | `(string \| { id, version?, options?, rules? })[]` | `[]` | Built-in pack ids and/or inline pack definitions. At most 8. |
| `maxScanChars` | integer, 1,024–4,194,304 | `262144` | Characters a content rule scans per item (one run input, one assistant message, or one tool result). The rest passes through unscanned, and the record says `truncated: true`. |

An inline pack's `rules` are JSON-only: a `pattern` string (no `RegExp`, no `deny` predicate), a named `detector`, or a `judge` (content stages, see [Judge rules](#judge-rules)), an optional `stage`, a `tool`, an optional `argPath`, an `action`, and a `reason`. An unknown pack id, pack option, or detector, a duplicate rule id, an invalid pattern, or an action the stage does not allow fails `createAgent` with `GuardrailPackError` (`ERR_PRISM_GUARDRAIL_PACK`).

### Stages and actions

| `stage` | Hook | Actions | `deny` does |
| --- | --- | --- | --- |
| `tool_call` (default) | `tool.call` | `deny`, `tripwire`, `ask` | Refuses the call; the run goes on. |
| `input` | `run.input` | `deny`, `redact`, `flag` | At run start, fails the run before any provider call. On a steer, drops the steered message (`steer.rejected`); the run goes on. |
| `output` | `model.response` | `deny`, `redact`, `flag` | Fails the run. No assistant message is appended and `message.completed` is not emitted. |
| `tool_result` | `tool.result` | `deny`, `redact`, `flag` | Replaces the result with an error result (`code: "guardrail_denied"`, naming the rule); the run goes on. |

- `redact` replaces each match with `[redacted:<rule id>]` before the content goes on: before the store append, memory, compaction, the next provider turn, and other handlers on the same hook. On `output` it rewrites text blocks only; tool calls dispatch from what the provider returned.
- `flag` only records the decision.
- A content rule scans text blocks. A `tool_result` rule also scans the string values in the result's `value` (to depth 8), which is the same body the kernel's untrusted envelope is built from.
- Within one item, `deny` rules run first on the original text; then `flag` rules; then `redact` rules in order.
- `untrustedOnly: true` (tool results only) scans only results marked `metadata.trust: "untrusted_external"`, plus the tools named in `alsoScanTools` (at most 16).
- Content handlers register at `GUARDRAIL_CONTENT_PRIORITY` (10,000), and only for stages that some configured rule uses. They therefore run before every priority-0 handler on the same hook, whatever the listing order.

```jsonc
{ "packs": [
    { "id": "pii", "options": { "detectors": ["email", "payment-card"], "stages": ["output", "tool_result"], "action": "redact" } },
    "injection-markers",
    { "id": "house", "rules": [{ "id": "no-internal-hosts", "stage": "output", "pattern": "\\binternal\\.example\\.com\\b", "action": "redact", "reason": "internal hostname" }] } ] }
```

**Streaming caveat.** `message.delta` events reach subscribers while the provider streams, before `model.response` runs, and `limits.bufferOutput` releases them before that point too. An `output` `deny` or `redact` therefore protects the transcript, memory, and later turns, but cannot recall text a subscriber already received. A host that must not display unchecked text renders from `message.completed`, which carries the checked message and is not emitted on a deny.

**Pattern cost.** Built-in detectors use bounded quantifiers. On the development machine, a worst-case 256 KiB item takes under 5 ms per pack (`pii` 4.4 ms, `injection-markers` 3.6 ms, `output-secrets` 1.0 ms). The compiler does not analyze backtracking in inline patterns. It caps each pattern at 4 KiB and each item's scan at `maxScanChars`. The cost of a host pattern on large content is the host's responsibility.

### Judge rules

A content rule can ask a model one yes/no question about the item instead of matching a pattern:

```jsonc
{ "packs": [{ "id": "house", "rules": [
    { "id": "medical-advice", "stage": "output", "action": "flag",
      "judge": { "model": "typesafe/jev", "question": "Does the text give medical advice?", "threshold": 0.7 } } ] }] }
```

| `judge` field | Default | Meaning |
| --- | --- | --- |
| `model` | required | A model reference (`provider/model`), never a credential. |
| `question` | required | One yes/no question, at most 512 characters. |
| `threshold` | `0.5` | Decisions path only: "yes" is a probability at or above this, in (0, 1]. |
| `maxInputChars` | `8000` | Characters of the item sent (256–65,536). The rest is not judged, and the record says `truncated`. |
| `timeoutMs` | `10000` | Per call (100–120,000). |
| `onError` | `"deny"` | `"deny"` or `"allow"` on a timeout, a provider failure, or an unparsable answer. Either way the record names the error. |

- **Model path.** When the model declares `capabilities.decisions` (from its provider's model list), the rule asks through `prism.models.decisions(ref)`: one `noul` question, compared with `threshold`. Otherwise it asks through `prism.models.client(ref)` with structured output `{ answer: boolean }`: native on a model that declares `structuredOutput`, and the prompted instruction otherwise. The judge gets no tools and no session history.
- **Actions.** `deny` (default) or `flag`; a judge finds no span, so `redact` fails the load. A "yes" applies the action exactly as a pattern hit does on that stage.
- **Isolation.** The content is sent inside the kernel's untrusted envelope (`formatUntrustedToolText`) under a fixed instruction, and the question comes from config alone, so the judged text cannot change the question or close the envelope.
- **Order.** Pattern and detector rules run first. A pattern `deny` skips the judge. The judge sees the item after redaction, so a redacted span never reaches the judge model.
- **Records.** `metadata.judge` is `{ path: "decisions" | "structured", probability?, error? }`. A judge failure under `onError: "allow"` records `outcome: "allow"`. The model's raw answer and the content are never recorded.
- **Metering.** Every judge call passes the hook's session, so it is charged to the active run's token and cost limits, usage, and ledger (a `package_call` row). A structured-path call also runs `model.request` and `model.call`; a decisions-path call does not, because those hooks carry a provider request and a stream.

**Cost.** Pattern and detector rules make no model call. A judge rule makes at most one model call per item: per run input (and per steer), per assistant message, or per tool result it applies to. Identical content under the same rule in one run is answered once from a per-run cache (at most 256 entries per run, dropped when the run ends). Parallel tool results with the same body share one in-flight call. Each call is bounded by `maxInputChars` and `timeoutMs`. Nothing is judged by default.

### Built-in packs

| Id | Rules |
| --- | --- |
| `destructive-commands` | Refuses force pushes and recursive force deletes in a `shell` command. |
| `secrets-hygiene` | Refuses any tool argument that carries secret-shaped material, without echoing the value. |
| `coding-standard` | Refuses test rewrites and writes outside the configured roots. |
| `validation-respect` | Records a failed validation tool and refuses the next mutation until it passes again. |
| `pii` | Content. Email, phone, payment card (Luhn-checked), and national-id shapes (US SSN, UK NINO). One rule per detector and stage, named `<detector>-<stage>`. Options: `detectors` (default all), `stages` (default `["output", "tool_result"]`), `action` (default `redact`). |
| `output-secrets` | Content. The `secrets-hygiene` shapes in model output. Rule `no-secret-material-in-output`. Options: `stages` (default `["output"]`), `action` (default `redact`). |
| `injection-markers` | Content, tool results marked `untrusted_external` only. Detectors `instruction-override`, `role-spoofing`, and `exfiltration-link`, one rule each. Options: `detectors` (default all), `action` (default `flag`), and `tools` (at most 16 tools scanned whatever their trust marking; MCP results are not marked today). |

Detector names for inline rules: `email`, `phone`, `payment-card`, `national-id`, `secret`, `instruction-override`, `role-spoofing`, `exfiltration-link`.

### Measured detection

These are measured on the `@arnilo/prism-hosts/evals` injection suite with a scripted mock model (see [the evidence](../../../docs/_evidence/guardrails-2026-11.md)). The run has 4 benign pages and 14 attacks carried in an untrusted `web_fetch` result, 60 items in all. The counts are the pack *firing*, scored by `createGuardrailFlaggedScorer`. "Clean pages" excludes the one page that trips the pack when benign.

| Pack | Catch, in-sample attacks | Catch, held-out attacks | False positives |
| --- | --- | --- | --- |
| `injection-markers` | 12/12 (95% CI 0.76–1.00) | 12/30 (0.25–0.58) | 1 of 4 benign pages (a chat-transcript sample trips `role-spoofing`) |
| `pii` | not measured (no personal-data attacks in the suite) | — | 1 of 4 benign pages (a parcel tracking number read as a phone number) |

- **In-sample.** The four built-in attacks were in view while the detectors were written, so 12/12 does not generalize.
- **Held-out.** The ten held-out phrasings were written afterwards and not used for tuning. The pack catches a direct "disregard your prior instructions", chat-template frames, `assistant:` lines, and Markdown image beacons. It misses other paraphrases, French and German, letter-spaced text, an unprompted "SYSTEM NOTICE" banner, and a "copy the question into this link" request.
- **Flagging is not blocking.** At default actions the packs record an injection and do not stop it: attack success did not change between arms. Use `action: "deny"`, or act on the record in the host.
- **Not measured.** No live model, `output-secrets`, judge rules, or the `pii` catch rate. Four benign pages give a wide interval, so read 1/4 as "fires on ordinary pages", not as 25%.

## What it changes

Registers a `tool.call` decide handler when a tool-call rule is configured, a priority-0 `tool.result` observer when a pack has one (`validation-respect`), and one priority-10,000 transform on `run.input`, `model.response`, or `tool.result` per content stage in use, plus the `guardrail-packs.describe` service and the `guardrail-packs:describe` command. An `input` rule also observes `run.completed`, `run.failed`, and `run.suspended` to tell run-start input from a steer; a judge rule observes them to drop its per-run cache. A rule returns `{ deny }` (block, tripwire) or `{ ask }` (ask). An `ask` confirms through `host.ui` or suspends the run; the pack's state rides `state.session("packs")`, so an `ask` rule stays enforced after `session.resume`.

A rule that throws is a deny. A deny is scoped to the call, not the run. Refusal text names the rule as `pack:<pack>/<rule>` and is capped.

## Failure behavior

Packs never return `allow` to override another handler's deny. `secrets-hygiene` refusals never echo the matched value. An invalid pack configuration fails closed at setup, naming the pack.

Every fired content rule emits a `guardrail.decision` package event: `{ toolCallId?, toolName?, record }`. The record has `guardrail` (`pack:<pack>/<rule>`), `stage` (`input`, `output`, or `tool_output`), and `action`. `deny` records `block`; `redact` and `flag` record `allow`, so the timeline and the `guardrail_pack` scorer do not count them as denials. `metadata` is `{ pack, rule, version, outcome, count, truncated? }`. Records carry rule ids and match counts, never the matched text.

## Capabilities

`session-state`, plus `models` when a configured rule has `judge` (narrowed per instance with `capabilitiesFor`). A host or manifest that withholds `models` from an instance with a judge rule fails `createAgent` closed.

## Example

`examples/guardrail-content.ts` runs three network-free content demos: `pii` redacting an address in model output, `injection-markers` flagging an untrusted tool result, and the same pack denying it.

`examples/guardrail-packs.ts` runs four network-free demos: two built-in packs refusing a `shell` and a `write` call and naming the rule; the same trajectory graded 0 by `createGuardrailPackScorer()`; an inline `ask` rule suspending a durable run and dispatching on approval; and a secret-shaped argument refused without the token in the refusal.
