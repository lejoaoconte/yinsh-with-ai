import { useEffect, useMemo, useState } from "react";

import type { TrainingReport } from "cli/QLearning";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface FetchState {
  loading: boolean;
  report: TrainingReport | null;
  error: string | null;
}

const REPORT_URL = `${import.meta.env.BASE_URL}qtable_training.json`;

export const QLearningPanel: React.FC<Props> = ({ open, onClose }) => {
  const [fetchState, setFetchState] = useState<FetchState>({
    loading: false,
    report: null,
    error: null,
  });

  useEffect(() => {
    if (!open) return;
    let aborted = false;
    queueMicrotask(() => {
      if (aborted) return;
      setFetchState({ loading: true, report: null, error: null });
    });
    fetch(REPORT_URL, { cache: "no-store" })
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return (await resp.json()) as TrainingReport;
      })
      .then((report) => {
        if (aborted) return;
        setFetchState({ loading: false, report, error: null });
      })
      .catch((err: unknown) => {
        if (aborted) return;
        setFetchState({
          loading: false,
          report: null,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      aborted = true;
    };
  }, [open]);

  const chartData = useMemo(() => {
    const r = fetchState.report;
    if (!r || r.history.length === 0) return null;

    const W = 720;
    const H = 320;
    const pad = { top: 16, right: 24, bottom: 36, left: 44 };
    const innerW = W - pad.left - pad.right;
    const innerH = H - pad.top - pad.bottom;

    const xs = r.history.map((p) => p.episode);
    const minX = xs[0];
    const maxX = xs[xs.length - 1];
    const xRange = Math.max(1, maxX - minX);

    const xAt = (x: number) =>
      pad.left + ((x - minX) / xRange) * innerW;
    const yAt = (frac: number) => pad.top + (1 - frac) * innerH;

    const winsPath = r.history
      .map((p) => {
        const x = xAt(p.episode);
        const y = yAt(p.winRate);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

    const epsPath = r.history
      .map((p) => {
        const x = xAt(p.episode);
        const y = yAt(Math.min(1, p.epsilon));
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

    const winsAbsMax = Math.max(...r.history.map((p) => p.wins), 1);
    const winsAbsPath = r.history
      .map((p) => {
        const x = xAt(p.episode);
        const y = yAt(p.wins / winsAbsMax);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      f,
      y: yAt(f),
      label: `${Math.round(f * 100)}%`,
    }));
    const xTicks: { x: number; label: string }[] = [];
    const tickCount = Math.min(8, r.history.length);
    for (let i = 0; i < tickCount; i++) {
      const idx = Math.round(((r.history.length - 1) * i) / Math.max(1, tickCount - 1));
      const ep = r.history[idx].episode;
      xTicks.push({ x: xAt(ep), label: String(ep) });
    }

    return {
      W,
      H,
      pad,
      winsPath,
      epsPath,
      winsAbsPath,
      yTicks,
      xTicks,
      winsAbsMax,
    };
  }, [fetchState.report]);

  if (!open) return null;

  const meta = fetchState.report?.meta;

  return (
    <div className="ql-panel-overlay" onClick={onClose}>
      <div className="ql-panel" onClick={(e) => e.stopPropagation()}>
        <div className="ql-panel-header">
          <h3>Q-Learning — Treinamento</h3>
          <button className="ql-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="ql-panel-body">
          {fetchState.loading && (
            <div className="ql-info">Carregando relatório de treino…</div>
          )}

          {fetchState.error && (
            <div className="ql-info ql-info-warn">
              Não foi possível carregar <code>qtable_training.json</code>.<br />
              Rode o treino com <code>npm run train</code> e atualize.
              <br />
              <small>Detalhe: {fetchState.error}</small>
            </div>
          )}

          {meta && (
            <div className="ql-meta-grid">
              <div>
                <span className="ql-meta-label">Episódios:</span>{" "}
                <strong>{meta.totalEpisodes}</strong>
              </div>
              <div>
                <span className="ql-meta-label">Adversário:</span>{" "}
                <strong>{meta.opponent}</strong>
              </div>
              <div>
                <span className="ql-meta-label">α / γ / ε-final:</span>{" "}
                <strong>
                  {meta.params.alpha} / {meta.params.gamma} /{" "}
                  {meta.params.epsilon}
                </strong>
              </div>
              <div>
                <span className="ql-meta-label">Estados:</span>{" "}
                <strong>{meta.stateCount.toLocaleString("pt-BR")}</strong>
              </div>
              <div>
                <span className="ql-meta-label">Entradas (state×ação):</span>{" "}
                <strong>{meta.entryCount.toLocaleString("pt-BR")}</strong>
              </div>
              <div>
                <span className="ql-meta-label">Win-rate final:</span>{" "}
                <strong>
                  {meta.finalWinRate !== undefined
                    ? `${(meta.finalWinRate * 100).toFixed(1)}%`
                    : "—"}
                </strong>
              </div>
              <div className="ql-meta-when">
                <span className="ql-meta-label">Treinado em:</span>{" "}
                <strong>
                  {new Date(meta.trainedAt).toLocaleString("pt-BR")}
                </strong>
              </div>
            </div>
          )}

          {chartData && fetchState.report && (
            <>
              <div className="ql-chart-legend">
                <span>
                  <span className="ql-swatch ql-swatch-win" /> Win-rate (avaliação)
                </span>
                <span>
                  <span className="ql-swatch ql-swatch-eps" /> ε (exploração)
                </span>
                <span>
                  <span className="ql-swatch ql-swatch-wins" /> Vitórias por
                  avaliação (máx={chartData.winsAbsMax})
                </span>
              </div>
              <svg
                className="ql-chart"
                viewBox={`0 0 ${chartData.W} ${chartData.H}`}
              >
                <rect
                  x={chartData.pad.left}
                  y={chartData.pad.top}
                  width={chartData.W - chartData.pad.left - chartData.pad.right}
                  height={chartData.H - chartData.pad.top - chartData.pad.bottom}
                  className="ql-chart-bg"
                />
                {chartData.yTicks.map((t) => (
                  <g key={t.f}>
                    <line
                      x1={chartData.pad.left}
                      y1={t.y}
                      x2={chartData.W - chartData.pad.right}
                      y2={t.y}
                      className="ql-chart-grid"
                    />
                    <text
                      x={chartData.pad.left - 6}
                      y={t.y + 4}
                      className="ql-chart-label"
                      textAnchor="end"
                    >
                      {t.label}
                    </text>
                  </g>
                ))}
                {chartData.xTicks.map((t, i) => (
                  <text
                    key={i}
                    x={t.x}
                    y={chartData.H - chartData.pad.bottom + 16}
                    className="ql-chart-label"
                    textAnchor="middle"
                  >
                    {t.label}
                  </text>
                ))}
                <polyline
                  points={chartData.winsAbsPath}
                  className="ql-line ql-line-wins"
                />
                <polyline
                  points={chartData.epsPath}
                  className="ql-line ql-line-eps"
                />
                <polyline
                  points={chartData.winsPath}
                  className="ql-line ql-line-win"
                />
                <text
                  x={chartData.W / 2}
                  y={chartData.H - 4}
                  className="ql-chart-axis"
                  textAnchor="middle"
                >
                  Episódios de treino
                </text>
              </svg>

              <details className="ql-history-details">
                <summary>
                  Tabela detalhada ({fetchState.report.history.length} pontos)
                </summary>
                <div className="ql-history-scroll">
                  <table className="ql-history-table">
                    <thead>
                      <tr>
                        <th>Episódio</th>
                        <th>Vitórias</th>
                        <th>Derrotas</th>
                        <th>Empates</th>
                        <th>Win-rate</th>
                        <th>ε</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fetchState.report.history.map((p) => (
                        <tr key={p.episode}>
                          <td>{p.episode}</td>
                          <td>{p.wins}</td>
                          <td>{p.losses}</td>
                          <td>{p.draws}</td>
                          <td>{(p.winRate * 100).toFixed(1)}%</td>
                          <td>{p.epsilon.toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default QLearningPanel;
