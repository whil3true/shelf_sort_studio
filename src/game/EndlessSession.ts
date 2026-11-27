import { GOODS, goodsLeft, moveGood, type Board, type Move, type MoveResult, type Row } from './Board.ts';
import { addEndlessStock, dealEndless, endlessStockDue, ENDLESS_SHELVES, MAX_ENDLESS_GOODS, MAX_ENDLESS_STOCK } from './EndlessStock.ts';

const HISTORY_LIMIT = 8;
const POINTS_PER_MATCH = 100;

interface Position {
  readonly board: Board;
  readonly matches: number;
  readonly moves: number;
  readonly lastSupplyMove: number;
  readonly randomState: number;
  readonly lastSupply: number;
}

interface EndlessSave {
  readonly version: 2;
  readonly seed: number;
  readonly position: Position;
  readonly history: readonly Position[];
}

export interface EndlessMove extends MoveResult {
  readonly supplied: readonly number[];
  readonly redealt: boolean;
  readonly stockCheck?: 'solved' | 'unsolvable' | 'limit';
}

export function hasLegalMove(board: Board): boolean {
  // Every settled front item may move to any empty front slot, including on its own shelf.
  return board.some(shelf => shelf.front.some(Boolean)) && board.some(shelf => shelf.front.includes(null));
}

export class EndlessSession {
  readonly seed: number;
  private position: Position;
  private readonly history: Position[];

  private constructor(seed: number, position: Position, history: Position[]) {
    this.seed = seed;
    this.position = position;
    this.history = history;
  }

  static start(seed: number) {
    const position = { ...dealEndless(seed), matches: 0, lastSupply: 0, moves: 0, lastSupplyMove: 0 };
    return new EndlessSession(seed, position, []);
  }

  static restore(value: unknown): EndlessSession | null {
    if (!record(value) || !unsigned(value.seed) || (value.version !== undefined && value.version !== 2)
      || !Array.isArray(value.history) || value.history.length > HISTORY_LIMIT) return null;
    const legacy = value.version === undefined;
    const positions: Position[] = [];
    for (const entry of [...value.history, value.position] as unknown[]) {
      const previous = positions.at(-1);
      const position = readPosition(entry, legacy, previous);
      if (!position || (previous && (!hasLegalMove(previous.board)
        || position.matches < previous.matches || position.lastSupply < previous.lastSupply
        || position.moves !== previous.moves + 1 || position.lastSupplyMove < previous.lastSupplyMove))) return null;
      positions.push(position);
    }
    return new EndlessSession(value.seed, positions.pop()!, positions);
  }

  get board(): Board { return this.position.board; }
  get matches(): number { return this.position.matches; }
  get score(): number { return this.matches * POINTS_PER_MATCH; }
  get lost(): boolean { return !hasLegalMove(this.board) && goodsLeft(this.board) > 0; }
  get canUndo(): boolean { return this.history.length > 0; }

  snapshot(): EndlessSave {
    return { version: 2, seed: this.seed, position: this.position, history: [...this.history] };
  }

  move(move: Move): EndlessMove | null {
    const result = moveGood(this.board, move);
    if (!result) return null;
    const cleared = new Set<number>();
    let removed = 0;
    for (const event of result.events) {
      if (event.type !== 'match') continue;
      cleared.add(event.shelf);
      removed++;
    }

    this.history.push(this.position);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();

    let { board } = result;
    const matches = this.matches + removed;
    const moves = this.position.moves + 1;
    let { lastSupply, lastSupplyMove, randomState } = this.position;
    let supplied: readonly number[] = [];
    let stockCheck: EndlessMove['stockCheck'];
    const redealt = goodsLeft(board) === 0;
    if (redealt) {
      ({ board, randomState } = dealEndless(this.seed, randomState, matches));
      lastSupply = matches;
      lastSupplyMove = moves;
    } else if (hasLegalMove(board) && endlessStockDue(matches, moves - lastSupplyMove, matches - lastSupply, removed > 0)) {
      const supply = addEndlessStock(board, this.seed, randomState, matches, cleared);
      if (supply) {
        ({ board, supplied, randomState } = supply);
        stockCheck = supply.check;
        if (supplied.length) {
          lastSupply = matches;
          lastSupplyMove = moves;
        }
      }
    }
    this.position = { board, matches, randomState, lastSupply, moves, lastSupplyMove };
    return { board, events: result.events, supplied, redealt, stockCheck };
  }

  undo(): boolean {
    const previous = this.history.pop();
    if (!previous) return false;
    this.position = previous;
    return true;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function unsigned(value: unknown): value is number {
  return nonnegative(value) && value <= 0xffffffff;
}

function validRow(value: unknown): value is Row {
  return Array.isArray(value) && value.length === 3
    && [value[0], value[1], value[2]].every(good => good === null || GOODS.includes(good))
    && !(value[0] && value[0] === value[1] && value[0] === value[2]);
}

function readPosition(value: unknown, legacy: boolean, previous?: Position): Position | null {
  if (!record(value) || !nonnegative(value.matches) || value.matches > Number.MAX_SAFE_INTEGER / POINTS_PER_MATCH
    || !unsigned(value.randomState) || !nonnegative(value.lastSupply) || value.lastSupply > value.matches
    || !validBoard(value.board)) return null;

  // Old saves have one position per retained successful move, but no clock before that history.
  const moves = legacy ? (previous ? previous.moves + 1 : 0) : value.moves;
  const lastSupplyMove = legacy
    ? (previous && value.lastSupply > previous.lastSupply ? moves : previous?.lastSupplyMove ?? 0)
    : value.lastSupplyMove;
  if (!nonnegative(moves) || !nonnegative(lastSupplyMove) || lastSupplyMove > moves) return null;
  return { board: value.board, matches: value.matches, randomState: value.randomState,
    lastSupply: value.lastSupply, moves, lastSupplyMove };
}

function validBoard(board: unknown): board is Board {
  if (!Array.isArray(board) || board.length !== ENDLESS_SHELVES) return false;

  const counts = new Map<string, number>();
  let stock = 0;
  let total = 0;
  for (const shelf of board) {
    if (!record(shelf) || !validRow(shelf.front) || !Array.isArray(shelf.stock) || shelf.stock.length > 1) return false;
    stock += shelf.stock.length;
    if (shelf.stock.length && !shelf.front.some(Boolean)) return false;
    for (const back of shelf.stock) {
      if (!validRow(back) || !back.some(Boolean)) return false;
    }
    for (const row of [shelf.front, ...shelf.stock] as Row[]) {
      for (const good of row) {
        if (!good) continue;
        total++;
        counts.set(good, (counts.get(good) ?? 0) + 1);
      }
    }
  }
  return total > 0 && total <= MAX_ENDLESS_GOODS && stock <= MAX_ENDLESS_STOCK
    && [...counts.values()].every(count => count % 3 === 0);
}
