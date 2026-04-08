import { useState, useCallback, useMemo } from "react";
import {
  YinshGame,
  parseCoord,
  coordKey,
  coordToPixel,
  VALID_POSITIONS,
} from "./GameMechanics";

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

// Hook principal do jogo YINSH: gerencia estado, nós do tabuleiro, arestas, movimentos válidos e ações do jogador
export const useYinshGame = () => {
  const [game, setGame] = useState(() => new YinshGame());

  const state = game.getState();

  // Executa uma ação genérica no jogo, clonando o estado antes para manter a imutabilidade
  const performAction = useCallback((action: (g: YinshGame) => boolean) => {
    setGame((prev) => {
      const clone = prev.clone();
      return action(clone) ? clone : prev;
    });
  }, []);

  // Gera a lista de nós do tabuleiro com suas coordenadas axiais e posições em pixel
  const nodes: BoardNode[] = useMemo(() => {
    return Array.from(VALID_POSITIONS).map((key) => {
      const { q, r } = parseCoord(key);
      const { x, y } = coordToPixel(q, r, SPACING);
      return { key, q, r, x, y };
    });
  }, []);

  // Gera as arestas (linhas) entre nós vizinhos nos 3 eixos do tabuleiro hexagonal
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

  // Conjunto de movimentos válidos para a fase atual, recalculado quando o jogo muda
  const validMoves = useMemo(() => new Set(game.getValidMoves()), [game]);

  // Trata o clique em uma célula do tabuleiro, executando a ação correspondente à fase atual do jogo
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

  // Reinicia o jogo criando uma nova instância com estado inicial
  const resetGame = useCallback(() => {
    setGame(new YinshGame());
  }, []);

  // Coleta as coordenadas de todas as sequências detectadas do jogador atual para destacar no tabuleiro
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
