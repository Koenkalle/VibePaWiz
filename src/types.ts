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

export type LayoutName = 'dagre' | 'fcose';

/** User-facing settings persisted in snapshots and share links. */
export interface Settings {
  layers: number;
  direction: Direction;
  colors: boolean;
  layout: LayoutName;
  collapse: number;
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
}
