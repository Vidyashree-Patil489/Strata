import { useCallback, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import {
  FileCode2,
  GitCommit,
  ArrowDownToLine,
  ArrowUpFromLine,
  Loader2,
} from "lucide-react";
import api from "../../api/axios";

// ── Public API (preserved from the previous cytoscape impl) ───────────

export type DiffState = "added" | "removed" | "unchanged";

export interface GraphNode {
  id: string;
  label: string;
  dir: string;
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
  /** Apply added/removed/unchanged overlay colors. */
  showDiff?: boolean;
  /** "fcose" → left-to-right tree; "dagre" → top-to-bottom tree. */
  layout?: "fcose" | "dagre";
  onNodeClick?: (id: string) => void;
  /** Required for the hover card to fetch /file-meta. Without it the card
   *  still shows pagerank, dependencies, and the basename — just no commit
   *  date or file summary. */
  repoId?: string;
}

// ── Constants ─────────────────────────────────────────────────────────

const FILE_W = 68;
const FILE_H = 70;
const FILE_GAP = 18;
const DIR_HEADER = 32;
const DIR_PADDING = 18;
const NODE_MIN = 22;
const NODE_MAX_GROWTH = 28;

// ── Helpers ────────────────────────────────────────────────────────────

/** Stable directory → hue map. djb2-ish hash spreads well across HSL. */
function dirHue(dir: string): number {
  let h = 5381;
  for (let i = 0; i < dir.length; i++) {
    h = ((h << 5) + h + dir.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(h) % 360;
}

function dirColor(dir: string, sat = 55, lum = 56, alpha = 1): string {
  return `hsla(${dirHue(dir)}, ${sat}%, ${lum}%, ${alpha})`;
}

function nodeSize(pageRank: number, max: number): number {
  if (max <= 0) return NODE_MIN;
  return NODE_MIN + (pageRank / max) * NODE_MAX_GROWTH;
}

// ── Layout ─────────────────────────────────────────────────────────────

/**
 * Two-level layout: dagre positions the *directory* groups using the
 * aggregated cross-dir import graph; files are then grid-packed inside
 * each group. Looks like a clean tree at any scale.
 */
function computeLayout(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  layoutKind: "fcose" | "dagre",
  showDiff: boolean,
): { rfNodes: Node[]; rfEdges: Edge[]; maxPageRank: number } {
  const byDir = new Map<string, GraphNode[]>();
  for (const n of rawNodes) {
    const d = n.dir || ".";
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d)!.push(n);
  }

  // Per-dir bounding box, based on a square-ish grid of its files.
  const dirSize = new Map<string, { w: number; h: number; cols: number }>();
  for (const [d, files] of byDir) {
    const cols = Math.max(1, Math.ceil(Math.sqrt(files.length)));
    const rows = Math.ceil(files.length / cols);
    const w = cols * FILE_W + (cols - 1) * FILE_GAP + 2 * DIR_PADDING;
    const h = rows * FILE_H + (rows - 1) * FILE_GAP + DIR_HEADER + DIR_PADDING;
    dirSize.set(d, { w, h, cols });
  }

  // Dagre on the dir-level graph
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: layoutKind === "dagre" ? "TB" : "LR",
    nodesep: 90,
    ranksep: 130,
    marginx: 40,
    marginy: 40,
  });

  for (const [d, size] of dirSize) {
    g.setNode(d, { width: size.w, height: size.h });
  }

  const fileDir = new Map<string, string>();
  for (const n of rawNodes) fileDir.set(n.id, n.dir || ".");

  const dirEdgeSeen = new Set<string>();
  for (const e of rawEdges) {
    const s = fileDir.get(e.source);
    const t = fileDir.get(e.target);
    if (!s || !t || s === t) continue;
    const key = `${s}|${t}`;
    if (dirEdgeSeen.has(key)) continue;
    dirEdgeSeen.add(key);
    g.setEdge(s, t);
  }

  dagre.layout(g);

  let maxPageRank = 0;
  for (const n of rawNodes) maxPageRank = Math.max(maxPageRank, n.pageRank);

  const rfNodes: Node[] = [];
  for (const [d, files] of byDir) {
    const gnode = g.node(d);
    if (!gnode) continue;
    const { w, h, cols } = dirSize.get(d)!;

    rfNodes.push({
      id: `dir:${d}`,
      type: "dirGroup",
      position: { x: gnode.x - w / 2, y: gnode.y - h / 2 },
      data: { label: d, dir: d },
      style: { width: w, height: h, zIndex: 0 },
      draggable: false,
      selectable: false,
      connectable: false,
    });

    files.forEach((file, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      rfNodes.push({
        id: file.id,
        type: "fileNode",
        parentId: `dir:${d}`,
        extent: "parent",
        position: {
          x: DIR_PADDING + col * (FILE_W + FILE_GAP),
          y: DIR_HEADER + row * (FILE_H + FILE_GAP),
        },
        data: { file, maxPageRank, showDiff },
        draggable: false,
        connectable: false,
      });
    });
  }

  const rfEdges: Edge[] = rawEdges.map((e, i) => {
    const baseStroke = "#d6d3d1";
    const baseWidth = 1;
    let stroke = baseStroke;
    let width = baseWidth;
    let opacity = 0.4;
    if (showDiff) {
      if (e.diff === "added") {
        stroke = "#15803d";
        width = 1.5;
        opacity = 0.85;
      } else if (e.diff === "removed") {
        stroke = "#b91c1c";
        width = 1;
        opacity = 0.6;
      }
    }
    return {
      id: `e${i}:${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      type: "default",
      style: { stroke, strokeWidth: width, opacity },
      data: { weight: e.weight ?? 1, diff: e.diff },
    };
  });

  return { rfNodes, rfEdges, maxPageRank };
}

// ── Custom node components ────────────────────────────────────────────

type FileHoverState = "hovered" | "incoming" | "outgoing" | "dimmed";

interface FileNodeData {
  file: GraphNode;
  maxPageRank: number;
  showDiff: boolean;
  hoverState?: FileHoverState;
  [key: string]: unknown;
}

interface DirGroupData {
  label: string;
  dir: string;
  [key: string]: unknown;
}

type FileNodeT = Node<FileNodeData, "fileNode">;
type DirGroupT = Node<DirGroupData, "dirGroup">;

function FileNode({ data }: NodeProps<FileNodeT>) {
  const { file, maxPageRank, showDiff, hoverState } = data;
  const size = nodeSize(file.pageRank, maxPageRank);

  // Color the dot by directory; override for diff state when on.
  const baseFill = dirColor(file.dir);
  const diffFill =
    showDiff && file.diff === "added"
      ? "#15803d"
      : showDiff && file.diff === "removed"
        ? "#b91c1c"
        : null;
  const fill = diffFill ?? baseFill;

  const border =
    hoverState === "hovered"
      ? "#4f46e5"
      : hoverState === "incoming"
        ? "#15803d"
        : hoverState === "outgoing"
          ? "#b91c1c"
          : showDiff && file.diff === "removed"
            ? "#b91c1c"
            : "rgba(10,10,10,0.18)";

  const borderWidth = hoverState === "hovered" ? 2.5 : hoverState && hoverState !== "dimmed" ? 2 : 1;

  const dimmed = hoverState === "dimmed";
  const fadedByDiff = showDiff && file.diff === "unchanged" && !hoverState;

  return (
    <div
      className="flex flex-col items-center"
      style={{
        opacity: dimmed ? 0.18 : fadedByDiff ? 0.4 : 1,
        transition: "opacity 120ms",
      }}
    >
      {/* Handles centered on the circle so edges connect to it visually,
          not to the wrapping label-aware div. */}
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        style={{ opacity: 0, pointerEvents: "none", top: size / 2 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        style={{ opacity: 0, pointerEvents: "none", top: size / 2 }}
      />
      <div
        style={{
          width: size,
          height: size,
          background: fill,
          border: `${borderWidth}px solid ${border}`,
          borderRadius: "50%",
          transition: "border 100ms, transform 120ms, box-shadow 120ms",
          transform: hoverState === "hovered" ? "scale(1.1)" : "scale(1)",
          boxShadow: hoverState === "hovered" ? "0 4px 14px rgba(79,70,229,0.25)" : "none",
        }}
      />
      <span
        className="mt-1 truncate font-mono"
        style={{
          fontSize: 9.5,
          maxWidth: FILE_W - 4,
          color: "var(--card-foreground, #0a0a0a)",
          opacity: dimmed ? 0.4 : 0.75,
        }}
        title={file.id}
      >
        {file.label}
      </span>
    </div>
  );
}

function DirGroup({ data }: NodeProps<DirGroupT>) {
  const tint = dirColor(data.dir, 55, 56, 0.05);
  const stroke = dirColor(data.dir, 45, 45, 0.32);
  const labelColor = dirColor(data.dir, 35, 28, 0.85);

  return (
    <div
      className="rounded-xl relative"
      style={{
        width: "100%",
        height: "100%",
        background: tint,
        border: `1px dashed ${stroke}`,
      }}
    >
      <div
        className="absolute font-medium font-mono"
        style={{
          top: 8,
          left: DIR_PADDING,
          fontSize: 11,
          color: labelColor,
          letterSpacing: 0.2,
        }}
      >
        {data.label === "." ? "(root)" : data.label + "/"}
      </div>
    </div>
  );
}

const nodeTypes = { fileNode: FileNode, dirGroup: DirGroup };

// ── Hover card ─────────────────────────────────────────────────────────

interface FileMeta {
  path: string;
  lastModified: string | null;
  lastCommitSha: string | null;
  lastCommitMessage: string | null;
  lastCommitAuthor: string | null;
  summary: string | null;
}

interface HoverNeighbor {
  id: string;
  label: string;
  weight: number;
}

interface HoverState {
  file: GraphNode;
  meta: FileMeta | "loading" | "error" | null;
  incoming: HoverNeighbor[];
  outgoing: HoverNeighbor[];
}

interface CursorPos {
  x: number;
  y: number;
}

function HoverCard({ state, cursor }: { state: HoverState; cursor: CursorPos }) {
  const { file, meta, incoming, outgoing } = state;
  const { x: screenX, y: screenY } = cursor;
  const CARD_W = 360;
  const CARD_OFFSET = 18;

  const flipX = screenX + CARD_W + CARD_OFFSET > window.innerWidth - 8;
  const left = flipX
    ? Math.max(8, screenX - CARD_W - CARD_OFFSET)
    : screenX + CARD_OFFSET;
  // Cap vertical so the card never clips the viewport
  const top = Math.max(8, Math.min(window.innerHeight - 380, screenY - 12));

  return (
    <div
      className="fixed z-50 rounded-lg pointer-events-none"
      style={{
        left,
        top,
        width: CARD_W,
        background: "var(--card, #ffffff)",
        border: "1px solid var(--border, #e7e5e4)",
        padding: 12,
        boxShadow:
          "0 10px 30px rgba(10, 10, 10, 0.10), 0 4px 10px rgba(10,10,10,0.04)",
      }}
    >
      <div className="flex items-start gap-2">
        <FileCode2
          size={14}
          style={{ color: "var(--primary, #4f46e5)", marginTop: 2, flexShrink: 0 }}
        />
        <div className="min-w-0 flex-1">
          <div
            className="font-semibold truncate"
            style={{ fontSize: 13, color: "var(--card-foreground, #0a0a0a)" }}
          >
            {file.label}
          </div>
          <div
            className="font-mono truncate"
            style={{ fontSize: 10.5, color: "var(--muted-foreground, #57534e)" }}
            title={file.id}
          >
            {file.id}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <Stat label="PageRank" value={`${(file.pageRank * 100).toFixed(2)}%`} />
        <Stat label="Definitions" value={String(file.defCount)} />
      </div>

      <MetaSection meta={meta} />

      <NeighborList
        icon="incoming"
        label="Imported by"
        peers={incoming}
        empty="No file imports this"
      />
      <NeighborList
        icon="outgoing"
        label="Imports"
        peers={outgoing}
        empty="Imports nothing"
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-md"
      style={{ background: "var(--muted, #f5f5f4)", padding: 8 }}
    >
      <div
        className="uppercase tracking-wider"
        style={{ fontSize: 9, color: "var(--muted-foreground, #57534e)" }}
      >
        {label}
      </div>
      <div
        className="font-semibold font-mono tabular-nums mt-0.5"
        style={{ fontSize: 13, color: "var(--card-foreground, #0a0a0a)" }}
      >
        {value}
      </div>
    </div>
  );
}

function MetaSection({ meta }: { meta: HoverState["meta"] }) {
  if (meta === "loading") {
    return (
      <div
        className="mt-3 flex items-center gap-1.5"
        style={{ fontSize: 11, color: "var(--muted-foreground, #57534e)" }}
      >
        <Loader2 size={11} className="animate-spin" />
        Loading commit + summary…
      </div>
    );
  }
  if (meta === "error") {
    return (
      <div
        className="mt-3"
        style={{ fontSize: 11, color: "var(--muted-foreground, #57534e)" }}
      >
        Couldn't load file metadata
      </div>
    );
  }
  if (meta === null) return null;

  return (
    <div className="mt-3 space-y-2.5">
      {meta.lastModified && (
        <div>
          <div
            className="flex items-center gap-1.5 mb-0.5 uppercase tracking-wider"
            style={{ fontSize: 9, color: "var(--muted-foreground, #57534e)" }}
          >
            <GitCommit size={9} />
            Last touched
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: "var(--card-foreground, #0a0a0a)",
            }}
          >
            {new Date(meta.lastModified).toLocaleString()}
            {meta.lastCommitAuthor && (
              <span style={{ color: "var(--muted-foreground, #57534e)" }}>
                {" "}
                by {meta.lastCommitAuthor}
              </span>
            )}
          </div>
          {meta.lastCommitMessage && (
            <div
              className="font-mono truncate"
              style={{
                fontSize: 11,
                color: "var(--muted-foreground, #57534e)",
                marginTop: 2,
              }}
              title={meta.lastCommitMessage}
            >
              {meta.lastCommitMessage}
            </div>
          )}
        </div>
      )}
      {meta.summary && (
        <div>
          <div
            className="uppercase tracking-wider mb-1"
            style={{ fontSize: 9, color: "var(--muted-foreground, #57534e)" }}
          >
            What this file does
          </div>
          <div
            className="leading-snug whitespace-pre-line"
            style={{
              fontSize: 11.5,
              color: "var(--card-foreground, #0a0a0a)",
              maxHeight: 110,
              overflow: "hidden",
            }}
          >
            {meta.summary}
          </div>
        </div>
      )}
    </div>
  );
}

function NeighborList({
  icon,
  label,
  peers,
  empty,
}: {
  icon: "incoming" | "outgoing";
  label: string;
  peers: HoverNeighbor[];
  empty: string;
}) {
  const Icon = icon === "incoming" ? ArrowDownToLine : ArrowUpFromLine;
  const color = icon === "incoming" ? "#15803d" : "#b91c1c";
  const shown = peers.slice(0, 4);
  const overflow = peers.length - shown.length;

  return (
    <div className="mt-3">
      <div
        className="flex items-center gap-1.5 mb-1 uppercase tracking-wider"
        style={{ fontSize: 9, color: "var(--muted-foreground, #57534e)" }}
      >
        <Icon size={9} style={{ color }} />
        {label}
        <span
          className="font-mono tabular-nums"
          style={{ color: "var(--muted-foreground, #57534e)" }}
        >
          ({peers.length})
        </span>
      </div>
      {peers.length === 0 ? (
        <div
          className="italic"
          style={{
            fontSize: 10.5,
            color: "var(--muted-foreground, #57534e)",
          }}
        >
          {empty}
        </div>
      ) : (
        <ul className="space-y-0.5">
          {shown.map((p) => (
            <li
              key={p.id}
              className="truncate font-mono"
              style={{
                fontSize: 11,
                color: "var(--card-foreground, #0a0a0a)",
              }}
              title={p.id}
            >
              {p.label}
            </li>
          ))}
          {overflow > 0 && (
            <li
              style={{
                fontSize: 10.5,
                color: "var(--muted-foreground, #57534e)",
              }}
            >
              +{overflow} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────

export function GraphCanvas({
  nodes,
  edges,
  showDiff = false,
  layout = "fcose",
  onNodeClick,
  repoId,
}: Props) {
  const { rfNodes: baseNodes, rfEdges: baseEdges } = useMemo(
    () => computeLayout(nodes, edges, layout, showDiff),
    [nodes, edges, layout, showDiff],
  );

  const [hoverState, setHoverState] = useState<HoverState | null>(null);
  const [cursor, setCursor] = useState<CursorPos>({ x: 0, y: 0 });
  const metaCacheRef = useRef<Map<string, FileMeta>>(new Map());

  // Precompute neighbor lookups so hover is O(1) regardless of graph size.
  const labelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nodes) m.set(n.id, n.label);
    return m;
  }, [nodes]);

  const { incomingMap, outgoingMap } = useMemo(() => {
    const inc = new Map<string, HoverNeighbor[]>();
    const out = new Map<string, HoverNeighbor[]>();
    for (const e of edges) {
      const inList = inc.get(e.target) ?? [];
      inList.push({
        id: e.source,
        label: labelById.get(e.source) ?? e.source,
        weight: e.weight ?? 1,
      });
      inc.set(e.target, inList);

      const outList = out.get(e.source) ?? [];
      outList.push({
        id: e.target,
        label: labelById.get(e.target) ?? e.target,
        weight: e.weight ?? 1,
      });
      out.set(e.source, outList);
    }
    for (const list of inc.values()) list.sort((a, b) => b.weight - a.weight);
    for (const list of out.values()) list.sort((a, b) => b.weight - a.weight);
    return { incomingMap: inc, outgoingMap: out };
  }, [edges, labelById]);

  // Apply hover decoration to the visible nodes/edges.
  const displayNodes = useMemo<Node[]>(() => {
    if (!hoverState) return baseNodes;
    const hoveredId = hoverState.file.id;
    const incomingSet = new Set(
      (incomingMap.get(hoveredId) ?? []).map((n) => n.id),
    );
    const outgoingSet = new Set(
      (outgoingMap.get(hoveredId) ?? []).map((n) => n.id),
    );
    return baseNodes.map((n) => {
      if (n.type === "dirGroup") return n;
      let state: FileHoverState;
      if (n.id === hoveredId) state = "hovered";
      else if (incomingSet.has(n.id)) state = "incoming";
      else if (outgoingSet.has(n.id)) state = "outgoing";
      else state = "dimmed";
      return { ...n, data: { ...(n.data as FileNodeData), hoverState: state } };
    });
  }, [baseNodes, hoverState, incomingMap, outgoingMap]);

  const displayEdges = useMemo<Edge[]>(() => {
    if (!hoverState) return baseEdges;
    const hoveredId = hoverState.file.id;
    return baseEdges.map((e) => {
      const isIncoming = e.target === hoveredId;
      const isOutgoing = e.source === hoveredId;
      if (isIncoming) {
        return {
          ...e,
          style: { stroke: "#15803d", strokeWidth: 2, opacity: 0.95 },
          animated: true,
          zIndex: 10,
        };
      }
      if (isOutgoing) {
        return {
          ...e,
          style: { stroke: "#b91c1c", strokeWidth: 2, opacity: 0.95 },
          animated: true,
          zIndex: 10,
        };
      }
      return { ...e, style: { ...e.style, opacity: 0.06 } };
    });
  }, [baseEdges, hoverState]);

  // Fetch /file-meta lazily; cache by file id (stable for the lifetime of
  // the snapshot, since paths don't move within one commit).
  const fetchMeta = useCallback(
    (file: GraphNode) => {
      if (!repoId) return;
      const cached = metaCacheRef.current.get(file.id);
      if (cached) {
        setHoverState((cur) =>
          cur && cur.file.id === file.id ? { ...cur, meta: cached } : cur,
        );
        return;
      }
      api
        .get<FileMeta>(`/repos/${repoId}/file-meta`, {
          params: { path: file.id },
        })
        .then(({ data }) => {
          metaCacheRef.current.set(file.id, data);
          setHoverState((cur) =>
            cur && cur.file.id === file.id ? { ...cur, meta: data } : cur,
          );
        })
        .catch(() => {
          setHoverState((cur) =>
            cur && cur.file.id === file.id ? { ...cur, meta: "error" } : cur,
          );
        });
    },
    [repoId],
  );

  const onNodeMouseEnter: NodeMouseHandler = useCallback(
    (event, node) => {
      if (node.type !== "fileNode") return;
      const file = (node.data as FileNodeData).file;
      const me = event as unknown as React.MouseEvent;
      const cached = metaCacheRef.current.get(file.id);
      setCursor({ x: me.clientX, y: me.clientY });
      setHoverState((cur) => {
        if (cur && cur.file.id === file.id) return cur;
        return {
          file,
          meta: cached ?? (repoId ? "loading" : null),
          incoming: incomingMap.get(file.id) ?? [],
          outgoing: outgoingMap.get(file.id) ?? [],
        };
      });
      if (!cached) fetchMeta(file);
    },
    [fetchMeta, incomingMap, outgoingMap, repoId],
  );

  const onNodeMouseMove: NodeMouseHandler = useCallback((event) => {
    const me = event as unknown as React.MouseEvent;
    setCursor((cur) =>
      cur.x === me.clientX && cur.y === me.clientY
        ? cur
        : { x: me.clientX, y: me.clientY },
    );
  }, []);

  const onNodeMouseLeave: NodeMouseHandler = useCallback(() => {
    setHoverState(null);
  }, []);

  const onNodeClickInternal: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (node.type !== "fileNode") return;
      onNodeClick?.((node.data as FileNodeData).file.id);
    },
    [onNodeClick],
  );

  return (
    <div
      className="w-full h-full relative"
      style={{ minHeight: 600, background: "var(--card, #ffffff)" }}
    >
      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1.2, minZoom: 0.08 }}
        minZoom={0.05}
        maxZoom={4}
        proOptions={{ hideAttribution: true }}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseMove={onNodeMouseMove}
        onNodeMouseLeave={onNodeMouseLeave}
        onNodeClick={onNodeClickInternal}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
      >
        <Background gap={32} size={1} color="#e7e5e4" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeStrokeColor="rgba(10,10,10,0.2)"
          nodeColor={(n) =>
            n.type === "dirGroup"
              ? "transparent"
              : dirColor(((n.data as FileNodeData)?.file)?.dir ?? ".")
          }
          maskColor="rgba(245,245,244,0.6)"
          style={{ background: "var(--card, #ffffff)" }}
        />
      </ReactFlow>
      {hoverState && <HoverCard state={hoverState} cursor={cursor} />}
    </div>
  );
}
