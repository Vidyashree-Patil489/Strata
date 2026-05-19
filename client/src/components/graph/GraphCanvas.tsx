import { useEffect, useRef } from "react";
import cytoscape from "cytoscape";
import type { Core, ElementDefinition, NodeSingular } from "cytoscape";
// @ts-expect-error — no published types
import fcose from "cytoscape-fcose";
// @ts-expect-error — no published types
import dagre from "cytoscape-dagre";

// Register layout plugins once globally (cytoscape complains if you call
// twice but the guard is in cytoscape itself, so this is safe across HMR).
let registered = false;
function ensureRegistered() {
  if (registered) return;
  cytoscape.use(fcose);
  cytoscape.use(dagre);
  registered = true;
}

export type DiffState = "added" | "removed" | "unchanged";

export interface GraphNode {
  id: string;        // file path
  label: string;     // basename
  dir: string;       // top-level directory (compound parent id will be `dir:${dir}`)
  pageRank: number;
  defCount: number;
  diff?: DiffState;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight?: number;
  diff?: DiffState;
}

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Show a colored overlay for diff state (added/removed). Default off. */
  showDiff?: boolean;
  /**
   * Layout to use. `fcose` is the smart force-directed default. `dagre`
   * is a top-down hierarchical fallback some users may prefer for
   * smaller graphs.
   */
  layout?: "fcose" | "dagre";
  /** Called when the user clicks a node. */
  onNodeClick?: (id: string) => void;
}

/**
 * Cytoscape-backed canvas. Renders files as nodes grouped into compound
 * parents per top-level directory. Edges = imports/references between
 * files. Node size scales with PageRank.
 *
 * Diff mode (showDiff=true) styles added nodes/edges green, removed in
 * a phantom red dashed style, unchanged at low opacity so the changes
 * pop.
 */
export function GraphCanvas({
  nodes,
  edges,
  showDiff = false,
  layout = "fcose",
  onNodeClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  // Build cytoscape elements once per render of nodes/edges.
  // Compound parents: one per unique `dir` value, with id `dir:${dir}`.
  useEffect(() => {
    if (!containerRef.current) return;
    ensureRegistered();

    const dirs = new Set<string>();
    for (const n of nodes) dirs.add(n.dir || ".");

    const elements: ElementDefinition[] = [];
    // Compound parent nodes
    for (const d of dirs) {
      elements.push({
        group: "nodes",
        data: { id: `dir:${d}`, label: d === "." ? "(root)" : d + "/", isDir: true },
        classes: "dir",
      });
    }
    // File nodes — parented into their directory
    for (const n of nodes) {
      elements.push({
        group: "nodes",
        data: {
          id: n.id,
          label: n.label,
          parent: `dir:${n.dir || "."}`,
          pageRank: n.pageRank,
          defCount: n.defCount,
          fullPath: n.id,
        },
        classes: showDiff && n.diff ? `file diff-${n.diff}` : "file",
      });
    }
    // Edges
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      elements.push({
        group: "edges",
        data: { id: `e${i}:${e.source}->${e.target}`, source: e.source, target: e.target, weight: e.weight ?? 1 },
        classes: showDiff && e.diff ? `diff-${e.diff}` : "",
      });
    }

    // Destroy any prior instance to avoid leaking listeners
    if (cyRef.current) {
      cyRef.current.destroy();
      cyRef.current = null;
    }

    // Compute node-size range. Map pageRank to a 14..56 px node diameter
    // so small files don't disappear and big files don't dominate.
    const prValues = nodes.map((n) => n.pageRank).filter((v) => v > 0);
    const minPR = prValues.length ? Math.min(...prValues) : 0;
    const maxPR = prValues.length ? Math.max(...prValues) : 1;
    const prRange = Math.max(maxPR - minPR, 1e-9);

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      // Editorial palette — soft gray strokes, dark ink, indigo accent.
      style: [
        // ── Compound (directory) ──
        {
          selector: "node.dir",
          style: {
            "background-opacity": 0.04,
            "background-color": "#0a0a0a",
            "border-width": 1,
            "border-color": "#e7e5e4",
            "border-style": "dashed",
            "label": "data(label)",
            "color": "#57534e",
            "font-size": 10,
            "font-family": "Inter, sans-serif",
            "font-weight": 500,
            "text-valign": "top",
            "text-halign": "center",
            "text-margin-y": -4,
            "padding": 18,
            // cytoscape needs `shape: 'roundrectangle'` to round corners on compounds
            "shape": "round-rectangle",
            "corner-radius": "10",
          } as any,
        },
        // ── File ──
        {
          selector: "node.file",
          style: {
            "background-color": "#0a0a0a",
            "background-opacity": 0.85,
            "border-width": 1,
            "border-color": "#0a0a0a",
            "label": "data(label)",
            "color": "#0a0a0a",
            "font-size": 9,
            "font-family": "JetBrains Mono, ui-monospace, monospace",
            "text-valign": "bottom",
            "text-halign": "center",
            "text-margin-y": 4,
            "min-zoomed-font-size": 8,
            // Size based on PageRank — mapped to 14..56 px
            "width": (ele: NodeSingular) => {
              const pr = ele.data("pageRank") || 0;
              return 14 + ((pr - minPR) / prRange) * 42;
            },
            "height": (ele: NodeSingular) => {
              const pr = ele.data("pageRank") || 0;
              return 14 + ((pr - minPR) / prRange) * 42;
            },
            "shape": "ellipse",
          } as any,
        },
        // ── File hover / selection ──
        {
          selector: "node.file:active, node.file.cy-selected",
          style: {
            "border-color": "#4f46e5",
            "border-width": 2,
          } as any,
        },
        // ── Edges ──
        {
          selector: "edge",
          style: {
            "width": 1,
            "line-color": "#d6d3d1",
            "curve-style": "bezier",
            "target-arrow-shape": "triangle",
            "target-arrow-color": "#d6d3d1",
            "arrow-scale": 0.6,
            "opacity": 0.5,
          } as any,
        },
        // ── Diff overlay: added (green) ──
        {
          selector: "node.diff-added",
          style: {
            "background-color": "#15803d", // chart-5 green
            "border-color": "#15803d",
          } as any,
        },
        {
          selector: "edge.diff-added",
          style: {
            "line-color": "#15803d",
            "target-arrow-color": "#15803d",
            "opacity": 0.9,
            "width": 1.5,
          } as any,
        },
        // ── Diff overlay: removed (red dashed) ──
        {
          selector: "node.diff-removed",
          style: {
            "background-color": "#b91c1c",
            "border-color": "#b91c1c",
            "background-opacity": 0.3,
            "border-style": "dashed",
            "border-width": 1.5,
          } as any,
        },
        {
          selector: "edge.diff-removed",
          style: {
            "line-color": "#b91c1c",
            "target-arrow-color": "#b91c1c",
            "line-style": "dashed",
            "opacity": 0.7,
            "width": 1,
          } as any,
        },
        // ── When diff mode is active and a node is "unchanged", fade it ──
        {
          selector: "node.file.diff-unchanged",
          style: {
            "background-opacity": 0.2,
            "opacity": 0.45,
          } as any,
        },
      ],
      layout:
        layout === "fcose"
          ? ({
              name: "fcose",
              quality: "default",
              animate: false,
              randomize: true,
              fit: true,
              padding: 30,
              nodeRepulsion: 5500,
              idealEdgeLength: 80,
              edgeElasticity: 0.45,
              nestingFactor: 0.4,
              gravity: 0.25,
              numIter: 2500,
              tile: true,
              tilingPaddingVertical: 12,
              tilingPaddingHorizontal: 12,
            } as any)
          : ({
              name: "dagre",
              rankDir: "TB",
              nodeSep: 24,
              edgeSep: 12,
              rankSep: 40,
              animate: false,
              fit: true,
              padding: 30,
            } as any),
      // wheelSensitivity > 1 triggers a cytoscape console warning but it
      // works fine and is what gives a snappy zoom feel. 0.2 (default-ish)
      // was sluggish; 1.4 matches the responsiveness of Figma/Linear/etc.
      wheelSensitivity: 1.4,
      minZoom: 0.05,
      maxZoom: 8,
    });

    if (onNodeClick) {
      cy.on("tap", "node.file", (evt) => {
        onNodeClick(evt.target.id());
      });
    }

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [nodes, edges, showDiff, layout, onNodeClick]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-background"
      style={{ minHeight: 600 }}
    />
  );
}
