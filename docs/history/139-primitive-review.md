# Plan 139 Task 1 — OpenTUI primitives and TUI event contract

Date: 2026-09-29. Scope: review and throughput spike only; no production code changed. Reviewed installed `@opentui/core@0.5.12` declarations, [OpenTUI docs](https://opentui.com/docs/components/markdown), [plan 135 spike](135-opentui-spike.md), and current Prism Code TUI.

## Primitive decisions

| Primitive | 0.5.12 API / decision |
| --- | --- |
| `MarkdownRenderable` | `new MarkdownRenderable(renderer, { content: "", syntaxStyle, streaming: true, treeSitterClient? })`; update `content` with cumulative text, set `streaming = false` on message finish to finalize unstable trailing block. Fenced code gets an internal `CodeRenderable`; no separate fenced-code parser needed. `syntaxStyle` is **required** in installed types (current web docs describe it as optional). |
| `CodeRenderable` | `{ content, filetype, syntaxStyle, treeSitterClient?, streaming? }`; `highlightingDone` awaits async highlights; default tree-sitter client available through `getTreeSitterClient()`. `SyntaxStyle.fromStyles({ default: { fg: "#ddd" }, keyword: { fg: "#f90" } })`; destroy owned styles on teardown. Do not synchronously await highlighting on each token. |
| `DiffRenderable` | `{ diff: unifiedPatch, view: "unified" | "split", filetype?, syntaxStyle?, treeSitterClient?, showLineNumbers?, wrapMode? }`; choose unified for narrow cards and approval; split plus `syncScroll` optional later. `diff` expects unified patch text, not arbitrary tool JSON. |
| `TextareaRenderable` | `{ keyBindings: [{ name: "return", action: "submit" }, { name: "return", shift: true, action: "newline" }], keyAliasMap?, onSubmit }`; callback reads `textarea.plainText`; `handlePaste` handles paste to focused editor. Keyboard `KeyBinding` supports `ctrl`, `shift`, `meta`, `super` (not an `alt` field: use `meta` for Alt). Host listener must explicitly prevent propagation when routing overlay keys; a bare return from the listener does not consume the key. |
| `ScrollBoxRenderable` | `{ stickyScroll: true, stickyStart: "bottom", viewportCulling? }` and `scrollTop`/`scrollTo`; keep bottom pinned until user manually scrolls upward. Reuse existing stream root. |
| `SelectRenderable` | `{ options: [{ name, description, value }], selectedIndex?, keyBindings?, wrapSelection? }`; `ITEM_SELECTED` and `SELECTION_CHANGED` events, `selectCurrent()`/`moveUp()`/`moveDown()`. Existing picker has custom filtering and text rows; reuse for completion unless replacing those rows measurably simplifies it. |

Sources: `node_modules/@opentui/core/renderables/{Markdown,Code,Diff,Textarea,ScrollBox,Select}.d.ts`, `syntax-style.d.ts`, `lib/tree-sitter/{index,client}.d.ts`; OpenTUI upstream [markdown](https://github.com/anomalyco/opentui/blob/main/packages/web/src/content/docs/components/markdown.mdx), [diff](https://github.com/anomalyco/opentui/blob/main/packages/web/src/content/docs/components/diff.mdx), [keyboard](https://github.com/anomalyco/opentui/blob/main/packages/web/src/content/docs/core-concepts/keyboard.mdx). Installed declarations take precedence over moving upstream docs.

## Event contract and actual flow

`AgentSession.subscribe({ acrossRuns: true })` in `packages/prism-code/src/tui/index.ts:537-559` feeds `tuiReducer` (`reducer.ts:178-564`), then `MessageStreamComponent.appendOrUpdate`. `tool_execution_started.call.id` identifies a card; `tool_execution_finished.result.toolCallId` identifies its completion (not `runId`; no top-level `toolCallId`), with `result.error` on failed results and `metadata.durationMs` / `metadata.status`. `tool_execution_error.call.id` plus `error` and `metadata`, and `tool_execution_blocked.toolCallId` plus `reason`, are separate paths. See `src/contracts-protocol.ts:295-329,528-536` and `src/contracts-core/content.ts:84-110`. **Correction to plan Task 2:** current reducer already uses `event.result?.toolCallId ?? event.runId`; remove unsafe `runId` fallback rather than claiming it exclusively matches by run id. `result` is required by contract. Current subscription renders only `entries.at(-1)` after every event, so an earlier parallel tool card can remain visually running despite updated reducer state. Avoid rebuilding every card on each delta.

`message_delta.content` is a `ContentBlock`; text uses `{ type: "text", text }`, thinking uses `{ type: "thinking", text, signature? }` (`src/contracts-core/content.ts:33-70`). Reducer currently collapses thinking into a preview. `provider_turn_finished.usage?` is per-turn reported/estimated usage, while `agent_finished.usage?` is run aggregate (`src/contracts-protocol.ts:234-291`); do **not** sum both. `Usage` has optional input/output/total/cache-read/cache-write/cost/estimated fields (`src/contracts-core/content.ts:205-225`). `session.contextMeter()` already exposes latest reported/estimated input count, cap and ratio (`src/agent-session/session.ts:324-359`); use it rather than recomputing next-request estimate in footer. `compaction_finished` announces summary/count but no new usage total. Resume replay is through `packages/prism-code/src/tui/history.ts`, not the live subscription.

## Existing components and proposed inventory

| Existing | Today | Next task ownership |
| --- | --- | --- |
| `components/stream.ts` | `ScrollBoxRenderable` with keyed renderable map, plain text messages/tool rows/thinking; update path uses inconsistent `user:` vs new `You:` | Task 2 keyed changed-entry updates and sanitization; Task 3 markdown/tool/thinking composition |
| `components/input.ts` | `TextareaRenderable`, Enter submit, in-memory history | Task 4 newline/paste/history/completion |
| `components/picker.ts` | Custom filtered `BoxRenderable` + text options | Reuse as completion popup where possible; `Select` optional |
| `components/status.ts` | Repo/branch/model/effort/approval/MCP/OM + run total tokens | Task 5 meter |
| `components/approval.ts` | Text-only confirmation card | Task 3 unified diff preview |

Planned component names: `markdown-message`, `tool-card`, `diff-view`, `thinking-block`, `completion-popup`, `meter`. Names describe UI seams, **not** six mandatory new files: reuse stream/picker/status when a small change suffices. Keep `todo` and `secret-input` components already present. No generic gap belongs outside `packages/prism-code`; existing core contracts and OpenTUI primitives suffice. For Task 4 `@path`, attach at most 64 KiB using existing read limits after realpath containment within repo; large/unreadable files should remain references for model-side read, not bypass trust boundary.

## Host throughput spike

Host: Linux 7.2.7-1-cachyos x86_64, 16 logical CPUs, Bun 1.4.2, OpenTUI 0.5.12. `createTestRenderer({ width: 100, height: 35 })`, scrollbox 30 rows, one streaming markdown renderable with recurring TS fences, one focused textarea, `SyntaxStyle.fromStyles`. Keypress-to-paint = elapsed from `mockInput.pressKey("x")` through `await renderOnce()`; simulated focused input, **not** a physical terminal PTY or OS key event. One run each; p95 across 12 or 20 samples, not a statistically stable CI threshold.

| Scenario | Markdown deltas | Paint passes | Elapsed | Rendered deltas/s | Input p50 / p95 / max |
| --- | ---: | ---: | ---: | ---: | --- |
| Paced 16 ms/delta (~coding-agent 60/s) | 120 | 121 | 2,075.1 ms | 57.8 | 0.78 / 7.56 / 7.56 ms |
| Burst, flush every 25 deltas | 500 | 21 | 126.7 ms | 3,946 | 1.42 / 4.38 / 6.67 ms |

All 12/20 keypresses reached textarea, including during streaming; no observed input lag at 60 deltas/s. Plan 135's 17,145 events/s measured **plain text item append**, not streamed markdown updates; these are different workloads and should not be compared as a regression. Task 3 must rerun with real stream/card composition and highlight worker; Task 7 PTY p95 covers terminal behavior.

Reproduce paced scenario from repo root (`bun -e` with installed dependency):

```ts
import { MarkdownRenderable, ScrollBoxRenderable, SyntaxStyle, TextareaRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
const { renderer, mockInput, renderOnce } = await createTestRenderer({ width: 100, height: 35 });
const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: "#dddddd" }, keyword: { fg: "#ff9900" } });
const scroll = new ScrollBoxRenderable(renderer, { width: 100, height: 30, stickyScroll: true, stickyStart: "bottom" });
const md = new MarkdownRenderable(renderer, { content: "", syntaxStyle, streaming: true, width: 96 });
const editor = new TextareaRenderable(renderer, { width: 90, height: 3 });
renderer.root.add(scroll); scroll.add(md); renderer.root.add(editor); editor.focus();
const lag: number[] = [], start = performance.now();
for (let i = 0; i < 120; i++) {
  md.content += i % 20 === 0 ? `\n## Turn ${i}\n\n\`\`\`ts\nconst value = ${i};\n\`\`\`\n` : `chunk${i} `;
  if (i % 10 === 0) { const t = performance.now(); mockInput.pressKey("x"); await renderOnce(); lag.push(performance.now() - t); }
  else await renderOnce();
  await Bun.sleep(16);
}
md.streaming = false; await renderOnce();
lag.sort((a, b) => a - b);
console.log({ eventsPerSecond: 120_000 / (performance.now() - start), inputP95Ms: lag[Math.ceil(lag.length * .95) - 1], inputChars: editor.plainText.length });
renderer.destroy(); syntaxStyle.destroy();
```

For burst reproduction replace `120` with `500`, flush and keypress every 25th delta, remove `Bun.sleep(16)`, and keep final paint. Performance bottlenecks should be measured on **rendered** frames and input latency, not number of string concatenations.

## Security and binary packaging

Tool output, errors, diffs and untrusted tool metadata are **text**, never ANSI or markdown: strip/escape C0/C1 controls except safe newline/tab and complete CSI/OSC sequences before placing them in any `TextRenderable`/`DiffRenderable` or deriving a preview. An OSC title payload such as `\x1b]0;evil\x07` must render inert. Assistant message markdown is explicitly markdown only after control sanitization; do not parse tool output as markdown. Task 2 owns shared sanitizer and tests; Task 3 routes rich views through it. Bound output size before parsing a giant patch.

OpenTUI 0.5.12 ships default tree-sitter assets **only** for JS, TS, markdown, markdown_inline and Zig (`node_modules/@opentui/core/assets/*`; bundled asset imports in `chunk-bun-8f4q4e2m.js:8040-8201`). Other Task 3 languages (JSON, Python, Rust, Go, shell, YAML, TOML, diff) need separate grammars/queries or plain unhighlighted fallback; do not promise highlighting they cannot provide. For plan 140 Task 3 compiled binary, verify highlighted TS/JS and worker startup in a **compiled PTY** self-test; package the `.wasm`/`.scm` default assets through OpenTUI's file imports, and add literal asset imports for any extra grammars actually shipped. No general Prism-core parser abstraction or new dependency for this review.
