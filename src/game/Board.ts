export const GOODS = [
  'jam', 'tea', 'honey', 'cocoa', 'pear', 'apple', 'lemon', 'soda',
  'soap', 'candle', 'milk', 'flour', 'mint', 'cookie',
] as const;
export type Good = typeof GOODS[number];
export type Row = readonly [Good | null, Good | null, Good | null];
export interface Shelf {
  readonly front: Row;
  readonly stock: readonly Row[];
}
export type Board = readonly Shelf[];
export interface Slot { readonly shelf: number; readonly slot: number }
export interface Move { readonly from: Slot; readonly to: Slot }
export type BoardEvent =
  | { readonly type: 'match'; readonly shelf: number; readonly good: Good }
  | { readonly type: 'reveal'; readonly shelf: number };
export interface MoveResult {
  readonly board: Board;
  readonly events: readonly BoardEvent[];
}

export const EMPTY_ROW: Row = [null, null, null];

export function sameSlot(a: Slot, b: Slot): boolean {
  return a.shelf === b.shelf && a.slot === b.slot;
}

export function goodAt(board: Board, { shelf, slot }: Slot): Good | null | undefined {
  return board[shelf]?.front[slot];
}

export function canMove(board: Board, { from, to }: Move): boolean {
  return Number.isInteger(from.shelf) && Number.isInteger(from.slot)
    && Number.isInteger(to.shelf) && Number.isInteger(to.slot)
    && goodAt(board, from) != null && goodAt(board, to) === null;
}

function replace(row: Row, slot: number, good: Good | null): Row {
  const next: [Good | null, Good | null, Good | null] = [...row];
  next[slot] = good;
  return next;
}

function settle(shelf: Shelf, index: number, events: BoardEvent[]): Shelf {
  let { front, stock } = shelf;
  while (true) {
    const [a, b, c] = front;
    if (a && a === b && a === c) {
      events.push({ type: 'match', shelf: index, good: a });
      front = EMPTY_ROW;
    }
    if (front.some(Boolean) || stock.length === 0) return { front, stock };

    [front, ...stock] = stock;
    events.push({ type: 'reveal', shelf: index });
  }
}

export function moveGood(board: Board, move: Move): MoveResult | null {
  if (!canMove(board, move)) return null;

  const { from, to } = move;
  const next = [...board];
  const source = next[from.shelf];
  next[from.shelf] = { ...source, front: replace(source.front, from.slot, null) };
  const target = next[to.shelf];
  next[to.shelf] = { ...target, front: replace(target.front, to.slot, source.front[from.slot]) };
  const events: BoardEvent[] = [];
  next[to.shelf] = settle(next[to.shelf], to.shelf, events);
  if (from.shelf !== to.shelf) next[from.shelf] = settle(next[from.shelf], from.shelf, events);
  return { board: next, events };
}

export function goodsLeft(board: Board): number {
  return board.reduce((total, shelf) => total
    + [shelf.front, ...shelf.stock].reduce((count, row) => count + row.filter(Boolean).length, 0), 0);
}

export function isWon(board: Board): boolean {
  return goodsLeft(board) === 0;
}
