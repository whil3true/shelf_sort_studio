import { GOODS, goodsLeft, moveGood, type Board, type Good, type Move, type Row, type Shelf } from './Board.ts';

export type SearchResult =
  | { status: 'solved'; moves: readonly Move[]; visited: number }
  | { status: 'unsolvable' | 'limit'; visited: number };

interface Node {
  board: Board;
  remaining: number;
  score: number;
  depth: number;
  parent?: Node;
  move?: Move;
}

// Two bits per good hold counts from zero to three. Slot order is cosmetic.
const goodKeys = Object.fromEntries(GOODS.map((good, index) => [good, 1 << (index * 2)])) as Record<Good, number>;

function rowKey([a, b, c]: Row): number {
  return (a ? goodKeys[a] : 0) + (b ? goodKeys[b] : 0) + (c ? goodKeys[c] : 0);
}

function keyOf(board: Board, shelfKeys: WeakMap<Shelf, string>): string {
  // Moves share untouched shelves, so each immutable shelf only needs encoding once per search.
  // Slot order and shelf positions are cosmetic. The order of stock rows is not.
  return board.map(shelf => {
    const cached = shelfKeys.get(shelf);
    if (cached !== undefined) return cached;
    const key = [shelf.front, ...shelf.stock].map(rowKey).join('/');
    shelfKeys.set(shelf, key);
    return key;
  }).sort().join('|');
}

function stockPriority(board: Board, frontBias: WeakMap<Shelf, number>): number {
  let bias = 0;
  for (const shelf of board) {
    let cached = frontBias.get(shelf);
    if (cached === undefined) {
      const [a, b, c] = shelf.front;
      const occupied = Number(a !== null) + Number(b !== null) + Number(c !== null);
      const hasPair = (a && (a === b || a === c)) || (b && b === c);
      // Prefer freeing hidden stock and preparing triples with room for the third item.
      cached = occupied * (shelf.stock.length ? 0.9 : 0.3) - (hasPair ? (occupied === 2 ? 1.7 : 0.7) : 0);
      frontBias.set(shelf, cached);
    }
    bias += cached;
  }
  return bias;
}

function* successors(board: Board) {
  for (let source = 0; source < board.length; source++) {
    const used = new Set<string>();
    for (const [slot, good] of board[source].front.entries()) {
      if (!good || used.has(good)) continue;
      used.add(good);
      for (let target = 0; target < board.length; target++) {
        if (source === target) continue;
        const empty = board[target].front.indexOf(null);
        if (empty < 0) continue;
        const move: Move = { from: { shelf: source, slot }, to: { shelf: target, slot: empty } };
        const result = moveGood(board, move);
        if (result) yield { move, ...result };
      }
    }
  }
}

function push(queue: Node[], node: Node) {
  let index = queue.length;
  queue.push(node);
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (queue[parent].score <= node.score) break;
    queue[index] = queue[parent];
    index = parent;
  }
  queue[index] = node;
}

function pop(queue: Node[]): Node {
  const first = queue[0];
  const last = queue.pop()!;
  if (!queue.length) return first;
  let index = 0;
  while (index * 2 + 1 < queue.length) {
    let child = index * 2 + 1;
    if (queue[child + 1]?.score < queue[child].score) child++;
    if (last.score <= queue[child].score) break;
    queue[index] = queue[child];
    index = child;
  }
  queue[index] = last;
  return first;
}

export function solveStock(board: Board, budget: number): SearchResult {
  return search(board, budget, 4, stockPriority);
}

export function solve(board: Board, budget = 25_000, remainingWeight = 1.4): SearchResult {
  return search(board, budget, remainingWeight);
}

function search(
  board: Board, budget: number, remainingWeight: number,
  priority?: (board: Board, cache: WeakMap<Shelf, number>) => number,
): SearchResult {
  const remaining = goodsLeft(board);
  const queue: Node[] = [{ board, remaining, score: 0, depth: 0 }];
  const shelfKeys = new WeakMap<Shelf, string>();
  const frontBias = new WeakMap<Shelf, number>();
  const seen = new Map([[keyOf(board, shelfKeys), 0]]);
  let visited = 0;

  while (queue.length) {
    if (visited >= budget) return { status: 'limit', visited };
    const node = pop(queue);
    if (seen.get(keyOf(node.board, shelfKeys)) !== node.depth) continue;
    visited++;
    if (node.remaining === 0) {
      const moves: Move[] = [];
      for (let step: Node | undefined = node; step?.move; step = step.parent) moves.push(step.move);
      return { status: 'solved', moves: moves.reverse(), visited };
    }
    const depth = node.depth + 1;
    for (const next of successors(node.board)) {
      const key = keyOf(next.board, shelfKeys);
      if ((seen.get(key) ?? Infinity) <= depth) continue;
      seen.set(key, depth);
      const count = node.remaining - next.events.filter(event => event.type === 'match').length * 3;
      const score = depth + count * remainingWeight + (priority?.(next.board, frontBias) ?? 0);
      push(queue, { board: next.board, remaining: count, depth, score, parent: node, move: next.move });
    }
  }
  return { status: 'unsolvable', visited };
}
