import { simulateEndless } from '../tests/support/endless-simulation.ts';

const seeds = Number(process.argv[2] ?? 1_000);
const moves = Number(process.argv[3] ?? 150);
const first = Number(process.argv[4] ?? 0);
if (![seeds, moves, first].every(Number.isSafeInteger) || seeds < 1 || moves < 1 || first < 0 || first + seeds > 2 ** 32) {
  throw new Error('Usage: npm run test:endless -- [seed-count] [moves-per-run] [first-seed]');
}
console.log(JSON.stringify(simulateEndless(first, seeds, moves), null, 2));
