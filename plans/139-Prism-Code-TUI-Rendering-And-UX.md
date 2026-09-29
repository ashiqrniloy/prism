# Prism Code: TUI Correctness, Rendering, and Daily-Use UX

## Objectives

- Fix the P0 TUI correctness bugs:
  - tool cards stuck in "running";
  - only the newest entry re-rendering;
  - inconsistent role labels;
  - a noisy Obscura warning on every launch;
  - crash/signal handling that swallows errors.
- Deliver the P1 daily-use experience:
  - markdown and syntax highlighting;
  - diff views for edits (also in approval prompts);
  - visible thinking;
  - live token/context/cost meter;
  - multi-line input with paste handling, history, slash-command and `@file` completion;
  - utility commands and a `prism-code doctor` subcommand.
- Build on OpenTUI 0.5.12 renderables (`MarkdownRenderable`, `CodeRenderable`, `DiffRenderable`, `TextareaRenderable`, `ScrollBoxRenderable`, `SelectRenderable`) rather than custom drawing.

## Expected Outcome

- Parallel tool calls each finish in their own card with the correct status; errors are red, denials are marked, and output is expandable.
- Assistant replies render as streamed markdown with highlighted code blocks; thinking is shown collapsed and toggled with a key.
- `edit`/`write` tool cards and approval prompts show a unified diff.
- Input supports Shift+Enter/Alt+Enter newlines, large paste collapse (`[pasted 240 lines]`), Up/Down history, Tab completion for `/commands` and `@path` references.
- The footer shows context usage (`42k/200k`), session tokens, and cost when pricing is known, next to the existing repo/branch/model/effort/MCP information.
- `/clear`, `/exit`, `/tools`, `/export`, `/help` work; `prism-code doctor` prints a diagnostic report and exits non-zero on blocking problems.
- An uncaught error restores the terminal, prints the error with a hint, and exits non-zero.
- Docs updated: `docs/prism-code.md` (TUI section, keybindings, commands), `docs/index.md`.
- Depends on: plans 136–138 (commands `/logout`, `/skills`, `/mcp`, `/approval` and the model catalog limits used by the meter).

## Tasks

- [x] Task 1 (P0 prerequisite): Primitive review of OpenTUI renderables and the TUI event contract
  - Acceptance Criteria:
    - Functional: the record `docs/history/139-primitive-review.md` covers:
      - OpenTUI 0.5.12 renderables and their options (`Markdown` streaming mode, `Code` + `SyntaxStyle` + tree-sitter client, `Diff` unified/split, `Textarea` key bindings/`onSubmit`, `ScrollBox` sticky scroll, `Select`), with a small throughput spike: streamed markdown at coding-agent rates without input lag, measured like the plan 135 spike;
      - the agent event contract used by the reducer: `tool_execution_started`/`tool_execution_finished`/`tool_execution_error` (`src/contracts-protocol.ts:300-320`; the finish event carries `result.toolCallId`, not a tool-call id at the top level), thinking content deltas (`src/contracts-core/content.ts:69`), and usage events;
      - the existing prism-code components (`stream`, `input`, `picker`, `status`, `approval`).
    - Functional: decides whether any generic gap belongs outside prism-code (expected: none; if tree-sitter grammars need bundling for the plan 140 binary, record the approach).
    - Performance: the spike records rendered events/s and input latency on the host.
    - Code Quality: records the component inventory changes (new: `markdown-message`, `tool-card`, `diff-view`, `thinking-block`, `completion-popup`, `meter`).
    - Security: records that tool output/diff rendering treats content as text (no terminal escape passthrough: ANSI/OSC sequences from tool output are stripped or escaped).
  - Approach:
    - Documentation Reviewed:
      - `node_modules/@opentui/core/renderables/{Markdown,Code,Diff,Textarea,ScrollBox,Select}.d.ts` (0.5.12), OpenTUI README/opentui.com docs
      - `docs/history/135-opentui-spike.md`
    - Options Considered:
      - Hand-rolled markdown→ANSI. Rejected: OpenTUI ships a streaming `MarkdownRenderable`.
    - Chosen Approach: primitive-first review plus a throughput spike before UI work. Completed 2026-09-29 in `docs/history/139-primitive-review.md`: 120 paced markdown deltas at 57.8/s (input p95 7.56 ms), 500-delta burst at 3,946/s (input p95 4.38 ms); no lag observed in test renderer. No generic code change needed outside prism-code. OpenTUI only bundles JS/TS/markdown/Zig tree-sitter assets; Task 3 must address other grammars or fallback, and plan 140 binary tests must check compiled worker/assets.
    - API Notes and Examples:
      ```ts
      import { MarkdownRenderable, SyntaxStyle } from "@opentui/core";
      const md = new MarkdownRenderable(renderer, { content: "", syntaxStyle, streaming: true });
      md.content += delta; // trailing block stays unstable while streaming
      ```
    - Files to Create/Edit:
      - `docs/history/139-primitive-review.md`
    - References:
      - Analysis section 9 and P1 list
  - Test Cases to Write:
    - none — review/spike; measurements recorded.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — review only.
    - Docs pages to create/edit: `docs/history/139-primitive-review.md` (history archive).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2: Reducer and stream correctness, labels, and process robustness (P0)
  - Acceptance Criteria:
    - Functional: the reducer matches tool finishes by required `event.result.toolCallId` (remove the current `?? event.runId` fallback), errors by `event.call.id`, and sets status from the result (`error`, `denied` from approval refusals, else `success`).
    - Functional: the stream view re-renders every entry whose version changed (keyed by entry id with a version counter), not only the last entry (`tui/index.ts:308`), so parallel tool completions and earlier cards update.
    - Functional: role labels are consistent ("You", "Assistant", and a distinct style for system notes; no "Assistant:" prefix on system notes; no "You:"/"user:" flip on update).
    - Functional: web tools default to `off` when no Obscura binary is found, without a startup warning; resolution retains `unavailableReason` for `/tools` and `doctor` (Task 6). An explicit `web.mode: "obscura"` with a missing binary still warns.
    - Functional: `uncaughtException`/`unhandledRejection` handlers (`tui/index.ts:560`) destroy the renderer, print the error (message + stack when `PRISM_DEBUG=1`) to stderr, flush/persist the session, and exit 1. SIGTERM/SIGHUP abort the active run, persist, restore the terminal, and exit 143/129.
    - Performance: rendering stays O(changed entries) per frame; there is no full-list rebuild on each delta.
    - Code Quality: reducer state entries carry `id` and `version`; the stream component diffs by id; reducer unit tests cover every event type.
    - Security: tool output and assistant text are sanitized of terminal control sequences before rendering (strip C0/C1 controls except `\n`/`\t`, and OSC/CSI).
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-code/src/tui/{reducer,index}.ts`, `src/tui/components/stream.ts`, `src/contracts-protocol.ts:295-320`, `packages/prism-code/src/web.ts`
    - Options Considered:
      - Rebuild the whole stream on each change. Rejected: O(n) per delta at coding-agent rates.
    - Chosen Approach: completed 2026-09-29. Reducer records the id/version and changed-entry ids for each transcript mutation; subscription renders only those ids, and stream skips unchanged versions. Tool finishes match `result.toolCallId` (not `runId`), failures/denials are styled distinctly, all entry text is control-sanitized. Terminal teardown aborts and awaits the active run before closing the durable session; fatal paths report to stderr and exit nonzero. Implicit missing Obscura is silent, with `unavailableReason` retained for Task 6 diagnostics. No `/tools` or `doctor` surface yet: those are created in Task 6, which must display this reason.
    - API Notes and Examples:
      ```ts
      case "tool_execution_finished": {
        const id = event.result.toolCallId;
        return updateEntry(state, id, { status: event.result.isError ? "error" : "success", output: summarize(event.result) });
      }
      ```
    - Files to Create/Edit:
      - `packages/prism-code/src/tui/reducer.ts`, `src/tui/components/stream.ts`, `src/tui/index.ts`, `src/web.ts`
      - `packages/prism-code/src/tui/sanitize.ts`: new control-sequence stripper
      - `packages/prism-code/src/__tests__/{reducer,tui-stream,tui-process,web-wiki}.test.ts`
    - References:
      - Analysis section 9
  - Test Cases to Write:
    - Two parallel tool calls finishing out of order both end in the correct state.
    - A tool error renders as an error; an approval denial renders as denied.
    - Updating an earlier entry re-renders it (component test with a fake renderer).
    - Output containing `\x1b]0;evil\x07` renders inert.
    - Uncaught error: terminal restored, stderr contains the message, exit code 1.
    - No Obscura binary → no startup warning, web tools off.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — web default when Obscura is missing, and exit behavior.
    - Docs pages to create/edit:
      - `docs/prism-code.md`: web backend default note; exit codes
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Rich rendering: markdown, code, diffs, thinking, and tool cards
  - Acceptance Criteria:
    - Functional: assistant messages render with `MarkdownRenderable` in streaming mode and `CodeRenderable` highlighting for fenced blocks (a common language set: ts/js/json/py/rs/go/sh/md/yaml/toml/diff).
    - Functional: `edit`/`write`/`git_apply` tool cards show a unified `DiffRenderable` (from the tool's diff output or computed from the edit arguments). The approval prompt for these tools shows the same diff before the user decides.
    - Functional: thinking/reasoning deltas are rendered in a dimmed collapsed block ("Thinking… (Ctrl+T to expand)"); a toggle shows or hides all thinking.
    - Functional: tool cards show name, a one-line args summary, status glyph, duration, and a collapsed output preview (first N lines). Ctrl+O expands the focused/last card; long outputs are bounded (head+tail with an omitted-lines marker).
    - Functional: the `todo_write` panel from plan 137 Task 7 uses this card system.
    - Performance: streamed markdown keeps ≥ the plan 135 spike throughput with no input lag; highlighting runs off the render path (tree-sitter client async); expanded outputs are capped at 2,000 lines rendered.
    - Code Quality: one `ToolCard` component with per-tool renderers registered by tool name (default text renderer, diff renderer for mutation tools).
    - Security: diffs and outputs pass through the Task 2 sanitizer; nothing from tool output is interpreted as markup other than the explicit markdown of assistant messages.
  - Approach:
    - Documentation Reviewed:
      - `@opentui/core` `Markdown.d.ts` (streaming semantics), `Code.d.ts` (`SyntaxStyle`, `treeSitterClient`), `Diff.d.ts` (`view: "unified"`); see Task 1 record for shipped grammar limits and compiled-asset checks
      - `packages/prism-coding-tools/src/agent/{edit,edit-diff,write}.ts` (diff output shape)
    - Options Considered:
      - Split diff view. Deferred: unified works in narrow terminals; split can be a later toggle.
    - Chosen Approach: OpenTUI renderables + per-tool card renderers.
    - API Notes and Examples:
      ```ts
      new DiffRenderable(renderer, { diff: unifiedPatch, view: "unified", filetype: "ts" });
      ```
    - Files to Create/Edit:
      - `packages/prism-code/src/tui/components/{markdown-message,tool-card,diff-view}.ts`: new (thinking was small enough to stay in `stream.ts`; there is no separate `thinking-block.ts`)
      - `packages/prism-code/src/tui/components/{stream,approval}.ts`: use the new components
      - `packages/prism-code/src/tui/reducer.ts`: proposal/applied patches, output bounding, durations
      - `packages/prism-code/src/__tests__/tui-rendering.test.ts`
    - Chosen Approach (implemented):
      - Assistant messages are `MarkdownRenderable` with `streaming: true` until `message_finished`; its internal `CodeRenderable` uses the default tree-sitter client off the render path. Highlighting covers the shipped grammars (JS/TS, Markdown, Zig); `json`/`python`/`rust`/`go`/`sh`/`yaml`/`toml`/`diff` fences render as plain code because no bundled grammar exists (Task 1 record). `SyntaxStyle` is built once in `ensureUi` (`createPrismSyntaxStyle`) and destroyed in `close()`.
      - Tool cards live in one `ToolCardComponent` with a name→renderer registry (`registerToolRenderer`/`resolveToolRenderer`, default `text`, `diff` for `edit`/`write`/`git_apply`). The header keeps the existing `[glyph] name argsSummary` text (args summary capped at 64 chars so the duration stays on one line) plus `durationMs` from `ToolExecutionMetadata`. Output preview is 6 lines collapsed, 2,000 lines expanded, with omitted-line markers; tool output is bounded to 16 KiB (head 100 + tail 50) and patches over 64 KiB are dropped whole (a truncated patch cannot be parsed).
      - The reducer builds the proposal patch at `tool_execution_started` (`write` → all-added hunk; `edit` → per-edit hunks with exact counts; `git_apply` → `args.patch`) so the approval prompt can show the diff before the file is read; `tool_execution_finished` replaces it with `result.metadata.patch` when the tool reports one. `promptApproval` reads the newest matching running card out of `tui` state (graceful degradation: no card → no diff). All patches/outputs are sanitized and `\r`-stripped so CRLF diffs parse.
      - Thinking entries are rendered by `stream.ts` as a dimmed `▸ Thinking… (Ctrl+T to expand)` line (120-char collapsed preview); `Ctrl+T` toggles every thinking block. `Ctrl+O` toggles the most recent tool card. Both call `key.preventDefault()` so the control character never reaches the textarea.
      - `DiffRenderable` is created with `view: "unified"`, `wrapMode: "word"`, `showLineNumbers: true` — OpenTUI renders the `+`/`-` signs in the gutter *after* the line number, so hiding line numbers hides the signs.
      - `todo_write` transcript cards use the normal tool-card path; the live todo panel (`TodoPanelComponent`) is unchanged.
      - Tests: `tui-rendering.test.ts` (7 tests) covers highlighted fences, in-place streaming updates, edit-card diff + collapsed/expanded output + inert control sequences, reducer output/patch bounds, approval-prompt diff, thinking toggle, and a CI-tolerant 200-delta perf smoke; full package suite 301 pass.
    - References:
      - Analysis P1: markdown/code/diff/thinking/expandable output
  - Test Cases to Write:
    - A markdown fixture with a code fence renders highlighted spans (snapshot of styled text).
    - An `edit` tool card shows the diff; the approval prompt shows the diff.
    - Thinking deltas accumulate in a collapsed block; the toggle expands.
    - A 50k-line tool output is capped with a marker.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — TUI rendering and keybindings.
    - Docs pages to create/edit:
      - `docs/prism-code.md`: TUI section and keybinding table
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4: Input editing: multi-line, paste, history, and completion
  - Acceptance Criteria:
    - Functional: Enter submits; Shift+Enter (terminals with kitty keyboard protocol) and Alt+Enter/Ctrl+J (fallback) insert newlines. A trailing `\` + Enter also inserts a newline.
    - Functional: bracketed paste is supported. Pastes over 10 lines or 2 KB collapse to a `[pasted N lines]` token in the editor, expanded on submit; multi-line pastes never auto-submit.
    - Functional: Up/Down on the first/last line navigates prompt history, persisted per repo in `~/.prism/history.jsonl`, bounded to 500 entries.
    - Functional: typing `/` opens a filtered command popup (Tab/Enter to complete, with descriptions); `@` opens a file-path popup fed by `git ls-files` (fallback `repo_list`), fuzzy-matched. The chosen path is inserted as `@path` and the file content is attached on submit (bounded by the `read` tool limits) or referenced for the model to read (decided in Task 1; the default is attaching up to 64 KB).
    - Functional: Esc interrupts a running turn (existing); Ctrl+C clears non-empty input, then aborts a running turn, then a second Ctrl+C within 2 s exits; Ctrl+D on empty input exits.
    - Performance: completion popups filter ≤ 50k paths in < 16 ms (precomputed lowercase index, refreshed on focus); keystroke-to-render stays within one frame.
    - Code Quality: input keybindings are declared in one table (used by `/help` and docs).
    - Security: `@path` attachments are limited to paths inside the repo root (realpath containment) and honor the same size limits as `read`; history excludes lines entered in secret prompts.
  - Approach:
    - Documentation Reviewed:
      - `@opentui/core` `Textarea.d.ts` (`keyBindings`, `keyAliasMap`, `onSubmit`), `EditBufferRenderable.d.ts`; OpenTUI paste/kitty-keyboard docs
      - `packages/prism-code/src/tui/components/input.ts`
    - Options Considered:
      - Inline autocomplete ghost text. Deferred; a popup is clearer and reuses `Select`.
    - Chosen Approach: `TextareaRenderable` with custom bindings + a popup built on the picker/select component.
    - API Notes and Examples:
      ```ts
      new TextareaRenderable(renderer, { keyBindings: [{ name: "return", shift: true, action: "newline" }], onSubmit });
      ```
    - Files to Create/Edit:
      - `packages/prism-code/src/tui/components/input.ts`: bindings, paste collapse, history navigation
      - `packages/prism-code/src/tui/components/picker.ts`: `setOptions()`/`selectedOption` for the inline completion popup (no separate `completion-popup.ts`)
      - `packages/prism-code/src/tui/completion.ts`: new — completion context, fuzzy filtering, file index, `@path` attachments
      - `packages/prism-code/src/tui/keybindings.ts`: new — one command/keybinding table for `/help` and the popup
      - `packages/prism-code/src/tui/history-store.ts`: new — `~/.prism/history.jsonl`
      - `packages/prism-code/src/tui/index.ts`, `src/tui/commands.ts`, `src/tui/history.ts`: wire popup, paste, history, attachments, Ctrl+C escalation, and keep attachment bodies out of the replayed transcript
      - `packages/prism-code/src/__tests__/tui-input.test.ts`
    - Chosen Approach (implemented):
      - Keybindings: `return` → submit; `shift+return`, `meta+return`, `ctrl+j`, `linefeed` → newline (custom bindings override OpenTUI's `meta+return` → submit default). Trailing `\` + Enter is intercepted in the host listener and rewrites the buffer to `…\n`. The mock-key findings: mock keys must pass `KeyCodes.*` (or the key name string is typed literally), and Shift/Alt+Enter only round-trip under `kittyKeyboard: true`.
      - Paste: the renderer paste listener calls `InputEditorComponent.handlePaste`; over 10 lines or 2 KiB it consumes the event and inserts `[pasted N lines]`, expanding the first matching token on submit. Smaller pastes are left to the textarea (never auto-submit).
      - History: `PromptHistoryStore` writes owner-only JSONL records `{cwd, text, at}`, loads the last 500 for the repo, and rotates the shared file at 2,000 lines. Navigation is host-driven whenever the caret sits on the first/last logical line, with the draft restored on the way forward. Masked secret prompts use a different component and never reach history.
      - Completion: `completionContext()` derives `{kind, query, start, end}` from the buffer; commands match without the leading `/` (so `mo` ranks `/model` above `/om-model`); paths match against a precomputed lowercase `git ls-files --cached --others --exclude-standard` index (bounded recursive walk fallback when git is unavailable, 50k cap). The index is loaded lazily and reused for 60 s rather than refreshed on focus (avoids a sync `git ls-files` on every focus). Printable keys are never consumed; `onContentChange` refreshes the popup. Tab/Enter replace the typed prefix with the selected value through the picker's `selectedOption`; Esc dismisses; Up/Down move the selection.
      - Attachments: `buildPromptInput()` turns each `@mention` into a text block `[attached file: <rel>]` appended to the same user `Message`; paths are realpath-contained in `cwd` (symlink escapes refused) and read through a bounded `readSync` at 64 KiB with a truncation marker. Refused mentions are dropped and reported with a notice; the plain prompt text still runs. Resume rendering skips attachment blocks in `history.ts` so a 64 KiB file body never replays into the transcript.
      - Ctrl+C: clear non-empty input → abort the active run → a second press within 2 s exits; empty input while idle keeps the existing immediate exit, so `Ctrl+D` remains the unconditional quit.
      - Tests: `tui-input.test.ts` (11) covers completion context/ranking, attachment containment + truncation, resumed-prompt attachment omission, history store and navigation, Shift/Alt/Ctrl+J vs Enter, 300-line paste collapse, an end-to-end `/model` and `@src/index.ts` completion with an attachment-bearing request, secret-history exclusion, the Ctrl+C escalation, and a 50k-path filter budget; full package suite 312 pass.
    - References:
      - Analysis P1: input
  - Test Cases to Write:
    - Shift+Enter/Alt+Enter insert newlines; Enter submits the multi-line text.
    - A 300-line paste collapses and expands on submit.
    - History persists across restarts and skips secret input.
    - `/mo` + Tab completes `/model`; `@src/ind` suggests `src/index.ts`; a path outside the repo is rejected.
    - The Ctrl+C sequence behaves as specified.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — input keybindings and `@file` references.
    - Docs pages to create/edit:
      - `docs/prism-code.md`: input and keybinding reference
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5: Usage meter in the footer
  - Acceptance Criteria:
    - Functional: the footer shows:
      - context usage for the next request (estimated input tokens vs the model context window from plan 136 Task 7), color-shifting at 70%/90%;
      - cumulative session input/output tokens (including cache reads when reported);
      - cumulative cost when model pricing is known.

      The meter updates on usage events and after compaction. Narrow terminals drop the cost first, then tokens.
    - Performance: the meter updates at most once per frame; the estimate reuses the assembly estimate (no extra tokenization).
    - Code Quality: usage aggregation is in the reducer (pure), and the status component only renders it.
    - Security: none beyond existing (no secrets involved).
  - Approach:
    - Documentation Reviewed:
      - usage events in `src/contracts-protocol.ts`, `src/context-budget.ts` estimates, `packages/prism-code/src/tui/components/status.ts`
    - Options Considered:
      - Show only token totals. Rejected: the context percentage is the actionable number.
    - Chosen Approach: context % + totals + cost.
    - API Notes and Examples:
      ```text
      ~/prism (main)                         claude-sonnet-4-5 · high   ctx 42k/200k 21%  ↑1.2M ↓48k  $3.41
      ```
    - Files to Create/Edit:
      - `packages/prism-code/src/tui/reducer.ts`, `src/tui/components/status.ts`, `src/tui/index.ts`
      - `packages/prism-code/src/__tests__/tui-meter.test.ts`
    - Chosen Approach (implemented):
      - Aggregation stays in the pure reducer: each `provider_turn_finished.usage` is added to `footer.usageTotals` with a local `addUsage` (absent fields stay absent; `estimated` sticks; cache reads kept separately and rendered as input). `agent_finished.usage` is a run total, so it is only added when the run reported no per-turn usage (`state.usageRunId` bookkeeping) — never double counted.
      - Context reading: the latest turn's `usage.inputTokens` sets `footer.contextTokens`/`contextSource` (the reported input of the turn = context for the next request); `compaction_finished` clears it because a pre-compaction reading overstates the rebuilt history. `reset_session` clears the session's totals, last-run usage and context reading.
      - The host mirrors `AgentSession.contextMeter()` into the footer via `PrismCodeTui.syncContextMeter()` — the session's cached assembly estimate plus the model input cap, so no extra tokenization. It is deduped on `tokens:cap:source`, guaranteeing at most one state/render update per changed reading (`session.contextMeter()` itself caches until history/limits change). Called at startup, on session switch, after every `provider_turn_finished`, and after a manual compaction (`compaction_finished` with no `runId`). Auto compaction deliberately waits for the next provider turn, because the session keeps its stale reported meter until then; the reducer-cleared context avoids showing the old number in the meantime.
      - Rendering is in `status.ts` only: `footerDetailSegments()` builds MCP → OM → `ctx <used>/<cap> <pct>%` → `↑input ↓output` → `$cost` → model notice, `formatFooterDetails()` joins them for tests, and the component wraps segments in `StyledText` so only the context segment is colored (amber at 70%, red at 90%). Cost is rendered only when `Usage.cost` is present (estimates carry none). The width budget drops the cost segment first, then the token totals; the component now uses `renderer.width` instead of a hardcoded 80.
      - The legacy `tokens: <n>` detail was replaced by the cumulative `↑/↓` totals; `formatFooterDetails`' second parameter is now a `FooterUsageMeter` (the `tui-lifecycle` assertion was updated).
      - Tests: `tui-meter.test.ts` (8) — per-turn accumulation incl. cache reads, no double counting with run totals, compaction invalidation + lower reading, session reset, token/cost formatting with unknown pricing, 70%/90% colors, cost→totals drop order, and a live mock-provider run asserting the rendered `ctx ~24k/200k 12% | ↑151k ↓400` footer plus sync dedupe. Full package suite 320 pass.
    - References:
      - Analysis P1: meter
  - Test Cases to Write:
    - Usage events accumulate; compaction lowers the context estimate.
    - Unknown pricing hides the cost; narrow width drops fields in order.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — footer contents.
    - Docs pages to create/edit:
      - `docs/prism-code.md`: footer description
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 6: Utility commands and `prism-code doctor`
  - Acceptance Criteria:
    - Functional:
      - `/clear` clears the screen and starts a new session (alias of `/new` with screen clear).
      - `/exit` quits.
      - `/tools` lists active tools by source (built-in, opt-in, MCP server, user module) with enabled state, including `WebToolResolution.unavailableReason` when implicit Obscura is absent.
      - `/export [path]` writes the session transcript as markdown (default `./prism-session-<id>.md`, confirming before overwrite).
      - `/help` is generated from the command registry + keybinding table.
    - Functional: `prism-code doctor` (non-TUI subcommand) checks:
      - Bun version and the platform native package (OpenTUI);
      - `~/.prism` permissions;
      - credential store availability (keychain probe) and configured providers (without revealing values);
      - selected model resolution;
      - skills roots and counts;
      - MCP server connectivity (with timeout);
      - web backend (include `unavailableReason` when implicit Obscura is absent);
      - terminal capabilities (kitty keyboard, truecolor);
      - session database integrity (`PRAGMA quick_check`).

      Output is a table; `--json` gives machine output; exit code 1 on blocking failures.
    - Performance: doctor completes in < 20 s with MCP timeouts; checks run in parallel where independent.
    - Code Quality: each check is a small function returning `{ name, status, detail }`; the checks are reused by `/tools`/`/mcp` where relevant.
    - Security: doctor never prints secrets, tokens, or env values; `/export` goes through redaction and writes `0600`.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-code/src/tui/commands.ts` (registry), `packages/prism-code/src/flags.ts`, plan 136–138 APIs (credential probe, skills roots, MCP status)
    - Options Considered:
      - Doctor as a TUI command only. Rejected: needs to work when the TUI can't start.
    - Chosen Approach: a CLI subcommand with reusable checks.
    - API Notes and Examples:
      ```bash
      prism-code doctor --json | jq '.checks[] | select(.status != "ok")'
      ```
    - Files to Create/Edit:
      - `packages/prism-code/src/doctor.ts`: new
      - `packages/prism-code/src/flags.ts`, `bin/prism-code.ts`: subcommand
      - `packages/prism-code/src/tui/commands.ts`: `/clear`, `/exit`, `/tools`, `/export`, generated `/help`
      - `packages/prism-code/src/__tests__/{doctor,commands-utility}.test.ts`
    - Chosen Approach (implemented):
      - `/clear` clears the transcript (`MessageStreamComponent.clear()`) and then runs the existing `/new` path, so the session switch owns the state reset; both refuse while a run is active. `/exit` calls a new `CommandContext.requestExit` host hook, wired in `PrismCodeTui` to its existing `shutdown(code)` (abort + persist + close). `/tools` renders `formatToolInventory()`: BUNDLED_CODING_TOOLS split into built-in/opt-in with on/off state (off reasons: `excluded or replaced`, `opt-in`, `needs config checks`), MCP servers from the live plane status (state, tool count, session-disable), the web backend from `CommandContext.webResolution` including `unavailableReason`, and any remaining registered tools as user modules. `/export [path]` serializes `session.entries()` (`formatSessionMarkdown`) to `./prism-session-<id>.md` or the given path, runs every entry through `redactSessionEntry` with the agent redactor, writes `0600`, and confirms an existing file through the shared PickerComponent (Yes/No). Attachment blocks are dropped from the transcript.
      - `/help` was already generated from `CORE_SLASH_COMMANDS` + `TUI_KEYBINDINGS` in Task 4; Task 6 added the four new commands to that registry, so the help, completion popup, and docs stay in one place.
      - `prism-code doctor` is a subcommand (`flags.subcommand`, plus `--json`), handled in `bin/prism-code.ts` after config layering and before any session/provider work. `src/doctor.ts` holds one small function per check and returns ordered `{ name, status: ok|warn|fail, detail, hint? }` rows; independent checks run under one `Promise.all` and MCP probes are bounded by a per-server `AbortController` timeout (5 s default), so the report stays well under 20 s. Blocking (`fail`) rows make the process exit 1; `warn` rows do not.
      - Checks: `runtime` (Bun >= 1.4.2 + `@opentui/core` and its platform native package resolve), `home` (exists/owned/`0700`), `credentials` (the same `selectCredentialStore` path as startup, no prompting), `providers` (`describeProviderCredentialStatus` per shipped provider — env var names and store kinds only, never values), `model` (`enrichModelConfig`: catalog hit vs assumed limits), `skills` (roots + counts), `web` (`resolveWebTools`, surfacing `unavailableReason`), `terminal` (TERM/TERM_PROGRAM, truecolor, kitty keyboard), `session-db` (`bun:sqlite` `PRAGMA quick_check`, `:memory:` stores report no database), and `mcp:<id>` (`resolveMcpServers` + `connectMcpTools`/`buildConnectOptions`). Doctor resolves project-declared MCP servers with `mode: "allow"` because it is explicitly operator-invoked; trust prompting stays in the run path, and manifest notes are reported as `mcp:notes` warnings. `--json` prints `{ version, ok, exitCode, checks }`.
      - Tests: `doctor.test.ts` (7) — missing provider exits 1 with a clear row, ambient provider + resolvable model is ok, loose/missing home permissions warn, sqlite `quick_check` ok and corrupted database fails, unreachable MCP server fails, stable JSON schema, `doctor --json` flags parse; `commands-utility.test.ts` (6) — `/tools` grouping with web `unavailableReason`, `/clear` wipe+new session, `/exit` host hook, `/export` 0600 + redaction + overwrite refusal + default path, `/help` registry coverage, transcript formatting without attachment bodies. Full package suite 333 tests.
    - References:
      - Analysis P1: commands and doctor
  - Test Cases to Write:
    - Doctor with a missing provider → exit 1 and a clear row; `--json` schema.
    - `/export` writes redacted markdown and refuses to overwrite without confirmation.
    - `/tools` groups by source.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new commands and subcommand.
    - Docs pages to create/edit:
      - `docs/prism-code.md`: commands table, "Troubleshooting with doctor"
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 7: PTY-driven TUI end-to-end tests and docs pass
  - Acceptance Criteria:
    - Functional: a PTY harness spawns the built TUI (mock provider, temp `PRISM_HOME`), sends keystrokes, and asserts on the screen buffer. It covers: onboarding, prompt → streamed markdown, parallel tool cards, approval with a diff, `/model` switch, Esc abort, resume, and a clean exit restoring the terminal. It runs in CI on Linux.
    - Functional: `docs/prism-code.md` TUI sections are complete (commands, keybindings, footer, rendering); `bun run build`, tests, and `release:gate` are green.
    - Performance: the harness completes in < 60 s; a frame-time budget (p95 < 16 ms under the streaming fixture) is recorded in the task note.
    - Code Quality: the harness is reusable (`scripts/lib/pty-harness.mjs`) with screen-text helpers.
    - Security: the harness uses only mock providers and a temp home; no real credentials.
  - Approach:
    - Documentation Reviewed:
      - Bun `Bun.spawn({ terminal: { cols, rows, data } })` PTY API and the `Bun.Terminal` class (`write`, `resize`, `close`), from bun docs/`bun-types` `TerminalOptions`
      - `@xterm/headless` (dev dependency) to turn the raw PTY byte stream into a screen buffer for assertions
    - Options Considered:
      - Only component tests. Rejected: key handling and terminal restore need a real PTY.
    - Chosen Approach: a `Bun.spawn` terminal PTY feeding `@xterm/headless`, with assertions on the screen buffer. `script(1)` stays available as a manual fallback only.
    - API Notes and Examples:
      ```js
      const tui = await startTui({ home: tmp, args: [] });
      await tui.type("hello\r"); await tui.waitFor("Mock response"); await tui.key("C-d"); expect(await tui.exitCode).toBe(0);
      ```
    - Files to Create/Edit:
      - `scripts/lib/pty-harness.mjs`: new
      - root `package.json`: `@xterm/headless` dev dependency (pinned)
      - `scripts/e2e-prism-code-tui.test.mjs`: new
      - `.github/workflows/coding-journey.yml`: add the job
      - `docs/prism-code.md`: final pass
    - Chosen Approach (implemented):
      - `scripts/lib/pty-harness.mjs` spawns `packages/prism-code/dist/bin/prism-code.js` under `Bun.Terminal`, feeds the copied byte stream into `@xterm/headless`, and exposes `screen()`, `waitFor(pattern)`, `type`, `press(key)`, `submit`, `resize`, `settled()`, `raw()`, `exited`, and `stop()`. Two subtleties are baked in: the PTY buffer must be copied before `xterm.write` (Bun reuses it while xterm parses asynchronously — without the copy the frames interleave characters), and screen reads await the chained parse callback so a wait never asserts on a torn frame. The environment is hermetic: temp `HOME`/`PRISM_HOME`, a minimal env (`PATH`/`TERM`/`COLORTERM`/`LANG`/`TMPDIR` only — inherited provider keys are never visible), a seeded `state.json` `credentialStore: "memory"`, and the shipped `mock` provider. `PRISM_CODE_MOCK_SCRIPT` (new seam in `packages/prism-code/src/providers.ts`) scripts provider turns for the journeys that need tool calls; an unscripted run streams `Mock response`.
      - `scripts/e2e-prism-code-tui.test.mjs` runs 8 journeys against the built binary: first-run onboarding (provider picker → model picker → prompt → `Ctrl+D` exit 0 with `\x1b[?1049l` in the raw stream), parallel `read` cards with finished output, `edit` approval showing the proposed diff then applying the edit when allowed, Esc abort of a running `shell`, `/model` switch, `--continue` resume replay, a 150-delta streaming throughput check, and a missing-binary guard. Each journey has a 60 s ceiling; the whole file completes in ~5.6 s.
      - Performance: the streaming fixture rendered 150 deltas in ~161 ms end-to-end (~930 deltas/s) over the PTY. The render-path frame budget stays with the in-process `tui-rendering.test.ts` smoke (200 deltas, CI ceiling 5 s); the PTY harness asserts throughput (>100 deltas/s) and the end-to-end ceiling (15 s) instead of a per-frame p95, because Bun coalesces PTY writes so external frame timings are not a frame-time signal.
      - Defect found and fixed by this task: the TUI/headless assembly never set a verified identity, so every durable tool effect (`edit`, `write`, `delete`, `move`) was silently blocked by core with `verified identity is required for a durable tool effect` — Prism Code could not edit files at all. `assembleAppAgent` now passes `ownership: { userId: config.userId ?? "local" }` plus a local `identity` (`tenantId: local`, `scopes: ["coding"]`) mirroring the ACP surface, with a regression test in `src/__tests__/integration.test.ts` (edit tool call applies, no `tool_execution_blocked`).
      - CI: the journeys run in the default chain (`GATE_FILES` in `scripts/run-all-tests.mjs`) and as a hermetic `hermetic-pty-tui-e2e` job in `.github/workflows/coding-journey.yml`.
      - Docs: `docs/prism-code.md` documents the local durable-effect identity and the `PRISM_CODE_MOCK_SCRIPT` seam with the PTY harness command; the TUI rendering/keybindings/footer/commands sections were already brought current by Tasks 2–6.
      - Local environment repair (not tracked, node_modules only): `packages/*/node_modules/@arnilo/prism` were stale `file:` cache copies (2026-09-27) that made every workspace resolve an outdated root `dist`; they are now symlinks to the repository root. `bun.lock` was unparseable by bun 1.4.2 (`InvalidLockfile: failed to parse lockfile`) and was regenerated by `bun install`; `bun install --frozen-lockfile` now validates (`168 installs across 209 packages, no changes`).
      - Verification: package `typecheck` clean; root `bun run build` green; `bun run test` green across all 9 stages (build, performance budget, root suites, sqlite suites, gate suites 321 tests/48 files — including the 8 PTY journeys, build race, workspace suites incl. `@arnilo/prism-code` 335 tests/36 files, examples execution, branch coverage); `git diff --check` clean.
      - Gates this task had to repair to reach that green run (all were red before the Task 7 work): the package-truth generated docs were stale for the new workspaces (regenerated with `bun scripts/package-truth.mjs --emit-docs`), the `@arnilo/prism-code` compat baseline was stale for the Task 5 `formatFooterDetails` signature (updated via `bun scripts/release.mjs gate --update-baseline`; only that baseline changed), biome reported 24 diagnostics in plan-139 files (non-null assertions in `doctor.test.ts`/`reducer.ts`/`tui-process.test.ts`, implicit `any` in `completion.ts`, an unused binding in `doctor.ts`; all fixed, plus `biome.json` schema bumped to the installed CLI 2.5.14), and the dead-export sweep flagged the unused `registerToolRenderer` export (now exercised by a registry test and used for `git_diff`).
      - `bun run release:gate` cannot complete on this host: `release-skip-manifest.mjs` fails closed because `PRISM_TEST_POSTGRES_URL` is unset (`test:postgres durable conformance` is recorded `blocked`). That is the documented local-Postgres limitation (plans/backlog.md, plan 135) and is unrelated to plan 139's code; the code-level release legs run here are green (`release-gate.test.mjs` compat/tarball/version gates inside the chain, `bun scripts/check-client-neutrality.mjs`).
    - References:
      - Tasks 2–6
  - Test Cases to Write:
    - The journeys listed in the Functional criteria.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — tests and a docs pass.
    - Docs pages to create/edit: `docs/prism-code.md` consistency pass.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- **The PTY harness measures streaming throughput, not a per-frame p95.** Bun coalesces PTY writes, so external
  inter-chunk timings say nothing about frame time; the render-path 16 ms budget stays with the in-process
  `tui-rendering.test.ts` smoke, and the PTY journey asserts >100 deltas/s and a 15 s end-to-end ceiling instead.
  Measured: 150 deltas in ~161 ms (~930 deltas/s).
- **`/model` and onboarding journeys ride the mock catalog.** The mock provider has one model, so those journeys
  prove the picker, selection, and footer wiring rather than ranking or multi-provider switching.
- **The approval-with-diff journey uses `edit`.** `write` and `git_apply` reuse the same proposal-patch path, but only
  `edit` is asserted end-to-end in the PTY.
- **Prism Code asserts its own local identity.** The durable-effect fix synthesizes `tenantId: local` with
  `verified: true` (mirroring the ACP surface) instead of exposing a configurable `identity`; a host embedding the
  assembly gets a self-asserted local principal rather than supplying its own verifier.
- **Local environment repair is untracked.** `packages/*/node_modules/@arnilo/prism` were re-pointed at the repo root
  as symlinks instead of fixing bun's `file:` cache behavior, and a pre-existing unparseable `bun.lock` was
  regenerated by `bun install`. Both live outside tracked source, so a fresh `bun install` can reintroduce the stale
  copies until the toolchain issue is fixed (see Further Actions).

## Further Actions

- **Make cross-package `@arnilo/prism` resolution immune to bun's stale `file:` cache.** The per-package copies are
  hardlinks to `~/.bun/install/cache/@arnilo/prism/@T@*` snapshots, so a root `dist` rebuild never refreshes them and
  every workspace silently loads an old root API (this task hit `SESSION_TITLE_METADATA_KEY` and `DiscoveryRoot`
  missing from the copies). Fix the linker rule or add a post-install check that the copies match the root `dist`;
  the lockfile repair in this task should be committed. Tracking item P2.
- **Extend the PTY journeys to the remaining interactive paths.** `Ctrl+C` run-abort escalation, a multi-model
  `/model` switch, MCP connect/reconnect in the footer, `todo_write` panel rendering, and an `@file` attachment
  loaded from completion would each add real end-to-end coverage with the same harness.
- **Expose the durable-effect identity in `prism-code.json`.** A host that wants auditable principals (not the
  local default) should be able to set `identity`/`ownership` without reimplementing `assembleAppAgent`; document the
  effect-token requirement next to the approvals table at the same time.
- **Run `bun run release:gate` where a Postgres service is available.** On this host the skip manifest fails closed
  on the unset `PRISM_TEST_POSTGRES_URL` (the known local-Postgres limitation tracked against plan 135); the
  code-level release legs (compat baselines, tarball deny list, version ranges, client neutrality) are green.
