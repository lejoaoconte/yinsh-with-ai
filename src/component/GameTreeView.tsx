import React, {
  useMemo,
  useRef,
  useEffect,
  useCallback,
  useState,
} from "react";

import { GameStateTree } from "cli/GameStateTree";
import type { TreeNodeData } from "cli/GameStateTree";

const NODE_W = 120;
const NODE_H = 54;
const H_GAP = 20;
const V_GAP = 60;

interface VirtualGroup {
  id: string;
  parentId: string;
  count: number;
  childIds: string[];
}

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  data: TreeNodeData | null;
  groupInfo?: {
    parentId: string;
    count: number;
    childIds: string[];
  };
}

interface LayoutEdge {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function layoutTree(
  tree: GameStateTree,
  rootId: string,
  playedPathSet: Set<string>,
  navigableIds: Set<string>,
  expandedGroups: Set<string>,
): { nodes: LayoutNode[]; edges: LayoutEdge[]; width: number; height: number } {
  const nodeMap = tree.nodes;

  function getEffectiveChildren(
    parentId: string,
  ): Array<string | VirtualGroup> {
    const parent = nodeMap.get(parentId);
    if (!parent || parent.childIds.length === 0) return [];

    const shown: string[] = [];
    const collapsible: string[] = [];

    for (const cid of parent.childIds) {
      const child = nodeMap.get(cid);
      if (!child) continue;
      if (playedPathSet.has(cid) || navigableIds.has(cid)) {
        shown.push(cid);
      } else if (child.childIds.length === 0) {
        collapsible.push(cid);
      } else {
        shown.push(cid);
      }
    }

    if (collapsible.length === 0) return shown;

    const groupId = `group:${parentId}`;
    if (expandedGroups.has(parentId)) {
      return [...shown, ...collapsible];
    }

    return [
      ...shown,
      {
        id: groupId,
        parentId,
        count: collapsible.length,
        childIds: collapsible,
      },
    ];
  }

  const subtreeWidth = new Map<string, number>();

  function calcWidth(idOrGroup: string | VirtualGroup): number {
    const id = typeof idOrGroup === "string" ? idOrGroup : idOrGroup.id;

    if (typeof idOrGroup !== "string") {
      subtreeWidth.set(id, NODE_W);
      return NODE_W;
    }

    const node = nodeMap.get(id);
    if (!node) {
      subtreeWidth.set(id, NODE_W);
      return NODE_W;
    }

    const children = getEffectiveChildren(id);
    if (children.length === 0) {
      subtreeWidth.set(id, NODE_W);
      return NODE_W;
    }

    const total =
      children.reduce((sum, c) => sum + calcWidth(c) + H_GAP, 0) - H_GAP;
    const w = Math.max(total, NODE_W);
    subtreeWidth.set(id, w);
    return w;
  }

  calcWidth(rootId);

  const layoutNodes: LayoutNode[] = [];
  const layoutEdges: LayoutEdge[] = [];

  function place(idOrGroup: string | VirtualGroup, cx: number, depth: number) {
    const isGroup = typeof idOrGroup !== "string";
    const id = isGroup ? idOrGroup.id : idOrGroup;

    const x = cx - NODE_W / 2;
    const y = depth * (NODE_H + V_GAP);

    if (isGroup) {
      layoutNodes.push({
        id,
        x,
        y,
        data: null,
        groupInfo: {
          parentId: idOrGroup.parentId,
          count: idOrGroup.count,
          childIds: idOrGroup.childIds,
        },
      });
      return;
    }

    const node = nodeMap.get(id);
    if (!node) return;

    layoutNodes.push({ id, x, y, data: node });

    const children = getEffectiveChildren(id);
    if (children.length === 0) return;

    const totalW =
      children.reduce((sum, c) => {
        const cid = typeof c === "string" ? c : c.id;
        return sum + (subtreeWidth.get(cid) ?? NODE_W) + H_GAP;
      }, 0) - H_GAP;
    let curX = cx - totalW / 2;

    for (const child of children) {
      const cid = typeof child === "string" ? child : child.id;
      const cw = subtreeWidth.get(cid) ?? NODE_W;
      const childCx = curX + cw / 2;
      place(child, childCx, depth + 1);

      layoutEdges.push({
        id: `${id}-${cid}`,
        x1: cx,
        y1: y + NODE_H,
        x2: childCx,
        y2: (depth + 1) * (NODE_H + V_GAP),
      });

      curX += cw + H_GAP;
    }
  }

  const rootW = subtreeWidth.get(rootId) ?? NODE_W;
  place(rootId, rootW / 2, 0);

  const maxX = Math.max(...layoutNodes.map((n) => n.x + NODE_W));
  const maxY = Math.max(...layoutNodes.map((n) => n.y + NODE_H));

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    width: maxX + 20,
    height: maxY + 20,
  };
}

function phaseShort(phase: string): string {
  const map: Record<string, string> = {
    "placing-rings": "Colocar anel",
    "place-marker": "Marcador",
    "move-ring": "Mover anel",
    "remove-run": "Remover seq.",
    "remove-ring": "Remover anel",
    "game-over": "Fim",
  };
  return map[phase] ?? phase;
}

interface GameTreeViewProps {
  tree: GameStateTree;
  treeVersion: number;
  onClose: () => void;
  onSave: () => void;
  onLoad: (file: File) => void;
  onUndo: () => void;
  onNodeClick: (nodeId: string) => void;
  onComputeHeuristics?: (aiPlayer: "white" | "black") => {
    nodes: number;
    elapsedMs: number;
  };
}

export const GameTreeView: React.FC<GameTreeViewProps> = ({
  tree,
  treeVersion,
  onClose,
  onSave,
  onLoad,
  onUndo,
  onNodeClick,
  onComputeHeuristics,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [heuristicTarget, setHeuristicTarget] = useState<"white" | "black">(
    "white",
  );
  const [heuristicInfo, setHeuristicInfo] = useState<string | null>(null);

  const playedPathSet = useMemo(
    () => (treeVersion >= 0 ? new Set(tree.playedPath) : new Set<string>()),
    [tree, treeVersion],
  );

  const navigableIds = useMemo(
    () => (treeVersion >= 0 ? tree.getNavigableIds() : new Set<string>()),
    [tree, treeVersion],
  );

  const { nodes, edges, width, height } = useMemo(() => {
    if (!tree.rootId || treeVersion < 0)
      return { nodes: [], edges: [], width: 0, height: 0 };
    return layoutTree(
      tree,
      tree.rootId,
      playedPathSet,
      navigableIds,
      expandedGroups,
    );
  }, [tree, treeVersion, playedPathSet, navigableIds, expandedGroups]);

  useEffect(() => {
    if (!containerRef.current) return;
    const currentLayout = nodes.find((n) => n.id === tree.currentId);
    if (!currentLayout) return;
    const container = containerRef.current;
    const targetX = currentLayout.x + NODE_W / 2;
    const targetY = currentLayout.y + NODE_H / 2;
    container.scrollTo({
      left: Math.max(0, targetX - container.clientWidth / 2),
      top: Math.max(0, targetY - container.clientHeight / 2),
      behavior: "smooth",
    });
  }, [treeVersion, nodes, tree.currentId]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onLoad(file);
      e.target.value = "";
    },
    [onLoad],
  );

  return (
    <div className="tree-panel">
      <div className="tree-panel-header">
        <span className="tree-panel-title">Árvore de Estados</span>
        <div className="tree-panel-stats">
          <span>{tree.totalNodes} nós</span>
          <span>profundidade {tree.maxDepth}</span>
          {heuristicInfo && <span>h: {heuristicInfo}</span>}
        </div>
        <div className="tree-panel-actions">
          <button className="tree-btn" onClick={onUndo} title="Voltar jogada">
            Desfazer
          </button>
          <button className="tree-btn" onClick={onSave} title="Salvar árvore">
            Salvar
          </button>
          <button
            className="tree-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Carregar árvore"
          >
            Carregar
          </button>
          {onComputeHeuristics && (
            <>
              <select
                value={heuristicTarget}
                onChange={(e) =>
                  setHeuristicTarget(e.target.value as "white" | "black")
                }
                title="Cor para a qual a heurística será calculada"
                className="tree-btn"
                style={{ padding: "4px" }}
              >
                <option value="white">h(Brancas)</option>
                <option value="black">h(Pretas)</option>
              </select>
              <button
                className="tree-btn"
                title="Calcular heurística em todos os nós"
                onClick={() => {
                  const res = onComputeHeuristics(heuristicTarget);
                  setHeuristicInfo(
                    `${res.nodes} nós em ${res.elapsedMs.toFixed(1)}ms`,
                  );
                }}
              >
                Calcular h
              </button>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xml"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
          <button className="tree-btn tree-btn-close" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      <div className="tree-panel-svg-container" ref={containerRef}>
        {nodes.length === 0 ? (
          <div className="tree-empty">Nenhuma jogada ainda.</div>
        ) : (
          <svg ref={svgRef} width={width} height={height} className="tree-svg">
            <g className="tree-edges">
              {edges.map((e) => {
                const [fromId, toId] = e.id.split(/-(.+)/);
                const isPlayedEdge =
                  !toId?.startsWith("group:") &&
                  playedPathSet.has(fromId) &&
                  playedPathSet.has(toId);
                const isGroupEdge = toId?.startsWith("group:");
                return (
                  <line
                    key={e.id}
                    x1={e.x1}
                    y1={e.y1}
                    x2={e.x2}
                    y2={e.y2}
                    className={`tree-edge${isPlayedEdge ? " tree-edge-played" : ""}${isGroupEdge ? " tree-edge-group" : ""}`}
                  />
                );
              })}
            </g>
            <g className="tree-nodes">
              {nodes.map((n) => {
                if (n.groupInfo) {
                  const { parentId, count } = n.groupInfo;
                  const isExpanded = expandedGroups.has(parentId);
                  const handleToggle = () => {
                    setExpandedGroups((prev) => {
                      const next = new Set(prev);
                      if (isExpanded) next.delete(parentId);
                      else next.add(parentId);
                      return next;
                    });
                  };
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${n.x},${n.y})`}
                      className="tree-node-g tree-node-group"
                      onClick={handleToggle}
                      style={{ cursor: "pointer" }}
                    >
                      <rect
                        width={NODE_W}
                        height={NODE_H}
                        rx={8}
                        ry={8}
                        className="tree-node-rect tree-group-rect"
                        strokeDasharray="5,3"
                      />
                      <text x={NODE_W / 2} y={22} className="tree-group-icon">
                        ⋯
                      </text>
                      <text x={NODE_W / 2} y={38} className="tree-group-count">
                        {count} {count === 1 ? "ramo" : "ramos"}
                      </text>
                      <g transform={`translate(${NODE_W - 18}, 4)`}>
                        <circle
                          cx={8}
                          cy={8}
                          r={8}
                          className="tree-group-btn-circle"
                        />
                        <text x={8} y={12} className="tree-group-btn-label">
                          {isExpanded ? "−" : "+"}
                        </text>
                      </g>
                    </g>
                  );
                }

                const isCurrent = n.id === tree.currentId;
                const isPlayed = playedPathSet.has(n.id);
                const isNavigable = navigableIds.has(n.id);
                const snap = n.data!.stateSnapshot;
                const player = snap.currentPlayer;
                const phase = snap.phase;

                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x},${n.y})`}
                    className={`tree-node-g${isCurrent ? " tree-node-current" : ""}${isPlayed && !isCurrent ? " tree-node-played" : ""}${!isPlayed ? " tree-node-future" : ""}${isNavigable ? " tree-node-navigable" : ""}`}
                    onClick={isNavigable ? () => onNodeClick(n.id) : undefined}
                    style={isNavigable ? { cursor: "pointer" } : undefined}
                  >
                    <rect
                      width={NODE_W}
                      height={NODE_H}
                      rx={8}
                      ry={8}
                      className="tree-node-rect"
                    />
                    <circle
                      cx={14}
                      cy={14}
                      r={6}
                      className={`tree-player-dot tree-player-dot-${player}`}
                    />
                    <text x={24} y={18} className="tree-node-phase">
                      {phaseShort(phase)}
                    </text>
                    {n.data!.move && (
                      <text x={8} y={38} className="tree-node-move">
                        {n.data!.move.length > 16
                          ? n.data!.move.slice(0, 15) + "…"
                          : n.data!.move}
                      </text>
                    )}
                    {isCurrent && (
                      <text x={NODE_W - 10} y={14} className="tree-node-star">
                        ★
                      </text>
                    )}
                    <text
                      x={NODE_W - 8}
                      y={NODE_H - 6}
                      className="tree-node-children"
                    >
                      {n.data!.childIds.length > 0
                        ? `↓${n.data!.childIds.length}`
                        : ""}
                    </text>
                    {n.data!.heuristic !== undefined && (
                      <text
                        x={8}
                        y={NODE_H - 6}
                        className="tree-node-heuristic"
                      >
                        h={n.data!.heuristic.toFixed(0)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        )}
      </div>
    </div>
  );
};

export default GameTreeView;
