import { ok, strictEqual, throws } from "node:assert";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  canonicalizeDrawioXml,
  DiagramsFormatError,
  type DiagramsTelemetry,
  type DiagramsTelemetrySpan,
  DiagramsXxeError,
  validateDrawioXml,
} from "../index.js";

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

const XML_A = `<mxfile host="drawio.internal" modified="2026-09-01T00:00:00.000Z" agent="Prism" version="24.0.0">
  <diagram id="diag-1" name="Page-1">
    <mxGraphModel dx="1000" dy="800">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="2" parent="1" value="Actor" style="shape=umlActor;" vertex="1">
          <mxGeometry as="geometry" height="60" width="30" x="100" y="100"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

// Same diagram with permuted attributes, different whitespace and formatting
const XML_B = `<mxfile   version="24.0.0"   agent="Prism" modified="2026-09-01T00:00:00.000Z" host="drawio.internal" >
    <diagram name="Page-1" id="diag-1">
        <mxGraphModel dy="800" dx="1000">
            <root>
                <mxCell id="0" />
                <mxCell parent="0" id="1" />
                <mxCell vertex="1" style="shape=umlActor;" value="Actor" parent="1" id="2">
                    <mxGeometry y="100" x="100" width="30" height="60" as="geometry" />
                </mxCell>
            </root>
        </mxGraphModel>
    </diagram>
</mxfile>`;

test("canonicalizeDrawioXml produces identical output for differently formatted and ordered XML", () => {
  const canonA = canonicalizeDrawioXml(XML_A);
  const canonB = canonicalizeDrawioXml(XML_B);

  strictEqual(canonA, canonB, "Canonical XML must be byte-identical");
  strictEqual(sha256(canonA), sha256(canonB), "SHA-256 hash must be identical");
});

test("canonical XML output itself validates cleanly under validateDrawioXml", () => {
  const canon = canonicalizeDrawioXml(XML_A);
  const summary = validateDrawioXml(canon);
  strictEqual(summary.pages, 1);
  strictEqual(summary.cells, 3); // 0, 1, 2
});

test("canonicalizeDrawioXml sorts attributes lexicographically", () => {
  const input = `<mxCell vertex="1" style="rounded=1;" parent="1" id="2" value="Box"/>`;
  const canonical = canonicalizeDrawioXml(input);
  strictEqual(canonical, `<mxCell id="2" parent="1" style="rounded=1;" value="Box" vertex="1"/>`);
});

test("canonicalizeDrawioXml rejects XXE and Visio inputs", () => {
  const xxe = `<!DOCTYPE lol [ <!ENTITY x "x"> ]><mxfile/>`;
  throws(
    () => canonicalizeDrawioXml(xxe),
    (err: unknown) => err instanceof DiagramsXxeError,
  );

  const visio = `<VisioDocument xmlns="http://schemas.microsoft.com/visio"><Pages/></VisioDocument>`;
  throws(
    () => canonicalizeDrawioXml(visio),
    (err: unknown) => err instanceof DiagramsFormatError,
  );
});

test("canonicalizeDrawioXml records telemetry spans", () => {
  const spans: Array<{ name: string; attrs: Record<string, unknown> }> = [];

  const testTelemetry: DiagramsTelemetry = {
    startSpan(name, attributes) {
      const attrs: Record<string, unknown> = { ...(attributes ?? {}) };
      const span: DiagramsTelemetrySpan = {
        setAttribute(k, v) {
          attrs[k] = v;
        },
        addEvent() {},
        recordError() {},
        end() {
          spans.push({ name, attrs });
        },
      };
      return span;
    },
  };

  canonicalizeDrawioXml(XML_A, { telemetry: testTelemetry });
  strictEqual(spans.length, 1);
  strictEqual(spans[0]?.name, "diagrams.canonicalize");
  ok(typeof spans[0]?.attrs["diagrams.inputBytes"] === "number");
  ok(typeof spans[0]?.attrs["diagrams.outputBytes"] === "number");
  ok(typeof spans[0]?.attrs["diagrams.durationMs"] === "number");
});
