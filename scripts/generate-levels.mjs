import { writeFileSync } from 'node:fs';
import { GOODS } from '../src/game/Board.ts';
import { solve } from '../src/game/Solver.ts';

// Each recipe sets the number of shelves and triples plus a list of hidden-row owners.
const recipes = [
  [3, 2, [], 3, 5], [3, 2, [], 4, 6], [4, 3, [], 5, 7],
  [4, 3, [0], 5, 7], [4, 4, [1], 6, 8], [4, 4, [0, 2], 7, 9],
  [5, 5, [0, 2], 8, 10], [5, 5, [1, 3, 4], 9, 11], [5, 6, [0, 2, 4], 10, 12],
  [5, 6, [0, 0, 3], 11, 13], [6, 7, [0, 2, 4], 12, 15], [6, 7, [1, 1, 3, 5], 13, 16],
  [6, 8, [0, 2, 2, 5], 14, 18], [6, 8, [1, 1, 3, 3, 5], 15, 19], [6, 9, [0, 0, 2, 4, 5], 16, 20],
  [6, 9, [0, 0, 1, 3, 3, 5], 17, 21], [6, 10, [0, 0, 2, 2, 4, 5], 19, 23],
  [6, 11, [0, 0, 1, 2, 2, 4, 5], 21, 28],
];

let seed = 2557718;
function random(n) {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) % n;
}
function shuffle(list) {
  for (let pos = list.length - 1; pos > 0; pos--) {
    const other = random(pos + 1);
    [list[pos], list[other]] = [list[other], list[pos]];
  }
  return list;
}

const layouts = [];
const solutions = [];
for (const [index, [shelves, groups, behind, min, max]] of recipes.entries()) {
  const palette = index < 3 ? GOODS.slice(0, groups) : GOODS.slice(0, groups).map((_, i) => GOODS[(i + index) % GOODS.length]);
  for (let attempt = 1; ; attempt++) {
    if (attempt > 600) throw Error(`No suitable layout for level ${index + 1}`);
    const goods = shuffle(palette.flatMap(good => [good, good, good]));
    const board = Array.from({ length: shelves }, () => ({ front: [null, null, null], stock: [] }));
    for (const owner of behind) board[owner].stock.push(goods.splice(0, 3));
    const slots = shuffle(Array.from({ length: shelves * 3 }, (_, slot) => slot));
    for (const [item, good] of goods.entries()) {
      const cell = slots[item];
      board[Math.floor(cell / 3)].front[cell % 3] = good;
    }
    const rows = board.flatMap(shelf => [shelf.front, ...shelf.stock]);
    if (rows.some(row => row[0] && row.every(good => row[0] === good))) continue;
    if (board.some(shelf => shelf.stock.length && shelf.front.every(good => good === null))) continue;
    const result = solve(board, 3000, index < 6 ? 0.55 : 0.85);
    if (result.status !== 'solved' || result.moves.length < min || result.moves.length > max) continue;
    // Reject short alternatives on early levels. The first chapters teach deliberately.
    if (index < 9) {
      const shortest = solve(board, 10_000, 1 / 3);
      if (shortest.status === 'solved' && shortest.moves.length < min) continue;
    }
    layouts.push(board.map(({ front, stock }) => [front, ...stock].map(row => row.map(good => good === null ? '.' : GOODS.indexOf(good).toString(16)).join('')).join('/')).join(' '));
    solutions.push(result.moves.map(({ from, to }) => `${from.shelf}${from.slot}${to.shelf}${to.slot}`).join(' '));
    console.log(`Level ${index + 1}: ${result.moves.length} moves, ${result.visited} states`);
    break;
  }
}
const array = list => '[\n' + list.map(line => `  '${line}',`).join('\n') + '\n] as const;\n';
writeFileSync('src/game/LevelData.ts', '// Deterministic layouts and verified replays. Regenerate with node scripts/generate-levels.mjs.\n'
  + 'export const LAYOUTS = ' + array(layouts) + '\nexport const SOLUTIONS = ' + array(solutions));
