import { useState, useCallback, useMemo } from "react";

import {
  YinshGame,
  parseCoord,
  coordKey,
  coordToPixel,
  VALID_POSITIONS,
} from "cli/GameMechanics";

const SPACING = 40;

export interface BoardNode {
  key: string;
  q: number;
  r: number;
  x: number;
  y: number;
}

export interface BoardEdge {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const useYinshGame = () => {
  const [game, setGame] = useState(() => new YinshGame());

  const state = game.getState();

  const performAction = useCallback((action: (g: YinshGame) => boolean) => {
    setGame((prev) => {
      const clone = prev.clone();
      return action(clone) ? clone : prev;
    });
  }, []);

  const nodes: BoardNode[] = useMemo(() => {
    return Array.from(VALID_POSITIONS).map((key) => {
      const { q, r } = parseCoord(key);
      const { x, y } = coordToPixel(q, r, SPACING);
      return { key, q, r, x, y };
    });
  }, []);

  const edges: BoardEdge[] = useMemo(() => {
    const nodeMap = new Map(nodes.map((n) => [n.key, n]));
    const dirs = [
      { dq: 1, dr: 0 },
      { dq: 0, dr: 1 },
      { dq: -1, dr: 1 },
    ];
    const result: BoardEdge[] = [];

    for (const node of nodes) {
      for (const dir of dirs) {
        const nKey = coordKey(node.q + dir.dq, node.r + dir.dr);
        const neighbor = nodeMap.get(nKey);
        if (neighbor) {
          result.push({
            id: `${node.key}-${nKey}`,
            x1: node.x,
            y1: node.y,
            x2: neighbor.x,
            y2: neighbor.y,
          });
        }
      }
    }

    return result;
  }, [nodes]);

  const validMoves = useMemo(() => new Set(game.getValidMoves()), [game]);

  const handleCellClick = useCallback((coordStr: string) => {
    setGame((prev) => {
      const s = prev.getState();
      const clone = prev.clone();
      let success = false;

      switch (s.phase) {
        case "placing-rings":
          success = clone.placeRing(coordStr);
          break;
        case "place-marker":
          success = clone.placeMarker(coordStr);
          break;
        case "move-ring":
          success = clone.moveRing(coordStr);
          break;
        case "remove-run": {
          const playerRuns = s.detectedRuns.filter(
            (r) => r.player === s.runRemovalPlayer,
          );
          const runIndex = playerRuns.findIndex((r) =>
            r.coords.includes(coordStr),
          );
          if (runIndex >= 0) {
            success = clone.selectRun(runIndex);
          }
          break;
        }
        case "remove-ring":
          success = clone.removeRing(coordStr);
          break;
      }

      return success ? clone : prev;
    });
  }, []);

  const resetGame = useCallback(() => {
    setGame(new YinshGame());
  }, []);

  const runCoords = useMemo(() => {
    const coords = new Set<string>();
    if (state.phase === "remove-run" && state.runRemovalPlayer) {
      for (const run of state.detectedRuns) {
        if (run.player === state.runRemovalPlayer) {
          for (const c of run.coords) coords.add(c);
        }
      }
    }
    return coords;
  }, [state.phase, state.detectedRuns, state.runRemovalPlayer]);

  return {
    state,
    nodes,
    edges,
    validMoves,
    runCoords,
    handleCellClick,
    resetGame,
    performAction,
    spacing: SPACING,
  };
};
