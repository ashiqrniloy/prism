import { describe, it } from "bun:test";
import assert from "node:assert";
import { createMemorySessionStore, type ModelConfig } from "@arnilo/prism";
import { createTestRenderer } from "@opentui/core/testing";
import { MemoryStoredCredentialStore, PrismCodeCredentialManager } from "../credentials.js";
import { describeProviderCredentialStatus, getShippedProvider } from "../index.js";
import { ObservationalMemoryCoordinator } from "../observational-memory.js";
import { type CommandContext, handleSlashCommand, parseCommandArgs } from "../tui/commands.js";
import { PickerComponent, type UiPickerOption } from "../tui/components/picker.js";
import { createInitialTuiState, type TuiState } from "../tui/reducer.js";
import { stubGlobalFetch } from "./helpers/global-fetch.js";

describe("TUI Slash Commands & Picker Filtering", () => {
  it("handleSlashCommand ignores non-slash prompts", async () => {
    const memoryStore = new MemoryStoredCredentialStore();
    const manager = new PrismCodeCredentialManager({ store: memoryStore });

    const context: any = {
      credentialManager: manager,
    };

    const result = await handleSlashCommand("hello world", context);
    assert.strictEqual(result.handled, false);
  });

  it("handleSlashCommand handles /help and unknown commands", async () => {
    const memoryStore = new MemoryStoredCredentialStore();
    const manager = new PrismCodeCredentialManager({ store: memoryStore });
    const streamEntries: any[] = [];

    const mockStream: any = {
      appendOrUpdate: (entry: any) => {
        streamEntries.push(entry);
      },
    };

    const context: any = {
      stream: mockStream,
      credentialManager: manager,
    };

    const helpResult = await handleSlashCommand("/help", context);
    assert.strictEqual(helpResult.handled, true);
    assert.ok(streamEntries.some((e) => e.text?.includes("Available slash commands")));

    const unknownResult = await handleSlashCommand("/nonexistent", context);
    assert.strictEqual(unknownResult.handled, true);
    assert.ok(streamEntries.some((e) => e.type === "error" && e.message?.includes("Unknown command")));
  });

  it("PickerComponent filters options in-memory as keys are typed without network requests", async () => {
    const env = await createTestRenderer({ width: 80, height: 24 });
    const picker = new PickerComponent(env.renderer);

    const options: UiPickerOption[] = [
      { name: "Anthropic Claude 3.7", value: "anthropic" },
      { name: "OpenAI GPT-4o", value: "openai" },
      { name: "Google Gemini Pro", value: "google" },
      { name: "DeepSeek R1", value: "deepseek" },
    ];

    // Show picker
    const showPromise = picker.show("Select Provider", options);
    assert.strictEqual(picker.isVisible, true);
    assert.strictEqual(picker.currentFilteredCount, 4);

    // Type 'g'
    picker.handleKey({ name: "g", sequence: "g" });
    assert.strictEqual(picker.currentFilterQuery, "g");
    assert.ok(picker.currentFilteredCount >= 1);

    // Type 'e' -> "ge" (Google Gemini)
    picker.handleKey({ name: "e", sequence: "e" });
    assert.strictEqual(picker.currentFilterQuery, "ge");
    assert.strictEqual(picker.currentFilteredCount, 1);

    // Backspace -> "g"
    picker.handleKey({ name: "backspace" });
    assert.strictEqual(picker.currentFilterQuery, "g");

    // Select with return
    picker.handleKey({ name: "return" });
    const selected = await showPromise;
    assert.ok(selected);
    assert.strictEqual(picker.isVisible, false);

    env.renderer.destroy();
  });

  it("PickerComponent cancels on escape", async () => {
    const env = await createTestRenderer({ width: 80, height: 24 });
    const picker = new PickerComponent(env.renderer);

    const options: UiPickerOption[] = [{ name: "Opt 1", value: "1" }];
    const showPromise = picker.show("Select Option", options);

    picker.handleKey({ name: "escape" });
    const result = await showPromise;
    assert.strictEqual(result, undefined);
    assert.strictEqual(picker.isVisible, false);

    env.renderer.destroy();
  });

  it("PickerComponent keeps the filter and selection when a live refresh replaces the options", async () => {
    const env = await createTestRenderer({ width: 80, height: 24 });
    const picker = new PickerComponent(env.renderer);

    const options: UiPickerOption[] = [
      { name: "grok-4.5", value: "grok-4.5" },
      { name: "longcat-2.5-preview-free", value: "longcat-2.5-preview-free" },
      { name: "glm-5.3", value: "glm-5.3" },
    ];
    const showPromise = picker.show("Select Model (OpenCode Go)", options);
    for (const char of "longcat") picker.handleKey({ name: char, sequence: char });
    assert.strictEqual(picker.currentFilterQuery, "longcat");

    // The credential probes re-option the visible picker while the filter is active.
    picker.setOptions(
      [
        { name: "grok-4.5", value: "grok-4.5" },
        { name: "longcat-2.5-preview-free", value: "longcat-2.5-preview-free" },
        { name: "glm-5.3", value: "glm-5.3" },
        { name: "longcat-2.0", value: "longcat-2.0" },
      ],
      "Select Model (OpenCode Go)",
    );
    assert.strictEqual(picker.currentFilterQuery, "longcat");
    assert.strictEqual(picker.currentFilteredCount, 2);
    assert.strictEqual(picker.selectedOption?.value, "longcat-2.5-preview-free");

    // A refresh that drops the filtered entry must not resurrect the unfiltered list at index 0.
    picker.setOptions([{ name: "grok-4.5", value: "grok-4.5" }], "Select Model (OpenCode Go)");
    assert.strictEqual(picker.currentFilteredCount, 0);
    assert.strictEqual(picker.selectedOption, undefined);

    env.renderer.destroy();
    picker.handleKey({ name: "escape" });
    await showPromise;
  });

  it("/provider slash command allows selecting provider, prompts for secret, and saves credential", async () => {
    const restoreFetch = stubGlobalFetch(
      (async () =>
        new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch,
    );
    try {
      const env = await createTestRenderer({ width: 80, height: 24 });
      const picker = new PickerComponent(env.renderer);
      const memoryStore = new MemoryStoredCredentialStore();
      const manager = new PrismCodeCredentialManager({ store: memoryStore });

      const streamEntries: any[] = [];
      const mockStream: any = {
        appendOrUpdate: (entry: any) => streamEntries.push(entry),
      };

      let updatedFooter: any = {};
      const mockStatus: any = {
        update: (patch: any) => {
          updatedFooter = { ...updatedFooter, ...patch };
        },
      };

      let currentModel: ModelConfig = { provider: "mock", model: "default" };
      const state = createInitialTuiState();

      const context: CommandContext = {
        state,
        picker,
        stream: mockStream,
        status: mockStatus,
        credentialManager: manager,
        currentModel,
        config: { cwd: "/test" },
        store: createMemorySessionStore(),
        onUpdateState: (patch) => Object.assign(state, patch),
        onUpdateModel: (m) => {
          currentModel = m;
        },
        promptSecret: async () => "sk-ant-test-secret-key",
      };

      // Run /provider
      const commandPromise = handleSlashCommand("/provider", context);

      // Provider statuses are resolved before the picker opens; wait for it, then type 'anthropic' and press return.
      for (let i = 0; i < 500 && !picker.isVisible; i++) await new Promise((resolve) => setTimeout(resolve, 1));
      assert.strictEqual(picker.isVisible, true, "expected the provider picker to open");
      picker.handleKey({ name: "a", sequence: "a" });
      picker.handleKey({ name: "n", sequence: "n" });
      picker.handleKey({ name: "t", sequence: "t" });
      picker.handleKey({ name: "return" });

      // /provider then opens /model with the catalog default first; accept it.
      for (let i = 0; i < 500 && !picker.isVisible; i++) await new Promise((resolve) => setTimeout(resolve, 1));
      assert.strictEqual(picker.isVisible, true, "expected the model picker to open after provider selection");
      picker.handleKey({ name: "return" });

      const result = await commandPromise;
      assert.strictEqual(result.handled, true);

      // Never the literal "default": the catalog default is applied.
      assert.notStrictEqual(updatedFooter.model, "default");
      assert.strictEqual(updatedFooter.model, "claude-sonnet-5");
      assert.strictEqual(currentModel.model, "claude-sonnet-5");

      // Verify credential saved in manager
      const saved = await manager.getApiKey("anthropic");
      assert.strictEqual(saved, "sk-ant-test-secret-key");

      // Verify secret was NEVER echoed into stream
      for (const entry of streamEntries) {
        if (entry.text) {
          assert.strictEqual(entry.text.includes("sk-ant-test-secret-key"), false);
        }
      }

      // Verify status footer updated
      assert.strictEqual(updatedFooter.provider, "anthropic");

      env.renderer.destroy();
    } finally {
      restoreFetch();
    }
  });

  it("/provider keeps a model already pinned for the selected provider", async () => {
    // Regression (plan 140 Task 6 live run): /provider replaced `--model opencode-go/<id>` with the
    // provider's catalog default, so a gateway-live model was silently swapped for grok-4.5.
    const restoreFetch = stubGlobalFetch(
      (async () =>
        new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch,
    );
    try {
      const env = await createTestRenderer({ width: 80, height: 24 });
      const picker = new PickerComponent(env.renderer);
      const manager = new PrismCodeCredentialManager({ store: new MemoryStoredCredentialStore() });
      const mockStream: any = { appendOrUpdate: () => {} };
      const state = createInitialTuiState();
      let currentModel: ModelConfig = { provider: "opencode-go", model: "longcat-2.5-preview-free" };
      let updatedFooter: any = {};
      const context: CommandContext = {
        state,
        picker,
        stream: mockStream,
        status: { update: (patch: any) => (updatedFooter = { ...updatedFooter, ...patch }) } as any,
        credentialManager: manager,
        currentModel,
        config: { cwd: "/test" },
        store: createMemorySessionStore(),
        onUpdateState: (patch) => Object.assign(state, patch),
        onUpdateModel: (m) => {
          currentModel = m;
        },
        promptSecret: async () => "oc_test_key",
      };

      const commandPromise = handleSlashCommand("/provider", context);
      for (let i = 0; i < 500 && !picker.isVisible; i++) await new Promise((resolve) => setTimeout(resolve, 1));
      assert.strictEqual(picker.isVisible, true, "expected the provider picker to open");
      for (const char of "opencode-go") picker.handleKey({ name: char, sequence: char });
      picker.handleKey({ name: "return" });

      for (let i = 0; i < 500 && !picker.isVisible; i++) await new Promise((resolve) => setTimeout(resolve, 1));
      assert.strictEqual(picker.isVisible, true, "expected the model picker to open");
      picker.handleKey({ name: "escape" }); // keep the pinned model

      await commandPromise;
      assert.strictEqual(currentModel.provider, "opencode-go");
      assert.strictEqual(currentModel.model, "longcat-2.5-preview-free");
      assert.strictEqual(updatedFooter.provider, "opencode-go");
      assert.strictEqual(await manager.getApiKey("opencode-go"), "oc_test_key");

      env.renderer.destroy();
    } finally {
      restoreFetch();
    }
  });

  it("/model command errors when provider is not authenticated", async () => {
    const env = await createTestRenderer({ width: 80, height: 24 });
    const picker = new PickerComponent(env.renderer);
    const memoryStore = new MemoryStoredCredentialStore();
    const manager = new PrismCodeCredentialManager({ store: memoryStore });

    const streamEntries: any[] = [];
    const mockStream: any = {
      appendOrUpdate: (entry: any) => streamEntries.push(entry),
    };

    // State with unauthenticated deepseek provider
    const state: TuiState = {
      ...createInitialTuiState(),
      footer: {
        provider: "deepseek",
        model: "default",
        effort: "off",
        connectedMcpCount: 0,
      },
    };

    const prev = process.env.DEEPSEEK_API_KEY;
    try {
      delete process.env.DEEPSEEK_API_KEY;

      const context: CommandContext = {
        state,
        picker,
        stream: mockStream,
        status: { update: () => {} } as any,
        credentialManager: manager,
        currentModel: { provider: "deepseek", model: "default" },
        config: { cwd: "/test" },
        store: createMemorySessionStore(),
        onUpdateState: () => {},
        onUpdateModel: () => {},
      };

      const result = await handleSlashCommand("/model", context);
      assert.strictEqual(result.handled, true);
      assert.ok(streamEntries.some((e) => e.type === "error" && e.message?.includes("not authenticated")));
    } finally {
      if (prev !== undefined) process.env.DEEPSEEK_API_KEY = prev;
      env.renderer.destroy();
    }
  });

  it("/logout openai-codex deletes stored OAuth, reports not configured, and never echoes the token", async () => {
    const env = await createTestRenderer({ width: 80, height: 24 });
    const picker = new PickerComponent(env.renderer);
    const manager = new PrismCodeCredentialManager({ store: new MemoryStoredCredentialStore() });
    await manager.setOAuth("openai-codex", { access: "oauth-secret-token-abc", refresh: "r", expires: Date.now() + 60_000 });

    const streamEntries: any[] = [];
    const context: CommandContext = {
      state: createInitialTuiState(),
      picker,
      stream: { appendOrUpdate: (entry: any) => streamEntries.push(entry) } as any,
      status: { update: () => {} } as any,
      credentialManager: manager,
      currentModel: { provider: "openai-codex", model: "gpt-5.1-codex" },
      config: { cwd: "/test" },
      store: createMemorySessionStore(),
      onUpdateState: () => {},
      onUpdateModel: () => {},
    };

    const result = await handleSlashCommand("/logout openai-codex", context);
    assert.strictEqual(result.handled, true);
    assert.strictEqual(await manager.getOAuth("openai-codex"), undefined);
    assert.ok(streamEntries.some((e) => e.type === "message" && e.text?.includes("Signed out of OpenAI Codex")));
    for (const entry of streamEntries) {
      assert.strictEqual(entry.text?.includes("oauth-secret-token-abc") ?? false, false);
      assert.strictEqual(entry.message?.includes("oauth-secret-token-abc") ?? false, false);
    }

    const desc = getShippedProvider("openai-codex");
    assert.ok(desc);
    const status = await describeProviderCredentialStatus(desc, manager, {});
    assert.strictEqual(status.kind, "not-configured");

    env.renderer.destroy();
  });

  it("/logout without a provider signs out the only stored provider and says so when nothing is stored", async () => {
    const env = await createTestRenderer({ width: 80, height: 24 });
    const picker = new PickerComponent(env.renderer);
    const manager = new PrismCodeCredentialManager({ store: new MemoryStoredCredentialStore() });
    await manager.setApiKey("xai", "xai-secret-key");

    const streamEntries: any[] = [];
    const context: CommandContext = {
      state: createInitialTuiState(),
      picker,
      stream: { appendOrUpdate: (entry: any) => streamEntries.push(entry) } as any,
      status: { update: () => {} } as any,
      credentialManager: manager,
      currentModel: { provider: "xai", model: "grok-4.6" },
      config: { cwd: "/test" },
      store: createMemorySessionStore(),
      onUpdateState: () => {},
      onUpdateModel: () => {},
    };

    await handleSlashCommand("/logout", context);
    assert.strictEqual(await manager.getStore().get({ name: "apiKey", provider: "xai" }), undefined);
    assert.ok(streamEntries.some((e) => e.type === "message" && e.text?.includes("deleted stored API key")));

    streamEntries.length = 0;
    await handleSlashCommand("/logout", context);
    assert.ok(streamEntries.some((e) => e.type === "error" && e.message?.includes("No stored credentials to remove")));

    env.renderer.destroy();
  });

  it("active run denies /new, /resume, and /compact", async () => {
    const memoryStore = new MemoryStoredCredentialStore();
    const manager = new PrismCodeCredentialManager({ store: memoryStore });
    const env = await createTestRenderer({ width: 80, height: 24 });
    const picker = new PickerComponent(env.renderer);

    const streamEntries: any[] = [];
    const mockStream: any = {
      appendOrUpdate: (entry: any) => streamEntries.push(entry),
    };

    const state = {
      ...createInitialTuiState(),
      isRunning: true,
    };

    const context: CommandContext = {
      state,
      picker,
      stream: mockStream,
      status: { update: () => {} } as any,
      credentialManager: manager,
      currentModel: { provider: "mock", model: "default" },
      config: { cwd: "/test" },
      store: createMemorySessionStore(),
      onUpdateState: () => {},
      onUpdateModel: () => {},
    };

    try {
      const resNew = await handleSlashCommand("/new", context);
      assert.strictEqual(resNew.handled, true);
      assert.ok(
        streamEntries.some((e) => e.type === "error" && e.message?.includes("Cannot create a new session while a run is in progress")),
      );

      streamEntries.length = 0;
      const resResume = await handleSlashCommand("/resume", context);
      assert.strictEqual(resResume.handled, true);
      assert.ok(streamEntries.some((e) => e.type === "error" && e.message?.includes("Cannot resume session while a run is in progress")));

      streamEntries.length = 0;
      const resCompact = await handleSlashCommand("/compact", context);
      assert.strictEqual(resCompact.handled, true);
      assert.ok(streamEntries.some((e) => e.type === "error" && e.message?.includes("Cannot compact session while a run is in progress")));
    } finally {
      env.renderer.destroy();
    }
  });

  it("/resume shows non-resumable message when store is memory", async () => {
    const memoryStore = new MemoryStoredCredentialStore();
    const manager = new PrismCodeCredentialManager({ store: memoryStore });
    const env = await createTestRenderer({ width: 80, height: 24 });
    const picker = new PickerComponent(env.renderer);

    const streamEntries: any[] = [];
    const mockStream: any = {
      appendOrUpdate: (entry: any) => streamEntries.push(entry),
    };

    const state = createInitialTuiState();

    const context: CommandContext = {
      state,
      picker,
      stream: mockStream,
      status: { update: () => {} } as any,
      credentialManager: manager,
      currentModel: { provider: "mock", model: "default" },
      config: { cwd: "/test", store: { type: "memory" } },
      store: createMemorySessionStore(),
      onUpdateState: () => {},
      onUpdateModel: () => {},
    };

    try {
      const result = await handleSlashCommand("/resume", context);
      assert.strictEqual(result.handled, true);
      assert.ok(streamEntries.some((e) => e.type === "error" && e.message?.includes("not supported with in-memory session store")));
    } finally {
      env.renderer.destroy();
    }
  });

  it("/new creates session, calls onSwitchSession and reports ID", async () => {
    const memoryStore = new MemoryStoredCredentialStore();
    const manager = new PrismCodeCredentialManager({ store: memoryStore });
    const env = await createTestRenderer({ width: 80, height: 24 });
    const picker = new PickerComponent(env.renderer);

    const streamEntries: any[] = [];
    const mockStream: any = {
      appendOrUpdate: (entry: any) => streamEntries.push(entry),
    };

    const state = createInitialTuiState();

    let switchedSession: any;
    const mockDefinition: any = {
      createSession: (opts: any) => ({
        id: opts.id,
        metadata: opts.metadata,
      }),
    };

    const context: CommandContext = {
      state,
      picker,
      stream: mockStream,
      status: { update: () => {} } as any,
      credentialManager: manager,
      currentModel: { provider: "mock", model: "default" },
      config: { cwd: "/test" },
      store: createMemorySessionStore(),
      definition: mockDefinition,
      onUpdateState: () => {},
      onUpdateModel: () => {},
      onSwitchSession: async (s) => {
        switchedSession = s;
      },
    };

    try {
      const result = await handleSlashCommand("/new", context);
      assert.strictEqual(result.handled, true);
      assert.ok(switchedSession !== undefined);
      assert.ok(switchedSession.id.startsWith("session_"));
      assert.ok(streamEntries.some((e) => e.type === "message" && e.text?.includes("Created new session:")));
    } finally {
      env.renderer.destroy();
    }
  });

  it("active run denies /om and /om-model", async () => {
    const memoryStore = new MemoryStoredCredentialStore();
    const manager = new PrismCodeCredentialManager({ store: memoryStore });
    const env = await createTestRenderer({ width: 80, height: 24 });
    const picker = new PickerComponent(env.renderer);

    const streamEntries: any[] = [];
    const mockStream: any = {
      appendOrUpdate: (entry: any) => streamEntries.push(entry),
    };

    const state = createInitialTuiState();
    const runningState = { ...state, isRunning: true };

    const mockSession: any = { id: "s1", entries: async () => [] };

    const context: CommandContext = {
      state: runningState,
      picker,
      stream: mockStream,
      status: { update: () => {} } as any,
      credentialManager: manager,
      currentModel: { provider: "mock", model: "default" },
      config: { cwd: "/test" },
      store: createMemorySessionStore(),
      session: mockSession,
      onUpdateState: () => {},
      onUpdateModel: () => {},
    };

    try {
      const omResult = await handleSlashCommand("/om", context);
      assert.strictEqual(omResult.handled, true);
      assert.ok(streamEntries.some((e) => e.type === "error" && e.message?.includes("active")));

      streamEntries.length = 0;
      const omModelResult = await handleSlashCommand("/om-model", context);
      assert.strictEqual(omModelResult.handled, true);
      assert.ok(streamEntries.some((e) => e.type === "error" && e.message?.includes("active")));
    } finally {
      env.renderer.destroy();
    }
  });

  it("/om toggles observational memory and updates status", async () => {
    const memoryStore = new MemoryStoredCredentialStore();
    const manager = new PrismCodeCredentialManager({ store: memoryStore });
    const env = await createTestRenderer({ width: 80, height: 24 });
    const picker = new PickerComponent(env.renderer);

    const streamEntries: any[] = [];
    const mockStream: any = {
      appendOrUpdate: (entry: any) => streamEntries.push(entry),
    };

    const state = createInitialTuiState();
    const statusUpdates: any[] = [];

    const mockSession: any = { id: "s1", entries: async () => [] };
    const coordinator = new ObservationalMemoryCoordinator({
      config: { cwd: "/test" },
      store: createMemorySessionStore(),
      providerResolver: async () => ({
        id: "mock",
        async *generate() {
          yield { type: "done" as const };
        },
      }),
    });

    const context: CommandContext = {
      state,
      picker,
      stream: mockStream,
      status: { update: (u: any) => statusUpdates.push(u) } as any,
      credentialManager: manager,
      currentModel: { provider: "mock", model: "default" },
      config: { cwd: "/test" },
      store: createMemorySessionStore(),
      session: mockSession,
      omCoordinator: coordinator,
      onUpdateState: () => {},
      onUpdateModel: () => {},
    };

    try {
      // Toggle on
      const result = await handleSlashCommand("/om", context);
      assert.strictEqual(result.handled, true);
      assert.ok(streamEntries.some((e) => e.text?.includes("enabled")));
      assert.ok(statusUpdates.some((u) => u.omEnabled === true));
    } finally {
      env.renderer.destroy();
    }
  });

  it("/om:status reports status without error", async () => {
    const memoryStore = new MemoryStoredCredentialStore();
    const manager = new PrismCodeCredentialManager({ store: memoryStore });
    const env = await createTestRenderer({ width: 80, height: 24 });
    const picker = new PickerComponent(env.renderer);

    const streamEntries: any[] = [];
    const mockStream: any = {
      appendOrUpdate: (entry: any) => streamEntries.push(entry),
    };

    const state = createInitialTuiState();
    const mockSession: any = { id: "s1", entries: async () => [] };

    const context: CommandContext = {
      state,
      picker,
      stream: mockStream,
      status: { update: () => {} } as any,
      credentialManager: manager,
      currentModel: { provider: "mock", model: "default" },
      config: { cwd: "/test" },
      store: createMemorySessionStore(),
      session: mockSession,
      onUpdateState: () => {},
      onUpdateModel: () => {},
    };

    try {
      const result = await handleSlashCommand("/om:status", context);
      assert.strictEqual(result.handled, true);
      // Should produce a message (not an error)
      assert.ok(streamEntries.some((e) => e.type === "message"));
    } finally {
      env.renderer.destroy();
    }
  });

  it("dispatches registered extension commands with session context and host drivers", async () => {
    const memoryStore = new MemoryStoredCredentialStore();
    const _manager = new PrismCodeCredentialManager({ store: memoryStore });

    const streamEntries: any[] = [];
    const mockStream: any = {
      appendOrUpdate: (entry: any) => streamEntries.push(entry),
    };

    const calls: Array<{ args: unknown; context: unknown }> = [];
    const drivers = {
      startRun: async () => ({ status: "succeeded" }),
      startWorkflow: async () => ({ runId: "run-1", status: "succeeded" }),
      steer: () => {},
    };
    const wikiLint = {
      name: "wiki-lint",
      description: "Check wiki health",
      execute: async (args: unknown, context: unknown) => {
        calls.push({ args, context });
        return { name: "wiki-lint", content: [{ type: "text", text: "✅ Wiki healthy" }] };
      },
    };

    const context: any = {
      state: createInitialTuiState(),
      stream: mockStream,
      session: { id: "session-ctx" } as any,
      definition: { commands: [wikiLint] } as any,
      commandDrivers: drivers,
    };

    const result = await handleSlashCommand("/wiki-lint", context);
    assert.strictEqual(result.handled, true);
    assert.strictEqual(calls.length, 1);
    const call = calls[0];
    if (!call) throw new Error("expected one command call");
    assert.deepStrictEqual(call.args, {});
    assert.strictEqual((call.context as { sessionId?: string }).sessionId, "session-ctx");
    assert.strictEqual((call.context as { drivers?: unknown }).drivers, drivers);
    assert.ok(streamEntries.some((e) => e.text?.includes("Wiki healthy")));
  });

  it("parses extension command arguments without forwarding raw slash text", () => {
    assert.deepStrictEqual(parseCommandArgs(["https://example.com/doc.html"]), { url: "https://example.com/doc.html" });
    assert.deepStrictEqual(parseCommandArgs(["path=docs/a.md", "title=Doc"]), { path: "docs/a.md", title: "Doc" });
    assert.deepStrictEqual(parseCommandArgs(["some", "free", "text"]), { text: "some free text" });
    assert.deepStrictEqual(parseCommandArgs([]), {});
  });

  it("unknown and disabled extension commands fail locally without running anything", async () => {
    const memoryStore = new MemoryStoredCredentialStore();
    const manager = new PrismCodeCredentialManager({ store: memoryStore });

    const streamEntries: any[] = [];
    const mockStream: any = {
      appendOrUpdate: (entry: any) => streamEntries.push(entry),
    };
    let executed = false;
    const registered = {
      name: "wiki-init",
      execute: async () => {
        executed = true;
        return { name: "wiki-init", content: [] };
      },
    };

    // Wiki disabled: no extension commands registered at all.
    const disabledContext: any = {
      state: createInitialTuiState(),
      stream: mockStream,
      credentialManager: manager,
      definition: { commands: [] } as any,
      session: { id: "s1" } as any,
    };
    const disabledResult = await handleSlashCommand("/wiki-init", disabledContext);
    assert.strictEqual(disabledResult.handled, true);
    assert.ok(streamEntries.some((e) => e.type === "error" && e.message?.includes("Unknown command")));
    assert.strictEqual(executed, false);

    // Duplicate registration fails closed instead of double-dispatching.
    streamEntries.length = 0;
    const duplicateContext: any = {
      state: createInitialTuiState(),
      stream: mockStream,
      definition: { commands: [registered, registered] } as any,
      session: { id: "s1" } as any,
    };
    const duplicateResult = await handleSlashCommand("/wiki-init", duplicateContext);
    assert.strictEqual(duplicateResult.handled, true);
    assert.ok(streamEntries.some((e) => e.type === "error" && e.message?.includes("Duplicate command")));
    assert.strictEqual(executed, false);
  });

  it("bounds extension command output and errors", async () => {
    const streamEntries: any[] = [];
    const mockStream: any = {
      appendOrUpdate: (entry: any) => streamEntries.push(entry),
    };

    const huge = "x".repeat(64 * 1024);
    const explodingCommand = {
      name: "wiki-refresh",
      execute: async () => {
        throw new Error(huge);
      },
    };
    const context: any = {
      state: createInitialTuiState(),
      stream: mockStream,
      definition: { commands: [explodingCommand] } as any,
      session: { id: "s1" } as any,
    };

    const result = await handleSlashCommand("/wiki-refresh", context);
    assert.strictEqual(result.handled, true);
    const errorEntry = streamEntries.find((e) => e.type === "error");
    assert.ok(errorEntry);
    assert.ok(errorEntry.message.includes("[output truncated]"));
    assert.ok(errorEntry.message.length < huge.length);
  });
});
