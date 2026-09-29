#!/usr/bin/env bun
/**
 * prism-code: Terminal coding agent on @arnilo/prism-agent-sdk.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseFlags } from "../src/flags.js";
import type {
  PrismCodeApprovalMode,
  PrismCodeConfig,
  PrismCodeConfigLayer,
  PrismCodeCredentialManager,
  PrismCodeCredentialStoreChoice,
} from "../src/index.js";
import { applyOpenTuiLibc } from "../src/libc.js";
import { resolvePrismCodeChannel, resolvePrismCodeVersion } from "../src/version.js";

const USAGE = `
Usage:
  prism-code [options] [prompt]
  prism-code acp [options]

Commands:
  acp                        Serve ACP (Agent Client Protocol) over stdio
  doctor                     Diagnose runtime, credentials, providers, MCP, and storage

Options:
  -p, --prompt <text>        Prompt to execute
  -m, --mode <mode>          Execution mode: tui (default), print, json, acp
  --json                     Machine-readable JSON output (doctor)
  -c, --config <path>        Config file path (default: prism-code.json)
  --session <id>             Resume session by ID
  --continue                 Resume the most recent session for this repository
  --resume                   Open the session picker at startup (TUI mode)
  --trust-project-mcp        Trust project-config MCP servers for this run without prompting
  --model <model>            Model specification (e.g. anthropic/claude-sonnet-4-5)
  --provider <provider>      Provider name
  --max-turns <n>            Maximum provider turns per run
  --max-cost <usd>           Maximum run cost in USD
  --approve <mode>           Headless approval: deny (default), edits, or all
  --no-agents-md             Skip loading AGENTS.md instructions
  --no-system-md             Skip loading global SYSTEM.md instructions
  -h, --help                 Show this help message
  -v, --version              Show version
`;

/** Actionable one-liner for a missing provider credential (names the env var to set). */
function missingCredentialGuidance(config: PrismCodeConfig, app: typeof import("../src/index.js")): string {
  const providerId = config.model?.provider;
  if (!providerId) {
    return 'prism-code: no AI provider configured. Run "prism-code" to pick one, or set "model" in prism-code.json.';
  }
  const desc = app.getShippedProvider(providerId);
  const envVars = desc?.envVars.length ? desc.envVars : (app.PROVIDER_ENV_VARS[providerId] ?? []);
  const hint = envVars.length > 0 ? `Set ${envVars.join(" or ")}` : 'Run "prism-code" to authenticate';
  return `prism-code: no usable credential for "${providerId}". ${hint}, or run "prism-code" to set it up.`;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));

  if (flags.help) {
    console.log(USAGE.trim());
    process.exit(0);
  }

  if (flags.version) {
    console.log(`${resolvePrismCodeVersion()} (${resolvePrismCodeChannel()})`);
    process.exit(0);
  }

  // Before the app graph (and OpenTUI) loads: select OpenTUI's musl native library on musl hosts.
  applyOpenTuiLibc();

  // Loaded after the --help/--version fast path: evaluating the app graph costs ~350 ms, which a
  // version probe (install smokes, support diagnostics) should not pay.
  const app = await import("../src/index.js");
  const {
    applyFlagOverlay,
    assembleAppAgent,
    autoDetectProvider,
    createPrismCodeApprovalPolicy,
    createPrismCodeTui,
    createProviderCache,
    doctorReportToJson,
    enrichModelConfig,
    ensureHomeDir,
    formatDoctorTable,
    hasUsableProvider,
    legacySessionDbNotice,
    loadPrismCodeConfigLayer,
    mcpServerOrigins,
    mergePrismCodeConfigLayers,
    PRISM_CREDENTIALS_PASSPHRASE_ENV,
    readGlobalConfig,
    readState,
    resolveContinueSessionId,
    resolvePrismHome,
    resolveSessionStore,
    runDoctor,
    runHeadless,
    selectCredentialStore,
    serveAcp,
    sessionRecordExists,
    UNKNOWN_MODEL_LIMITS,
    writeState,
  } = app;

  const home = resolvePrismHome();
  let rawConfig: PrismCodeConfig;
  let mcpOrigins: ReadonlyMap<string, "global" | "project"> = new Map();
  try {
    ensureHomeDir(home);
    const layers: PrismCodeConfigLayer[] = [];
    const originLayers: { layer: PrismCodeConfigLayer; origin: "global" | "project" }[] = [];
    const global = readGlobalConfig(home);
    if (global) {
      layers.push(global.config);
      originLayers.push({ layer: global.config, origin: "global" });
    }

    const configPath = resolve(flags.config ?? "prism-code.json");
    if (existsSync(configPath)) {
      const project = loadPrismCodeConfigLayer(configPath);
      layers.push(project);
      originLayers.push({ layer: project, origin: "project" });
    } else {
      if (flags.config) {
        console.error(`prism-code: specified config file does not exist: ${configPath}`);
        process.exit(1);
      }
      const fallback = { cwd: process.cwd() };
      layers.push(fallback);
      originLayers.push({ layer: fallback, origin: "project" });
    }
    mcpOrigins = mcpServerOrigins(originLayers);
    rawConfig = mergePrismCodeConfigLayers(layers, process.cwd());
  } catch (err) {
    console.error(`prism-code: ${(err as Error).message}`);
    process.exit(1);
  }

  // Remembered selection is the fallback only when neither config nor flags choose a model.
  const { state: rememberedState, notice: stateNotice } = readState(home);
  if (stateNotice) console.error(stateNotice);
  if (!rawConfig.model && flags.model === undefined && flags.provider === undefined && rememberedState.lastModel) {
    rawConfig = {
      ...rawConfig,
      model: { provider: rememberedState.lastModel.provider, model: rememberedState.lastModel.model },
    };
  }

  let config = applyFlagOverlay(rawConfig, flags);
  const mode = flags.mode ?? (flags.prompt !== undefined ? "print" : "tui");

  // `prism-code doctor` diagnoses the environment without starting a session.
  if (flags.subcommand === "doctor") {
    const report = await runDoctor({ config, home });
    console.log(flags.json === true ? doctorReportToJson(report) : formatDoctorTable(report));
    process.exit(report.exitCode);
  }

  // Session-selection flags are mutually exclusive; --resume needs the interactive TUI.
  const sessionFlagCount = [flags.session !== undefined, flags.continueRecent === true, flags.resume === true].filter(Boolean).length;
  if (sessionFlagCount > 1) {
    console.error("prism-code: choose only one of --session, --continue, --resume.");
    process.exit(1);
  }
  if (flags.resume && mode !== "tui") {
    console.error("prism-code: --resume requires TUI mode.");
    process.exit(1);
  }
  if ((flags.continueRecent || flags.resume) && mode === "acp") {
    console.error("prism-code: --continue/--resume are not supported in ACP mode.");
    process.exit(1);
  }

  const sessionStoreNotice = legacySessionDbNotice(config, home);
  if (sessionStoreNotice && mode !== "tui") console.error(sessionStoreNotice);

  // Exactly one credential manager per process, shared by TUI, headless, ACP, /compact, and OM.
  let credentialManager: PrismCodeCredentialManager;
  let credentialStoreNeedsChoice = false;
  let credentialStoreSelection: Awaited<ReturnType<typeof selectCredentialStore>>;
  try {
    credentialStoreSelection = await selectCredentialStore({ config, state: rememberedState, home });
    credentialManager = credentialStoreSelection.manager;
    credentialStoreNeedsChoice = credentialStoreSelection.needsChoice;
    if (credentialStoreSelection.notice && mode !== "tui") console.error(credentialStoreSelection.notice);
  } catch (err) {
    console.error(`prism-code: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // No config, no flags, no remembered model: auto-detect the first provider with a credential.
  if (!config.model && flags.model === undefined && flags.provider === undefined) {
    const detected = await autoDetectProvider(credentialManager);
    if (detected) {
      config = { ...config, model: detected };
      if (mode !== "tui") console.error(`prism-code: auto-selected ${detected.provider}/${detected.model}`);
    }
  }

  // Fill limits/capabilities from the shipped catalog so effort levels and the compaction trigger
  // have real numbers; a model the catalog does not describe gets conservative assumed limits.
  let modelNotice: string | undefined;
  if (config.model) {
    const enriched = await enrichModelConfig(config.model);
    config = { ...config, model: enriched.model };
    if (enriched.usedDefaults) {
      modelNotice = `limits assumed (${UNKNOWN_MODEL_LIMITS.contextWindow.toLocaleString()} ctx) — "${enriched.model.model}" is not in the ${enriched.model.provider} catalog`;
      if (mode !== "tui") console.error(`prism-code: ${modelNotice}`);
    }
  }

  const providerCache = createProviderCache({
    credentialRef: config.credentialRef,
    resolver: credentialManager.createResolver(),
    credentialManager,
  });

  if (mode === "tui") {
    // Resolve the startup session once here (store opened once, then handed to the TUI).
    let startupSessionId = flags.session;
    let startupStore: ReturnType<typeof resolveSessionStore> | undefined;
    if (startupSessionId !== undefined || flags.continueRecent) {
      startupStore = resolveSessionStore(config, home);
      if (flags.continueRecent) {
        try {
          startupSessionId = await resolveContinueSessionId(startupStore, config.cwd);
        } catch (err) {
          console.error(`prism-code: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
        if (!startupSessionId) {
          console.error("prism-code: no prior sessions for this repository.");
          process.exit(1);
        }
      }
      if (startupSessionId !== undefined && !(await sessionRecordExists(startupStore, startupSessionId))) {
        console.error(`prism-code: session not found: ${startupSessionId}`);
        process.exit(1);
      }
    }

    let tui: ReturnType<typeof createPrismCodeTui> | undefined;
    const approvalMode: PrismCodeApprovalMode =
      flags.approve === "all" ? "auto" : flags.approve === "edits" ? "accept-edits" : (config.approval?.mode ?? "ask");
    const approval = createPrismCodeApprovalPolicy({
      roots: [config.cwd],
      cwd: config.cwd,
      home,
      mode: approvalMode,
      ...(config.approval?.timeoutMs !== undefined ? { timeoutMs: config.approval.timeoutMs } : {}),
      prompt: async (request) => {
        if (!tui) return "deny";
        const decision = await tui.promptApproval({ action: request.action });
        if (decision === "allow_once") return "once";
        if (decision === "allow_for_run") return "run";
        if (decision === "allow_always") return "always";
        return "deny";
      },
    });

    tui = createPrismCodeTui({
      config,
      onExit: (code) => process.exit(code),
      credentialManager,
      providerCache,
      approvalController: approval,
      initialEffort: rememberedState.lastEffort,
      modelNotice,
      ...(startupSessionId !== undefined ? { sessionId: startupSessionId } : {}),
      ...(startupStore ? { store: startupStore } : {}),
      ...(flags.resume ? { openResumePicker: true } : {}),
      ...(sessionStoreNotice ? { setupNotes: [sessionStoreNotice] } : {}),
      ...(credentialStoreNeedsChoice
        ? {
            onCredentialStoreChoiceNeeded: async () => {
              const choice = await tui?.promptCredentialStoreChoice();
              let applied: PrismCodeCredentialStoreChoice = choice ?? "memory";
              let passphrase: string | undefined;
              if (applied === "encrypted-file" && !process.env[PRISM_CREDENTIALS_PASSPHRASE_ENV]) {
                passphrase = await tui?.promptSecret("Passphrase for the encrypted credential store: ");
                if (!passphrase) applied = "memory";
              }
              try {
                await credentialStoreSelection.apply(applied, passphrase ? { passphrase } : undefined);
                writeState(home, { credentialStore: applied });
                tui?.notify(
                  applied === "memory"
                    ? "Credentials will be kept for this session only."
                    : `Credentials will be saved using the "${applied}" store.`,
                );
              } catch (error) {
                tui?.notify(
                  `Could not open the credential store: ${error instanceof Error ? error.message : String(error)}. Using this session only.`,
                );
                await credentialStoreSelection.apply("memory").catch(() => {});
              }
            },
          }
        : {}),
      onSelectionChange: (selection) => {
        try {
          writeState(home, {
            lastModel: { provider: selection.model.provider, model: selection.model.model },
            lastEffort: selection.effort,
          });
        } catch {
          // Remembered selection is best-effort; a failed state write must not break the session.
        }
      },
    });

    // First run: no usable provider -> interactive onboarding (provider -> credential -> model) before assembly.
    if (!(await hasUsableProvider(config, { credentialManager }))) {
      const onboarded = await tui.onboardProvider();
      if (!onboarded) {
        await tui.close();
        return;
      }
      config = { ...config, model: onboarded };
    }

    const assembled = await assembleAppAgent(config, undefined, approval.policy, undefined, credentialManager, providerCache, undefined, {
      askUser: (request) => tui?.promptAskUserDecision(request) ?? Promise.reject(new Error("TUI is not started")),
      mcpTrust: {
        origins: mcpOrigins,
        mode: flags.trustProjectMcp ? "allow" : "prompt",
        home,
        promptTrust: (server) => tui?.promptMcpTrust(server) ?? Promise.resolve(false),
        notify: (text) => tui?.notify(text),
      },
    });
    await tui.start(assembled);
  } else if (mode === "print" || mode === "json") {
    if (!flags.prompt) {
      console.error("prism-code: headless mode requires a prompt (-p, --prompt).");
      process.exit(1);
    }
    if (!(await hasUsableProvider(config, { credentialManager }))) {
      console.error(missingCredentialGuidance(config, app));
      process.exit(1);
    }
    const exitCode = await runHeadless({
      config,
      prompt: flags.prompt,
      mode,
      sessionId: flags.session,
      continueRecent: flags.continueRecent,
      credentialManager,
      ...(flags.approve !== undefined ? { approve: flags.approve } : {}),
      home,
      mcpTrust: { origins: mcpOrigins, mode: flags.trustProjectMcp ? "allow" : "skip", home },
    });
    process.exit(exitCode);
  } else if (mode === "acp") {
    if (!(await hasUsableProvider(config, { credentialManager }))) {
      console.error(missingCredentialGuidance(config, app));
      process.exit(1);
    }
    try {
      await serveAcp({ config, credentialManager, providerCache, home });
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? (err as { code?: unknown }).code : undefined;
      if (code === "EPIPE") {
        process.exit(0);
      }
      console.error(`prism-code: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(`prism-code: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
