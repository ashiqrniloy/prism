import { describe, expect, it } from "bun:test";
import type {
  RagTelemetry as MemoryRagTelemetry,
  RagTelemetryAttributeValue as MemoryRagAttributeValue,
  RagTelemetrySpan as MemoryRagSpan,
} from "@arnilo/prism-memory-rag";
import type { RagTelemetry, RagTelemetryAttributeValue, RagTelemetrySpan } from "../rag-telemetry.js";

// Compile-time drift check in both directions: if memory-rag's seam changes, `bun run typecheck` fails here,
// in CI, rather than in a host's build. The local types exist so the stable package never imports memory-rag.
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const attribute: Mutual<RagTelemetryAttributeValue, MemoryRagAttributeValue> = true;
const span: Mutual<RagTelemetrySpan, MemoryRagSpan> = true;
const telemetry: Mutual<RagTelemetry, MemoryRagTelemetry> = true;
const toMemory = (value: RagTelemetry): MemoryRagTelemetry => value;
const fromMemory = (value: MemoryRagTelemetry): RagTelemetry => value;

describe("rag telemetry types", () => {
  it("rag_telemetry_types_stay_compatible", () => {
    expect([attribute, span, telemetry]).toEqual([true, true, true]);
    expect(typeof toMemory).toBe("function");
    expect(typeof fromMemory).toBe("function");
  });
});
