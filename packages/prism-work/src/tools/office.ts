import { Buffer } from "node:buffer";
import { isAbsolute } from "node:path";
import type {
  ArtifactBodyRef,
  ArtifactBodyStore,
  JsonObject,
  SecretRedactor,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from "@arnilo/prism";
import { type WorkSandboxFilesystem, resolveSandboxPath } from "./filesystem.js";
import {
  type DocumentCaps,
  type DocumentFormat,
  type DocumentModel,
  type DocumentPatch,
  diffDocument,
  generateDocument,
  importDocument,
  parseDocument,
  renderPreviewHtml,
  resolveDocumentCaps,
  validateByteCap,
  validateDocumentModel,
  patchDocument,
} from "../documents/index.js";

const NO_EFFECT = { kind: "none", idempotency: "none" } as const;
const EXTERNAL_MUTATION = { kind: "external_mutation", idempotency: "unsupported" } as const;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export type OfficeFilesystem = WorkSandboxFilesystem;

export interface OfficeArtifactStore {
  readonly bodies: ArtifactBodyStore;
  /** Host owns artifact naming and ownership; tools only supply verified byte metadata. */
  createRef(input: {
    readonly context: ToolExecutionContext;
    readonly format: DocumentFormat;
    readonly mime: string;
    readonly byteLength: number;
    readonly contentHash: string;
  }): ArtifactBodyRef;
}

export interface OfficeToolsOptions {
  readonly caps?: DocumentCaps;
  readonly redactor?: SecretRedactor;
  readonly filesystem?: OfficeFilesystem;
  readonly artifacts?: OfficeArtifactStore;
}

function objectSchema(properties: JsonObject, required: readonly string[]): JsonObject {
  return { type: "object", properties, required: [...required], additionalProperties: false };
}

function errorResult(name: string, context: ToolExecutionContext, error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { toolCallId: context.toolCallId, name, content: [{ type: "text", text: message }], error: { message } };
}

function stringArg(args: JsonObject, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function documentModel(value: unknown): DocumentModel {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("model must be an object");
  const model = value as DocumentModel;
  validateDocumentModel(model);
  return model;
}

function documentPatches(value: unknown): readonly DocumentPatch[] {
  if (!Array.isArray(value)) throw new TypeError("patches must be an array");
  return value as readonly DocumentPatch[];
}

function documentKind(value: unknown): "doc" | "sheet" | "deck" {
  if (value === "doc" || value === "sheet" || value === "deck") return value;
  throw new TypeError("kind must be doc, sheet, or deck");
}

function documentFormat(value: unknown): DocumentFormat {
  if (value === "docx" || value === "xlsx" || value === "pptx") return value;
  throw new TypeError("format must be docx, xlsx, or pptx");
}

function decodeBase64(value: string, maxBytes: number): Buffer {
  const maxEncodedBytes = Math.ceil(maxBytes / 3) * 4;
  if (Buffer.byteLength(value, "ascii") > maxEncodedBytes || value.length % 4 !== 0 || !BASE64.test(value)) {
    throw new TypeError(`bytesBase64 exceeds the ${maxBytes} byte limit or is invalid base64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value || bytes.byteLength > maxBytes) {
    throw new TypeError(`bytesBase64 exceeds the ${maxBytes} byte limit or is invalid base64`);
  }
  return bytes;
}

async function inputBytes(
  args: JsonObject,
  options: OfficeToolsOptions,
  maxBytes: number,
  context: ToolExecutionContext,
): Promise<Uint8Array> {
  const bytesBase64 = stringArg(args, "bytesBase64");
  const path = stringArg(args, "path");
  if ((bytesBase64 === undefined) === (path === undefined)) throw new TypeError("provide exactly one of bytesBase64 or path");
  if (bytesBase64 !== undefined) return decodeBase64(bytesBase64, maxBytes);
  if (!options.filesystem) throw new TypeError("path requires a configured filesystem");
  if (path === undefined) throw new TypeError("path is required");
  const target = await resolveSandboxPath(options.filesystem, path);
  const bytes = await options.filesystem.readFile(target, { maxBytes, signal: context.signal });
  validateByteCap(bytes.byteLength, { ...resolveDocumentCaps(options.caps), maxBytes });
  return bytes;
}

function outputRequested(args: JsonObject): boolean {
  return stringArg(args, "outputPath") !== undefined || args.artifact === true;
}

function outputFormat(args: JsonObject): DocumentFormat | undefined {
  const value = args.format;
  return value === undefined ? undefined : documentFormat(value);
}

function mime(format: DocumentFormat): string {
  return format === "docx"
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : format === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/vnd.openxmlformats-officedocument.presentationml.presentation";
}

async function writeOutput(
  bytes: Uint8Array,
  contentHash: string,
  format: DocumentFormat,
  args: JsonObject,
  options: OfficeToolsOptions,
  context: ToolExecutionContext,
): Promise<{ readonly path?: string; readonly artifact?: ArtifactBodyRef }> {
  const outputPath = stringArg(args, "outputPath");
  const artifact = args.artifact === true;
  if (outputPath !== undefined && artifact) throw new TypeError("provide only one of outputPath or artifact");
  if (outputPath !== undefined) {
    if (!options.filesystem) throw new TypeError("outputPath requires a configured filesystem");
    const target = await resolveSandboxPath(options.filesystem, outputPath);
    await options.filesystem.writeFile(target, bytes, { maxBytes: resolveDocumentCaps(options.caps).maxBytes, signal: context.signal });
    return { path: target };
  }
  if (artifact) {
    if (!options.artifacts) throw new TypeError("artifact requires a configured artifact store");
    const ref = options.artifacts.createRef({ context, format, mime: mime(format), byteLength: bytes.byteLength, contentHash });
    await options.artifacts.bodies.put(ref, bytes, { signal: context.signal });
    return { artifact: ref };
  }
  return {};
}

function generatedValue(
  format: DocumentFormat,
  contentHash: string,
  byteLength: number,
  target: { readonly path?: string; readonly artifact?: ArtifactBodyRef },
) {
  return { format, contentHash, byteLength, ...target };
}

const MODEL = { type: "object", description: "Validated Prism document model" } as JsonObject;
const PATCHES = { type: "array", items: { type: "object" }, description: "Prism document patch operations" } as JsonObject;
const INPUT = {
  kind: { type: "string", enum: ["doc", "sheet", "deck"] },
  bytesBase64: { type: "string", description: "Bounded OOXML bytes as canonical base64" },
  path: { type: "string", description: "Sandbox-relative OOXML path" },
} as JsonObject;
const OUTPUT = {
  outputPath: { type: "string", description: "Sandbox-relative output path" },
  artifact: { type: "boolean", description: "Store bytes through the configured host artifact body store" },
} as JsonObject;

/** Thin, bounded tool facade over the Prism document primitives. */
export function createOfficeTools(options: OfficeToolsOptions = {}): readonly ToolDefinition[] {
  const caps = resolveDocumentCaps(options.caps);
  if (options.filesystem && !isAbsolute(options.filesystem.root)) throw new TypeError("filesystem.root must be absolute");

  const observe = NO_EFFECT;
  const mutation = (args: JsonObject) => (outputRequested(args) ? EXTERNAL_MUTATION : NO_EFFECT);

  return [
    {
      name: "office_parse",
      kind: "read",
      effect: observe,
      description: "Parse bounded OOXML bytes into a Prism document model. Parsed content is untrusted.",
      parameters: objectSchema(INPUT, ["kind"]),
      async execute(args, context) {
        try {
          const model = await parseDocument(await inputBytes(args, options, caps.maxBytes, context), {
            kind: documentKind(args.kind),
            caps: options.caps,
            redactor: options.redactor,
          });
          return { toolCallId: context.toolCallId, name: "office_parse", value: { model }, metadata: { trust: "untrusted_external" } };
        } catch (error) {
          return errorResult("office_parse", context, error);
        }
      },
    },
    {
      name: "office_import",
      kind: "read",
      effect: observe,
      description: "Import bounded OOXML bytes with a fidelity report. Imported content is untrusted.",
      parameters: objectSchema(INPUT, ["kind"]),
      async execute(args, context) {
        try {
          const imported = await importDocument(await inputBytes(args, options, caps.maxBytes, context), {
            kind: documentKind(args.kind),
            caps: options.caps,
            redactor: options.redactor,
          });
          return { toolCallId: context.toolCallId, name: "office_import", value: imported, metadata: { trust: "untrusted_external" } };
        } catch (error) {
          return errorResult("office_import", context, error);
        }
      },
    },
    {
      name: "office_generate",
      kind: "edit",
      effect: mutation,
      description: "Generate OOXML from a validated model. Returns only hash/size; optionally writes sandbox or artifact bytes.",
      parameters: objectSchema({ format: { type: "string", enum: ["docx", "xlsx", "pptx"] }, model: MODEL, ...OUTPUT }, [
        "format",
        "model",
      ]),
      async execute(args, context) {
        try {
          const format = documentFormat(args.format);
          const generated = await generateDocument(documentModel(args.model), { format, caps: options.caps });
          const target = await writeOutput(generated.bytes, generated.contentHash, format, args, options, context);
          return {
            toolCallId: context.toolCallId,
            name: "office_generate",
            value: generatedValue(format, generated.contentHash, generated.bytes.byteLength, target),
          };
        } catch (error) {
          return errorResult("office_generate", context, error);
        }
      },
    },
    {
      name: "office_patch",
      kind: "edit",
      effect: mutation,
      description: "Apply validated document patches; optionally generate the patched model to sandbox or artifact bytes.",
      parameters: objectSchema({ model: MODEL, patches: PATCHES, format: { type: "string", enum: ["docx", "xlsx", "pptx"] }, ...OUTPUT }, [
        "model",
        "patches",
      ]),
      async execute(args, context) {
        try {
          const model = patchDocument(documentModel(args.model), documentPatches(args.patches));
          const format = outputFormat(args);
          if (!outputRequested(args)) return { toolCallId: context.toolCallId, name: "office_patch", value: { model } };
          if (!format) throw new TypeError("format is required when writing patched bytes");
          const generated = await generateDocument(model, { format, caps: options.caps });
          const target = await writeOutput(generated.bytes, generated.contentHash, format, args, options, context);
          return {
            toolCallId: context.toolCallId,
            name: "office_patch",
            value: { model, ...generatedValue(format, generated.contentHash, generated.bytes.byteLength, target) },
          };
        } catch (error) {
          return errorResult("office_patch", context, error);
        }
      },
    },
    {
      name: "office_diff",
      kind: "read",
      effect: observe,
      description: "Return a bounded structural diff between two validated Prism document models.",
      parameters: objectSchema({ from: MODEL, to: MODEL }, ["from", "to"]),
      async execute(args, context) {
        try {
          return {
            toolCallId: context.toolCallId,
            name: "office_diff",
            value: diffDocument(documentModel(args.from), documentModel(args.to)),
          };
        } catch (error) {
          return errorResult("office_diff", context, error);
        }
      },
    },
    {
      name: "office_preview",
      kind: "read",
      effect: observe,
      description: "Render a bounded, inert HTML preview of a validated Prism document model.",
      parameters: objectSchema({ model: MODEL }, ["model"]),
      async execute(args, context) {
        try {
          return { toolCallId: context.toolCallId, name: "office_preview", value: { html: renderPreviewHtml(documentModel(args.model)) } };
        } catch (error) {
          return errorResult("office_preview", context, error);
        }
      },
    },
  ];
}
