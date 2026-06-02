export type Player = "white" | "black";

export type CellContent = null | "W_RING" | "B_RING" | "W_MARKER" | "B_MARKER";

export type GamePhase =
  | "placing-rings"
  | "place-marker"
  | "move-ring"
  | "remove-run"
  | "remove-ring"
  | "game-over";

export interface Coord {
  q: number;
  r: number;
}

export interface Run {
  coords: string[];
  player: Player;
}

export interface YinshState {
  board: Map<string, CellContent>;
  currentPlayer: Player;
  phase: GamePhase;
  ringsPlaced: { white: number; black: number };
  ringsRemoved: { white: number; black: number };
  selectedRing: string | null;
  detectedRuns: Run[];
  runRemovalPlayer: Player | null;
  winner: Player | null;
}

const BOARD_RADIUS = 5;
const SQRT3 = Math.sqrt(3);

const DIRECTIONS: Coord[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

const REMOVED_CORNERS = new Set(["0,-5", "5,-5", "5,0", "0,5", "-5,5", "-5,0"]);

export function coordKey(q: number, r: number): string {
  return `${q},${r}`;
}

export function parseCoord(key: string): Coord {
  const [q, r] = key.split(",").map(Number);
  return { q, r };
}

export function coordToPixel(
  q: number,
  r: number,
  spacing: number,
): { x: number; y: number } {
  return {
    x: spacing * (q + r / 2),
    y: spacing * (SQRT3 / 2) * r,
  };
}

function generateValidPositions(): Set<string> {
  const positions = new Set<string>();
  for (let r = -BOARD_RADIUS; r <= BOARD_RADIUS; r++) {
    const q1 = Math.max(-BOARD_RADIUS, -r - BOARD_RADIUS);
    const q2 = Math.min(BOARD_RADIUS, -r + BOARD_RADIUS);
    for (let q = q1; q <= q2; q++) {
      const key = coordKey(q, r);
      if (!REMOVED_CORNERS.has(key)) {
        positions.add(key);
      }
    }
  }
  return positions;
}

export const VALID_POSITIONS = generateValidPositions();

export class YinshGame {
  private state: YinshState;

  constructor(state?: YinshState) {
    if (state) {
      this.state = state;
    } else {
      const board = new Map<string, CellContent>();
      for (const key of VALID_POSITIONS) {
        board.set(key, null);
      }
      this.state = {
        board,
        currentPlayer: "white",
        phase: "placing-rings",
        ringsPlaced: { white: 0, black: 0 },
        ringsRemoved: { white: 0, black: 0 },
        selectedRing: null,
        detectedRuns: [],
        runRemovalPlayer: null,
        winner: null,
      };
    }
  }

  getState(): Readonly<YinshState> {
    return this.state;
  }

  clone(): YinshGame {
    return new YinshGame({
      board: new Map(this.state.board),
      currentPlayer: this.state.currentPlayer,
      phase: this.state.phase,
      ringsPlaced: { ...this.state.ringsPlaced },
      ringsRemoved: { ...this.state.ringsRemoved },
      selectedRing: this.state.selectedRing,
      detectedRuns: this.state.detectedRuns.map((r) => ({
        coords: [...r.coords],
        player: r.player,
      })),
      runRemovalPlayer: this.state.runRemovalPlayer,
      winner: this.state.winner,
    });
  }

  getValidMoves(): string[] {
    const { phase, board, currentPlayer, selectedRing, runRemovalPlayer } =
      this.state;

    switch (phase) {
      case "placing-rings": {
        const moves: string[] = [];
        for (const [key, content] of board) {
          if (content === null) moves.push(key);
        }
        return moves;
      }

      case "place-marker": {
        const ringType = currentPlayer === "white" ? "W_RING" : "B_RING";
        const moves: string[] = [];
        for (const [key, content] of board) {
          if (content === ringType && this.getValidRingMoves(key).length > 0) {
            moves.push(key);
          }
        }
        return moves;
      }

      case "move-ring": {
        if (!selectedRing) return [];
        return this.getValidRingMoves(selectedRing);
      }

      case "remove-run": {
        return this.state.detectedRuns
          .filter((r) => r.player === runRemovalPlayer)
          .flatMap((r) => r.coords);
      }

      case "remove-ring": {
        const ringType = runRemovalPlayer === "white" ? "W_RING" : "B_RING";
        const moves: string[] = [];
        for (const [key, content] of board) {
          if (content === ringType) moves.push(key);
        }
        return moves;
      }

      case "game-over":
        return [];
    }
  }

  getAvailableActions(): {
    type: string;
    target: string;
    runIndex?: number;
  }[] {
    if (this.state.phase === "remove-run") {
      const playerRuns = this.state.detectedRuns.filter(
        (r) => r.player === this.state.runRemovalPlayer,
      );
      return playerRuns.map((run, i) => ({
        type: "select-run",
        target: run.coords.join("|"),
        runIndex: i,
      }));
    }
    return this.getValidMoves().map((coord) => ({
      type: this.state.phase,
      target: coord,
    }));
  }

  placeRing(coord: string): boolean {
    if (this.state.phase !== "placing-rings") return false;
    if (!VALID_POSITIONS.has(coord)) return false;
    if (this.state.board.get(coord) !== null) return false;

    const ringType = this.state.currentPlayer === "white" ? "W_RING" : "B_RING";
    this.state.board.set(coord, ringType);
    this.state.ringsPlaced[this.state.currentPlayer]++;

    if (this.state.ringsPlaced.white + this.state.ringsPlaced.black >= 10) {
      this.state.phase = "place-marker";
    }

    this.state.currentPlayer =
      this.state.currentPlayer === "white" ? "black" : "white";
    return true;
  }

  placeMarker(coord: string): boolean {
    if (this.state.phase !== "place-marker") return false;
    const ringType = this.state.currentPlayer === "white" ? "W_RING" : "B_RING";
    if (this.state.board.get(coord) !== ringType) return false;

    const markerType =
      this.state.currentPlayer === "white" ? "W_MARKER" : "B_MARKER";
    this.state.board.set(coord, markerType);
    this.state.selectedRing = coord;
    this.state.phase = "move-ring";
    return true;
  }

  moveRing(dest: string): boolean {
    if (this.state.phase !== "move-ring") return false;
    if (!this.state.selectedRing) return false;

    const validMoves = this.getValidRingMoves(this.state.selectedRing);
    if (!validMoves.includes(dest)) return false;

    this.flipMarkersBetween(this.state.selectedRing, dest);

    const ringType = this.state.currentPlayer === "white" ? "W_RING" : "B_RING";
    this.state.board.set(dest, ringType);
    this.state.selectedRing = null;

    this.checkForRuns();
    return true;
  }

  selectRun(runIndex: number): boolean {
    if (this.state.phase !== "remove-run") return false;
    const playerRuns = this.state.detectedRuns.filter(
      (r) => r.player === this.state.runRemovalPlayer,
    );
    if (runIndex < 0 || runIndex >= playerRuns.length) return false;

    const run = playerRuns[runIndex];
    for (const coord of run.coords) {
      this.state.board.set(coord, null);
    }

    this.state.detectedRuns = this.detectRuns();
    this.state.phase = "remove-ring";
    return true;
  }

  removeRing(coord: string): boolean {
    if (this.state.phase !== "remove-ring") return false;
    const ringType =
      this.state.runRemovalPlayer === "white" ? "W_RING" : "B_RING";
    if (this.state.board.get(coord) !== ringType) return false;

    this.state.board.set(coord, null);
    this.state.ringsRemoved[this.state.runRemovalPlayer!]++;

    if (this.state.ringsRemoved[this.state.runRemovalPlayer!] >= 3) {
      this.state.winner = this.state.runRemovalPlayer!;
      this.state.phase = "game-over";
      return true;
    }

    const playerRuns = this.state.detectedRuns.filter(
      (r) => r.player === this.state.runRemovalPlayer,
    );
    if (playerRuns.length > 0) {
      this.state.phase = "remove-run";
      return true;
    }

    const opponent: Player =
      this.state.runRemovalPlayer === "white" ? "black" : "white";
    const opponentRuns = this.state.detectedRuns.filter(
      (r) => r.player === opponent,
    );
    if (opponentRuns.length > 0) {
      this.state.runRemovalPlayer = opponent;
      this.state.phase = "remove-run";
      return true;
    }

    this.state.runRemovalPlayer = null;
    this.state.currentPlayer =
      this.state.currentPlayer === "white" ? "black" : "white";
    this.state.phase = "place-marker";
    this.checkForDraw();
    return true;
  }

  private getValidRingMoves(fromCoord: string): string[] {
    const from = parseCoord(fromCoord);
    const validMoves: string[] = [];

    for (const dir of DIRECTIONS) {
      let q = from.q + dir.q;
      let r = from.r + dir.r;
      let jumpedOverMarkers = false;

      while (true) {
        const key = coordKey(q, r);
        if (!VALID_POSITIONS.has(key)) break;

        const content = this.state.board.get(key);

        if (content === null) {
          validMoves.push(key);
          if (jumpedOverMarkers) break;
        } else if (content === "W_MARKER" || content === "B_MARKER") {
          jumpedOverMarkers = true;
        } else {
          break;
        }

        q += dir.q;
        r += dir.r;
      }
    }

    return validMoves;
  }

  private flipMarkersBetween(fromCoord: string, toCoord: string): void {
    const from = parseCoord(fromCoord);
    const to = parseCoord(toCoord);
    const dq = Math.sign(to.q - from.q);
    const dr = Math.sign(to.r - from.r);

    let q = from.q + dq;
    let r = from.r + dr;

    while (coordKey(q, r) !== toCoord) {
      const key = coordKey(q, r);
      const content = this.state.board.get(key);
      if (content === "W_MARKER") this.state.board.set(key, "B_MARKER");
      else if (content === "B_MARKER") this.state.board.set(key, "W_MARKER");
      q += dq;
      r += dr;
    }
  }

  private checkForRuns(): void {
    const runs = this.detectRuns();
    if (runs.length > 0) {
      this.state.detectedRuns = runs;
      const currentPlayerRuns = runs.filter(
        (r) => r.player === this.state.currentPlayer,
      );
      this.state.runRemovalPlayer =
        currentPlayerRuns.length > 0
          ? this.state.currentPlayer
          : this.state.currentPlayer === "white"
            ? "black"
            : "white";
      this.state.phase = "remove-run";
    } else {
      this.state.currentPlayer =
        this.state.currentPlayer === "white" ? "black" : "white";
      this.state.phase = "place-marker";
      this.checkForDraw();
    }
  }

  private detectRuns(): Run[] {
    const runs: Run[] = [];
    const found = new Set<string>();

    const axes: Coord[] = [
      { q: 1, r: 0 },
      { q: 0, r: 1 },
      { q: 1, r: -1 },
    ];

    for (const [key, content] of this.state.board) {
      if (content !== "W_MARKER" && content !== "B_MARKER") continue;

      const player: Player = content === "W_MARKER" ? "white" : "black";
      const { q, r } = parseCoord(key);

      for (const dir of axes) {
        let startQ = q;
        let startR = r;
        while (
          this.state.board.get(coordKey(startQ - dir.q, startR - dir.r)) ===
          content
        ) {
          startQ -= dir.q;
          startR -= dir.r;
        }

        const sequence: string[] = [];
        let curQ = startQ;
        let curR = startR;
        while (this.state.board.get(coordKey(curQ, curR)) === content) {
          sequence.push(coordKey(curQ, curR));
          curQ += dir.q;
          curR += dir.r;
        }

        if (sequence.length >= 5) {
          for (let i = 0; i <= sequence.length - 5; i++) {
            const runCoords = sequence.slice(i, i + 5);
            const runKey = runCoords.join("|");
            if (!found.has(runKey)) {
              found.add(runKey);
              runs.push({ coords: runCoords, player });
            }
          }
        }
      }
    }

    return runs;
  }

  private checkForDraw(): void {
    if (this.state.phase !== "place-marker") return;
    if (this.getValidMoves().length === 0) {
      this.state.phase = "game-over";
    }
  }
}
