export type NodeType =
  | "package"
  | "file"
  | "config"
  | "script"
  | "function"
  | "class"
  | "method"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "route";

export type EdgeType =
  | "CONTAINS"
  | "IMPORTS"
  | "EXPORTS"
  | "CALLS"
  | "DEPENDS_ON"
  | "TESTS"
  | "ROUTE";

export type Confidence = "EXTRACTED" | "INFERRED" | "AMBIGUOUS";

export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  filePath?: string;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  type: EdgeType;
  from: string;
  to: string;
  confidence: Confidence;
  metadata?: Record<string, unknown>;
}

export interface GraphWarning {
  filePath?: string;
  message: string;
}

export interface CodexGraph {
  schemaVersion: 1;
  generatedAt: string;
  root: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: GraphWarning[];
  stats: GraphStats;
}

export interface GraphStats {
  files: number;
  symbols: number;
  edges: number;
  warnings: number;
  tests: number;
  routes: number;
  cache?: GraphCacheSummary;
  hotspots: Array<{ id: string; name: string; filePath?: string; score: number }>;
}

export interface GraphCacheSummary {
  mode: "full" | "incremental" | "skipped";
  changedFiles: number;
  deletedFiles: number;
  unchangedFiles: number;
  reason?: string;
}

export interface FileCacheEntry {
  sha256: string;
  size: number;
  mtimeMs: number;
}

export interface GraphCache {
  schemaVersion: 1;
  graphSchemaVersion: 1;
  generatedAt: string;
  files: Record<string, FileCacheEntry>;
}

export interface BuildOptions {
  root: string;
  write?: boolean;
}

export interface QueryOptions {
  cwd: string;
  limit: number;
  depth: number;
  json?: boolean;
}

export interface QueryResult {
  node: GraphNode;
  score: number;
  reasons: string[];
  neighbors: GraphNode[];
}
