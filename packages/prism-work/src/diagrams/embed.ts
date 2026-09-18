import { DiagramsProtocolError, DiagramsTimeoutError } from "./errors.js";
import type { DrawioExportBounds, DrawioExportFormat, DrawioInboundEvent, DrawioOutboundAction } from "./messages.js";
import { validateDiagramsOrigin } from "./origin.js";

export interface DrawioEmbedFrame {
  readonly contentWindow: {
    postMessage(message: unknown, targetOrigin: string): void;
  } | null;
}

export interface DrawioMessageEvent {
  readonly origin: string;
  readonly source: unknown;
  readonly data: unknown;
}

export interface DrawioMessageSource {
  addEventListener(type: "message", listener: (event: DrawioMessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: DrawioMessageEvent) => void): void;
}

export type DrawioEventMap = {
  init: () => void;
  load: () => void;
  save: (event: { readonly xml: string; readonly exit?: boolean }) => void;
  autosave: (event: { readonly xml: string }) => void;
  exit: (event: { readonly modified: boolean }) => void;
  configure: () => void;
  export: (event: { readonly format: string; readonly data: string; readonly xml?: string; readonly bounds?: DrawioExportBounds }) => void;
  error: (event: { readonly message: string }) => void;
};

export interface DrawioEmbedOptions {
  readonly iframe: DrawioEmbedFrame;
  readonly origin: string;
  readonly messageSource?: DrawioMessageSource;
  readonly onProtocolError?: (error: DiagramsProtocolError) => void;
  readonly defaultExportTimeoutMs?: number;
}

export interface DrawioLoadOptions {
  readonly xml: string;
  readonly autosave?: boolean;
  readonly saveAndExit?: boolean;
  readonly noSaveBtn?: boolean;
  readonly noExitBtn?: boolean;
  readonly title?: string;
}

export interface DrawioExportOptions {
  readonly format: DrawioExportFormat;
  readonly scale?: number;
  readonly border?: number;
  readonly xml?: string;
  readonly embedImages?: boolean;
  readonly timeoutMs?: number;
}

export interface DrawioExportResult {
  readonly format: string;
  readonly data: string;
  readonly xml?: string;
  readonly bounds?: DrawioExportBounds;
}

export interface DrawioEmbed {
  readonly origin: string;
  on<K extends keyof DrawioEventMap>(event: K, listener: DrawioEventMap[K]): () => void;
  off<K extends keyof DrawioEventMap>(event: K, listener: DrawioEventMap[K]): void;
  load(options: DrawioLoadOptions): void;
  configure(config: Readonly<Record<string, unknown>>): void;
  merge(xml: string): void;
  export(options: DrawioExportOptions): Promise<DrawioExportResult>;
  postAction(action: DrawioOutboundAction): void;
  destroy(): void;
}

const DEFAULT_EXPORT_TIMEOUT_MS = 30_000;

export function createDrawioEmbed(options: DrawioEmbedOptions): DrawioEmbed {
  if (!options || typeof options !== "object") {
    throw new DiagramsProtocolError("createDrawioEmbed requires an options object");
  }

  if (!options.iframe || typeof options.iframe !== "object") {
    throw new DiagramsProtocolError("createDrawioEmbed requires an iframe container with contentWindow");
  }

  const origin = validateDiagramsOrigin(options.origin);
  const defaultTimeoutMs = options.defaultExportTimeoutMs ?? DEFAULT_EXPORT_TIMEOUT_MS;

  const listeners = new Map<keyof DrawioEventMap, Set<(...args: any[]) => void>>();
  const pendingExportResolvers = new Set<(result: DrawioExportResult) => void>();

  const messageSource: DrawioMessageSource | undefined =
    options.messageSource ??
    (typeof globalThis !== "undefined" && typeof (globalThis as unknown as { addEventListener?: unknown }).addEventListener === "function"
      ? (globalThis as unknown as DrawioMessageSource)
      : undefined);

  function handleMessage(event: DrawioMessageEvent): void {
    // 1. Origin verification: must strictly match the configured origin
    if (event.origin !== origin) {
      return;
    }

    // 2. Source verification: must come from the embed iframe's contentWindow
    if (!options.iframe.contentWindow || event.source !== options.iframe.contentWindow) {
      return;
    }

    // 3. Payload normalization
    let payload: unknown;
    if (typeof event.data === "string") {
      try {
        payload = JSON.parse(event.data);
      } catch {
        options.onProtocolError?.(new DiagramsProtocolError("Failed to parse JSON message payload from draw.io iframe"));
        return;
      }
    } else {
      payload = event.data;
    }

    if (!payload || typeof payload !== "object") {
      options.onProtocolError?.(new DiagramsProtocolError("Received non-object message payload from draw.io iframe"));
      return;
    }

    const eventName = (payload as { event?: unknown }).event;
    if (typeof eventName !== "string") {
      options.onProtocolError?.(new DiagramsProtocolError("Inbound draw.io message is missing string 'event' discriminator"));
      return;
    }

    dispatchInboundEvent(payload as DrawioInboundEvent);
  }

  function dispatchInboundEvent(inbound: DrawioInboundEvent): void {
    switch (inbound.event) {
      case "init": {
        const set = listeners.get("init");
        if (set) {
          for (const fn of Array.from(set)) fn();
        }
        break;
      }
      case "load": {
        const set = listeners.get("load");
        if (set) {
          for (const fn of Array.from(set)) fn();
        }
        break;
      }
      case "save": {
        const set = listeners.get("save");
        if (set) {
          for (const fn of Array.from(set)) {
            fn({ xml: inbound.xml, exit: inbound.exit });
          }
        }
        break;
      }
      case "autosave": {
        const set = listeners.get("autosave");
        if (set) {
          for (const fn of Array.from(set)) {
            fn({ xml: inbound.xml });
          }
        }
        break;
      }
      case "exit": {
        const set = listeners.get("exit");
        if (set) {
          for (const fn of Array.from(set)) {
            fn({ modified: Boolean(inbound.modified) });
          }
        }
        break;
      }
      case "configure": {
        const set = listeners.get("configure");
        if (set) {
          for (const fn of Array.from(set)) fn();
        }
        break;
      }
      case "export": {
        const result: DrawioExportResult = {
          format: inbound.format,
          data: inbound.data,
          ...(inbound.xml !== undefined ? { xml: inbound.xml } : {}),
          ...(inbound.bounds !== undefined ? { bounds: inbound.bounds } : {}),
        };
        // Resolve any waiting export promise
        for (const resolver of Array.from(pendingExportResolvers)) {
          resolver(result);
        }
        const set = listeners.get("export");
        if (set) {
          for (const fn of Array.from(set)) {
            fn(result);
          }
        }
        break;
      }
      case "error": {
        const set = listeners.get("error");
        if (set) {
          for (const fn of Array.from(set)) {
            fn({ message: inbound.message });
          }
        }
        break;
      }
      default: {
        options.onProtocolError?.(
          new DiagramsProtocolError(`Unknown or unsupported draw.io event: "${(inbound as { event: string }).event}"`),
        );
        break;
      }
    }
  }

  if (messageSource) {
    messageSource.addEventListener("message", handleMessage);
  }

  function postAction(action: DrawioOutboundAction): void {
    if (!action || typeof action !== "object" || typeof action.action !== "string") {
      throw new DiagramsProtocolError("Outbound action must be an object with an 'action' discriminator");
    }

    if (!options.iframe.contentWindow) {
      throw new DiagramsProtocolError("Cannot post action: iframe contentWindow is null or unavailable");
    }

    // Prohibit wildcard posting - always post strictly to validated origin
    if (origin === "*") {
      throw new DiagramsProtocolError("Posting to wildcard targetOrigin '*' is strictly prohibited");
    }

    options.iframe.contentWindow.postMessage(JSON.stringify(action), origin);
  }

  return {
    origin,

    on<K extends keyof DrawioEventMap>(event: K, listener: DrawioEventMap[K]): () => void {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener as (...args: any[]) => void);
      return () => {
        set?.delete(listener as (...args: any[]) => void);
      };
    },

    off<K extends keyof DrawioEventMap>(event: K, listener: DrawioEventMap[K]): void {
      listeners.get(event)?.delete(listener as (...args: any[]) => void);
    },

    load(opts: DrawioLoadOptions): void {
      postAction({
        action: "load",
        xml: opts.xml,
        ...(opts.autosave !== undefined ? { autosave: opts.autosave ? 1 : 0 } : {}),
        ...(opts.saveAndExit !== undefined ? { saveAndExit: opts.saveAndExit ? 1 : 0 } : {}),
        ...(opts.noSaveBtn !== undefined ? { noSaveBtn: opts.noSaveBtn ? 1 : 0 } : {}),
        ...(opts.noExitBtn !== undefined ? { noExitBtn: opts.noExitBtn ? 1 : 0 } : {}),
        ...(opts.title !== undefined ? { title: opts.title } : {}),
      });
    },

    configure(config: Readonly<Record<string, unknown>>): void {
      postAction({
        action: "configure",
        config,
      });
    },

    merge(xml: string): void {
      postAction({
        action: "merge",
        xml,
      });
    },

    export(opts: DrawioExportOptions): Promise<DrawioExportResult> {
      const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs;

      return new Promise<DrawioExportResult>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;

        const resolver = (result: DrawioExportResult) => {
          if (timer) clearTimeout(timer);
          pendingExportResolvers.delete(resolver);
          resolve(result);
        };

        pendingExportResolvers.add(resolver);

        if (timeoutMs > 0 && timeoutMs !== Number.POSITIVE_INFINITY) {
          timer = setTimeout(() => {
            pendingExportResolvers.delete(resolver);
            reject(new DiagramsTimeoutError(`Timed out waiting for draw.io export response after ${timeoutMs}ms`));
          }, timeoutMs);
        }

        try {
          postAction({
            action: "export",
            format: opts.format,
            ...(opts.scale !== undefined ? { scale: opts.scale } : {}),
            ...(opts.border !== undefined ? { border: opts.border } : {}),
            ...(opts.xml !== undefined ? { xml: opts.xml } : {}),
            ...(opts.embedImages !== undefined ? { embedImages: opts.embedImages } : {}),
          });
        } catch (error) {
          if (timer) clearTimeout(timer);
          pendingExportResolvers.delete(resolver);
          reject(error);
        }
      });
    },

    postAction,

    destroy(): void {
      if (messageSource) {
        messageSource.removeEventListener("message", handleMessage);
      }
      listeners.clear();
      pendingExportResolvers.clear();
    },
  };
}
