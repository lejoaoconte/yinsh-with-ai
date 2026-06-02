import { useState, useCallback, useRef } from "react";

import { YinshGame } from "cli/GameMechanics";
import type { Player } from "cli/GameMechanics";
import { GameStateTree } from "cli/GameStateTree";

export function useGameTree(initialGame: YinshGame) {
  const [holder, setHolder] = useState<{ tree: GameStateTree; v: number }>(
    () => {
      const t = new GameStateTree();
      t.init(initialGame);
      return { tree: t, v: 0 };
    },
  );

  const persistentHeurTableRef = useRef<[string, number][]>([]);

  const { tree, v: treeVersion } = holder;

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
      const table = loaded.getHeuristicTable();
      if (table.length > 0) {
        persistentHeurTableRef.current = table;
      }
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

  const computeHeuristics = useCallback(
    (aiPlayer: Player) => {
      const res = tree.computeAllHeuristics(aiPlayer);
      persistentHeurTableRef.current = tree.getHeuristicTable();
      bump();
      return res;
    },
    [tree, bump],
  );

  const getHeuristicTable = useCallback(
    (): [string, number][] => persistentHeurTableRef.current,
    [],
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
    computeHeuristics,
    getHeuristicTable,
  } as const;
}
