import type { JsonObject, Message, StructuredOutputOptions, ToolDefinition, Usage } from "../contracts.js";
export declare function assertOpenAIChatMessage(message: unknown, path: string): asserts message is Message;
export declare function serializeOpenAIChatStructuredOutput(options: StructuredOutputOptions): JsonObject;
export declare function applyOpenAIChatStructuredOutput(body: Record<string, unknown>, structuredOutput?: StructuredOutputOptions): void;
export declare function serializeOpenAITool(tool: ToolDefinition): JsonObject;
/**
 * Rendered in place of a tool-result image when the model declares no image input. Every route can
 * carry this note as text, so an image result never turns into a request the vendor rejects.
 */
export declare const OMITTED_TOOL_RESULT_IMAGE_NOTE = "[image omitted: the model does not accept images]";
/** Tool-result payload as the model should read it: text stays text, structured values stay JSON. */
export declare function serializeToolResultText(message: Message): string;
export { serializeOpenAIChatMessage } from "./codecs/openai-chat.js";
export declare function mapOpenAIChatUsage(usage: unknown): Usage | undefined;
