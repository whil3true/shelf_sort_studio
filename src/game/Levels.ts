import { GOODS, type Board, type Move, type Row } from './Board.ts';
import { LAYOUTS, SOLUTIONS } from './LevelData.ts';

export interface Level {
  readonly id: number;
  readonly chapter: number;
  readonly board: Board;
  readonly solution: readonly Move[];
}

function readRow(text: string): Row {
  if (!/^[.0-9a-d]{3}$/.test(text)) throw new Error(`Invalid level row: ${text}`);
  const read = (index: number) => text[index] === '.' ? null : GOODS[parseInt(text[index], 16)];
  return [read(0), read(1), read(2)];
}

export const LEVELS: readonly Level[] = LAYOUTS.map((layout, index) => ({
  id: index + 1,
  chapter: Math.floor(index / 6),
  board: layout.split(' ').map(shelf => {
    const [front, ...stock] = shelf.split('/').map(readRow);
    return { front, stock };
  }),
  solution: SOLUTIONS[index].split(' ').map(encoded => {
    const [a, b, c, d] = Array.from(encoded, Number);
    return { from: { shelf: a, slot: b }, to: { shelf: c, slot: d } };
  }),
}));

export function levelById(id: number): Level | undefined {
  return LEVELS[id - 1];
}
