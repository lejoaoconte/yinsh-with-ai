import { YinshGame } from "./GameMechanics";
import type { YinshState, Player } from "./GameMechanics";
import { generateChildGames } from "./GameStateTree";
import { hashState } from "./stateHash";
import { evaluate } from "./Minimax";

export type QTable = Map<string, Map<string, number>>;

export interface QLearningParams {
  alpha: number;
  gamma: number;
  epsilon: number;
  useHeuristicTieBreak: boolean;
}

export const DEFAULT_QL_PARAMS: QLearningParams = {
  alpha: 0.2,
  gamma: 0.95,
  epsilon: 0.25,
  useHeuristicTieBreak: true,
};

export interface QLearningMetadata {
  totalEpisodes: number;
  trainedAt: string;
  opponent: string;
  params: QLearningParams;
  finalWinRate?: number;
  stateCount: number;
  entryCount: number;
}

export function qStateKey(state: Readonly<YinshState>): string {
  const board = hashState(state);
  return [
    board,
    state.currentPlayer,
    state.phase,
    state.ringsRemoved.white,
    state.ringsRemoved.black,
    state.selectedRing ?? "",
    state.runRemovalPlayer ?? "",
  ].join("#");
}

export function getQ(table: QTable, state: string, action: string): number {
  const inner = table.get(state);
  if (!inner) return 0;
  return inner.get(action) ?? 0;
}

export function setQ(
  table: QTable,
  state: string,
  action: string,
  v: number,
): void {
  let inner = table.get(state);
  if (!inner) {
    inner = new Map();
    table.set(state, inner);
  }
  inner.set(action, v);
}

export function maxQ(
  table: QTable,
  state: string,
  actions: string[],
): number {
  if (actions.length === 0) return 0;
  const inner = table.get(state);
  if (!inner || inner.size === 0) return 0;
  let best = -Infinity;
  for (const a of actions) {
    const v = inner.get(a);
    if (v !== undefined && v > best) best = v;
  }
  return best === -Infinity ? 0 : best;
}

export interface ActionChoice {
  action: string;
  child: YinshGame;
  qValue: number;
  exploratory: boolean;
}

export function chooseAction(
  table: QTable,
  game: YinshGame,
  aiPlayer: Player,
  params: QLearningParams,
  rng: () => number = Math.random,
): ActionChoice | null {
  const children = generateChildGames(game);
  if (children.length === 0) return null;

  if (rng() < params.epsilon) {
    const idx = Math.floor(rng() * children.length);
    const pick = children[idx];
    const sKey = qStateKey(game.getState());
    return {
      action: pick.move,
      child: pick.game,
      qValue: getQ(table, sKey, pick.move),
      exploratory: true,
    };
  }

  const sKey = qStateKey(game.getState());
  let bestQ = -Infinity;
  let bestEval = -Infinity;
  let best: ActionChoice | null = null;

  for (const { move, game: child } of children) {
    const q = getQ(table, sKey, move);
    if (q > bestQ + 1e-9) {
      bestQ = q;
      bestEval = params.useHeuristicTieBreak
        ? evaluate(child.getState(), aiPlayer)
        : 0;
      best = { action: move, child, qValue: q, exploratory: false };
    } else if (Math.abs(q - bestQ) <= 1e-9 && params.useHeuristicTieBreak) {
      const ev = evaluate(child.getState(), aiPlayer);
      if (ev > bestEval) {
        bestEval = ev;
        best = { action: move, child, qValue: q, exploratory: false };
      }
    }
  }
  return best;
}

export function rewardFor(
  prev: Readonly<YinshState>,
  curr: Readonly<YinshState>,
  aiPlayer: Player,
): number {
  const opp: Player = aiPlayer === "white" ? "black" : "white";
  let r = 0;

  if (curr.winner === aiPlayer) r += 100;
  else if (curr.winner === opp) r -= 100;

  const drAi = curr.ringsRemoved[aiPlayer] - prev.ringsRemoved[aiPlayer];
  const drOpp = curr.ringsRemoved[opp] - prev.ringsRemoved[opp];
  r += drAi * 30 - drOpp * 30;

  let prevMarkers = 0;
  let currMarkers = 0;
  let prevOppMarkers = 0;
  let currOppMarkers = 0;
  const myMarker = aiPlayer === "white" ? "W_MARKER" : "B_MARKER";
  const oppMarker = aiPlayer === "white" ? "B_MARKER" : "W_MARKER";
  for (const v of prev.board.values()) {
    if (v === myMarker) prevMarkers++;
    else if (v === oppMarker) prevOppMarkers++;
  }
  for (const v of curr.board.values()) {
    if (v === myMarker) currMarkers++;
    else if (v === oppMarker) currOppMarkers++;
  }
  r += (currMarkers - prevMarkers) * 0.3;
  r -= (currOppMarkers - prevOppMarkers) * 0.3;

  r -= 0.05;
  return r;
}

export function bellmanUpdate(
  table: QTable,
  stateKey: string,
  action: string,
  reward: number,
  nextStateKey: string,
  nextActions: string[],
  done: boolean,
  params: QLearningParams,
): void {
  const oldQ = getQ(table, stateKey, action);
  const next = done ? 0 : maxQ(table, nextStateKey, nextActions);
  const target = reward + params.gamma * next;
  const newQ = oldQ + params.alpha * (target - oldQ);
  setQ(table, stateKey, action, newQ);
}

export interface SerializedQTable {
  meta: QLearningMetadata;
  table: Record<string, Record<string, number>>;
}

export interface SerializeOptions {
  pruneAbs?: number;
  topKPerState?: number;
}

export function serializeQTable(
  table: QTable,
  meta: QLearningMetadata,
  opts: SerializeOptions = {},
): string {
  const pruneAbs = opts.pruneAbs ?? 1e-4;
  const topK = opts.topKPerState ?? 0;

  const obj: Record<string, Record<string, number>> = {};
  let entryCount = 0;
  for (const [s, inner] of table) {
    if (inner.size === 0) continue;
    let entries: [string, number][] = [];
    for (const [a, q] of inner) {
      if (Math.abs(q) < pruneAbs) continue;
      entries.push([a, q]);
    }
    if (entries.length === 0) continue;
    if (topK > 0 && entries.length > topK) {
      entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      entries = entries.slice(0, topK);
    }
    const row: Record<string, number> = {};
    for (const [a, q] of entries) {
      row[a] = Math.round(q * 1e4) / 1e4;
      entryCount++;
    }
    obj[s] = row;
  }

  const fullMeta: QLearningMetadata = {
    ...meta,
    stateCount: Object.keys(obj).length,
    entryCount,
  };
  const payload: SerializedQTable = { meta: fullMeta, table: obj };
  return JSON.stringify(payload);
}

export function deserializeQTable(json: string): {
  table: QTable;
  meta: QLearningMetadata;
} {
  const payload = JSON.parse(json) as SerializedQTable;
  const table: QTable = new Map();
  for (const [s, row] of Object.entries(payload.table)) {
    const inner = new Map<string, number>();
    for (const [a, q] of Object.entries(row)) inner.set(a, q);
    table.set(s, inner);
  }
  return { table, meta: payload.meta };
}

export interface TrainingProgressPoint {
  episode: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  epsilon: number;
}

export interface TrainingReport {
  meta: QLearningMetadata;
  history: TrainingProgressPoint[];
}
