import { useState, useCallback } from "react";
import { YinshGame } from "./GameMechanics";
import { GameStateTree } from "./GameStateTree";

export function useGameTree(initialGame: YinshGame) {
  const [holder, setHolder] = useState<{ tree: GameStateTree; v: number }>(
    () => {
      const t = new GameStateTree();
      t.init(initialGame);
      return { tree: t, v: 0 };
    },
  );

  const { tree, v: treeVersion } = holder;

  // Para demonstração em sala
  // console.log(`Árvore de jogo atualizada. Versão: ${treeVersion}, Total de nós: ${tree.totalNodes}, Profundidade máxima: ${tree.maxDepth}`);
  // console.log(`Estado atual do jogo:`, tree.getCurrentGame()?.getState());
  // console.log(`Caminho jogado até agora:`, tree.playedPath);
  // console.log("Hash atual do estado do jogo:", tree?.getStateHash());
  // console.log(`Árvore do jogo:`, tree);

  const bump = useCallback(
    () => setHolder((h) => ({ tree: h.tree, v: h.v + 1 })),
    [],
  );

  const recordMove = useCallback(
    (newGame: YinshGame) => {
      tree.applyMove(newGame);
      bump();
    },
    [tree, bump],
  );

  const resetTree = useCallback((newGame: YinshGame) => {
    const t = new GameStateTree();
    t.init(newGame);
    setHolder({ tree: t, v: 0 });
  }, []);

  const undoMove = useCallback((): YinshGame | null => {
    const restored = tree.undo();
    if (restored) bump();
    return restored;
  }, [tree, bump]);

  const saveTree = useCallback(() => {
    tree.saveToFile(`yinsh_tree_${Date.now()}.xml`);
  }, [tree]);

  const loadTree = useCallback(
    async (file: File): Promise<YinshGame | null> => {
      const loaded = await GameStateTree.loadFromFile(file);
      setHolder({ tree: loaded, v: 0 });
      return loaded.getCurrentGame();
    },
    [],
  );

  const navigateToNode = useCallback(
    (nodeId: string): YinshGame | null => {
      const restored = tree.navigateTo(nodeId);
      if (restored) bump();
      return restored;
    },
    [tree, bump],
  );

  return {
    tree,
    treeVersion,
    recordMove,
    resetTree,
    undoMove,
    saveTree,
    loadTree,
    navigateToNode,
  } as const;
}
