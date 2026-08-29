# Obscura Full Host Support and Changed-Package Release

## Objectives
- Add optional `@arnilo/prism-obscura` support for a host-installed Obscura binary or Docker command without bundling Obscura, Chromium, or an image.
- Expose Obscura's complete discovered MCP browser surface, managed/external CDP connectivity, Playwright composition, and bounded CLI-backed web search/fetch/scrape capabilities as normal Prism tools/adapters.
- Make one package usable through every Prism host that already accepts `ToolDefinition[]`, avoiding host-specific forks.
- Release only npm packages changed from Plan 035 onward, with independent patch versions and unchanged package versions preserved.

## Expected Outcome
- Hosts can connect to `obscura mcp` over stdio or Streamable HTTP, start or attach to `obscura serve`, connect through Playwright `chromium.connectOverCDP`, and close only resources they own.
- All Obscura MCP tools present at connection time are available with bounded results, conservative side-effect metadata, collision-safe naming, abort propagation, and no static allow-list that hides future Obscura capabilities.
- Prism exposes real public-web search plus Markdown fetch and batch scrape through bounded Obscura CLI operations; Obscura's native `browser_search` remains correctly documented as in-page text search.
- Core agent sessions, server/MCP, AG-UI/ACP, workflows, supervisors, and delegated-agent exposure consume the same package-produced tools without bespoke Obscura logic.
- Existing changed packages since the commit immediately before Plan 035 receive patch bumps; unchanged manifests retain their exact versions; new `@arnilo/prism-obscura` publishes at its reviewed initial version.

## Tasks

- [x] Freeze Obscura capability evidence and review reusable Prism primitives first (2026-08-28: complete — evidence at `docs/_evidence/phase39-obscura-capability-matrix.md`; outcome notes below in Compromises Made)
  - Acceptance Criteria:
    - Functional: Record Obscura version/revision, CLI modes (`fetch`, `serve`, `scrape`, `mcp`), all discovered MCP tools, render-only tools, CDP/Playwright behavior, Docker invocation, and known protocol limits; distinguish public-web search from Obscura's in-page `browser_search`.
    - Performance: Record upstream startup, worker, V8-isolate, timeout, connection, request-body, and render ceilings that affect Prism defaults; measurements or defaults are reproducible from one pinned upstream revision.
    - Code Quality: Inventory existing Prism MCP, browser, web-tool, CLI-runner, process-lifecycle, URL-policy, tool-effect, artifact, and host-composition primitives before proposing code; add only generic reusable primitive gaps and keep Obscura-specific policy in the new package.
    - Security: Document that Obscura CDP and MCP HTTP have no authentication, default to loopback, require network/auth isolation when remote, and must not inherit arbitrary host environment or permit private-network/file access by default.
  - Approach:
    - Documentation Reviewed:
      - Obscura `0.1.0`, revision `f449e6fb3183138eb3e80f11fe44af31cefe0fae`: `README.md`, `docs/CLI-reference.md`, `docs/Use-the-MCP-server.md`, `docs/Connect-Puppeteer-or-Playwright.md`, `docs/Run-in-production-at-scale.md`, `docs/Environment-variables.md`.
      - Context7 `/h4ckf0r0day/obscura`: current serve flags, MCP launch, and Playwright `connectOverCDP` examples.
      - `docs/browser-automation.md`, `docs/web-tools.md`, `docs/mcp.md`, `docs/host-security.md`: Prism's existing generic seams and trust boundaries.
      - `packages/mcp/src/bridge.ts:47-77`, `packages/mcp/src/transport.ts:10-34`, `packages/browser/src/manager.ts`, `packages/browser/src/cdp.ts:30-54`, `packages/web-tools/src/tools.ts:5-37`.
    - Options Considered:
      - Reimplement Obscura's protocols and browser tools: rejected; MCP discovery, CDP, and Playwright already expose them.
      - Reuse generic Prism primitives and add only a Node-side owned-process seam if no suitable primitive exists: chosen.
      - Hard-code the current MCP tool list: rejected; it would contradict full/future capability support.
    - Chosen Approach:
      - Check in a capability matrix pinned to the reviewed upstream revision. Reuse `connectMcpTools`, `@arnilo/prism-browser`, `createWebTools`, `ToolDefinition`, standard effect metadata, and existing host tool seams. If process ownership lacks a reusable primitive, keep the minimum spawn/readiness/kill implementation private to `@arnilo/prism-obscura`; do not add Obscura branches to core.
    - API Notes and Examples:
      ```bash
      obscura serve --host 127.0.0.1 --port 9222
      obscura mcp
      obscura mcp --http --host 127.0.0.1 --port 3000
      docker run --rm -i h4ckf0r0day/obscura mcp
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase39-obscura-capability-matrix.md`: pinned upstream capability and limit inventory.
      - `packages/obscura/src/` (tentative): only generic-gap implementation identified by review.
      - Existing primitive tests/docs (tentative): only if review proves a reusable gap.
    - References:
      - `https://github.com/h4ckf0r0day/obscura/tree/f449e6fb3183138eb3e80f11fe44af31cefe0fae`.
      - Obscura MCP currently advertises 37 unique `browser_*` tools; screenshot/PDF require a render-enabled build.
      - Obscura Playwright support requires `chromium.connectOverCDP`, not `chromium.connect`.
  - Test Cases to Write:
    - Capability-matrix test: pinned documented tool names and feature-gated tools match the checked evidence fixture.
    - Primitive assessment: prove a generic MCP tool can already traverse each host seam before adding host code.
    - Capability-truth check: reject documentation or APIs that describe `browser_search` as public-web search.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; this task freezes evidence and architecture before implementation.
    - Docs pages to create/edit:
      - `docs/_evidence/phase39-obscura-capability-matrix.md`: reviewed upstream contract and limitations.
    - `docs/index.md` update: no; evidence stays non-navigation.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Create the package and fail-closed host/Docker process lifecycle (2026-08-28: complete — `packages/obscura` with `spawnObscuraProcess`; 13 lifecycle tests green; truth/peer gates updated)
  - Acceptance Criteria:
    - Functional: Add publishable `@arnilo/prism-obscura` with typed configuration for an installed `obscura` command, arbitrary shell-free command/argv (including Docker), external MCP/CDP endpoints, environment, working directory, stderr handling, startup timeout, shutdown timeout, and ownership-aware `close()`.
    - Performance: Startup and readiness are bounded; output capture is linear and capped; abort/close settles within configured deadlines and leaves no child, timer, listener, or retry loop.
    - Code Quality: Follow existing package layout and errors/limits patterns; use `node:child_process.spawn`/`execFile` without a shell, one small lifecycle implementation, and no process framework or Docker SDK.
    - Security: Validate command/argv/env/URLs and byte/count limits; pass an explicit minimal environment; redact configured secrets; bind managed servers to loopback by default; never enable `--allow-private-network`, `--allow-file-access`, `0.0.0.0`, privileged Docker, host networking, or persistent storage implicitly.
  - Approach:
    - Documentation Reviewed:
      - Obscura `docs/CLI-reference.md`: serve/MCP host and port flags.
      - Obscura `docs/Run-in-production-at-scale.md`: Docker, authentication, worker, and timeout guidance.
      - Node.js `child_process.spawn`, `AbortSignal`, and process signal semantics.
      - `packages/computer-use-linux/src/create.ts:55-121`: host-owned binary over MCP.
      - `packages/antigravity-agent/src/runner.ts:66-99`: shell-free CLI argument construction.
      - `packages/coding-security/src/docker-cli.ts`: executable/argv and redaction precedent.
    - Options Considered:
      - Manage Docker through an SDK: rejected; a validated command/argv supports host and Docker equally.
      - Require package-owned processes only: rejected; external sidecars/services are common.
      - Owned or external lifecycle union: chosen; only owned resources are terminated.
    - Chosen Approach:
      - Ship a Node-only package whose default command is `obscura`. Accept command/argv overrides such as `docker run --rm -i ...`; use no shell. Expose small owned-process handles and external endpoint configs. Readiness is proven by the target protocol connection, not log-text parsing.
    - API Notes and Examples:
      ```ts
      const obscura = await createObscura({
        command: "/usr/local/bin/obscura",
        mode: "managed",
        startupTimeoutMs: 10_000,
      });

      const docker = await createObscura({
        command: "/usr/bin/docker",
        args: ["run", "--rm", "-i", "h4ckf0r0day/obscura", "mcp"],
        mode: "mcp-stdio",
      });
      ```
    - Files to Create/Edit:
      - `package.json`: add `packages/obscura` workspace.
      - `package-lock.json`: register workspace and reviewed dependencies.
      - `packages/obscura/package.json`: npm metadata, exports, peers, scripts, files, Node engine.
      - `packages/obscura/tsconfig.json`: package build config.
      - `packages/obscura/src/types.ts`: public configuration/handle types.
      - `packages/obscura/src/errors.ts`: stable package error codes.
      - `packages/obscura/src/limits.ts`: bounded defaults and hard caps.
      - `packages/obscura/src/process.ts`: private shell-free owned-process lifecycle.
      - `packages/obscura/src/index.ts`: public exports.
      - `packages/obscura/src/__tests__/process.test.ts`: lifecycle tests.
      - `packages/obscura/README.md`, `packages/obscura/CHANGELOG.md`: package-local usage/release notes.
    - References:
      - `packages/computer-use-linux/package.json`: closest optional binary-backed package convention.
      - `packages/browser/package.json`: optional `playwright-core@1.61.0` peer convention.
  - Test Cases to Write:
    - Host binary and Docker argv are passed byte-for-byte with `shell: false`.
    - Abort during startup kills the owned process tree and removes listeners/timers.
    - External endpoint close disconnects clients but never kills an external service.
    - Invalid endpoint, oversized env/argv/output, forbidden bind/private-network/file flags, and readiness timeout fail closed with redacted errors.
    - Repeated/concurrent `close()` is idempotent.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new package, configuration, lifecycle, and error surface.
    - Docs pages to create/edit:
      - `docs/obscura.md`: package API sections, installation, lifecycle, host and Docker configuration.
      - `docs/host-security.md`: unauthenticated CDP/MCP endpoint isolation.
    - `docs/index.md` update: yes; add `Obscura browser engine` under Tools.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Bridge the complete Obscura MCP surface into Prism tools (2026-08-28: complete — `createObscuraMcpTools` over `connectMcpTools`; 25/25 package tests green; truth/peer gates and docs updated)
  - Acceptance Criteria:
    - Functional: Connect to `obscura mcp` over stdio or Streamable HTTP; expose every discovered tool, including render tools when advertised; preserve schemas/content blocks/errors; support refresh; provide collision-safe default naming and explicit no-prefix mode.
    - Performance: Reuse MCP's existing call timeout, response-byte, tool-count, schema-byte, refresh, and concurrency bounds; package adds no polling or per-call transport creation.
    - Code Quality: Wrap `connectMcpTools` rather than reimplement MCP; classify known tools by effect and default unknown future `browser_*` tools conservatively without excluding them.
    - Security: HTTP defaults to exact loopback URLs; remote HTTP requires explicit opt-in plus secure transport/auth/network policy; mutating, storage, cookie, JS-evaluation, navigation, and lifecycle tools carry external-mutation/exclusive metadata as appropriate; all remote content remains untrusted and bounded.
  - Approach:
    - Documentation Reviewed:
      - Obscura `docs/Use-the-MCP-server.md`: stdio/HTTP invocation, security, tool groups, stale refs, storage, tabs, screenshot/PDF.
      - MCP tool source at Obscura revision `f449e6f`, `crates/obscura-mcp/src/lib.rs`.
      - `packages/mcp/src/bridge.ts:47-77`, `packages/mcp/src/types.ts`, `packages/mcp/src/transport.ts:10-34`.
      - `packages/computer-use-linux/src/create.ts:55-121`: bridge wrapping and conservative effect annotation.
    - Options Considered:
      - Maintain a static 37-tool allow-list: rejected; future upstream tools would disappear.
      - Pass remote metadata unchanged: rejected; host approval/policy needs conservative effects.
      - Discover all tools, annotate known reads/mutations, default unknowns to high-risk mutation: chosen.
    - Chosen Approach:
      - `createObscuraMcpTools()` delegates transport and bounds to `@arnilo/prism-mcp`. Default names use `obscura_` prefix to coexist with `@arnilo/prism-browser`; `namePrefix: ""` preserves native Obscura names when desired. Known read-only diagnostics/extraction tools are non-mutating; all actions, navigation, evaluation, cookies/storage, tabs, and unknown future tools are exclusive external mutations unless evidence proves otherwise.
    - API Notes and Examples:
      ```ts
      const obscura = await createObscuraMcpTools({
        transport: { type: "stdio", command: "/usr/local/bin/obscura", args: ["mcp"] },
        namePrefix: "obscura_",
      });
      agent.tools = [...agent.tools, ...obscura.tools];
      await obscura.close();
      ```
    - Files to Create/Edit:
      - `packages/obscura/src/mcp.ts`: MCP connection, discovery, refresh, naming, and lifecycle.
      - `packages/obscura/src/classify.ts`: minimal known-tool effects plus conservative fallback.
      - `packages/obscura/src/types.ts`, `packages/obscura/src/index.ts`: MCP public surface.
      - `packages/obscura/src/__tests__/mcp.test.ts`: fake-server discovery and behavior.
      - `packages/obscura/src/__tests__/classify.test.ts`: effect classification.
      - `packages/obscura/package.json`: `@arnilo/prism-mcp` dependency/peer metadata.
    - References:
      - `packages/mcp/src/capabilities.ts:40-108`: dynamic capability collection pattern.
      - `packages/mcp/src/server.ts:40-339`: bounded Prism tool dispatch over MCP.
  - Test Cases to Write:
    - Current 37 unique upstream tools bridge; render-disabled fixture omits only screenshot/PDF; render-enabled fixture includes both.
    - Unknown future `browser_*` tool remains exposed but is exclusive/high-risk.
    - Refresh adds/removes advertised tools without duplicate names or leaked calls.
    - Prefix collision and native-name modes behave deterministically.
    - Text/image/embedded-resource content, remote errors, abort, timeout, oversize response, and close map through existing MCP contracts.
    - Remote non-loopback HTTP without explicit policy is rejected.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new tool factory, naming, effects, transports, and lifecycle.
    - Docs pages to create/edit:
      - `docs/obscura.md`: MCP inputs, outputs, tool inventory/discovery, effects, examples, security/performance notes.
      - `docs/mcp.md`: Obscura adapter cross-reference.
    - `docs/index.md` update: yes through the Obscura entry created in the prior task.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add managed/external CDP and Playwright browser composition (2026-08-28: complete — `connectObscuraCdp` in `packages/obscura/src/cdp.ts`; 33/33 package tests green; truth/peer gates and docs updated)
  - Acceptance Criteria:
    - Functional: Start `obscura serve` or attach to an external CDP WebSocket; connect with host-supplied `playwright-core` using `chromium.connectOverCDP`; return a browser accepted by `@arnilo/prism-browser`; support raw CDP sessions for all Obscura-supported methods, screenshots, PDF, and screencast; close browser/client/process in ownership order.
    - Performance: Connection retries are bounded with abortable delay; no fixed post-start sleep; host-configured Obscura workers and Prism browser limits remain authoritative; one managed server can serve multiple bounded run-owned contexts.
    - Code Quality: Reuse `createBrowserManager`/browser tools and Playwright structural types; do not fork Prism's snapshot/action/policy implementation or add Puppeteer.
    - Security: Managed CDP binds loopback by default; external `ws://` is loopback-only unless explicitly allowed, remote deployments require authenticated tunnel/proxy guidance, userinfo is rejected, and package never silently enables private/file navigation.
  - Approach:
    - Documentation Reviewed:
      - Obscura `docs/Connect-Puppeteer-or-Playwright.md`: `connectOverCDP`, supported calls, raw CDP screencast, current limits.
      - Obscura `docs/CLI-reference.md`: `serve` flags and endpoint.
      - `packages/browser/src/manager.ts`, `packages/browser/src/cdp.ts:30-54`, `packages/browser/src/types.ts`.
      - `docs/browser-automation.md`: run ownership, policy, checkpoints, artifacts, CDP constraints.
    - Options Considered:
      - Duplicate browser tools specifically for Obscura: rejected.
      - Treat Obscura as the host-supplied Playwright browser: chosen.
      - Add Puppeteer support too: rejected; Playwright plus raw CDP covers requested Prism behavior with an existing peer.
    - Chosen Approach:
      - `connectObscuraCdp()` optionally owns `obscura serve`, dynamically allocates or validates a port, and calls injected/default Playwright `chromium.connectOverCDP`. `createObscuraBrowserTools()` composes the resulting browser through `@arnilo/prism-browser`. Raw CDP access remains available through the returned Playwright browser/session; package adds no CDP command allow-list.
    - API Notes and Examples:
      ```ts
      const session = await connectObscuraCdp({
        command: "/usr/local/bin/obscura",
        args: ["serve", "--host", "127.0.0.1", "--port", "9222"],
        endpoint: "ws://127.0.0.1:9222",
      });
      const browserTools = createBrowserTools({ browser: session.browser, policy });
      ```
    - Files to Create/Edit:
      - `packages/obscura/src/cdp.ts`: managed/external CDP and Playwright connection.
      - `packages/obscura/src/browser.ts`: thin `@arnilo/prism-browser` composition helper if it removes repeated host wiring.
      - `packages/obscura/src/types.ts`, `packages/obscura/src/index.ts`: CDP/browser exports.
      - `packages/obscura/src/__tests__/cdp.test.ts`: fake Playwright/readiness/lifecycle tests.
      - `packages/obscura/src/__tests__/browser.test.ts`: Prism browser composition.
      - `packages/obscura/package.json`: optional exact `playwright-core@1.61.0` peer and browser dependency/peer.
    - References:
      - `packages/browser/src/__tests__/fake-playwright.ts`: network-free host-browser fixture.
      - Obscura limit: pages in one worker share one V8 isolate; CPU-bound JS may delay siblings.
  - Test Cases to Write:
    - Playwright receives `connectOverCDP`, never `connect` or browser launch.
    - Managed serve retries connection until ready, aborts immediately, and kills only owned process.
    - External browser disconnect leaves server alive.
    - Prism browser open/snapshot/act/evaluate/observe/close and raw `newCDPSession` work against fake Obscura-compatible Playwright APIs.
    - Screenshot/PDF/screencast content obeys existing artifact/byte policy.
    - Remote endpoint, credentials-in-URL, malformed port, private/file flags, startup timeout, and process crash fail closed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new CDP/Playwright factory and browser-host behavior.
    - Docs pages to create/edit:
      - `docs/obscura.md`: managed/external CDP, Playwright, raw CDP, render and concurrency limits.
      - `docs/browser-automation.md`: Obscura host-browser recipe and limitations.
    - `docs/index.md` update: no additional entry; existing Browser automation and new Obscura entries cross-link.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add bounded Obscura CLI web search, fetch, and scrape tools (2026-08-28: complete — `createObscuraWebTools` + bounded `runObscuraCli`; 54/54 package tests plus 1 opt-in live skip green; truth/peer gates and docs updated)
  - Acceptance Criteria:
    - Functional: Provide standard Prism `web_search` and `web_fetch` behavior backed by Obscura, plus explicit `obscura_fetch`/`obscura_scrape` tools for native dump/evaluate/batch features; public search works out of the box through one documented default HTML search profile and supports host replacement; native `browser_search` remains an in-page tool.
    - Performance: Enforce query, URL, batch, concurrency, stdout/stderr, result, timeout, and child-count caps; abort kills subprocesses; output collection is linear; no unbounded `Promise.all` or retry.
    - Code Quality: Reuse `createWebTools` and its normalized result/citation types where possible; one provider-profile object contains default search URL and extraction expression; no HTML parser dependency or search framework.
    - Security: Validate public HTTP(S) URLs with DNS/private-network policy before execution; encode queries; inject no user text into JavaScript source; arbitrary `--eval`, proxy credentials, screenshots, file URLs, output paths, and private-network access are explicit opt-ins subject to host permission/artifact policy; all page/search output is labeled untrusted.
  - Approach:
    - Documentation Reviewed:
      - Obscura `docs/CLI-reference.md`: fetch dump modes, adaptive wait, screenshot, scrape concurrency/stdin, worker requirement.
      - Obscura `docs/Extract-data.md`, `docs/Markdown-extraction.md`, `docs/Configure-stealth-and-proxies.md`.
      - `packages/web-tools/src/types.ts`, `packages/web-tools/src/tools.ts:5-37`, `packages/web-tools/src/normalize.ts`, `packages/web-tools/src/limits.ts`.
      - `packages/rag/src/loaders.ts:81-94`: current public-web URL validation precedent.
    - Options Considered:
      - Call an unrelated search API: rejected; this package should exercise Obscura.
      - Claim native `browser_search` is web search: rejected; it searches visible current-page text only.
      - Use one small replaceable HTML-search profile over `obscura fetch --eval`: chosen; default profile is tested as a parser contract and live-tested separately.
    - Chosen Approach:
      - Build argv only, spawn without a shell, and keep extraction JavaScript constant; pass query through URL encoding/data, never source concatenation. Adapt normalized search/fetch results into `createWebTools`. Native CLI tools expose reviewed flags and return bounded content/artifacts rather than allowing arbitrary host output paths. Batch scrape uses Obscura's own `--concurrency` cap and `obscura-worker` preflight.
    - API Notes and Examples:
      ```ts
      const web = await createObscuraWebTools({
        command: "/usr/local/bin/obscura",
        searchProfile: "default",
        limits: { timeoutMs: 30_000, maxResults: 10 },
      });
      // web.tools contains web_search/web_fetch plus opted-in native CLI tools.
      ```
    - Files to Create/Edit:
      - `packages/obscura/src/cli.ts`: bounded argv runner and native fetch/scrape operations.
      - `packages/obscura/src/web.ts`: search/fetch adapters and normalization.
      - `packages/obscura/src/search-profile.ts`: one default, replaceable HTML search profile.
      - `packages/obscura/src/types.ts`, `packages/obscura/src/limits.ts`, `packages/obscura/src/index.ts`: public CLI/web types and bounds.
      - `packages/obscura/src/__tests__/cli.test.ts`: argv, bounds, abort, output tests.
      - `packages/obscura/src/__tests__/web.test.ts`: deterministic search/fetch normalization.
      - `packages/obscura/src/__tests__/live.test.ts`: opt-in real Obscura/search-profile smoke test.
      - `packages/obscura/package.json`: `@arnilo/prism-web-tools` dependency/peer and `test:live` script.
    - References:
      - `packages/web-tools/src/transport.ts:26-173`: timeout/concurrency/response bounds.
      - Live tests stay behind `PRISM_LIVE_OBSCURA=1`; default suite uses a fake executable/server.
  - Test Cases to Write:
    - Query encoding prevents argument/source injection and yields normalized title/URL/snippet/citation rows.
    - Fetch returns bounded Markdown; native dump modes return expected text/JSON/artifact shapes.
    - Batch scrape preserves input association while Obscura enforces configured concurrency.
    - Invalid/private/credentialed URLs, excessive batch/concurrency, missing worker, timeout, oversize output, malformed JSON, abort, and nonzero exit fail closed with redacted diagnostics.
    - Arbitrary evaluation and private/file access are absent by default and require explicit policy.
    - Opt-in live test starts installed Obscura, searches/fetches a public page, and cleans every process/file.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new web adapters and native CLI tools.
    - Docs pages to create/edit:
      - `docs/obscura.md`: web-search truth, provider profile, fetch/scrape inputs/outputs, opt-ins, limits.
      - `docs/web-tools.md`: Obscura-backed adapter recipe and distinction from API-backed Brave/Exa.
    - `docs/index.md` update: update Web search entry to mention optional Obscura-backed browser search adapter.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Prove one generic integration works across every Prism host and publish package truth (2026-08-29: complete — `scripts/obscura-host-conformance.test.mjs` 9/9 green across all named hosts; wired into `npm test`; compat baseline + truth/freeze gates updated; docs/README/CHANGELOG/example published)
  - Acceptance Criteria:
    - Functional: The same `ToolDefinition[]` from `@arnilo/prism-obscura` works in core agent/session execution, Prism MCP server, server-hosted lifecycle, AG-UI/ACP, workflow agent nodes, supervisor children, and Antigravity delegated MCP exposure; hosts need no Obscura-specific branch.
    - Performance: Host conformance leaves zero active child processes, MCP calls, browser contexts, timers, and listeners; host-level timeout/concurrency/result limits still wrap package limits.
    - Code Quality: Add a shared conformance fixture/example instead of duplicate per-host implementations; update workspace/package truth, install smoke, exports, compatibility baseline, README/changelog, and docs; keep Obscura outside umbrella profiles by default because installation does not supply the required binary/image.
    - Security: Each host retains its existing authorization, ownership, permission, guardrail, effect, redaction, and run-limit checks; delegated exposure remains selected/authorized; no host automatically grants Obscura tools.
  - Approach:
    - Documentation Reviewed:
      - `packages/mcp/src/server.ts:40-339`: generic Prism tool dispatch.
      - `packages/ag-ui/src/mcp.ts:40-91` and `packages/ag-ui/src/acp/agent/core.ts`: host tool selection/execution.
      - `packages/antigravity-agent/src/mcp.ts:37-160`: selected generic tool exposure.
      - `docs/agent-session-runtime.md`, `docs/server.md`, `docs/ag-ui.md`, `docs/acp.md`, `docs/workflows.md`, `docs/supervisors.md`.
      - `scripts/package-truth.mjs`, `scripts/package-truth.json`, package/install/export tests.
    - Options Considered:
      - Add Obscura options to every host: rejected; every host already consumes generic tools.
      - Add only cross-host conformance and documentation, editing a host only if the test finds a generic bug: chosen.
      - Add Obscura to `prism-all`: rejected by default, matching host-owned binary adapters; revisit only if umbrella policy explicitly changes.
    - Chosen Approach:
      - Create one fake Obscura tool fixture and run it through public built host APIs. Verify effects, ownership, cancellation, errors, and content survive. Package truth records a deliberate optional opt-out from `prism-all`; consumers install it explicitly.
    - API Notes and Examples:
      ```ts
      const obscura = await createObscuraMcpTools(config);
      const agent = createAgent({ id: "research", provider, model, tools: obscura.tools });
      // Same array may be passed to createPrismMcpServer or delegated exposure.
      ```
    - Files to Create/Edit:
      - `scripts/obscura-host-conformance.test.mjs`: packed/public cross-host fixture.
      - Existing adjacent host tests (tentative): only for a discovered generic host defect.
      - `examples/obscura.ts`: host binary, Docker stdio, external CDP, and agent composition.
      - `scripts/package-truth.json`: regenerate from manifests.
      - `scripts/package-truth.mjs` and package truth tests (tentative): only if new package classification needs a generic category.
      - `src/__tests__/packaging.test.ts`, `src/__tests__/public-export-contract.test.ts`, install-smoke/compat fixtures: new workspace/package surface.
      - `docs/obscura.md`, `docs/index.md`, `docs/release-and-install.md`, related host docs: final public guidance.
      - Root/package `README.md` and `CHANGELOG.md`: package introduction and install command.
      - `scripts/compat-baseline/arnilo__prism-obscura.txt`: reviewed public declaration baseline.
    - References:
      - `packages/computer-use-linux` is the closest explicit-install, host-owned binary precedent.
      - `packages/browser` and `packages/web-tools` provide the reusable browser/web behavior instead of host forks.
  - Test Cases to Write:
    - One read and one mutating fake Obscura tool execute through each named host with identical bounded result semantics.
    - Denied permission/selection prevents remote call in every host path.
    - Abort and remote failure release all owned resources across nested workflow/supervisor/delegated paths.
    - Packed consumer installs `@arnilo/prism-obscura` with declared peers, imports every export, and runs without Obscura until a factory is invoked.
    - Package truth counts the new package and confirms deliberate umbrella omission.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new package becomes installable and documented across host surfaces.
    - Docs pages to create/edit:
      - `docs/obscura.md`: complete API page using required Prism wiki structure.
      - `docs/index.md`: Tools navigation entry.
      - `docs/release-and-install.md`: package count, install, optional-binary and live-test guidance.
      - Relevant host pages: add concise generic-tool composition links only.
    - `docs/index.md` update: yes; add `Obscura browser engine` and update Web search/Browser automation summaries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Run focused, protected, package, security, and release-readiness verification (2026-08-29: complete — all gates green except the pre-existing protected `PRISM_TEST_POSTGRES_URL` release prerequisite, which fails loudly as before)
  - Acceptance Criteria:
    - Functional: Package tests, host conformance, full workspace tests, typecheck, lint, format, coverage, package truth, install smoke, compatibility, deterministic pack, and release gates pass.
    - Performance: Managed startup/close, MCP calls, web search/fetch, and concurrent browser sessions stay inside reviewed ceilings; no material regression to root/browser/web/MCP package budgets.
    - Code Quality: No ignored failures, unexplained skips, stale generated truth, missing exports/docs, or unreviewed compatibility changes; refresh Graft after the large package addition.
    - Security: Threat suites, audit, secret scan, SBOM, URL/endpoint/process adversarial tests, and protected Docker/Playwright/Obscura legs pass or record explicit blocked evidence; missing protected prerequisites never become a passing skip.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md`: independent release readiness and protected gates.
      - `docs/performance.md`: artifact and runtime budgets.
      - Obscura production/security docs at the pinned revision.
      - Root `package.json` scripts and `.github/workflows/sandbox-browser.yml`.
    - Options Considered:
      - Require live Obscura in every default test: rejected; CI/package consumers may not install the binary.
      - Deterministic fake protocol tests by default plus fail-loud protected live legs when enabled: chosen.
    - Chosen Approach:
      - Keep normal tests network-free. Add `PRISM_LIVE_OBSCURA=1` and optional digest-pinned Docker/real Playwright legs to the protected sandbox-browser workflow and release evidence manifest. Run all standard release gates before version changes.
    - API Notes and Examples:
      ```bash
      npm run typecheck && npm run lint && npm run format:check
      npm test && npm run test:coverage && npm run pack:dry-run
      npm run security:threat-suites && npm audit --audit-level=moderate
      PRISM_LIVE_OBSCURA=1 npm run test:live -w @arnilo/prism-obscura
      graft build
      ```
    - Files to Create/Edit:
      - `.github/workflows/sandbox-browser.yml`: optional protected Obscura binary/Docker leg.
      - `scripts/release-skip-manifest.mjs` or its data inputs: named Obscura protected evidence.
      - `scripts/budgets.json`: only evidence-backed intentional budget changes.
      - `docs/performance.md`: startup/call/resource evidence.
      - `docs/_evidence/phase39-obscura-capability-matrix.md`: final verification rows.
      - `graft/`: deterministic graph refresh.
    - References:
      - `npm run sdk:ready` and `npm run release:gate` are existing composed gates.
      - Protected browser/Docker policy already lives in `.github/workflows/sandbox-browser.yml`.
  - Test Cases to Write:
    - Repeat managed startup/search/close benchmark three times and compare medians to reviewed ceilings.
    - Concurrent MCP/CDP use respects caps and reports zero leaked resources after abort storm.
    - Dry pack twice produces identical file list/size and excludes tests, maps, sources, binaries, images, credentials, and temp files.
    - Enabled-but-missing Obscura/Playwright/Docker fails the protected leg loudly.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no additional behavior beyond prior tasks; this task verifies and records it.
    - Docs pages to create/edit:
      - `docs/performance.md`: measured Obscura package envelopes.
      - `docs/_evidence/phase39-obscura-capability-matrix.md`: final pass/blocked matrix.
    - `docs/index.md` update: no; pages are already linked or evidence-only.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Bump and publish only packages changed from Plan 035 onward
  - Acceptance Criteria:
    - Functional: Use `c600eaa18f65b56764ec2fb408ec813536eff6f7` (parent of Plan 035 completion commit `d74b2db4f3bf3b963d599f77923d9ce8a6729355`) as the release baseline; patch-bump every existing package changed from that baseline through this plan, keep every unchanged package version byte-identical, publish new `@arnilo/prism-obscura` at its reviewed initial version, and publish in dependency order.
    - Performance: Release detection, validation, dry-run, and publication use existing manifest-derived scripts; no manual all-workspace publish or redundant lockstep cut.
    - Code Quality: Generate the final changed set with `release.mjs changed --baseline`; use `release.mjs bump --package ... --type patch`; regenerate/validate lockfile, package truth, changelogs, compatibility baselines, tags, and machine-readable reports; do not hand-maintain a stale package list.
    - Security: Publish only from a clean reviewed commit and current signed package tag, with registry availability checks, provenance, audit/SBOM/secret/security/protected gates green, no bypass flags on real publication, and no credentials in reports.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md:151-190`: independent changed-package check/publish and GitHub Actions package-tag flow.
      - `scripts/release.mjs:163-275`: baseline detection, changed packages, independent version validation, single-package bump.
      - `scripts/release.mjs:277-338`: clean/tagged state and publish args.
      - `scripts/release.mjs:340-546`: dependency-order release, resume, reports, and CLI syntax.
      - `scripts/release-gates.mjs:192-261`: independent ranges, compatibility, and tarball gates.
    - Options Considered:
      - Bump every workspace: rejected; user requested updated packages only and independent versioning supports it.
      - Baseline at the Plan 035 completion commit: rejected because it would omit changes made by Plan 035 itself.
      - Baseline at the parent of Plan 035 completion, derive changed packages mechanically, patch existing packages, leave new package at initial version: chosen.
    - Chosen Approach:
      - Capture the pre-bump list from `node scripts/release.mjs changed --baseline c600eaa18f65b56764ec2fb408ec813536eff6f7`. Current candidates are root, `acp-agent`, `model-router`, `prism-wiki`, `supervisor`, `workflows`, and the 17 provider packages changed in the working tree, plus new `obscura`; recompute after all tasks so later changes are included. For each changed package that existed at the baseline, apply one patch bump (`0.3.0 → 0.3.1`, while packages on another line such as `prism-wiki@0.0.1` become their next patch). Do not bump baseline-unchanged packages or the new package twice. Run independent gate/check/dry-run, commit, sign one current changed-package tag at HEAD, push it, and let the existing release workflow publish the full changed set in topological order; retain reports and verify registry manifests.
    - API Notes and Examples:
      ```bash
      BASELINE=c600eaa18f65b56764ec2fb408ec813536eff6f7
      node scripts/release.mjs changed --baseline "$BASELINE"
      node scripts/release.mjs bump --package @arnilo/prism --type patch
      npm run release:gate -- --baseline "$BASELINE"
      npm run release:check -- --baseline "$BASELINE" --allow-dirty --allow-untagged --report /tmp/prism-phase39-check.json
      npm run release:publish -- --baseline "$BASELINE" --dry-run --allow-dirty --allow-untagged --report /tmp/prism-phase39-dry-run.json
      ```
    - Files to Create/Edit:
      - `package.json`: patch version only if root is in final changed set.
      - `packages/<changed>/package.json`: patch versions only for final changed existing packages.
      - `packages/obscura/package.json`: reviewed initial version; no artificial patch bump.
      - `package-lock.json`: exact manifest-version synchronization.
      - Root and changed-package `CHANGELOG.md` files: release entries.
      - `docs/release-and-install.md`: final versions, changed set, command/report/tag handoff.
      - `scripts/package-truth.json`: regenerated version/package graph.
      - `scripts/compat-baseline/*.txt`: reviewed additive surfaces only.
      - `release-artifacts/phase39-check.json`, `release-artifacts/phase39-dry-run.json`, `release-artifacts/phase39-publish.json` (or established artifact path): redacted retained reports.
    - References:
      - Existing release validator rejects changed-but-unbumped and unchanged-but-bumped packages relative to the supplied baseline.
      - Independent internal ranges remain valid within `^0.3.0`; rewrite only a range that no longer satisfies its changed dependency.
  - Test Cases to Write:
    - Baseline diff and release changed list contain the same publishable package names.
    - Every changed existing package version is exactly one patch above baseline; every unchanged package equals baseline; new package has no baseline manifest and one reviewed initial version.
    - Lockfile workspace versions and every internal dependency/peer range satisfy final manifests.
    - Two publish dry-runs produce equivalent order/status/file evidence.
    - Registry preflight refuses existing conflicting versions; resume skips only an identical already-published manifest.
    - Post-publish registry verification confirms all and only final changed packages at expected versions with provenance/tarball contents.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; package versions and published package graph change.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: final independent release matrix, commands, tag, evidence, and rollback.
      - `docs/migration.md`: only if implementation introduces a documented breaking behavior; otherwise explicitly record no migration.
    - `docs/index.md` update: update Release and install summary/version/package count.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Task 1 (complete): The capability matrix pins Obscura `0.1.0` at revision `f449e6f` and records all 37 MCP tools, the 2 render-only tools, CLI modes, env bounds, and security posture. Primitive review confirmed `connectMcpTools`, `@arnilo/prism-browser` (manager, `classifyBrowserUrl`/`BrowserNetworkPolicy`), and `createWebTools` are directly reusable; work-tools' `createCliRunner` and the LSP/docker process lifecycles are pattern-only (wrong limits/dependency direction), so the minimal owned-process lifecycle stays private to `@arnilo/prism-obscura` as planned. No generic core primitive will be extracted for one consumer.
- Task 2 (complete): Lifecycle ships as one private `spawnObscuraProcess` (validation, bounded readiness probe, group SIGTERM→SIGKILL, idempotent close, capped stderr, redacted errors) plus `validateObscuraCommand` and bounded limits; endpoint/URL validation is deferred to the tasks that connect transports (3/4) rather than built speculatively. `@arnilo/prism-obscura@0.3.0` declares the core peer immediately (peer-policy Decision B gate) even though task 2 code does not import it yet. Package-truth (`scripts/package-truth.json`, `scripts/phase24-truth.test.mjs` flags) updated now so root gates stay green; umbrella `prism-all` omits Obscura deliberately (binary not supplied by install).
- Task 4 (complete): `connectObscuraCdp` reuses `spawnObscuraProcess` for managed `serve` (waitReady probes the endpoint's `/json/version` over HTTP — bounded, abortable, no fixed sleep) and calls Playwright `chromium.connectOverCDP` exactly once; `connect`/launch are structurally absent from the injected surface and the optional `playwright-core@1.61.0` peer is loaded like document-reader's optional peers (fail-closed message). Endpoint validation: loopback-only, credential-free, ws(s)/http(s) only; `allowRemoteEndpoint` opt-in still refuses remote plain `ws:`/`http:` (no authentication — wss/https tunnel required). `close()` closes the browser first, then any owned process; external servers stay alive. `packages/obscura/src/browser.ts` was **not** created: `createBrowserTools({ browser })` already accepts the returned browser directly, so a wrapper adds no wiring. `@arnilo/prism-browser` is a required peer (type-level contract for consumers); `browser_search` naming caveat unaffected. Docs: obscura.md CDP section, browser-automation.md Related APIs recipe, README/CHANGELOG, index entry extended. Tests (33 total): composition end-to-end over a fake Obscura-compatible browser (open/snapshot/evaluate/observe/close through `createBrowserTools`), connectOverCDP-only seam, managed retry/abort/timeout/close-ownership, external-server survival, endpoint and port validation.
- Task 5 (complete): `runObscuraCli` spawns shell-free, validates argv via the existing `validateObscuraCommand`, caps stdout/stderr, kills children on timeout/abort, and redacts argv from diagnostics. `createObscuraWebTools` exposes standard `web_search`/`web_fetch` plus native `obscura_fetch`/`obscura_scrape` (disable via `nativeTools: false`). Public-web search uses one replaceable HTML search profile (`search-profile.ts`, DuckDuckGo HTML default) whose extraction JavaScript is constant — queries travel only URL-encoded inside the search URL, never inside evaluated source; `browser_search` is never exposed. URLs are validated through core `assertSsrfAllowedUrl` (wrapped as `ObscuraError`) before any child starts; custom scrape expressions require `allowEval: true` and stay byte-capped. `@arnilo/prism-web-tools` is a new required peer (reused `citation()`/normalized untrusted shapes; `WebProvider` widened additively with "obscura" — the only web-tools change). Batch association is preserved by index with `{url,error}` rows for missing output. An opt-in live smoke test (`test:live`, `PRISM_LIVE_OBSCURA=1` + `PRISM_OBSCURA_BIN`) stays skipped in the default network-free suite; the deterministic suite drives a materialized fake obscura CLI (hang/exit/garbage/oversize modes). Docs: obscura.md web section, web-tools.md Obscura-alternative note, index web entry, README/CHANGELOG. Tests (55 total): normalization/citations, encoding, association, policy/limits/eval gates, malformed JSON, oversize, spawn/exit/timeout/abort kills, profile validation, live skip.
- Task 3 (complete): `createObscuraMcpTools` wraps `connectMcpTools` — no MCP reimplementation. Effect classification: 18 read/diagnostic/waiter/capture tools effect-free (incl. `browser_search`, which is in-page text search); all other advertised tools and unknown future upstream tools default to the bridge's conservative external-mutation and get `exclusive: true` plus serialized dispatch (one live page). `tools` is a live getter so `refresh()` propagates. stdio transport configs reuse `validateObscuraCommand`; non-loopback Streamable HTTP requires explicit `allowRemoteHttp` (loopback/origin security stays in `@arnilo/prism-mcp`). Naming defaults to `obscura_`; `namePrefix: ""` keeps native names. Docs: `docs/obscura.md` created (covers task 2 lifecycle too), `docs/index.md` Tools entry, `docs/mcp-tools.md` cross-reference; `phase24-truth.test.mjs` second-peer table extended with the obscura entry.

- Task 6 (complete): one fake-CLI-backed Obscura `ToolDefinition[]` (`web_fetch` read + `obscura_scrape` mutating, wrapped with an execution counter) runs through each host's **public** API: core `createAgent`/`AgentSession.run` (read + exclusive-serialized mutation), `createPrismMcpServer` + InMemory client (`tools/list`, `tools/call`, denied authorize never executes), `createPrismHandler` server lifecycle, AG-UI `createAgUiHandler` + `createAgUiMcpAdapter` (host-selected `web_fetch` through the normal session loop), ACP `createPrismAcpAgent` (`session/prompt`, client `request_permission` seam), workflow `toolNode` + `agentNode`, supervisor children (allowed + hooks-denied paths), and Antigravity `createAntigravityMcpExposure` (selection-limited exposure, delegated MCP call). Abort test proves an in-flight Obscura call settles and kills the owned child. Zero host-source edits — the claim "hosts need no Obscura-specific branch" is proven, not asserted. Generic behaviors surfaced by conformance (not changed): MCP serialization presents untrusted-content labels (values asserted end to end in core/workflow paths); ACP routes every tool through the client permission seam even for reads. Package truth published: `scripts/compat-baseline/arnilo__prism-obscura.txt` (40 declarations, no `__tests__` leakage); `phase29`/`phase30` freeze package-count formulas extended with the obscura term (umbrella-omission precedent, same as Graft); `phase24-truth` second-peer table already covers it. Docs: `docs/obscura.md` Host-conformance section, `examples/obscura.ts` (typechecked) + `examples/README.md`, release-and-install counts (60 publishable/59 workspace, install row, umbrella opt-out wording), host pages Related-API links, root README capability row + umbrella omissions, root CHANGELOG unreleased entry, `plans/README.md` entry, obscura CHANGELOG 0.1.0/0.0.28 backfill for the packaging docs gate.

- Task 7 (complete): full `npm test` green 2x (core 1,690 + every workspace suite + freezes/truth/gates), typecheck/lint/format clean, coverage green (core gate + new `@arnilo/prism-obscura` threshold 94.61 lines in `coverage-thresholds.json` — coverage-summary is fail-closed on missing entries), threat suites 59/59, audit 0 vulnerabilities, package truth/install smoke/compat baseline green, pack deterministic twice byte-identical (obscura tarball 34.4 kB/16 files), `release:gate` blocked ONLY by the pre-existing protected Postgres env prerequisite (obscura surface `pass`; no new blocked names). Historical freezes that counted packages were refreshed with the obscura exclusion precedent (phase13–21 count filters; phase16 exit-gate lockfile name filter — obscura adds no new external dependency names; phase27 `hasObscuraPackage` count term; phase19/21 `preservedSurface` hash refreshes with `$comment` notes attributing src/cache-helpers.ts to plan 035 and provider-kimi moonshot.ts to plan 037 work). New evidence: `scripts/benchmark-obscura.mjs` (3x medians: startup ~0.02 ms vs 250, CLI search ~20 ms vs 100, group close ~0.6 ms vs 250; artifact `benchmark-obscura.json`; not a release gate), `docs/performance.md` Phase 39 envelope section, final verification matrix appended to `docs/_evidence/phase39-obscura-capability-matrix.md`, `Obscura live browser legs` protected row (`PRISM_LIVE_OBSCURA` requiredEnv) in `scripts/release-skip-manifest.mjs`, optional `PRISM_ENABLE_OBSCURA_GATE` leg + build + aggregate report flag in `.github/workflows/sandbox-browser.yml`, and the live test now throws when enabled but `PRISM_OBSCURA_BIN` is missing (never a silent pass). Concurrency evidence is behavioral: MCP bridge serializes mutations, abort legs settle in-flight calls and kill owned children (host conformance abort test + process/web timeout/abort tests); committed no timing gate. Blocked live evidence: no OBS binary/credentials on this machine — Docker/binary/Playwright legs stay named protected rows. `release.mjs changed` does not list obscura until the package is committed (git-diff baseline) — Task 2 Further-Action note stands.
## Further Actions
- Task 2 note: `git diff`-based release detection does not see untracked new packages; `packages/obscura` must be committed before the final release check, otherwise `release.mjs changed` omits it.
- Task 3+ may add a generic process-lifecycle primitive only if a second consumer appears; until then keep the obscura runner private (priority: low).
- Re-run the capability-matrix review whenever the pinned Obscura revision changes; the tool classification table in Task 3 must be updated in the same change (priority: medium, on upgrade).
