import { YinshGame } from "./GameMechanics";
import type { YinshState, Player } from "./GameMechanics";

import { generateChildGames } from "./GameStateTree";
import { hashState } from "./stateHash";

export type Algorithm = "minimax" | "alphabeta";

export interface SearchStats {
  nodesEvaluated: number;
  cutoffs: number;
  elapsedMs: number;
  bestScore: number;
  depth: number;
  movesConsidered: number;
  algorithm: Algorithm;
}

export interface SearchResult {
  bestGame: YinshGame | null;
  bestMove: string | null;
  stats: SearchStats;
}

export function getActor(state: Readonly<YinshState>): Player {
  if (state.phase === "remove-run" || state.phase === "remove-ring") {
    return state.runRemovalPlayer ?? state.currentPlayer;
  }
  return state.currentPlayer;
}

const WIN_SCORE = 1_000_000;

function countMarkers(state: Readonly<YinshState>): {
  white: number;
  black: number;
} {
  let white = 0;
  let black = 0;
  for (const v of state.board.values()) {
    if (v === "W_MARKER") white++;
    else if (v === "B_MARKER") black++;
  }
  return { white, black };
}

function longestRuns(state: Readonly<YinshState>): {
  white: number;
  black: number;
} {
  const axes = [
    { q: 1, r: 0 },
    { q: 0, r: 1 },
    { q: 1, r: -1 },
  ];
  let bestW = 0;
  let bestB = 0;
  const visited = new Set<string>();

  for (const [key, content] of state.board) {
    if (content !== "W_MARKER" && content !== "B_MARKER") continue;
    const player: Player = content === "W_MARKER" ? "white" : "black";

    const [qStr, rStr] = key.split(",");
    const q0 = parseInt(qStr, 10);
    const r0 = parseInt(rStr, 10);

    for (const dir of axes) {
      const visitKey = `${player}|${dir.q},${dir.r}|${key}`;
      if (visited.has(visitKey)) continue;

      const backKey = `${q0 - dir.q},${r0 - dir.r}`;
      if (state.board.get(backKey) === content) continue;

      let len = 0;
      let q = q0;
      let r = r0;
      while (state.board.get(`${q},${r}`) === content) {
        visited.add(`${player}|${dir.q},${dir.r}|${q},${r}`);
        len++;
        q += dir.q;
        r += dir.r;
      }

      if (player === "white" && len > bestW) bestW = len;
      else if (player === "black" && len > bestB) bestB = len;
    }
  }
  return { white: bestW, black: bestB };
}

export function evaluate(
  state: Readonly<YinshState>,
  aiPlayer: Player,
): number {
  const opp: Player = aiPlayer === "white" ? "black" : "white";

  if (state.winner) {
    return state.winner === aiPlayer ? WIN_SCORE : -WIN_SCORE;
  }

  const removedDiff = state.ringsRemoved[aiPlayer] - state.ringsRemoved[opp];

  const markers = countMarkers(state);
  const markersDiff =
    aiPlayer === "white"
      ? markers.white - markers.black
      : markers.black - markers.white;

  const runs = longestRuns(state);
  const runAi = aiPlayer === "white" ? runs.white : runs.black;
  const runOpp = aiPlayer === "white" ? runs.black : runs.white;

  const runBonus = (n: number) => {
    if (n <= 1) return 0;
    if (n === 2) return 4;
    if (n === 3) return 18;
    if (n === 4) return 90;
    return 250;
  };

  return (
    removedDiff * 5000 + markersDiff * 6 + (runBonus(runAi) - runBonus(runOpp))
  );
}

function minimax(
  game: YinshGame,
  depth: number,
  alpha: number,
  beta: number,
  aiPlayer: Player,
  stats: SearchStats,
  useAlphaBeta: boolean,
  transpositionTable?: Map<string, number>,
): number {
  const state = game.getState();

  if (transpositionTable && transpositionTable.size > 0) {
    const h = hashState(state);
    const cached = transpositionTable.get(h);
    if (cached !== undefined) {
      stats.nodesEvaluated++;
      return cached;
    }
  }

  if (depth === 0 || state.phase === "game-over") {
    stats.nodesEvaluated++;
    return evaluate(state, aiPlayer);
  }

  const children = generateChildGames(game);
  if (children.length === 0) {
    stats.nodesEvaluated++;
    return evaluate(state, aiPlayer);
  }

  const actor = getActor(state);
  const maximizing = actor === aiPlayer;

  if (maximizing) {
    let value = -Infinity;
    for (const { game: child } of children) {
      const v = minimax(
        child,
        depth - 1,
        alpha,
        beta,
        aiPlayer,
        stats,
        useAlphaBeta,
        transpositionTable,
      );
      if (v > value) value = v;
      if (useAlphaBeta) {
        if (value > alpha) alpha = value;
        if (alpha >= beta) {
          stats.cutoffs++;
          break;
        }
      }
    }
    return value;
  } else {
    let value = Infinity;
    for (const { game: child } of children) {
      const v = minimax(
        child,
        depth - 1,
        alpha,
        beta,
        aiPlayer,
        stats,
        useAlphaBeta,
        transpositionTable,
      );
      if (v < value) value = v;
      if (useAlphaBeta) {
        if (value < beta) beta = value;
        if (alpha >= beta) {
          stats.cutoffs++;
          break;
        }
      }
    }
    return value;
  }
}

export function findBestMove(
  game: YinshGame,
  aiPlayer: Player,
  depth: number,
  algorithm: Algorithm = "alphabeta",
  transpositionTable?: Map<string, number>,
): SearchResult {
  const useAlphaBeta = algorithm === "alphabeta";
  const t0 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const stats: SearchStats = {
    nodesEvaluated: 0,
    cutoffs: 0,
    elapsedMs: 0,
    bestScore: 0,
    depth,
    movesConsidered: 0,
    algorithm,
  };

  const children = generateChildGames(game);
  stats.movesConsidered = children.length;

  if (children.length === 0) {
    stats.elapsedMs =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) -
      t0;
    return { bestGame: null, bestMove: null, stats };
  }

  const actor = getActor(game.getState());
  const maximizing = actor === aiPlayer;

  let bestVal = maximizing ? -Infinity : Infinity;
  let bestGame: YinshGame | null = null;
  let bestMove: string | null = null;
  let alpha = -Infinity;
  let beta = Infinity;

  for (const { move, game: child } of children) {
    const v = minimax(
      child,
      depth - 1,
      alpha,
      beta,
      aiPlayer,
      stats,
      useAlphaBeta,
      transpositionTable,
    );
    if (maximizing) {
      if (v > bestVal) {
        bestVal = v;
        bestGame = child;
        bestMove = move;
      }
      if (useAlphaBeta && bestVal > alpha) alpha = bestVal;
    } else {
      if (v < bestVal) {
        bestVal = v;
        bestGame = child;
        bestMove = move;
      }
      if (useAlphaBeta && bestVal < beta) beta = bestVal;
    }
    if (useAlphaBeta && alpha >= beta) {
      stats.cutoffs++;
      break;
    }
  }

  stats.bestScore = bestVal;
  stats.elapsedMs =
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;

  return { bestGame, bestMove, stats };
}
