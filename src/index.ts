// A small, dependency-free parser that recovers node ids and edges from
// Mermaid flowchart source, without pulling in `mermaid` itself (d3,
// cytoscape, katex, roughjs, ...) or any rendering pipeline.
//
// Mermaid's own flowchart grammar (`flow.jison`) is not exposed as a
// standalone, renderer-free API — see mermaid-js/mermaid#4401. This library
// does not attempt to be a full, spec-complete flowchart grammar. It covers
// the common declaration and edge shapes (bracket/paren/brace node shapes,
// solid/dotted/thick arrows, arrow-tip variants, edge labels, chained edges,
// subgraphs) well enough to answer two practical questions: "what node ids
// does this diagram declare?" and "what connects to what?"

/** Opening shape delimiter -> its matching closing delimiter. */
const OPEN_TO_CLOSE: Readonly<Record<string, string>> = {
  "[(": ")]",
  "((": "))",
  "{{": "}}",
  "[": "]",
  "(": ")",
  "{": "}",
};

/** Mermaid keywords and direction tokens that are never node ids. */
const RESERVED: ReadonlySet<string> = new Set([
  "flowchart", "graph", "subgraph", "end", "classDef", "class", "click",
  "style", "linkStyle", "direction", "TB", "TD", "LR", "RL", "BT",
]);

// Common Mermaid arrow tokens (solid, dotted `-.->`, thick `==>`, invisible
// `~~~`, bidirectional `<-->`, and cross/circle tips `--x`/`--o`), each with
// an optional trailing pipe-delimited edge label (`-->|"HTTP"|`).
const ARROW_RE = /(--[-.]*[>ox]?|==[=.]*[>ox]?|~~[~.]*[>ox]?|-\.[-.]*[>ox]?|<-->)(?:\|([^|]*)\|)?/g;

const BARE_ID_RE = /^([A-Za-z_][\w-]*)\s*$/;

/**
 * Reads a regex match's capture group 1. Every regex this module matches
 * against has a mandatory (non-optional) group 1, so `noUncheckedIndexedAccess`
 * infers `string | undefined` for match-array access without knowing that —
 * this narrows it in one place instead of scattering assertions.
 */
function group1(match: RegExpMatchArray | RegExpExecArray): string {
  return match[1] as string;
}

export interface FlowchartEdge {
  readonly from: string;
  readonly to: string;
  /** The raw arrow token, e.g. "-->", "-.->", "==>", "<-->". */
  readonly arrow: string;
  /** The edge label, if any, with surrounding quotes/whitespace stripped. */
  readonly label?: string;
}

export interface ParsedFlowchart {
  /** Every declared node id, in first-seen order. */
  readonly nodes: string[];
  readonly edges: FlowchartEdge[];
}

/**
 * Finds identifier+shape declarations in a line, adds their ids to `ids`, and
 * — unlike a plain global regex scan — skips past each shape's own label
 * content before continuing to search. Without this, an unquoted
 * parenthetical inside a label (e.g. `api[service (gateway)]`) gets mistaken
 * for a second node declaration (`service` immediately followed by `(`).
 *
 * @returns a "skeleton" of the line with label content removed, leaving only
 * ids and arrows for the caller's edge-splitting pass.
 */
function extractShapeDeclarations(line: string, ids: Set<string>): string {
  const idRe = /[A-Za-z_][\w-]*/y;
  const openRe = /\s*(\[\(|\(\(|\{\{|\[|\(|\{)/y;
  let skeleton = "";
  let i = 0;
  while (i < line.length) {
    // A pipe-delimited edge label (`-->|"session read/write (lock)"|`) is
    // copied through verbatim, without scanning its interior — otherwise a
    // word inside it followed by whitespace and "(" (e.g. "write (lock)")
    // gets misread as a paren-shaped node declaration.
    if (line[i] === "|") {
      const close = line.indexOf("|", i + 1);
      const end = close === -1 ? line.length : close + 1;
      skeleton += line.slice(i, end);
      i = end;
      continue;
    }
    idRe.lastIndex = i;
    const idMatch = idRe.exec(line);
    if (!idMatch || idMatch.index !== i) {
      skeleton += line[i];
      i++;
      continue;
    }
    const id = idMatch[0];
    openRe.lastIndex = i + id.length;
    const openMatch = openRe.exec(line);
    if (!openMatch || openMatch.index !== i + id.length) {
      skeleton += id;
      i += id.length;
      continue;
    }
    const opener = group1(openMatch);
    if (!RESERVED.has(id)) ids.add(id);
    skeleton += `${id} `; // keep the id itself visible to the edge-splitting pass

    // Skip past this shape's label content up to its matching close, so
    // nothing inside it gets rescanned as a new declaration.
    // openRe's capture group can only match one of OPEN_TO_CLOSE's keys.
    const closer = OPEN_TO_CLOSE[opener] as string;
    let depth = 1;
    let j = openMatch.index + openMatch[0].length;
    const openChar = opener.charAt(0);
    while (j < line.length && depth > 0) {
      if (line.startsWith(closer, j)) {
        depth--;
        j += closer.length;
        continue;
      }
      if (line[j] === openChar) depth++;
      j++;
    }
    i = j;
  }
  return skeleton;
}

interface EdgeSplit {
  readonly texts: string[];
  readonly arrows: { readonly raw: string; readonly label?: string }[];
}

/** Splits a label-free skeleton line into the text segments between arrows. */
function splitOnArrows(skeleton: string): EdgeSplit {
  const texts: string[] = [];
  const arrows: { raw: string; label?: string }[] = [];
  let lastIndex = 0;
  ARROW_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ARROW_RE.exec(skeleton))) {
    texts.push(skeleton.slice(lastIndex, m.index));
    const label = m[2]?.trim().replace(/^"|"$/g, "");
    arrows.push({ raw: group1(m), label: label || undefined });
    lastIndex = m.index + m[0].length;
  }
  texts.push(skeleton.slice(lastIndex));
  return { texts, arrows };
}

/** Parses Mermaid flowchart source into its declared node ids and edges. */
export function parseFlowchart(mermaid: string): ParsedFlowchart {
  const ids = new Set<string>();
  const nodeOrder: string[] = [];
  const edges: FlowchartEdge[] = [];

  const addId = (id: string) => {
    if (RESERVED.has(id) || ids.has(id)) return;
    ids.add(id);
    nodeOrder.push(id);
  };

  for (const rawLine of mermaid.split("\n")) {
    let line = rawLine.trim();
    if (line === "" || line.startsWith("%%")) continue;
    // Subgraph declarations name a zone/container, not a node — skip the
    // whole line rather than treat the zone id as a flowchart node.
    if (/^subgraph\b/.test(line)) continue;
    // Strip quoted label text first, so words inside a quoted label (e.g. a
    // parenthetical like `clearinghouse (SOAP)`) can't be mistaken for a node
    // declaration — a real node id always sits outside its own label. Pipe-
    // delimited edge labels (`-->|"HTTP"|`) are left untouched: their content
    // is still needed by the edge-splitting pass below.
    line = line.replace(/\|[^|]*\||"[^"]*"/g, (m) => (m.startsWith("|") ? m : ""));

    // Extract shape declarations first, replacing each one's label content
    // with a blank skeleton so the edge-splitting pass below only ever sees
    // ids and arrows, never label text (quoted or not).
    const declaredIds = new Set<string>();
    const skeleton = extractShapeDeclarations(line, declaredIds);
    for (const id of declaredIds) addId(id);

    const { texts, arrows } = splitOnArrows(skeleton);
    for (const text of texts) {
      const bare = text.trim().match(BARE_ID_RE);
      if (bare) addId(group1(bare));
    }
    // texts.length === arrows.length + 1 by construction (one text segment
    // before, between, and after every arrow), so texts[i+1] is always the
    // segment following arrows[i]; the `?? ""` fallback is defensive only.
    for (const [i, arrow] of arrows.entries()) {
      const fromBare = (texts[i] ?? "").trim().match(BARE_ID_RE);
      const toBare = (texts[i + 1] ?? "").trim().match(BARE_ID_RE);
      if (fromBare && toBare) {
        edges.push({ from: group1(fromBare), to: group1(toBare), arrow: arrow.raw, label: arrow.label });
      }
    }
  }

  return { nodes: nodeOrder, edges };
}

/** Convenience wrapper for callers that only need the set of declared node ids. */
export function extractMermaidNodeIds(mermaid: string): Set<string> {
  return new Set(parseFlowchart(mermaid).nodes);
}
