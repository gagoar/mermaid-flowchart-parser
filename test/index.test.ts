import { describe, expect, it } from "vitest";
import { extractMermaidNodeIds, parseFlowchart } from "../src/index.ts";

describe("parseFlowchart", () => {
  it("recovers node ids and a simple edge", () => {
    const result = parseFlowchart(`flowchart TD\n  api[API] --> db[(Database)]`);
    expect(result.nodes).toEqual(["api", "db"]);
    expect(result.edges).toEqual([{ from: "api", to: "db", arrow: "-->", label: undefined }]);
  });

  it("does not mistake an unquoted parenthetical inside a label for a new node", () => {
    const result = parseFlowchart(`flowchart TD\n  api[service (gateway)] --> db[(Database)]`);
    expect(result.nodes).toEqual(["api", "db"]);
    expect(result.edges).toEqual([{ from: "api", to: "db", arrow: "-->", label: undefined }]);
  });

  it("captures an edge label", () => {
    const result = parseFlowchart(`flowchart TD\n  api -->|"HTTP"| db`);
    expect(result.edges).toEqual([{ from: "api", to: "db", arrow: "-->", label: "HTTP" }]);
  });

  it("handles chained edges on one line", () => {
    const result = parseFlowchart(`flowchart TD\n  a --> b --> c`);
    expect(result.nodes).toEqual(["a", "b", "c"]);
    expect(result.edges).toEqual([
      { from: "a", to: "b", arrow: "-->", label: undefined },
      { from: "b", to: "c", arrow: "-->", label: undefined },
    ]);
  });

  it("handles dotted and thick arrows", () => {
    const result = parseFlowchart(`flowchart TD\n  a -.-> b\n  b ==> c`);
    expect(result.edges).toEqual([
      { from: "a", to: "b", arrow: "-.->", label: undefined },
      { from: "b", to: "c", arrow: "==>", label: undefined },
    ]);
  });

  it("skips subgraph and comment lines without treating the zone id as a node", () => {
    const result = parseFlowchart(
      [
        "flowchart TD",
        "%% a top-level comment",
        "subgraph zone1 [Trust Zone]",
        "  a --> b",
        "end",
      ].join("\n"),
    );
    expect(result.nodes).toEqual(["a", "b"]);
    expect(result.nodes).not.toContain("zone1");
  });

  it("strips quoted label text so words inside it are never mistaken for node ids", () => {
    const result = parseFlowchart(`flowchart TD\n  a["clearinghouse (SOAP)"] --> b`);
    expect(result.nodes).toEqual(["a", "b"]);
  });

  it("preserves first-seen node order", () => {
    const result = parseFlowchart(`flowchart TD\n  c --> a\n  a --> b`);
    expect(result.nodes).toEqual(["c", "a", "b"]);
  });

  it("does not mistake a word inside an edge label for a paren-shaped node, even with a parenthetical", () => {
    // Regression: a word immediately followed by whitespace + "(" inside a
    // pipe-delimited edge label (e.g. "write (lock)") was briefly misread as
    // a paren-shaped node declaration, adding "write"/"claim" as phantom node
    // ids that don't exist in the diagram.
    const result = parseFlowchart(
      `flowchart TD\n  a -->|"session read/write (lock)"| b\n  a -->|"submit claim (base64/SOAP)"| c`,
    );
    expect(result.nodes).toEqual(["a", "b", "c"]);
    expect(result.edges).toEqual([
      { from: "a", to: "b", arrow: "-->", label: "session read/write (lock)" },
      { from: "a", to: "c", arrow: "-->", label: "submit claim (base64/SOAP)" },
    ]);
  });
});

describe("extractMermaidNodeIds", () => {
  it("returns only the set of declared node ids", () => {
    const ids = extractMermaidNodeIds(`flowchart TD\n  api[API] --> db[(Database)]`);
    expect(ids).toEqual(new Set(["api", "db"]));
  });
});
