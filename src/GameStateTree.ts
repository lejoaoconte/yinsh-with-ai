import { YinshGame } from "./GameMechanics";
import type { YinshState, CellContent } from "./GameMechanics";

export function serializeState(state: Readonly<YinshState>): string {
  const boardEntries = Array.from(state.board.entries())
    .filter(([, v]) => v !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(",");

  return [
    boardEntries,
    state.currentPlayer,
    state.phase,
    state.ringsPlaced.white,
    state.ringsPlaced.black,
    state.ringsRemoved.white,
    state.ringsRemoved.black,
    state.selectedRing ?? "",
    state.runRemovalPlayer ?? "",
    state.winner ?? "",
  ].join("|");
}

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

export interface TreeNodeData {
  id: string;
  depth: number;
  move: string | null;
  stateSnapshot: SerializedState;
  childIds: string[];
  isPlayed: boolean;
  parentId: string | null;
}

export interface SerializedState {
  board: [string, CellContent][];
  currentPlayer: string;
  phase: string;
  ringsPlaced: { white: number; black: number };
  ringsRemoved: { white: number; black: number };
  selectedRing: string | null;
  runRemovalPlayer: string | null;
  winner: string | null;
}

function stateToSerialized(state: Readonly<YinshState>): SerializedState {
  return {
    board: Array.from(state.board.entries()),
    currentPlayer: state.currentPlayer,
    phase: state.phase,
    ringsPlaced: { ...state.ringsPlaced },
    ringsRemoved: { ...state.ringsRemoved },
    selectedRing: state.selectedRing,
    runRemovalPlayer: state.runRemovalPlayer,
    winner: state.winner,
  };
}

function serializedToState(s: SerializedState): YinshState {
  return {
    board: new Map(s.board) as Map<string, CellContent>,
    currentPlayer: s.currentPlayer as YinshState["currentPlayer"],
    phase: s.phase as YinshState["phase"],
    ringsPlaced: { ...s.ringsPlaced },
    ringsRemoved: { ...s.ringsRemoved },
    selectedRing: s.selectedRing,
    detectedRuns: [],
    runRemovalPlayer: s.runRemovalPlayer as YinshState["runRemovalPlayer"],
    winner: s.winner as YinshState["winner"],
  };
}

export function generateChildGames(parentGame: YinshGame): {
  move: string;
  game: YinshGame;
}[] {
  const state = parentGame.getState();
  const results: { move: string; game: YinshGame }[] = [];

  if (state.phase === "game-over") return results;

  if (state.phase === "place-marker") {
    const ringType = state.currentPlayer === "white" ? "W_RING" : "B_RING";
    for (const [key, content] of state.board) {
      if (content !== ringType) continue;
      const g1 = parentGame.clone();
      if (!g1.placeMarker(key)) continue;
      const ringMoves = g1.getValidMoves();
      for (const dest of ringMoves) {
        const g2 = g1.clone();
        if (!g2.moveRing(dest)) continue;
        results.push({ move: `${key}→${dest}`, game: g2 });
      }
    }
    return results;
  }

  if (state.phase === "remove-run") {
    const playerRuns = state.detectedRuns.filter(
      (r) => r.player === state.runRemovalPlayer,
    );
    playerRuns.forEach((run, i) => {
      const g1 = parentGame.clone();
      if (!g1.selectRun(i)) return;
      const ringMoves = g1.getValidMoves();
      for (const dest of ringMoves) {
        const g2 = g1.clone();
        if (!g2.removeRing(dest)) continue;
        results.push({
          move: `run[${run.coords.slice(0, 2).join(",")}…]→remove(${dest})`,
          game: g2,
        });
      }
    });
    return results;
  }

  const moves = parentGame.getValidMoves();
  for (const coord of moves) {
    const g = parentGame.clone();
    let success = false;
    switch (state.phase) {
      case "placing-rings":
        success = g.placeRing(coord);
        break;
      case "remove-ring":
        success = g.removeRing(coord);
        break;
    }
    if (success) {
      results.push({ move: coord, game: g });
    }
  }

  return results;
}

export class GameStateTree {
  nodes: Map<string, TreeNodeData> = new Map();
  private seenStates: Set<string> = new Set();
  rootId: string | null = null;
  currentId: string | null = null;
  playedPath: string[] = [];

  init(game: YinshGame): void {
    this.nodes.clear();
    this.seenStates.clear();
    this.playedPath = [];

    const state = game.getState();
    const id = hashState(state);
    const node: TreeNodeData = {
      id,
      depth: 0,
      move: null,
      stateSnapshot: stateToSerialized(state),
      childIds: [],
      isPlayed: true,
      parentId: null,
    };
    this.nodes.set(id, node);
    this.seenStates.add(serializeState(state));
    this.rootId = id;
    this.currentId = id;
    this.playedPath = [id];

    this._expandChildren(id, game);
  }

  getStateHash(): string | null {
    if (!this.currentId) return null;
    const node = this.nodes.get(this.currentId);
    if (!node) return null;
    const state = serializedToState(node.stateSnapshot);
    return hashState(state);
  }

  applyMove(newGame: YinshGame): void {
    const state = newGame.getState();
    const sig = serializeState(state);
    const id = hashState(state);

    let node = this.nodes.get(id);

    if (!node) {
      node = {
        id,
        depth: this.playedPath.length,
        move: null,
        stateSnapshot: stateToSerialized(state),
        childIds: [],
        isPlayed: true,
        parentId: this.currentId,
      };
      this.nodes.set(id, node);
      this.seenStates.add(sig);

      if (this.currentId) {
        const parent = this.nodes.get(this.currentId)!;
        if (!parent.childIds.includes(id)) {
          parent.childIds.push(id);
        }
      }
    } else {
      node.isPlayed = true;
    }

    this.currentId = id;
    this.playedPath.push(id);
    this._expandChildren(id, newGame);
  }

  undo(): YinshGame | null {
    if (this.playedPath.length <= 1) return null;
    this.playedPath.pop();
    this.currentId = this.playedPath[this.playedPath.length - 1];
    const node = this.nodes.get(this.currentId)!;
    const state = serializedToState(node.stateSnapshot);
    return new YinshGame(state);
  }

  navigateTo(nodeId: string): YinshGame | null {
    const node = this.nodes.get(nodeId);
    if (!node) return null;

    const pathIndex = this.playedPath.indexOf(nodeId);
    if (pathIndex >= 0) {
      this.playedPath = this.playedPath.slice(0, pathIndex + 1);
      this.currentId = nodeId;
      const state = serializedToState(node.stateSnapshot);
      return new YinshGame(state);
    }

    if (this.currentId) {
      const current = this.nodes.get(this.currentId);
      if (current?.childIds.includes(nodeId)) {
        node.isPlayed = true;
        this.currentId = nodeId;
        this.playedPath.push(nodeId);
        const restoredState = serializedToState(node.stateSnapshot);
        const restoredGame = new YinshGame(restoredState);
        if (node.childIds.length === 0 && restoredState.phase !== "game-over") {
          this._expandChildren(nodeId, restoredGame);
        }
        return restoredGame;
      }
    }

    return null;
  }

  getNavigableIds(): Set<string> {
    const set = new Set<string>();
    for (const id of this.playedPath) {
      if (id !== this.currentId) set.add(id);
    }
    if (this.currentId) {
      const current = this.nodes.get(this.currentId);
      if (current) {
        for (const cid of current.childIds) set.add(cid);
      }
    }
    return set;
  }

  private _expandChildren(parentId: string, parentGame: YinshGame): void {
    const parent = this.nodes.get(parentId)!;
    const children = generateChildGames(parentGame);

    for (const { move, game } of children) {
      const childState = game.getState();
      const childSig = serializeState(childState);
      const childId = hashState(childState);

      if (this.seenStates.has(childSig)) continue;

      this.seenStates.add(childSig);
      const childNode: TreeNodeData = {
        id: childId,
        depth: parent.depth + 1,
        move,
        stateSnapshot: stateToSerialized(childState),
        childIds: [],
        isPlayed: false,
        parentId,
      };
      this.nodes.set(childId, childNode);
      if (!parent.childIds.includes(childId)) {
        parent.childIds.push(childId);
      }
    }
  }

  toXML(): string {
    const esc = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push("<yinshTree>");
    lines.push(`  <meta>`);
    lines.push(`    <rootId>${esc(this.rootId ?? "")}</rootId>`);
    lines.push(`    <currentId>${esc(this.currentId ?? "")}</currentId>`);
    lines.push(
      `    <playedPath>${this.playedPath.map(esc).join(",")}</playedPath>`,
    );
    lines.push(`  </meta>`);
    lines.push(`  <nodes>`);

    for (const [id, node] of this.nodes) {
      lines.push(`    <node id="${esc(id)}">`);
      lines.push(`      <depth>${node.depth}</depth>`);
      lines.push(`      <move>${esc(node.move ?? "")}</move>`);
      lines.push(`      <isPlayed>${node.isPlayed}</isPlayed>`);
      lines.push(`      <parentId>${esc(node.parentId ?? "")}</parentId>`);
      lines.push(
        `      <childIds>${node.childIds.map(esc).join(",")}</childIds>`,
      );
      lines.push(`      <snapshot>`);
      const s = node.stateSnapshot;
      lines.push(
        `        <currentPlayer>${esc(s.currentPlayer)}</currentPlayer>`,
      );
      lines.push(`        <phase>${esc(s.phase)}</phase>`);
      lines.push(
        `        <ringsPlaced white="${s.ringsPlaced.white}" black="${s.ringsPlaced.black}"/>`,
      );
      lines.push(
        `        <ringsRemoved white="${s.ringsRemoved.white}" black="${s.ringsRemoved.black}"/>`,
      );
      lines.push(
        `        <selectedRing>${esc(s.selectedRing ?? "")}</selectedRing>`,
      );
      lines.push(
        `        <runRemovalPlayer>${esc(s.runRemovalPlayer ?? "")}</runRemovalPlayer>`,
      );
      lines.push(`        <winner>${esc(s.winner ?? "")}</winner>`);
      lines.push(`        <board>`);
      for (const [key, val] of s.board) {
        if (val !== null) {
          lines.push(`          <cell key="${esc(key)}" val="${esc(val)}"/>`);
        }
      }
      lines.push(`        </board>`);
      lines.push(`      </snapshot>`);
      lines.push(`    </node>`);
    }

    lines.push(`  </nodes>`);
    lines.push(`</yinshTree>`);
    return lines.join("\n");
  }

  static fromXML(xml: string): GameStateTree {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "application/xml");

    const err = doc.querySelector("parsererror");
    if (err) throw new Error("XML inválido: " + err.textContent);

    const getText = (parent: Element, tag: string) =>
      parent.querySelector(tag)?.textContent?.trim() ?? "";

    const tree = new GameStateTree();
    const meta = doc.querySelector("meta")!;
    tree.rootId = getText(meta, "rootId") || null;
    tree.currentId = getText(meta, "currentId") || null;
    const pathStr = getText(meta, "playedPath");
    tree.playedPath = pathStr ? pathStr.split(",") : [];

    for (const nodeEl of Array.from(doc.querySelectorAll("nodes > node"))) {
      const id = nodeEl.getAttribute("id")!;
      const snap = nodeEl.querySelector("snapshot")!;
      const boardEntries: [string, CellContent][] = Array.from(
        snap.querySelectorAll("board > cell"),
      ).map((c) => [
        c.getAttribute("key")!,
        c.getAttribute("val") as CellContent,
      ]);

      const rp = snap.querySelector("ringsPlaced")!;
      const rr = snap.querySelector("ringsRemoved")!;

      const childIdsStr = getText(nodeEl as Element, "childIds");

      const node: TreeNodeData = {
        id,
        depth: parseInt(getText(nodeEl as Element, "depth"), 10),
        move: getText(nodeEl as Element, "move") || null,
        isPlayed: getText(nodeEl as Element, "isPlayed") === "true",
        parentId: getText(nodeEl as Element, "parentId") || null,
        childIds: childIdsStr ? childIdsStr.split(",") : [],
        stateSnapshot: {
          board: boardEntries,
          currentPlayer: getText(snap, "currentPlayer"),
          phase: getText(snap, "phase"),
          ringsPlaced: {
            white: parseInt(rp.getAttribute("white")!, 10),
            black: parseInt(rp.getAttribute("black")!, 10),
          },
          ringsRemoved: {
            white: parseInt(rr.getAttribute("white")!, 10),
            black: parseInt(rr.getAttribute("black")!, 10),
          },
          selectedRing: getText(snap, "selectedRing") || null,
          runRemovalPlayer: getText(snap, "runRemovalPlayer") || null,
          winner: getText(snap, "winner") || null,
        },
      };

      tree.nodes.set(id, node);
    }

    for (const node of tree.nodes.values()) {
      const state = serializedToState(node.stateSnapshot);
      tree["seenStates"].add(serializeState(state));
    }

    return tree;
  }

  saveToFile(filename = "yinsh_tree.xml"): void {
    const blob = new Blob([this.toXML()], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  static async loadFromFile(file: File): Promise<GameStateTree> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const tree = GameStateTree.fromXML(e.target!.result as string);
          resolve(tree);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  getCurrentGame(): YinshGame | null {
    if (!this.currentId) return null;
    const node = this.nodes.get(this.currentId);
    if (!node) return null;
    const state = serializedToState(node.stateSnapshot);
    return new YinshGame(state);
  }

  get totalNodes(): number {
    return this.nodes.size;
  }

  get maxDepth(): number {
    let max = 0;
    for (const node of this.nodes.values()) {
      if (node.depth > max) max = node.depth;
    }
    return max;
  }
}
