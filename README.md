# mermaid-flowchart-parser

Recovers node ids and edges from [Mermaid](https://mermaid.js.org/) flowchart
source. No `mermaid` dependency, no rendering pipeline (no d3, cytoscape,
katex, or roughjs) — just the text.

## Why

Mermaid's own flowchart grammar (`flow.jison`) isn't exposed as a standalone,
render-free API ([mermaid-js/mermaid#4401](https://github.com/mermaid-js/mermaid/issues/4401)
tracks migrating it off jison; flowchart hasn't moved yet). If you need "what
node ids does this diagram declare" or "what connects to what" — for example,
to check a Mermaid diagram against a separate source of truth — pulling in
all of `mermaid` for that is a lot of dependency weight for two questions.

This library is not a complete, spec-accurate flowchart grammar. It covers
the common cases well: bracket/paren/brace node shapes, solid/dotted/thick
arrows, arrow-tip variants (`--x`, `--o`, `<-->`), edge labels, chained edges
on one line, subgraphs, and quoted labels containing punctuation that would
otherwise look like a second declaration.

## Install

```
npm install @gagoar/mermaid-flowchart-parser
```

## Usage

```ts
import { parseFlowchart, extractMermaidNodeIds } from "@gagoar/mermaid-flowchart-parser";

const { nodes, edges } = parseFlowchart(`
  flowchart TD
    api[API] -->|"HTTP"| db[(Database)]
`);
// nodes: ["api", "db"]
// edges: [{ from: "api", to: "db", arrow: "-->", label: "HTTP" }]

const ids = extractMermaidNodeIds(`flowchart TD\n  api --> db`);
// ids: Set(["api", "db"])
```

## API

### `parseFlowchart(source: string): ParsedFlowchart`

```ts
interface FlowchartEdge {
  from: string;
  to: string;
  arrow: string;   // raw arrow token, e.g. "-->", "-.->", "==>", "<-->"
  label?: string;
}

interface ParsedFlowchart {
  nodes: string[];       // declared node ids, in first-seen order
  edges: FlowchartEdge[];
}
```

### `extractMermaidNodeIds(source: string): Set<string>`

Convenience wrapper for callers that only need the set of declared node ids.

## Known limits

- Not a full grammar: constructs outside common node-shape/arrow/subgraph
  syntax (e.g. `class`/`click`/`style` statement targets, multi-id `class A,B`
  lists) are not specially parsed. They typically don't match the node-shape
  pattern and are ignored, rather than misidentified.
- Edge direction on `<-->` is reported as a single bidirectional arrow token,
  not split into two directed edges.

## License

MIT
