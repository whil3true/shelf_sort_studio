import type { Board } from './Board.ts';
import { solve } from './Solver.ts';

self.onmessage = (event: MessageEvent<Board>) => self.postMessage(solve(event.data, 12_000));
