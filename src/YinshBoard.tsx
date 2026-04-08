import { useState, useEffect } from "react";
import "./App.css";
import { useYinshGame } from "./useYinshGame";
import { parseCoord, coordToPixel } from "./GameMechanics";

const SPACING = 40;
const BOARD_ANIM_DURATION = 1500; // total ms for board assembly

const phaseLabels: Record<string, (p: string) => string> = {
  "placing-rings": (p) => `Posicione os anéis (${p})`,
  "place-marker": (p) => `Coloque um marcador em um anel (${p})`,
  "move-ring": (p) => `Mova o anel (${p})`,
  "remove-run": (p) => `Remova uma sequência de 5 (${p})`,
  "remove-ring": (p) => `Remova um de seus anéis (${p})`,
  "game-over": (p) => `${p} venceu!`,
};

// Componente principal que renderiza o tabuleiro YINSH com SVG, incluindo animações, peças e interações
const YinshBoard: React.FC = () => {
  const {
    state,
    nodes,
    edges,
    validMoves,
    runCoords,
    handleCellClick,
    resetGame,
  } = useYinshGame();

  const [boardReady, setBoardReady] = useState(false);

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

  const showHighlights = state.phase !== "placing-rings";

  return (
    <div className="yinsh-container">
      <div className="yinsh-header">
        <div className="yinsh-status">
          <div className="turn-indicator">
            <div className={`turn-dot ${activePlayer}`} />
            <span>{label}</span>
          </div>
          <div className="score">
            <span className="score-white">○ {state.ringsRemoved.white}/3</span>
            <span className="score-black">● {state.ringsRemoved.black}/3</span>
          </div>
        </div>
        {state.phase === "game-over" && (
          <button className="reset-btn" onClick={resetGame}>
            Novo Jogo
          </button>
        )}
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
          const clickable = isValid || isRun || state.phase === "placing-rings";

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
  );
};

export default YinshBoard;
