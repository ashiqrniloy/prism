/**
 * `@arnilo/prism-tools-work` — the first-party work tools as a package.
 *
 * The default export registers the `office_*` document tools, `work_exec` inside the host-injected
 * `work.sandbox` service, and the `m365_*` / `gws_*` connector tools when a ref-only credential
 * resolves. The bounded document reader is provided as the `work.reader` service, and the vendored
 * Hermes productivity skills are added from `vendor/`. A missing optional parser, an unresolved
 * connector credential, or a missing sandbox writes a `warn` status note and registers less.
 *
 * The document, spreadsheet, diagram, reader, extraction, connector, sandbox, skill, and tool
 * libraries stay importable as subpaths (`@arnilo/prism-tools-work/documents`, `/sheets`,
 * `/connectors`, …) because the family shares type names (`validateByteCap`, `CellValue`) that a
 * single flat barrel cannot re-export unambiguously. The 0.12 factory names stay exported.
 *
 * ```ts
 * import toolsWork from "@arnilo/prism-tools-work";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model,
 *   packages: [toolsWork({ root: process.cwd(), connectors: { microsoft365: { credential: "keyring:m365", configDir, identity } } })],
 * });
 * ```
 */
import manifest from "../package.json" with { type: "json" };
import { isAbsolute } from "node:path";
import { definePackage, type JsonObject, type PackageAPI, type PackageInstance, type Secret, type ToolDefinition } from "@arnilo/prism";
import { resolveCommand } from "./command.js";
import { type ToolsWorkConfig, toolsWorkConfigSchema } from "./config.js";
import { createGoogleWorkspaceCliAdapter } from "./connectors/google-workspace.js";
import { createMicrosoft365CliAdapter } from "./connectors/microsoft365.js";
import { createWorkTools } from "./connectors/tools.js";
import type {
  GoogleWorkspaceAdapter,
  GoogleWorkspaceOp,
  Microsoft365Adapter,
  Microsoft365Op,
  WorkTokenProvider,
  WorkToolsOptions,
} from "./connectors/types.js";
import {
  createDocumentReader,
  createDocxParser,
  createOoxmlParser,
  createPdfParser,
  type DocumentParser,
  type DocumentReader,
} from "./document-reader/index.js";
import { createMistralOcrParser } from "./document-reader/mistral-ocr.js";
import { closeWorkerPool } from "./runtime/worker-pool.js";
import { createWorkComposition, type WorkSandbox } from "./sandbox/composition.js";
import { createLocalWorkFilesystem } from "./tools/local-filesystem.js";
import { createOfficeTools } from "./tools/office.js";
import { loadWorkSkills } from "./skills/index.js";
import { type AgentIdentity } from "./connectors/identity.js";
export type {
  ToolsWorkConfig,
  ToolsWorkConnectorConfig,
  ToolsWorkConnectorsConfig,
  ToolsWorkOfficeConfig,
  ToolsWorkReaderConfig,
} from "./config.js";
export { toolsWorkConfigSchema } from "./config.js";
export { createWorkTools, WORK_MUTATING_TOOL_NAMES } from "./connectors/tools.js";
export { createDocumentReader, type DocumentReader } from "./document-reader/index.js";
// A curated flat surface; the group libraries stay behind their subpaths (see the file doc comment).
export { createWorkComposition, type WorkComposition, type WorkSandbox } from "./sandbox/composition.js";
export { loadWorkSkills, type WorkSkillName } from "./skills/index.js";
export { createLocalWorkFilesystem } from "./tools/local-filesystem.js";
export { createOfficeTools, type OfficeToolsOptions } from "./tools/office.js";

const READER_FORMATS = ["pdf", "docx", "xlsx", "pptx"] as const;

function identityFrom(json: JsonObject): AgentIdentity {
  return { ...json, verified: true } as unknown as AgentIdentity;
}

/**
 * The token provider for a connector credential. A JSON object value is treated as the env map to
 * inject; any other value becomes the provider's default access-token variable. The value is never
 * logged, returned, or placed in argv.
 */
function tokenProviderFrom(provider: "microsoft365" | "google-workspace", secret: Secret): WorkTokenProvider {
  const fallback = provider === "microsoft365" ? "M365_ACCESSTOKEN" : "GOOGLE_ACCESS_TOKEN";
  return {
    tokenEnv: () => {
      try {
        const parsed: unknown = JSON.parse(secret.value);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const out: Record<string, string> = {};
          for (const [key, value] of Object.entries(parsed)) if (typeof value === "string") out[key] = value;
          if (Object.keys(out).length > 0) return out;
        }
      } catch {
        // Not JSON: fall through to the provider's default variable.
      }
      return { [fallback]: secret.value };
    },
  };
}

/** Build the reader service. A missing optional peer drops only its formats, with one note. */
async function buildReader(prism: PackageAPI<ToolsWorkConfig>): Promise<DocumentReader | undefined> {
  const config = prism.config.reader;
  if (config === undefined) return undefined;
  const formats = new Set(config.formats ?? READER_FORMATS);
  const parsers: DocumentParser[] = [];
  const dropped: string[] = [];

  if (formats.has("pdf")) {
    if (config.ocr) {
      const secret = await prism.credentials.resolve(config.ocr.apiKey);
      if (secret) {
        parsers.push(
          createMistralOcrParser({
            apiKey: secret.value,
            ...(config.ocr.baseUrl ? { baseUrl: config.ocr.baseUrl } : {}),
            ...(config.ocr.model ? { model: config.ocr.model } : {}),
          }),
        );
      } else {
        dropped.push("pdf (ocr credential unresolved)");
      }
    } else {
      try {
        parsers.push(await createPdfParser());
      } catch {
        dropped.push("pdf (pdf-parse)");
      }
    }
  }
  if (formats.has("docx")) {
    try {
      parsers.push(await createDocxParser());
    } catch {
      dropped.push("docx (mammoth)");
    }
  }
  if (formats.has("xlsx")) parsers.push(createOoxmlParser("xlsx", "sheet", "xl/workbook.xml"));
  if (formats.has("pptx")) parsers.push(createOoxmlParser("pptx", "deck", "ppt/presentation.xml"));

  if (dropped.length > 0) {
    prism.status.note("warn", `work: dropped reader formats: ${dropped.join(", ")}`);
  }
  if (parsers.length === 0) return undefined;
  return await createDocumentReader({
    parsers,
    ...(config.maxBytes !== undefined ? { maxBytes: config.maxBytes } : {}),
    ...(config.maxPages !== undefined ? { maxPages: config.maxPages } : {}),
    ...(config.maxTextBytes !== undefined ? { maxTextBytes: config.maxTextBytes } : {}),
  });
}

/** Build the connector adapters. A provider registers only when its credential resolves. */
async function buildConnectors(prism: PackageAPI<ToolsWorkConfig>): Promise<WorkToolsOptions | undefined> {
  const config = prism.config.connectors;
  if (config === undefined) return undefined;

  let microsoft365: Microsoft365Adapter | undefined;
  let googleWorkspace: GoogleWorkspaceAdapter | undefined;

  const m365 = config.microsoft365;
  if (m365) {
    const secret = await prism.credentials.resolve(m365.credential);
    if (!secret) {
      prism.status.note("warn", "work: microsoft365 credential did not resolve; registering no microsoft365 tools");
    } else if (!m365.configDir || !m365.identity) {
      prism.status.note("warn", "work: microsoft365 needs configDir and identity; registering no microsoft365 tools");
    } else {
      const binary = resolveCommand(m365.binary ?? "m365");
      if (!binary) {
        prism.status.note(
          "warn",
          `work: microsoft365 binary "${m365.binary ?? "m365"}" not found on PATH; registering no microsoft365 tools`,
        );
      } else {
        microsoft365 = createMicrosoft365CliAdapter({
          binary,
          configDir: m365.configDir,
          identity: identityFrom(m365.identity),
          ...(m365.allowedOps ? { allowedOps: m365.allowedOps as readonly Microsoft365Op[] } : {}),
          tokenProvider: tokenProviderFrom("microsoft365", secret),
        });
      }
    }
  }

  const google = config.google;
  if (google) {
    const secret = await prism.credentials.resolve(google.credential);
    if (!secret) {
      prism.status.note("warn", "work: google credential did not resolve; registering no google tools");
    } else if (!google.configDir || !google.identity) {
      prism.status.note("warn", "work: google needs configDir and identity; registering no google tools");
    } else {
      const binary = resolveCommand(google.binary ?? "gws");
      if (!binary) {
        prism.status.note("warn", `work: google binary "${google.binary ?? "gws"}" not found on PATH; registering no google tools`);
      } else {
        googleWorkspace = createGoogleWorkspaceCliAdapter({
          binary,
          configDir: google.configDir,
          identity: identityFrom(google.identity),
          ...(google.allowedOps ? { allowedOps: google.allowedOps as readonly GoogleWorkspaceOp[] } : {}),
          tokenProvider: tokenProviderFrom("google-workspace", secret),
        });
      }
    }
  }

  if (!microsoft365 && !googleWorkspace) return undefined;
  return {
    ...(microsoft365 ? { microsoft365 } : {}),
    ...(googleWorkspace ? { googleWorkspace } : {}),
  };
}

const definition = definePackage<ToolsWorkConfig>({
  name: "@arnilo/prism-tools-work",
  version: manifest.version,
  description:
    "Office document, spreadsheet, diagram, connector, and bounded reader tools with declared effects, ref-only credentials, and an injected work sandbox.",
  requires: { api: 1 },
  capabilities: ["credentials"],
  config: toolsWorkConfigSchema,
  setup: async (prism) => {
    const root = prism.config.root;
    if (typeof root !== "string" || root.length === 0) {
      throw new Error("prism-tools-work: config needs root (the absolute workspace root the file tools operate in)");
    }
    if (!isAbsolute(root)) {
      throw new Error("prism-tools-work: root must be an absolute path");
    }

    const filesystem = createLocalWorkFilesystem(root);
    const officeConfig = prism.config.office;
    const officeOptions = {
      filesystem,
      ...(officeConfig?.maxBytes !== undefined ? { caps: { maxBytes: officeConfig.maxBytes } } : {}),
    };

    const reader = await buildReader(prism);
    if (reader) prism.services.provide("work.reader", reader);

    const connectors = await buildConnectors(prism);
    const officeEnabled = officeConfig?.enabled !== false;
    const workEnabled = prism.config.work?.enabled !== false;
    const sandbox = prism.services.consume<WorkSandbox>("work.sandbox");

    const tools: ToolDefinition[] = [];
    if (sandbox && workEnabled) {
      const composed = createWorkComposition({
        sandbox,
        ...(officeEnabled ? { office: officeOptions } : {}),
        ...(connectors ? { connectors } : {}),
        ...(reader ? { reader } : {}),
        filesystem,
        ...(prism.config.env ? { env: prism.config.env } : {}),
      });
      tools.push(...composed.tools);
    } else {
      if (officeEnabled) tools.push(...createOfficeTools(officeOptions));
      if (connectors) tools.push(...createWorkTools({ ...connectors, filesystem }));
      if (workEnabled && !sandbox) {
        prism.status.note("warn", "work: work_exec needs the host work.sandbox service; registering office and connector tools only");
      }
    }

    for (const tool of tools) prism.tools.register(tool);

    for (const skill of loadWorkSkills()) prism.skills.register(skill);

    prism.onDispose(() => closeWorkerPool());
  },
});

/** The package definition. Pass config through `packageConfig` or use {@link toolsWork}. */
export default definition;

/** The package with config baked in, for `packages: [toolsWork({ root })]`. */
export function toolsWork(config: ToolsWorkConfig): PackageInstance {
  return definition(config);
}
