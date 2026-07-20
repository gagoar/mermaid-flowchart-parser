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
/** Parses Mermaid flowchart source into its declared node ids and edges. */
export declare function parseFlowchart(mermaid: string): ParsedFlowchart;
/** Convenience wrapper for callers that only need the set of declared node ids. */
export declare function extractMermaidNodeIds(mermaid: string): Set<string>;
