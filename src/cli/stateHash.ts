import type { YinshState } from "./GameMechanics";

/**
 * Gera um hash de 64 bits (como string hex) do estado do tabuleiro.
 * Usado como identificador único de nó na árvore de estados e como
 * chave na tabela de transposição do Minimax.
 */
export function hashState(state: Readonly<YinshState>): string {
  const boardStr = Array.from(state.board.entries())
    .filter(([, v]) => v !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(",");

  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < boardStr.length; i++) {
    const c = boardStr.charCodeAt(i);
    h1 = (((h1 << 5) + h1) ^ c) >>> 0;
    h2 = (((h2 << 5) + h2) ^ c) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}
