import { deepStrictEqual, ok, rejects, strictEqual, throws } from "node:assert";
import test from "node:test";
import {
  createDrawioEmbed,
  DiagramsOriginError,
  DiagramsProtocolError,
  DiagramsTimeoutError,
  type DrawioEmbedFrame,
  type DrawioMessageEvent,
  type DrawioMessageSource,
  validateDiagramsOrigin,
} from "../index.js";

interface PostedMessage {
  readonly message: unknown;
  readonly targetOrigin: string;
}

class FakeContentWindow {
  readonly posted: PostedMessage[] = [];

  postMessage(message: unknown, targetOrigin: string): void {
    this.posted.push({ message, targetOrigin });
  }
}

class FakeMessageBus implements DrawioMessageSource {
  private readonly listeners = new Set<(event: DrawioMessageEvent) => void>();

  addEventListener(type: "message", listener: (event: DrawioMessageEvent) => void): void {
    if (type === "message") {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: "message", listener: (event: DrawioMessageEvent) => void): void {
    if (type === "message") {
      this.listeners.delete(listener);
    }
  }

  dispatch(origin: string, source: unknown, data: unknown): void {
    const event: DrawioMessageEvent = { origin, source, data };
    for (const listener of Array.from(this.listeners)) {
      listener(event);
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

function createHarness(origin = "https://drawio.internal.example") {
  const contentWindow = new FakeContentWindow();
  const iframe: DrawioEmbedFrame = { contentWindow };
  const bus = new FakeMessageBus();
  const protocolErrors: DiagramsProtocolError[] = [];

  const embed = createDrawioEmbed({
    iframe,
    origin,
    messageSource: bus,
    onProtocolError: (err) => protocolErrors.push(err),
  });

  return { embed, iframe, contentWindow, bus, protocolErrors, origin };
}

test("validateDiagramsOrigin rejects invalid origins", () => {
  throws(
    () => validateDiagramsOrigin(""),
    (err: unknown) => err instanceof DiagramsOriginError,
  );
  throws(
    () => validateDiagramsOrigin("   "),
    (err: unknown) => err instanceof DiagramsOriginError,
  );
  throws(
    () => validateDiagramsOrigin("*"),
    (err: unknown) => err instanceof DiagramsOriginError,
  );
  throws(
    () => validateDiagramsOrigin("not-a-url"),
    (err: unknown) => err instanceof DiagramsOriginError,
  );
  throws(
    () => validateDiagramsOrigin("ftp://drawio.example"),
    (err: unknown) => err instanceof DiagramsOriginError,
  );
  throws(
    () => validateDiagramsOrigin("https://user:pass@drawio.example"),
    (err: unknown) => err instanceof DiagramsOriginError,
  );
  throws(
    () => validateDiagramsOrigin("https://drawio.example/embed/path"),
    (err: unknown) => err instanceof DiagramsOriginError,
  );
  throws(
    () => validateDiagramsOrigin("https://drawio.example?query=1"),
    (err: unknown) => err instanceof DiagramsOriginError,
  );
  throws(
    () => validateDiagramsOrigin("https://drawio.example#hash"),
    (err: unknown) => err instanceof DiagramsOriginError,
  );

  strictEqual(validateDiagramsOrigin("https://drawio.example"), "https://drawio.example");
  strictEqual(validateDiagramsOrigin("http://localhost:8080"), "http://localhost:8080");
});

test("createDrawioEmbed construction origin validation", () => {
  const contentWindow = new FakeContentWindow();
  const iframe: DrawioEmbedFrame = { contentWindow };

  throws(
    () => createDrawioEmbed({ iframe, origin: "" }),
    (err: unknown) => err instanceof DiagramsOriginError,
  );

  throws(
    () => createDrawioEmbed({ iframe, origin: "*" }),
    (err: unknown) => err instanceof DiagramsOriginError,
  );

  throws(
    () => createDrawioEmbed(null as never),
    (err: unknown) => err instanceof DiagramsProtocolError,
  );

  throws(
    () => createDrawioEmbed({ iframe: null as never, origin: "https://drawio.example" }),
    (err: unknown) => err instanceof DiagramsProtocolError,
  );
});

test("init event triggers listener and load action posts correct JSON message to origin", () => {
  const { embed, contentWindow, bus, origin } = createHarness();
  let initFired = false;

  embed.on("init", () => {
    initFired = true;
    embed.load({
      xml: "<mxfile><diagram>...</diagram></mxfile>",
      autosave: true,
      saveAndExit: true,
      title: "Architecture",
    });
  });

  bus.dispatch(origin, contentWindow, JSON.stringify({ event: "init" }));
  ok(initFired, "init listener must fire");

  strictEqual(contentWindow.posted.length, 1);
  strictEqual(contentWindow.posted[0]?.targetOrigin, origin);
  ok(contentWindow.posted[0]?.targetOrigin !== "*", "targetOrigin must never be wildcard");

  const action = JSON.parse(contentWindow.posted[0]?.message as string);
  deepStrictEqual(action, {
    action: "load",
    xml: "<mxfile><diagram>...</diagram></mxfile>",
    autosave: 1,
    saveAndExit: 1,
    title: "Architecture",
  });
});

test("inbound save, autosave, exit, configure, and error events dispatch typed callbacks", () => {
  const { embed, contentWindow, bus, origin } = createHarness();

  let savePayload: { xml: string; exit?: boolean } | undefined;
  let autosavePayload: { xml: string } | undefined;
  let exitPayload: { modified: boolean } | undefined;
  let configureFired = false;
  let errorPayload: { message: string } | undefined;

  embed.on("save", (evt) => {
    savePayload = evt;
  });
  embed.on("autosave", (evt) => {
    autosavePayload = evt;
  });
  embed.on("exit", (evt) => {
    exitPayload = evt;
  });
  embed.on("configure", () => {
    configureFired = true;
  });
  embed.on("error", (evt) => {
    errorPayload = evt;
  });

  bus.dispatch(origin, contentWindow, { event: "save", xml: "<mxfile>saved</mxfile>", exit: true });
  deepStrictEqual(savePayload, { xml: "<mxfile>saved</mxfile>", exit: true });

  bus.dispatch(origin, contentWindow, JSON.stringify({ event: "autosave", xml: "<mxfile>draft</mxfile>" }));
  deepStrictEqual(autosavePayload, { xml: "<mxfile>draft</mxfile>" });

  bus.dispatch(origin, contentWindow, { event: "exit", modified: true });
  deepStrictEqual(exitPayload, { modified: true });

  bus.dispatch(origin, contentWindow, { event: "configure" });
  ok(configureFired);

  bus.dispatch(origin, contentWindow, { event: "error", message: "Export failed" });
  deepStrictEqual(errorPayload, { message: "Export failed" });
});

test("messages from wrong origin are dropped immediately without parsing", () => {
  const { embed, contentWindow, bus, protocolErrors } = createHarness("https://drawio.internal.example");

  let callbackFired = false;
  embed.on("save", () => {
    callbackFired = true;
  });
  embed.on("init", () => {
    callbackFired = true;
  });

  // Wrong origin: evil.attacker.com
  bus.dispatch("https://evil.attacker.com", contentWindow, {
    event: "save",
    xml: "<malicious/>",
  });

  ok(!callbackFired, "callback must never fire for wrong origin message");
  strictEqual(protocolErrors.length, 0, "wrong-origin message is dropped before protocol error handler");
});

test("messages from different window source are dropped immediately", () => {
  const { embed, bus, origin, protocolErrors } = createHarness();

  let callbackFired = false;
  embed.on("save", () => {
    callbackFired = true;
  });

  const foreignWindow = new FakeContentWindow();
  bus.dispatch(origin, foreignWindow, {
    event: "save",
    xml: "<mxfile>foreign</mxfile>",
  });

  ok(!callbackFired, "callback must never fire for message from foreign window source");
  strictEqual(protocolErrors.length, 0, "foreign window message is dropped before protocol error handler");
});

test("unknown events trigger onProtocolError callback", () => {
  const { contentWindow, bus, origin, protocolErrors } = createHarness();

  bus.dispatch(origin, contentWindow, { event: "some_unrecognized_event" });
  strictEqual(protocolErrors.length, 1);
  ok(protocolErrors[0]?.message.includes("Unknown or unsupported draw.io event"));
});

test("malformed JSON payload triggers onProtocolError", () => {
  const { contentWindow, bus, origin, protocolErrors } = createHarness();

  bus.dispatch(origin, contentWindow, "invalid-json-string{");
  strictEqual(protocolErrors.length, 1);
  ok(protocolErrors[0]?.message.includes("Failed to parse JSON"));
});

test("export flow sends export action and resolves Promise on matching export event", async () => {
  const { embed, contentWindow, bus, origin } = createHarness();

  const exportPromise = embed.export({
    format: "xmlsvg",
    scale: 2,
    border: 10,
    xml: "<mxfile>test</mxfile>",
  });

  // Check action sent
  strictEqual(contentWindow.posted.length, 1);
  const action = JSON.parse(contentWindow.posted[0]?.message as string);
  deepStrictEqual(action, {
    action: "export",
    format: "xmlsvg",
    scale: 2,
    border: 10,
    xml: "<mxfile>test</mxfile>",
  });
  strictEqual(contentWindow.posted[0]?.targetOrigin, origin);

  // Simulate editor response event
  bus.dispatch(origin, contentWindow, {
    event: "export",
    format: "xmlsvg",
    data: "data:image/svg+xml;base64,PHN2Z...",
    xml: "<mxfile>test</mxfile>",
    bounds: { x: 0, y: 0, width: 200, height: 100 },
  });

  const result = await exportPromise;
  deepStrictEqual(result, {
    format: "xmlsvg",
    data: "data:image/svg+xml;base64,PHN2Z...",
    xml: "<mxfile>test</mxfile>",
    bounds: { x: 0, y: 0, width: 200, height: 100 },
  });
});

test("export flow times out with DiagramsTimeoutError", async () => {
  const contentWindow = new FakeContentWindow();
  const iframe: DrawioEmbedFrame = { contentWindow };
  const bus = new FakeMessageBus();

  const embed = createDrawioEmbed({
    iframe,
    origin: "https://drawio.internal",
    messageSource: bus,
    defaultExportTimeoutMs: 10,
  });

  await rejects(
    () => embed.export({ format: "png", timeoutMs: 20 }),
    (err: unknown) => err instanceof DiagramsTimeoutError,
  );
});

test("outbound actions configure, merge, and postAction", () => {
  const { embed, contentWindow } = createHarness();

  embed.configure({ defaultFonts: ["Helvetica", "Arial"], uiTheme: "dark" });
  strictEqual(contentWindow.posted.length, 1);
  deepStrictEqual(JSON.parse(contentWindow.posted[0]?.message as string), {
    action: "configure",
    config: { defaultFonts: ["Helvetica", "Arial"], uiTheme: "dark" },
  });

  embed.merge("<mxfile><diagram>merged</diagram></mxfile>");
  strictEqual(contentWindow.posted.length, 2);
  deepStrictEqual(JSON.parse(contentWindow.posted[1]?.message as string), {
    action: "merge",
    xml: "<mxfile><diagram>merged</diagram></mxfile>",
  });

  embed.postAction({ action: "dialog", title: "Note", message: "Hello", button: "OK" });
  strictEqual(contentWindow.posted.length, 3);
  deepStrictEqual(JSON.parse(contentWindow.posted[2]?.message as string), {
    action: "dialog",
    title: "Note",
    message: "Hello",
    button: "OK",
  });
});

test("on() returns unsubscribe function and off() removes listeners", () => {
  const { embed, contentWindow, bus, origin } = createHarness();

  let count1 = 0;
  let count2 = 0;

  const unsubscribe1 = embed.on("init", () => {
    count1++;
  });
  const listener2 = () => {
    count2++;
  };
  embed.on("init", listener2);

  bus.dispatch(origin, contentWindow, { event: "init" });
  strictEqual(count1, 1);
  strictEqual(count2, 1);

  unsubscribe1();
  bus.dispatch(origin, contentWindow, { event: "init" });
  strictEqual(count1, 1);
  strictEqual(count2, 2);

  embed.off("init", listener2);
  bus.dispatch(origin, contentWindow, { event: "init" });
  strictEqual(count1, 1);
  strictEqual(count2, 2);
});

test("destroy() removes listener from messageSource", () => {
  const { embed, bus } = createHarness();
  strictEqual(bus.listenerCount, 1);

  embed.destroy();
  strictEqual(bus.listenerCount, 0);
});
