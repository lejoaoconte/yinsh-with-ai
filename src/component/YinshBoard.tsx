import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import "styles/app.css";

import { useYinshGame } from "hooks/useYinshGame";
import { useGameTree } from "hooks/useGameTree";

import { parseCoord, coordToPixel, YinshGame } from "cli/GameMechanics";
import type { Player, YinshState, CellContent } from "cli/GameMechanics";
import type { SearchStats, Algorithm } from "cli/Minimax";

import { GameTreeView } from "./GameTreeView";
import { QLearningPanel } from "./QLearningPanel";
import { getActor } from "cli/Minimax";
import {
  chooseAction,
  deserializeQTable,
  DEFAULT_QL_PARAMS,
} from "cli/QLearning";
import type { QTable, QLearningMetadata } from "cli/QLearning";
import MinimaxWorker from "ts/minimax.worker.ts?worker";

import type {
  WorkerRequest,
  WorkerResponse,
  SerializableState,
} from "ts/minimax.worker";

const SPACING = 40;
const BOARD_ANIM_DURATION = 1500;

type AnyAlgorithm = Algorithm | "qlearning" | "random";

interface MoveRecord {
  moveNum: number;
  player: Player;
  kind: "human" | "ai";
  algorithm?: AnyAlgorithm;
  depth?: number;
  movesConsidered: number;
  wallMs: number;
  computeMs: number;
  nodesEvaluated: number;
  heapDeltaMB: number;
}

type ExtendedStats = Omit<SearchStats, "algorithm"> & {
  algorithm: AnyAlgorithm;
  player: Player;
  move: string | null;
};

function algLabel(a: AnyAlgorithm | undefined): string {
  switch (a) {
    case "alphabeta":
      return "αβ";
    case "minimax":
      return "MM";
    case "qlearning":
      return "QL";
    case "random":
      return "Rnd";
    default:
      return "?";
  }
}

function getHeapMB(): number {
  const mem = (
    performance as unknown as { memory?: { usedJSHeapSize: number } }
  ).memory;
  return mem ? mem.usedJSHeapSize / (1024 * 1024) : -1;
}

const phaseLabels: Record<string, (p: string) => string> = {
  "placing-rings": (p) => `Posicione os anéis (${p})`,
  "place-marker": (p) => `Coloque um marcador em um anel (${p})`,
  "move-ring": (p) => `Mova o anel (${p})`,
  "remove-run": (p) => `Remova uma sequência de 5 (${p})`,
  "remove-ring": (p) => `Remova um de seus anéis (${p})`,
  "game-over": (p) => `${p} venceu!`,
};

const YinshBoard: React.FC = () => {
  const {
    state,
    nodes,
    edges,
    validMoves,
    runCoords,
    handleCellClick: originalHandleCellClick,
    resetGame: originalResetGame,
    performAction,
  } = useYinshGame();

  const initialGame = useMemo(() => new YinshGame(), []);
  const {
    tree,
    treeVersion,
    recordMove,
    resetTree,
    undoMove,
    saveTree,
    loadTree,
    navigateToNode,
    computeHeuristics,
    getHeuristicTable,
  } = useGameTree(initialGame);
  const [showTree, setShowTree] = useState(false);

  type PlayerKind = "human" | "minimax" | "alphabeta" | "qlearning";
  const [whiteKind, setWhiteKind] = useState<PlayerKind>("human");
  const [blackKind, setBlackKind] = useState<PlayerKind>("human");
  const [whiteDepth, setWhiteDepth] = useState<number>(2);
  const [blackDepth, setBlackDepth] = useState<number>(2);
  const [aiThinking, setAiThinking] = useState(false);
  const [lastAiStats, setLastAiStats] = useState<ExtendedStats | null>(null);
  const [showQLPanel, setShowQLPanel] = useState(false);
  const [qTableStatus, setQTableStatus] = useState<{
    state: "idle" | "loading" | "ready" | "error";
    meta: QLearningMetadata | null;
    error: string | null;
  }>({ state: "idle", meta: null, error: null });
  const qTableRef = useRef<QTable | null>(null);
  const aiBusyRef = useRef(false);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const pendingRequestIdRef = useRef<number | null>(null);

  const [moveLog, setMoveLog] = useState<MoveRecord[]>([]);
  const lastMoveTimeRef = useRef<number>(0);
  const heapBeforeRef = useRef<number>(-1);
  const moveCountRef = useRef<number>(0);
  const aiMoveJustAppliedRef = useRef(false);
  const prevPlayerRef = useRef<Player | null>(null);

  useEffect(() => {
    lastMoveTimeRef.current = Date.now();
    const w = new MinimaxWorker();
    workerRef.current = w;
    return () => {
      w.terminate();
      workerRef.current = null;
    };
  }, []);

  const loadQTable = useCallback(async () => {
    setQTableStatus({ state: "loading", meta: null, error: null });
    try {
      const url = `${import.meta.env.BASE_URL}qtable.json`;
      const resp = await fetch(url, { cache: "no-store" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      const { table, meta } = deserializeQTable(text);
      qTableRef.current = table;
      setQTableStatus({ state: "ready", meta, error: null });
    } catch (err) {
      qTableRef.current = null;
      setQTableStatus({
        state: "error",
        meta: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadQTable();
    });
  }, [loadQTable]);

  const [boardReady, setBoardReady] = useState(false);

  const suppressNextRecordRef = useRef(false);

  const applyRestoredGame = useCallback(
    (restoredGame: YinshGame, suppressTreeRecord = true) => {
      if (suppressTreeRecord) {
        suppressNextRecordRef.current = true;
      }
      performAction((g) => {
        const s = restoredGame.getState();
        g["state"] = {
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
        return true;
      });
    },
    [performAction],
  );

  const prevStateRef = useRef(state);
  useEffect(() => {
    if (prevStateRef.current !== state) {
      prevStateRef.current = state;
      if (suppressNextRecordRef.current) {
        suppressNextRecordRef.current = false;
        return;
      }

      const reconstructed = new YinshGame({
        board: new Map(state.board),
        currentPlayer: state.currentPlayer,
        phase: state.phase,
        ringsPlaced: { ...state.ringsPlaced },
        ringsRemoved: { ...state.ringsRemoved },
        selectedRing: state.selectedRing,
        detectedRuns: state.detectedRuns.map((r) => ({
          coords: [...r.coords],
          player: r.player,
        })),
        runRemovalPlayer: state.runRemovalPlayer,
        winner: state.winner,
      });
      recordMove(reconstructed);
    }
  }, [state, recordMove]);

  const handleCellClick = useCallback(
    (coord: string) => {
      originalHandleCellClick(coord);
    },
    [originalHandleCellClick],
  );

  const resetGame = useCallback(() => {
    originalResetGame();
    const fresh = new YinshGame();
    resetTree(fresh);
    setMoveLog([]);
    moveCountRef.current = 0;
    lastMoveTimeRef.current = Date.now();
    prevPlayerRef.current = null;
    aiMoveJustAppliedRef.current = false;
  }, [originalResetGame, resetTree]);

  useEffect(() => {
    const timer = setTimeout(
      () => setBoardReady(true),
      BOARD_ANIM_DURATION + 200,
    );
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (prevPlayerRef.current === null) {
      prevPlayerRef.current = state.currentPlayer;
      return;
    }
    if (state.currentPlayer === prevPlayerRef.current) return;
    prevPlayerRef.current = state.currentPlayer;

    if (aiMoveJustAppliedRef.current) {
      aiMoveJustAppliedRef.current = false;
      return;
    }

    const who: Player = state.currentPlayer === "white" ? "black" : "white";
    const wallMs = Date.now() - lastMoveTimeRef.current;
    lastMoveTimeRef.current = Date.now();
    moveCountRef.current++;
    setMoveLog((log) => [
      ...log,
      {
        moveNum: moveCountRef.current,
        player: who,
        kind: "human",
        movesConsidered: 0,
        wallMs,
        computeMs: 0,
        nodesEvaluated: 0,
        heapDeltaMB: -1,
      },
    ]);
  }, [state.currentPlayer]);

  const activePlayer =
    state.phase === "remove-run" || state.phase === "remove-ring"
      ? (state.runRemovalPlayer ?? state.currentPlayer)
      : state.currentPlayer;

  const label =
    state.phase === "game-over"
      ? phaseLabels["game-over"](
          state.winner === "white" ? "Brancas" : "Pretas",
        )
      : (phaseLabels[state.phase]?.(
          activePlayer === "white" ? "Brancas" : "Pretas",
        ) ?? "");

  const padding = 50;
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding;
  const w = Math.max(...xs) - minX + padding;
  const h = Math.max(...ys) - minY + padding;
  const viewBox = `${minX} ${minY} ${w} ${h}`;

  const handleUndo = useCallback(() => {
    const restored = undoMove();
    if (restored) {
      applyRestoredGame(restored);
    }
  }, [undoMove, applyRestoredGame]);

  const handleLoad = useCallback(
    async (file: File) => {
      const restored = await loadTree(file);
      if (restored) {
        applyRestoredGame(restored);
      }
    },
    [loadTree, applyRestoredGame],
  );

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      const restored = navigateToNode(nodeId);
      if (restored) {
        applyRestoredGame(restored);
      }
    },
    [navigateToNode, applyRestoredGame],
  );

  const actor = useMemo<Player>(() => getActor(state), [state]);
  const actorKind: PlayerKind = actor === "white" ? whiteKind : blackKind;
  const actorDepth = actor === "white" ? whiteDepth : blackDepth;
  const actorIsAi = actorKind !== "human";
  const actorAlgorithm: Algorithm =
    actorKind === "alphabeta" ? "alphabeta" : "minimax";

  useEffect(() => {
    if (state.phase === "game-over") return;
    if (!actorIsAi) return;
    if (aiBusyRef.current) return;

    if (actorKind === "qlearning") {
      const table = qTableRef.current;
      if (!table) return;
      aiBusyRef.current = true;
      queueMicrotask(() => setAiThinking(true));

      const game = new YinshGame({
        board: new Map(state.board),
        currentPlayer: state.currentPlayer,
        phase: state.phase,
        ringsPlaced: { ...state.ringsPlaced },
        ringsRemoved: { ...state.ringsRemoved },
        selectedRing: state.selectedRing,
        detectedRuns: state.detectedRuns.map((r) => ({
          coords: [...r.coords],
          player: r.player,
        })),
        runRemovalPlayer: state.runRemovalPlayer,
        winner: state.winner,
      });
      heapBeforeRef.current = getHeapMB();
      const t0 = performance.now();
      const choice = chooseAction(table, game, actor, {
        ...DEFAULT_QL_PARAMS,
        epsilon: 0,
      });
      const elapsed = performance.now() - t0;

      queueMicrotask(() => {
        if (!choice) {
          aiBusyRef.current = false;
          setAiThinking(false);
          return;
        }
        const heapAfter = getHeapMB();
        const heapDelta =
          heapBeforeRef.current >= 0 && heapAfter >= 0
            ? Math.max(0, heapAfter - heapBeforeRef.current)
            : -1;
        const wallMs = Date.now() - lastMoveTimeRef.current;
        lastMoveTimeRef.current = Date.now();
        moveCountRef.current++;
        aiMoveJustAppliedRef.current = true;
        setLastAiStats({
          nodesEvaluated: 1,
          cutoffs: 0,
          elapsedMs: elapsed,
          bestScore: choice.qValue,
          depth: 0,
          movesConsidered: 1,
          algorithm: "qlearning",
          player: actor,
          move: choice.action,
        });
        setMoveLog((log) => [
          ...log,
          {
            moveNum: moveCountRef.current,
            player: actor,
            kind: "ai",
            algorithm: "qlearning",
            depth: 0,
            movesConsidered: 1,
            wallMs,
            computeMs: elapsed,
            nodesEvaluated: 1,
            heapDeltaMB: heapDelta,
          },
        ]);
        applyRestoredGame(choice.child, false);
        aiBusyRef.current = false;
        setAiThinking(false);
      });
      return;
    }

    const worker = workerRef.current;
    if (!worker) return;

    if (state.phase === "placing-rings" && state.ringsPlaced[actor] === 0) {
      const tempGame = new YinshGame({
        board: new Map(state.board),
        currentPlayer: state.currentPlayer,
        phase: state.phase,
        ringsPlaced: { ...state.ringsPlaced },
        ringsRemoved: { ...state.ringsRemoved },
        selectedRing: state.selectedRing,
        detectedRuns: state.detectedRuns.map((r) => ({
          coords: [...r.coords],
          player: r.player,
        })),
        runRemovalPlayer: state.runRemovalPlayer,
        winner: state.winner,
      });
      const moves = tempGame.getValidMoves();
      if (moves.length > 0) {
        aiBusyRef.current = true;
        queueMicrotask(() => setAiThinking(true));
        const randomCoord = moves[Math.floor(Math.random() * moves.length)];
        const afterGame = tempGame.clone();
        afterGame.placeRing(randomCoord);
        heapBeforeRef.current = getHeapMB();
        queueMicrotask(() => {
          const heapAfter = getHeapMB();
          const heapDelta =
            heapBeforeRef.current >= 0 && heapAfter >= 0
              ? Math.max(0, heapAfter - heapBeforeRef.current)
              : -1;
          const wallMs = Date.now() - lastMoveTimeRef.current;
          lastMoveTimeRef.current = Date.now();
          moveCountRef.current++;
          aiMoveJustAppliedRef.current = true;
          const randomStats: ExtendedStats = {
            nodesEvaluated: 1,
            cutoffs: 0,
            elapsedMs: 0,
            bestScore: 0,
            depth: 0,
            movesConsidered: moves.length,
            algorithm: "random",
            player: actor,
            move: randomCoord,
          };
          setLastAiStats(randomStats);
          setMoveLog((log) => [
            ...log,
            {
              moveNum: moveCountRef.current,
              player: actor,
              kind: "ai",
              algorithm: "random",
              depth: 0,
              movesConsidered: moves.length,
              wallMs,
              computeMs: 0,
              nodesEvaluated: 1,
              heapDeltaMB: heapDelta,
            },
          ]);
          applyRestoredGame(afterGame, false);
          aiBusyRef.current = false;
          setAiThinking(false);
        });
        return;
      }
    }

    aiBusyRef.current = true;
    queueMicrotask(() => setAiThinking(true));

    const reqId = ++requestIdRef.current;
    pendingRequestIdRef.current = reqId;

    const serialized: SerializableState = {
      board: Array.from(state.board.entries()),
      currentPlayer: state.currentPlayer,
      phase: state.phase,
      ringsPlaced: { ...state.ringsPlaced },
      ringsRemoved: { ...state.ringsRemoved },
      selectedRing: state.selectedRing,
      detectedRuns: state.detectedRuns.map((r) => ({
        coords: [...r.coords],
        player: r.player,
      })),
      runRemovalPlayer: state.runRemovalPlayer,
      winner: state.winner,
    };

    const handleMessage = (e: MessageEvent<WorkerResponse>) => {
      const data = e.data;
      if (data.id !== reqId) return;
      worker.removeEventListener("message", handleMessage);
      pendingRequestIdRef.current = null;

      if (data.error) {
        console.error("Erro na IA (worker):", data.error);
      } else {
        const entry = {
          ...data.stats,
          player: actor,
          move: data.bestMove,
        };
        setLastAiStats(entry);

        const heapAfter = getHeapMB();
        const heapDelta =
          heapBeforeRef.current >= 0 && heapAfter >= 0
            ? Math.max(0, heapAfter - heapBeforeRef.current)
            : -1;
        const aiWallMs = Date.now() - lastMoveTimeRef.current;
        lastMoveTimeRef.current = Date.now();
        moveCountRef.current++;
        aiMoveJustAppliedRef.current = true;
        setMoveLog((log) => [
          ...log,
          {
            moveNum: moveCountRef.current,
            player: actor,
            kind: "ai",
            algorithm: data.stats.algorithm,
            depth: data.stats.depth,
            movesConsidered: data.stats.movesConsidered,
            wallMs: aiWallMs,
            computeMs: data.stats.elapsedMs,
            nodesEvaluated: data.stats.nodesEvaluated,
            heapDeltaMB: heapDelta,
          },
        ]);

        if (data.bestState) {
          const restored = new YinshGame({
            board: new Map(data.bestState.board) as Map<string, CellContent>,
            currentPlayer: data.bestState.currentPlayer,
            phase: data.bestState.phase as YinshState["phase"],
            ringsPlaced: { ...data.bestState.ringsPlaced },
            ringsRemoved: { ...data.bestState.ringsRemoved },
            selectedRing: data.bestState.selectedRing,
            detectedRuns: data.bestState.detectedRuns.map((r) => ({
              coords: [...r.coords],
              player: r.player,
            })),
            runRemovalPlayer: data.bestState.runRemovalPlayer,
            winner: data.bestState.winner,
          });
          applyRestoredGame(restored, false);
        }
      }
      aiBusyRef.current = false;
      setAiThinking(false);
    };

    worker.addEventListener("message", handleMessage);

    const req: WorkerRequest = {
      id: reqId,
      state: serialized,
      aiPlayer: actor,
      depth: actorDepth,
      algorithm: actorAlgorithm,
      transpositionTable: getHeuristicTable(),
    };
    heapBeforeRef.current = getHeapMB();
    worker.postMessage(req);

    return () => {
      worker.removeEventListener("message", handleMessage);
    };
  }, [
    state,
    actor,
    actorIsAi,
    actorKind,
    actorAlgorithm,
    actorDepth,
    applyRestoredGame,
    getHeuristicTable,
  ]);

  const showHighlights = state.phase !== "placing-rings";

  const totalWall = moveLog.reduce((s, r) => s + r.wallMs, 0);
  const totalCompute = moveLog.reduce((s, r) => s + r.computeMs, 0);
  const totalMem = moveLog.reduce((s, r) => {
    const d = r.depth ?? 0;
    const b = r.movesConsidered;
    return d > 0 && b > 0 ? s + (d * b * 5) / 1024 : s;
  }, 0);
  const heapAvail = moveLog.some((r) => r.heapDeltaMB >= 0);
  const totalHeap = heapAvail
    ? moveLog.reduce((s, r) => s + Math.max(0, r.heapDeltaMB), 0)
    : -1;

  return (
    <div className={`yinsh-app-layout${showTree ? " tree-open" : ""}`}>
      <div className="yinsh-container">
        <div className="yinsh-header">
          <div className="yinsh-status">
            <div className="turn-indicator">
              <div className={`turn-dot ${activePlayer}`} />
              <span>{label}</span>
            </div>
            <div className="score">
              <span className="score-white">
                ○ {state.ringsRemoved.white}/3
              </span>
              <span className="score-black">
                ● {state.ringsRemoved.black}/3
              </span>
            </div>
          </div>
          <div className="header-right-actions">
            <button
              className="tree-toggle-btn ql-toggle-btn"
              onClick={() => setShowQLPanel(true)}
              title={
                qTableStatus.state === "ready"
                  ? `Q-table: ${qTableStatus.meta?.stateCount.toLocaleString("pt-BR") ?? "?"} estados`
                  : "Treinamento Q-Learning não carregado"
              }
            >
              Q-Learning{" "}
              <span
                className={`ql-dot ql-dot-${qTableStatus.state}`}
                aria-label={qTableStatus.state}
              />
            </button>
            <button
              className="tree-toggle-btn"
              onClick={() => setShowTree((v) => !v)}
            >
              {showTree ? "Fechar Árvore" : "Ver Árvore"}
            </button>
            {state.phase === "game-over" && (
              <button className="reset-btn" onClick={resetGame}>
                Novo Jogo
              </button>
            )}
          </div>
        </div>

        <div className="ai-config-panel">
          <div className="ai-config-row">
            <label className="ai-config-label">
              <span className="ai-dot ai-dot-white" /> Brancas
            </label>
            <select
              value={whiteKind}
              onChange={(e) => setWhiteKind(e.target.value as PlayerKind)}
              disabled={aiThinking}
            >
              <option value="human">Humano</option>
              <option value="minimax">IA — Antecipação Limitada</option>
              <option value="alphabeta">IA — Minimax + αβ</option>
              <option value="qlearning" disabled={qTableStatus.state !== "ready"}>
                IA — Q-Learning{qTableStatus.state !== "ready" ? " (não carregado)" : ""}
              </option>
            </select>
            {whiteKind !== "human" && whiteKind !== "qlearning" && (
              <label className="ai-depth-label">
                Profundidade:
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={whiteDepth}
                  onChange={(e) =>
                    setWhiteDepth(
                      Math.max(1, Math.min(6, parseInt(e.target.value) || 1)),
                    )
                  }
                  disabled={aiThinking}
                />
              </label>
            )}
          </div>
          <div className="ai-config-row">
            <label className="ai-config-label">
              <span className="ai-dot ai-dot-black" /> Pretas
            </label>
            <select
              value={blackKind}
              onChange={(e) => setBlackKind(e.target.value as PlayerKind)}
              disabled={aiThinking}
            >
              <option value="human">Humano</option>
              <option value="minimax">IA — Antecipação Limitada</option>
              <option value="alphabeta">IA — Minimax + αβ</option>
              <option value="qlearning" disabled={qTableStatus.state !== "ready"}>
                IA — Q-Learning{qTableStatus.state !== "ready" ? " (não carregado)" : ""}
              </option>
            </select>
            {blackKind !== "human" && blackKind !== "qlearning" && (
              <label className="ai-depth-label">
                Profundidade:
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={blackDepth}
                  onChange={(e) =>
                    setBlackDepth(
                      Math.max(1, Math.min(6, parseInt(e.target.value) || 1)),
                    )
                  }
                  disabled={aiThinking}
                />
              </label>
            )}
          </div>
          <div className="ai-status-row">
            {aiThinking && (
              <span className="ai-thinking">
                IA ({actor === "white" ? "Brancas" : "Pretas"}) pensando…
              </span>
            )}
            {lastAiStats && !aiThinking && (
              <span className="ai-stats">
                Última IA [{lastAiStats.player === "white" ? "B" : "P"}{" "}
                {algLabel(lastAiStats.algorithm)}{" "}
                {lastAiStats.algorithm === "qlearning"
                  ? ""
                  : `d=${lastAiStats.depth} `}
                ]: {lastAiStats.elapsedMs.toFixed(0)}ms ·{" "}
                {lastAiStats.nodesEvaluated} nós · {lastAiStats.cutoffs} cortes
                · score {lastAiStats.bestScore.toFixed(2)}
              </span>
            )}
            <button
              className="tree-btn"
              onClick={resetGame}
              title="Reiniciar partida"
            >
              Reiniciar
            </button>
          </div>
        </div>

        <div className="move-stats-panel">
          <div className="move-stats-header">
            <span className="move-stats-title">Estatísticas de jogadas</span>
            <div className="move-stats-totals">
              <span>
                Tempo total:&nbsp;
                <strong>{totalWall.toFixed(0)} ms</strong>
              </span>
              <span>
                Cálculo IA:&nbsp;
                <strong>{totalCompute.toFixed(0)} ms</strong>
              </span>
              <span>
                Mem. busca:&nbsp;
                <strong>
                  {totalMem >= 0.01 ? `${totalMem.toFixed(2)} MB` : "—"}
                </strong>
              </span>
              {totalHeap >= 0 && (
                <span>
                  Heap Δ:&nbsp;<strong>{totalHeap.toFixed(2)} MB</strong>
                </span>
              )}
            </div>
          </div>
          <div className="move-stats-scroll">
            <table className="move-stats-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Jog.</th>
                  <th>Tipo</th>
                  <th>Tempo</th>
                  <th>Cálculo</th>
                  <th>Nós</th>
                  <th>Mem. busca</th>
                  {heapAvail && <th>Heap Δ</th>}
                </tr>
              </thead>
              <tbody>
                {[...moveLog].reverse().map((r) => (
                  <tr
                    key={r.moveNum}
                    className={
                      r.kind === "ai" ? "move-row-ai" : "move-row-human"
                    }
                  >
                    <td>{r.moveNum}</td>
                    <td
                      className={
                        r.player === "white" ? "cell-white" : "cell-black"
                      }
                    >
                      {r.player === "white" ? "○" : "●"}
                    </td>
                    <td>
                      {r.kind === "human"
                        ? "Humano"
                        : r.algorithm === "qlearning"
                          ? "QL"
                          : r.algorithm === "random"
                            ? "Rnd"
                            : `${algLabel(r.algorithm)} d=${r.depth}`}
                    </td>
                    <td>{r.wallMs.toFixed(0)} ms</td>
                    <td>
                      {r.computeMs > 0 ? `${r.computeMs.toFixed(0)} ms` : "—"}
                    </td>
                    <td>
                      {r.nodesEvaluated > 0
                        ? r.nodesEvaluated.toLocaleString("pt-BR")
                        : "—"}
                    </td>
                    <td>
                      {r.depth && r.depth > 0 && r.movesConsidered > 0
                        ? `${((r.depth * r.movesConsidered * 5) / 1024).toFixed(2)} MB`
                        : "—"}
                    </td>
                    {heapAvail && (
                      <td>
                        {r.heapDeltaMB >= 0
                          ? `${r.heapDeltaMB.toFixed(2)} MB`
                          : "N/D"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <svg
          className={`yinsh-svg${boardReady ? " board-zoom" : ""}`}
          viewBox={viewBox}
        >
          {edges.map((e, i) => (
            <line
              key={e.id}
              x1={e.x1}
              y1={e.y1}
              x2={e.x2}
              y2={e.y2}
              className="board-line board-anim-line"
              style={{
                animationDelay: `${(i / edges.length) * BOARD_ANIM_DURATION * 0.6}ms`,
              }}
            />
          ))}

          {showHighlights &&
            Array.from(validMoves).map((key) => {
              const { q, r } = parseCoord(key);
              const { x, y } = coordToPixel(q, r, SPACING);
              return (
                <circle
                  key={`v-${key}`}
                  cx={x}
                  cy={y}
                  r={12}
                  className="valid-move"
                />
              );
            })}

          {Array.from(runCoords).map((key) => {
            const { q, r } = parseCoord(key);
            const { x, y } = coordToPixel(q, r, SPACING);
            return (
              <circle
                key={`run-${key}`}
                cx={x}
                cy={y}
                r={15}
                className="run-highlight"
              />
            );
          })}

          {nodes.map((node) => {
            const content = state.board.get(node.key);
            const isValid = validMoves.has(node.key);
            const isRun = runCoords.has(node.key);
            const clickable =
              isValid || isRun || state.phase === "placing-rings";

            return (
              <g
                key={node.key}
                className={`board-cell ${clickable ? "clickable" : ""}`}
                onClick={() => handleCellClick(node.key)}
              >
                <circle cx={node.x} cy={node.y} r={16} className="click-area" />

                <circle
                  cx={node.x}
                  cy={node.y}
                  r={3}
                  className={`node-dot ${!boardReady ? "board-anim-dot" : ""}`}
                  style={
                    !boardReady
                      ? {
                          animationDelay: `${BOARD_ANIM_DURATION * 0.4 + (nodes.indexOf(node) / nodes.length) * BOARD_ANIM_DURATION * 0.6}ms`,
                        }
                      : undefined
                  }
                />

                {content === "W_RING" && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={14}
                    className="ring white-ring"
                  />
                )}
                {content === "B_RING" && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={14}
                    className="ring black-ring"
                  />
                )}

                {content === "W_MARKER" && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={10}
                    className="marker white-marker"
                  />
                )}
                {content === "B_MARKER" && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={10}
                    className="marker black-marker"
                  />
                )}

                {state.selectedRing === node.key && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={17}
                    className="selected-ring-indicator"
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {showTree && (
        <GameTreeView
          tree={tree}
          treeVersion={treeVersion}
          onClose={() => setShowTree(false)}
          onSave={saveTree}
          onLoad={handleLoad}
          onUndo={handleUndo}
          onNodeClick={handleNodeClick}
          onComputeHeuristics={computeHeuristics}
        />
      )}

      <QLearningPanel
        open={showQLPanel}
        onClose={() => setShowQLPanel(false)}
      />
    </div>
  );
};

export default YinshBoard;
