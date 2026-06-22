/** Core domain types shared across the app. */

/** Normalized metadata for a single paper, independent of the data source. */
export interface PaperMeta {
  /** Provider-native id (e.g. an OpenAlex `W...` id or a Semantic Scholar paper id). */
  id: string;
  doi?: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  citedByCount?: number;
}

/** A directed citation edge. By convention `source` cites `target` (source → target). */
export interface GraphEdge {
  source: string;
  target: string;
}

/** Direction of exploration when expanding the network. */
export type Direction = 'citers' | 'references' | 'both';

/**
 * `dagre-compact` and `dagre` are both Sugiyama/layered (origin left); compact
 * uses the network-simplex ranker to minimize total edge length, `dagre` uses
 * tight-tree (wider spread). `fcose` is force-directed.
 */
export type LayoutName = 'dagre-compact' | 'dagre' | 'fcose';

/**
 * How the collapse level decides whether two overlapping chains fuse:
 * - `ratio`: by overlap fraction (shared / union ≥ 1/(collapse+1)) — scales with
 *   chain size, so a single shared "hub" paper won't fuse chains until very loose.
 * - `difference`: by total differing papers across both chains (≤ collapse).
 * - `bridge`: today's per-side difference (≤ collapse) but only when chains share
 *   at least an edge (≥2 papers), so a lone shared paper never bridges.
 */
export type CollapseStyle = 'ratio' | 'difference' | 'bridge';

/** User-facing settings persisted in snapshots and share links. */
export interface Settings {
  layers: number;
  direction: Direction;
  colors: boolean;
  layout: LayoutName;
  collapse: number;
  /** Which overlap metric the collapse level uses to fuse chains. No effect at Collapse 0. */
  collapseStyle: CollapseStyle;
  /** Position nodes horizontally by publication year (dagre layout only). */
  yearOrder: boolean;
  /**
   * Weight dagre edges by how many chains they belong to, so colored chains are
   * crossed/lengthened less than non-chain dotted edges (hierarchical layout only).
   */
  prioritizeChains: boolean;
  /**
   * Draw each citation chain as a single path and hide the redundant edges
   * inside it (the original's chain simplification). When off, those edges are
   * shown dashed.
   */
  simplifyChains: boolean;
  /**
   * What collapsing does to the chains it groups together: 'split' just recolours
   * the related chains the same and leaves the layout unchanged; 'abridged'
   * combines each group into one forward citation-ordered path (synthetic
   * connectors fill gaps). No effect at Collapse 0.
   */
  mergeStyle: 'split' | 'abridged';
}

/** A maximal chain/clique of papers plus derived presentation data. */
export interface Clique {
  nodes: string[];
  color: string;
  /** Most frequent meaningful title keywords. */
  keywords: string[];
  earliestYear?: number;
  latestYear?: number;
  /** [authorName, count] sorted by count desc. */
  topAuthors: Array<[string, number]>;
}

/** Serializable representation of the whole graph (export / share / snapshot). */
export interface SerializedGraph {
  version: 1;
  providerId: string;
  seedId: string | null;
  settings: Settings;
  nodes: PaperMeta[];
  edges: GraphEdge[];
  /** Ids the user explicitly clicked to expand; controls leaf-node visibility. */
  expanded?: string[];
}
