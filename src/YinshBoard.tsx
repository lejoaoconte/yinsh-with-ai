import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import "./App.css";
import { useYinshGame } from "./useYinshGame";
import { parseCoord, coordToPixel, YinshGame } from "./GameMechanics";
import { useGameTree } from "./useGameTree";
import { GameTreeView } from "./GameTreeView";

const SPACING = 40;
const BOARD_ANIM_DURATION = 1500;

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
  } = useGameTree(initialGame);
  const [showTree, setShowTree] = useState(false);

  const [boardReady, setBoardReady] = useState(false);

  const suppressNextRecordRef = useRef(false);

  const applyRestoredGame = useCallback(
    (restoredGame: YinshGame) => {
      suppressNextRecordRef.current = true;
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
  }, [originalResetGame, resetTree]);

  useEffect(() => {
    const timer = setTimeout(
      () => setBoardReady(true),
      BOARD_ANIM_DURATION + 200,
    );
    return () => clearTimeout(timer);
  }, []);

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

  const showHighlights = state.phase !== "placing-rings";

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
        />
      )}
    </div>
  );
};

export default YinshBoard;
