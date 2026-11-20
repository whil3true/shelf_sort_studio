import { isWon, moveGood, type Board, type Move, type MoveResult } from './Board.ts';

export class Session {
  private current: Board;
  private readonly history: { board: Board; move: Move }[] = [];

  readonly initial: Board;

  constructor(initial: Board) {
    this.initial = initial;
    this.current = initial;
  }

  get board(): Board { return this.current; }
  get canUndo(): boolean { return this.history.length > 0; }
  get won(): boolean { return isWon(this.board); }
  get moves(): readonly Move[] { return this.history.map(entry => entry.move); }

  move(move: Move): MoveResult | null {
    const result = moveGood(this.current, move);
    if (!result) return null;
    this.history.push({ board: this.current, move });
    this.current = result.board;
    return result;
  }

  undo(): boolean {
    const entry = this.history.pop();
    if (!entry) return false;
    this.current = entry.board;
    return true;
  }

  restart(): void {
    this.history.length = 0;
    this.current = this.initial;
  }
}
