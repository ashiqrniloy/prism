import { ok, strictEqual, throws } from "node:assert";
import test from "node:test";
import {
  assertNotVisio,
  DiagramsCapError,
  DiagramsFormatError,
  DiagramsModelInvalidError,
  type DiagramsTelemetry,
  type DiagramsTelemetrySpan,
  DiagramsXmlMalformedError,
  DiagramsXxeError,
  validateDrawioXml,
} from "../index.js";

const VALID_DRAWIO_XML = `<mxfile host="drawio.internal" modified="2026-09-01T00:00:00.000Z" agent="Prism" version="24.0.0">
  <diagram id="diag-1" name="Page-1">
    <mxGraphModel dx="1000" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="2" value="Actor" style="shape=umlActor;" vertex="1" parent="1">
          <mxGeometry x="100" y="100" width="30" height="60" as="geometry"/>
        </mxCell>
        <mxCell id="3" value="Process" style="rounded=1;" vertex="1" parent="1">
          <mxGeometry x="250" y="100" width="120" height="60" as="geometry"/>
        </mxCell>
        <mxCell id="4" value="Call" style="endArrow=classic;" edge="1" parent="1" source="2" target="3">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

const VALID_RAW_GRAPH_MODEL = `<mxGraphModel dx="800" dy="600" pageWidth="1000" pageHeight="800">
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <mxCell id="2" value="Box" vertex="1" parent="1">
      <mxGeometry x="50" y="50" width="100" height="50" as="geometry"/>
    </mxCell>
  </root>
</mxGraphModel>`;

const BILLION_LAUGHS_XML = `<?xml version="1.0"?>
<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
 <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0" value="&lol3;"/></root></mxGraphModel></diagram></mxfile>`;

const XXE_EXTERNAL_ENTITY_XML = `<?xml version="1.0"?>
<!DOCTYPE mxfile [
  <!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/">
]>
<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0" value="&xxe;"/></root></mxGraphModel></diagram></mxfile>`;

test("validateDrawioXml validates standard draw.io mxfile", () => {
  const summary = validateDrawioXml(VALID_DRAWIO_XML);
  strictEqual(summary.pages, 1);
  strictEqual(summary.cells, 4); // cells: 0, 1, 2 (vertex), 3 (vertex)
  strictEqual(summary.edges, 1); // edge: 4
  strictEqual(summary.width, 850);
  strictEqual(summary.height, 1100);
  strictEqual(summary.compressed, undefined);
});

test("validateDrawioXml validates raw mxGraphModel XML", () => {
  const summary = validateDrawioXml(VALID_RAW_GRAPH_MODEL);
  strictEqual(summary.pages, 1);
  strictEqual(summary.cells, 3); // 0, 1, 2
  strictEqual(summary.edges, 0);
  strictEqual(summary.width, 1000);
  strictEqual(summary.height, 800);
});

test("validateDrawioXml accepts compressed mxfile without inflating", () => {
  const compressedXml = `<mxfile host="drawio.internal">
    <diagram id="d1" name="Page-1" compressed="true">7VbJbtswEP0aH4vAkiw5tg...</diagram>
  </mxfile>`;
  const summary = validateDrawioXml(compressedXml);
  strictEqual(summary.pages, 1);
  strictEqual(summary.compressed, true);
});

test("validateDrawioXml rejects malformed and truncated XML", () => {
  const truncated = "<mxfile><diagram><mxGraphModel><root><mxCell id=";
  throws(
    () => validateDrawioXml(truncated),
    (err: unknown) => err instanceof DiagramsXmlMalformedError,
  );
});

test("validateDrawioXml rejects non-mxGraph XML with DiagramsModelInvalidError", () => {
  const nonMxGraph = '<svg><rect width="100" height="50" fill="red"/></svg>';
  throws(
    () => validateDrawioXml(nonMxGraph),
    (err: unknown) => err instanceof DiagramsModelInvalidError,
  );
});

test("validateDrawioXml rejects Billion Laughs fixture with DiagramsXxeError", () => {
  throws(
    () => validateDrawioXml(BILLION_LAUGHS_XML),
    (err: unknown) => err instanceof DiagramsXxeError,
  );
});

test("validateDrawioXml rejects external entity injection with DiagramsXxeError", () => {
  throws(
    () => validateDrawioXml(XXE_EXTERNAL_ENTITY_XML),
    (err: unknown) => err instanceof DiagramsXxeError,
  );
});

test("validateDrawioXml enforces input byte cap", () => {
  throws(
    () => validateDrawioXml(VALID_DRAWIO_XML, { caps: { maxBytes: 100 } }),
    (err: unknown) => err instanceof DiagramsCapError,
  );
});

test("validateDrawioXml enforces maxElements cap", () => {
  throws(
    () => validateDrawioXml(VALID_DRAWIO_XML, { caps: { maxElements: 2 } }),
    (err: unknown) => err instanceof DiagramsCapError,
  );
});

test("assertNotVisio and validateDrawioXml reject Visio files (P12 guard)", () => {
  // Visio OLE binary header
  const oleBinary = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]);
  throws(
    () => assertNotVisio(oleBinary),
    (err: unknown) => err instanceof DiagramsFormatError,
  );
  throws(
    () => validateDrawioXml(oleBinary),
    (err: unknown) => err instanceof DiagramsFormatError,
  );

  // Visio XML document
  const visioXml = `<VisioDocument xmlns="http://schemas.microsoft.com/visio/2003/core"><Pages/></VisioDocument>`;
  throws(
    () => assertNotVisio(visioXml),
    (err: unknown) => err instanceof DiagramsFormatError,
  );
  throws(
    () => validateDrawioXml(visioXml),
    (err: unknown) => err instanceof DiagramsFormatError,
  );
});

test("validateDrawioXml records telemetry attributes with counts only", () => {
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

  validateDrawioXml(VALID_DRAWIO_XML, { telemetry: testTelemetry });
  strictEqual(spans.length, 1);
  strictEqual(spans[0]?.name, "diagrams.validate");
  strictEqual(spans[0]?.attrs["diagrams.pages"], 1);
  strictEqual(spans[0]?.attrs["diagrams.cells"], 4);
  strictEqual(spans[0]?.attrs["diagrams.edges"], 1);
  ok(typeof spans[0]?.attrs["diagrams.bytes"] === "number");
  ok(typeof spans[0]?.attrs["diagrams.durationMs"] === "number");
  // Asserts no XML payload or node labels leaked in attributes
  ok(!("xml" in spans[0]!.attrs));
  ok(!("text" in spans[0]!.attrs));
});
