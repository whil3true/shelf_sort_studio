import { GOODS, goodsLeft, type Board, type Good, type Row } from './Board.ts';
import { solve } from './Solver.ts';

export const ENDLESS_SHELVES = 6;
export const MAX_ENDLESS_STOCK = 4;
export const MAX_ENDLESS_GOODS = 27;

// Each layout is certified by replaying the production solver in the regression suite.
// Relabeling goods and permuting shelves and slots preserve the certificate.
const layouts = [
  ['43./411 52./021 42. 35. 30. 50.', '30./451 12./412 52. 00. 43. 35.', '42./440 33./521 21. 03. 15. 05.'],
  ['145/514 636/210 23. 050 43. 26.', '242/103 620/606 31. 351 55. 44.', '561/402 125/034 65. 642 31. 03.'],
  ['072/374 502/146 127/313 04. 66. 55.', '336/046 447/522 702/161 15. 05. 37.', '253/707 331/260 026/456 11. 75. 44.'],
] as const;

const settings = [
  { palette: 6, capacity: 21, stock: 3, interval: 2 },
  { palette: 8, capacity: 24, stock: 4, interval: 1 },
  { palette: 11, capacity: MAX_ENDLESS_GOODS, stock: MAX_ENDLESS_STOCK, interval: 1 },
] as const;

export function endlessTier(matches: number) {
  return matches < 6 ? 0 : matches < 18 ? 1 : 2;
}

class Random {
  state: number;

  constructor(state: number) { this.state = state; }

  index(length: number) {
    // Mulberry32. The counter is sufficient to reproduce the next draw.
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(this.state ^ (this.state >>> 15), this.state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) * length / 0x100000000 | 0;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.index(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

function row(random: Random, goods: Row): Row {
  const [a, b, c] = random.shuffle(goods);
  return [a, b, c];
}

function palette(seed: number): Good[] {
  return new Random(seed).shuffle(GOODS);
}

export function dealEndless(seed: number, randomState = seed, matches = 0) {
  const random = new Random(randomState);
  const tier = endlessTier(matches);
  const pool = palette(seed).slice(0, settings[tier].palette);
  const pattern = layouts[tier][random.index(layouts[tier].length)];
  const goods = random.shuffle(pool);
  const board: Board = random.shuffle(pattern.split(' ')).map(shelf => {
    const [front, ...stock] = shelf.split('/').map(encoded => {
      const read = (index: number) => encoded[index] === '.' ? null : goods[Number(encoded[index])];
      return row(random, [read(0), read(1), read(2)]);
    });
    return { front, stock };
  });
  return { board, randomState: random.state };
}

export function addEndlessStock(
  board: Board, seed: number, randomState: number, matches: number, sinceSupply: number, cleared: ReadonlySet<number>,
) {
  const config = settings[endlessTier(matches)];
  if (sinceSupply < config.interval || goodsLeft(board) + 6 > config.capacity
    || board.filter(shelf => shelf.stock.length).length + 2 > config.stock) return null;

  const random = new Random(randomState);
  const available = random.shuffle(board.flatMap((shelf, index) =>
    !shelf.stock.length && shelf.front.some(Boolean) ? [index] : []));
  // If only one preferred shelf is available, a just-cleared shelf with an exposed row can hold reserve stock.
  available.sort((a, b) => Number(cleared.has(a)) - Number(cleared.has(b)));
  if (available.length < 2) return null;

  const [a, b] = random.shuffle(palette(seed).slice(0, config.palette));
  const rows = [row(random, [a, a, b]), row(random, [a, b, b])];
  const shelves = available.slice(0, 2);
  const candidate = board.map((shelf, index) => {
    const at = shelves.indexOf(index);
    return at < 0 ? shelf : { ...shelf, stock: [rows[at]] };
  });
  // One bounded attempt per eligible match. A budget limit leaves the original board intact.
  if (solve(candidate, 36, 3).status !== 'solved') {
    return { board, supplied: [], randomState: random.state };
  }
  return { board: candidate, supplied: shelves, randomState: random.state };
}
