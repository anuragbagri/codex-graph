import { createHash } from "node:crypto";
import path from "node:path";

import type { EdgeType, GraphEdge, GraphNode, NodeType, Confidence } from "./types.js";

export function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

export function relativePath(root: string, value: string): string {
  return toPosixPath(path.relative(root, value));
}

export function hashId(parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16);
}

export function nodeId(type: NodeType, parts: string[]): string {
  return `${type}:${hashId(parts)}`;
}

export function edgeId(type: EdgeType, from: string, to: string, metadata?: unknown): string {
  return `edge:${hashId([type, from, to, JSON.stringify(metadata ?? {})])}`;
}

export class GraphBuilder {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();

  addNode(node: GraphNode): GraphNode {
    const existing = this.nodes.get(node.id);
    if (existing) {
      this.nodes.set(node.id, {
        ...existing,
        ...node,
        metadata: { ...(existing.metadata ?? {}), ...(node.metadata ?? {}) }
      });
      return this.nodes.get(node.id) as GraphNode;
    }
    this.nodes.set(node.id, node);
    return node;
  }

  addEdge(
    type: EdgeType,
    from: string,
    to: string,
    confidence: Confidence = "EXTRACTED",
    metadata?: Record<string, unknown>
  ): GraphEdge {
    const edge: GraphEdge = {
      id: edgeId(type, from, to, metadata),
      type,
      from,
      to,
      confidence,
      ...(metadata ? { metadata } : {})
    };
    this.edges.set(edge.id, edge);
    return edge;
  }

  getNodes(): GraphNode[] {
    return [...this.nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  getEdges(): GraphEdge[] {
    return [...this.edges.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}

export function compactJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
