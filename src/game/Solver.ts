import { goodsLeft, moveGood, type Board, type Move, type Row } from './Board.ts';

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

function rowKey(row: Row): string {
  return [...row].map(good => good ?? '').sort().join(',');
}

function keyOf(board: Board): string {
  // Slot order and shelf positions are cosmetic. The order of stock rows is not.
  return board.map(shelf => [shelf.front, ...shelf.stock].map(rowKey).join('/')).sort().join('|');
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

export function solve(board: Board, budget = 25_000, remainingWeight = 1.4): SearchResult {
  const remaining = goodsLeft(board);
  const queue: Node[] = [{ board, remaining, score: 0, depth: 0 }];
  const seen = new Map([[keyOf(board), 0]]);
  let visited = 0;

  while (queue.length) {
    if (visited >= budget) return { status: 'limit', visited };
    const node = pop(queue);
    if (seen.get(keyOf(node.board)) !== node.depth) continue;
    visited++;
    if (node.remaining === 0) {
      const moves: Move[] = [];
      for (let step: Node | undefined = node; step?.move; step = step.parent) moves.push(step.move);
      return { status: 'solved', moves: moves.reverse(), visited };
    }
    const depth = node.depth + 1;
    for (const next of successors(node.board)) {
      const key = keyOf(next.board);
      if ((seen.get(key) ?? Infinity) <= depth) continue;
      seen.set(key, depth);
      const count = node.remaining - next.events.filter(event => event.type === 'match').length * 3;
      push(queue, { board: next.board, remaining: count, depth, score: depth + count * remainingWeight, parent: node, move: next.move });
    }
  }
  return { status: 'unsolvable', visited };
}
