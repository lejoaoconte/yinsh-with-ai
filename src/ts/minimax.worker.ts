/// <reference lib="webworker" />
import { YinshGame } from "cli/GameMechanics";
import type { YinshState, CellContent, Player, Run } from "cli/GameMechanics";
import { findBestMove } from "cli/Minimax";
import type { SearchStats, Algorithm } from "cli/Minimax";

export interface SerializableState {
  board: [string, CellContent][];
  currentPlayer: Player;
  phase: YinshState["phase"];
  ringsPlaced: { white: number; black: number };
  ringsRemoved: { white: number; black: number };
  selectedRing: string | null;
  detectedRuns: Run[];
  runRemovalPlayer: Player | null;
  winner: Player | null;
}

export interface WorkerRequest {
  id: number;
  state: SerializableState;
  aiPlayer: Player;
  depth: number;
  algorithm: Algorithm;
  transpositionTable?: [string, number][];
}

export interface WorkerResponse {
  id: number;
  bestState: SerializableState | null;
  bestMove: string | null;
  stats: SearchStats;
  error?: string;
}

function deserialize(s: SerializableState): YinshGame {
  const state: YinshState = {
    board: new Map(s.board) as Map<string, CellContent>,
    currentPlayer: s.currentPlayer,
    phase: s.phase,
    ringsPlaced: { ...s.ringsPlaced },
    ringsRemoved: { ...s.ringsRemoved },
    selectedRing: s.selectedRing,
    detectedRuns: s.detectedRuns.map((r) => ({
      coords: [...r.coords],
      player: r.player,
    })),
    runRemovalPlayer: s.runRemovalPlayer,
    winner: s.winner,
  };
  return new YinshGame(state);
}

function serialize(game: YinshGame): SerializableState {
  const s = game.getState();
  return {
    board: Array.from(s.board.entries()),
    currentPlayer: s.currentPlayer,
    phase: s.phase,
    ringsPlaced: { ...s.ringsPlaced },
    ringsRemoved: { ...s.ringsRemoved },
    selectedRing: s.selectedRing,
    detectedRuns: s.detectedRuns.map((r) => ({
      coords: [...r.coords],
      player: r.player,
    })),
    runRemovalPlayer: s.runRemovalPlayer,
    winner: s.winner,
  };
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, state, aiPlayer, depth, algorithm, transpositionTable } = e.data;
  try {
    const game = deserialize(state);
    const ttMap = transpositionTable && transpositionTable.length > 0
      ? new Map<string, number>(transpositionTable)
      : undefined;
    const result = findBestMove(game, aiPlayer, depth, algorithm, ttMap);
    const response: WorkerResponse = {
      id,
      bestState: result.bestGame ? serialize(result.bestGame) : null,
      bestMove: result.bestMove,
      stats: result.stats,
    };
    (self as unknown as Worker).postMessage(response);
  } catch (err) {
    const response: WorkerResponse = {
      id,
      bestState: null,
      bestMove: null,
      stats: {
        nodesEvaluated: 0,
        cutoffs: 0,
        elapsedMs: 0,
        bestScore: 0,
        depth,
        movesConsidered: 0,
        algorithm,
      },
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(response);
  }
};
