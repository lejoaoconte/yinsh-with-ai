import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { YinshGame } from "../src/cli/GameMechanics.ts";
import type { YinshState, Player } from "../src/cli/GameMechanics.ts";
import { generateChildGames } from "../src/cli/GameStateTree.ts";
import { findBestMove, getActor } from "../src/cli/Minimax.ts";
import {
  bellmanUpdate,
  chooseAction,
  DEFAULT_QL_PARAMS,
  qStateKey,
  rewardFor,
  serializeQTable,
} from "../src/cli/QLearning.ts";
import type {
  QLearningParams,
  QTable,
  TrainingProgressPoint,
  TrainingReport,
} from "../src/cli/QLearning.ts";

type OpponentKind = "random" | "minimax" | "alphabeta";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

function envInt(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined) return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function envFloat(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined) return def;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

function envStr<T extends string>(name: string, def: T, allowed?: readonly T[]): T {
  const v = process.env[name];
  if (v === undefined) return def;
  if (allowed && !allowed.includes(v as T)) return def;
  return v as T;
}

const NUM_EPISODES = envInt("EPISODES", 1500);
const EVAL_EVERY = envInt("EVAL_EVERY", 50);
const EVAL_GAMES = envInt("EVAL_GAMES", 30);
const MAX_PLIES = envInt("MAX_PLIES", 250);
const EPSILON_START = envFloat("EPSILON_START", 0.5);
const EPSILON_END = envFloat("EPSILON_END", 0.05);
const ALPHA = envFloat("ALPHA", 0.2);
const GAMMA = envFloat("GAMMA", 0.95);
const OPPONENT = envStr<OpponentKind>("OPPONENT", "random", [
  "random",
  "minimax",
  "alphabeta",
]);
const MINIMAX_DEPTH = envInt("MINIMAX_DEPTH", 1);
// Probabilidade de o oponente minimax jogar um lance aleatório durante o
// TREINO. Torna o oponente estocástico, ampliando a diversidade de estados
// vistos e reduzindo o overfit a uma única linha determinística.
// A avaliação sempre usa 0 (oponente determinístico) para medir a força real.
const OPPONENT_EPSILON = envFloat("OPPONENT_EPSILON", 0.1);
const SEED = envInt("SEED", 0);
const OUT_DIR = path.resolve(PROJECT_ROOT, "public");
const QTABLE_PATH = path.join(OUT_DIR, "qtable.json");
const REPORT_PATH = path.join(OUT_DIR, "qtable_training.json");
const CSV_PATH = path.join(OUT_DIR, "qtable_training.csv");

function makeRng(seed: number): () => number {
  if (seed === 0) return Math.random;
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(SEED);

function clonePartialState(s: Readonly<YinshState>): YinshState {
  return {
    board: new Map(s.board),
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

function randomChild(game: YinshGame): YinshGame | null {
  const kids = generateChildGames(game);
  if (kids.length === 0) return null;
  return kids[Math.floor(rng() * kids.length)].game;
}

function opponentChoose(
  game: YinshGame,
  oppPlayer: Player,
  oppEpsilon: number,
): YinshGame | null {
  if (OPPONENT === "minimax" || OPPONENT === "alphabeta") {
    // ε-greedy no oponente: com probabilidade oppEpsilon joga aleatório.
    if (oppEpsilon > 0 && rng() < oppEpsilon) {
      return randomChild(game);
    }
    const res = findBestMove(
      game,
      oppPlayer,
      MINIMAX_DEPTH,
      OPPONENT === "alphabeta" ? "alphabeta" : "minimax",
    );
    return res.bestGame;
  }
  return randomChild(game);
}

function epsilonAt(ep: number, total: number): number {
  if (total <= 1) return EPSILON_END;
  const t = ep / (total - 1);
  return EPSILON_START + (EPSILON_END - EPSILON_START) * t;
}

interface EpisodeResult {
  outcome: "win" | "loss" | "draw";
  plies: number;
  updates: number;
}

function playEpisode(
  table: QTable,
  agentColor: Player,
  params: QLearningParams,
  learn: boolean,
  oppEpsilon: number,
): EpisodeResult {
  let game = new YinshGame();
  let plies = 0;
  let updates = 0;

  let pendingState: YinshState | null = null;
  let pendingStateKey: string | null = null;
  let pendingAction: string | null = null;

  const flushUpdate = (
    finalState: Readonly<YinshState>,
    done: boolean,
    finalActions: string[],
  ) => {
    if (
      pendingState === null ||
      pendingStateKey === null ||
      pendingAction === null
    )
      return;
    const reward = rewardFor(pendingState, finalState, agentColor);
    const nextKey = qStateKey(finalState);
    bellmanUpdate(
      table,
      pendingStateKey,
      pendingAction,
      reward,
      nextKey,
      finalActions,
      done,
      params,
    );
    updates++;
    pendingState = null;
    pendingStateKey = null;
    pendingAction = null;
  };

  while (plies < MAX_PLIES) {
    const state = game.getState();
    if (state.phase === "game-over") break;
    const actor = getActor(state);

    if (actor === agentColor) {
      if (learn && pendingState) {
        const currentChildren = generateChildGames(game).map((c) => c.move);
        flushUpdate(state, false, currentChildren);
      }
      const choice = chooseAction(table, game, agentColor, params, rng);
      if (!choice) break;
      if (learn) {
        pendingState = clonePartialState(state);
        pendingStateKey = qStateKey(state);
        pendingAction = choice.action;
      }
      game = choice.child;
    } else {
      const next = opponentChoose(game, actor, oppEpsilon);
      if (!next) break;
      game = next;
    }
    plies++;
  }

  const finalState = game.getState();
  if (learn && pendingState) {
    flushUpdate(finalState, true, []);
  }

  const winner = finalState.winner;
  let outcome: EpisodeResult["outcome"];
  if (winner === agentColor) outcome = "win";
  else if (winner && winner !== agentColor) outcome = "loss";
  else outcome = "draw";

  return { outcome, plies, updates };
}

function evaluateAgent(
  table: QTable,
  games: number,
): { wins: number; losses: number; draws: number } {
  const evalParams: QLearningParams = {
    alpha: 0,
    gamma: GAMMA,
    epsilon: 0,
    useHeuristicTieBreak: true,
  };
  let w = 0,
    l = 0,
    d = 0;
  for (let i = 0; i < games; i++) {
    const color: Player = i % 2 === 0 ? "white" : "black";
    // Avaliação sempre contra oponente determinístico (oppEpsilon = 0).
    const r = playEpisode(table, color, evalParams, false, 0);
    if (r.outcome === "win") w++;
    else if (r.outcome === "loss") l++;
    else d++;
  }
  return { wins: w, losses: l, draws: d };
}

function fmt(n: number, p = 2): string {
  return n.toFixed(p);
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

async function main(): Promise<void> {
  ensureDir(OUT_DIR);
  console.log("=".repeat(60));
  console.log("Yinsh — Treinamento Q-Learning");
  console.log("=".repeat(60));
  console.log(`Episódios:          ${NUM_EPISODES}`);
  console.log(`Adversário:         ${OPPONENT}${OPPONENT !== "random" ? ` (d=${MINIMAX_DEPTH})` : ""}`);
  if (OPPONENT !== "random") {
    console.log(`Oponente ε (treino): ${OPPONENT_EPSILON} (avaliação usa 0)`);
  }
  console.log(`α=${ALPHA}  γ=${GAMMA}  ε: ${EPSILON_START}→${EPSILON_END}`);
  console.log(`Avaliação a cada ${EVAL_EVERY} eps. (${EVAL_GAMES} partidas)`);
  console.log(`Máx. plies/episódio: ${MAX_PLIES}`);
  console.log(`Saída: ${QTABLE_PATH}`);
  console.log("=".repeat(60));

  const table: QTable = new Map();
  const history: TrainingProgressPoint[] = [];

  const startedAt = Date.now();
  let cumWins = 0,
    cumLosses = 0,
    cumDraws = 0;

  for (let ep = 0; ep < NUM_EPISODES; ep++) {
    const eps = epsilonAt(ep, NUM_EPISODES);
    const params: QLearningParams = {
      alpha: ALPHA,
      gamma: GAMMA,
      epsilon: eps,
      useHeuristicTieBreak: true,
    };
    const agentColor: Player = ep % 2 === 0 ? "white" : "black";
    const oppEps = OPPONENT === "random" ? 0 : OPPONENT_EPSILON;
    const r = playEpisode(table, agentColor, params, true, oppEps);
    if (r.outcome === "win") cumWins++;
    else if (r.outcome === "loss") cumLosses++;
    else cumDraws++;

    if ((ep + 1) % EVAL_EVERY === 0 || ep === NUM_EPISODES - 1) {
      const ev = evaluateAgent(table, EVAL_GAMES);
      const winRate = ev.wins / EVAL_GAMES;
      const point: TrainingProgressPoint = {
        episode: ep + 1,
        wins: ev.wins,
        losses: ev.losses,
        draws: ev.draws,
        winRate,
        epsilon: eps,
      };
      history.push(point);
      const elapsedS = (Date.now() - startedAt) / 1000;
      const epsPerSec = (ep + 1) / Math.max(elapsedS, 1e-6);
      console.log(
        `ep ${String(ep + 1).padStart(5)} | ε=${fmt(eps, 3)} | ` +
          `eval ${ev.wins}/${EVAL_GAMES} (${fmt(winRate * 100, 1)}%) ` +
          `[L=${ev.losses} D=${ev.draws}] | ` +
          `treino cum: W=${cumWins} L=${cumLosses} D=${cumDraws} | ` +
          `estados=${table.size} | ${fmt(epsPerSec, 1)} eps/s`,
      );
    }
  }

  const finalEval = evaluateAgent(table, Math.max(EVAL_GAMES, 50));
  const finalWinRate = finalEval.wins / Math.max(EVAL_GAMES, 50);

  const meta = {
    totalEpisodes: NUM_EPISODES,
    trainedAt: new Date().toISOString(),
    opponent: OPPONENT === "random" ? "random" : `${OPPONENT}(d=${MINIMAX_DEPTH}, ε=${OPPONENT_EPSILON})`,
    params: {
      alpha: ALPHA,
      gamma: GAMMA,
      epsilon: EPSILON_END,
      useHeuristicTieBreak: DEFAULT_QL_PARAMS.useHeuristicTieBreak,
    },
    finalWinRate,
    stateCount: table.size,
    entryCount: 0,
  };

  const serialized = serializeQTable(table, meta, {
    pruneAbs: 1e-3,
    topKPerState: 24,
  });
  fs.writeFileSync(QTABLE_PATH, serialized);

  const report: TrainingReport = {
    meta: { ...meta, entryCount: JSON.parse(serialized).meta.entryCount },
    history,
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  const csvLines = ["episode,wins,losses,draws,winRate,epsilon"];
  for (const p of history) {
    csvLines.push(
      `${p.episode},${p.wins},${p.losses},${p.draws},${p.winRate.toFixed(4)},${p.epsilon.toFixed(4)}`,
    );
  }
  fs.writeFileSync(CSV_PATH, csvLines.join("\n"));

  console.log("=".repeat(60));
  console.log(`Treino concluído em ${fmt((Date.now() - startedAt) / 1000, 1)}s`);
  console.log(
    `Avaliação final (${Math.max(EVAL_GAMES, 50)} partidas): ` +
      `W=${finalEval.wins} L=${finalEval.losses} D=${finalEval.draws} ` +
      `→ win-rate ${fmt(finalWinRate * 100, 1)}%`,
  );
  console.log(`Q-table salva em: ${QTABLE_PATH}`);
  console.log(`Relatório:       ${REPORT_PATH}`);
  console.log(`CSV:             ${CSV_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
