import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_ROW, goodsLeft, moveGood, type Board } from '../../src/game/Board.ts';
import { EndlessSession, hasLegalMove } from '../../src/game/EndlessSession.ts';
import { addEndlessStock, dealEndless, endlessStockDue } from '../../src/game/EndlessStock.ts';
import { LEVELS } from '../../src/game/Levels.ts';
import { solve, solveStock } from '../../src/game/Solver.ts';
import { SAVE_KEY, Storage } from '../../src/platform/Storage.ts';
import {
  clearForRestock, lossPath, lossSeed, moveSupplyPath, moveSupplySeed, restockSave, supplyPath, supplySeed,
} from '../support/endless-fixtures.ts';
import { simulateEndless } from '../support/endless-simulation.ts';

test('the seed reproduces its initial position and every difficulty starts with a solvable layout', () => {
  for (let seed = 0; seed < 24; seed++) {
    assert.deepEqual(EndlessSession.start(seed).snapshot(), EndlessSession.start(seed).snapshot());
    for (const matches of [0, 6, 18]) {
      const { board } = dealEndless(seed, seed, matches);
      assert.equal(hasLegalMove(board), true);
      assert.equal(solve(board, 3_500, 3).status, 'solved', `seed ${seed}, triples ${matches}`);
    }
  }
});

test('planned strategy continues through repeated checked stock deliveries across reproducible seeds', () => {
  const sample = simulateEndless(0, 12, 60);
  assert.equal(sample.distinctStarts, 12);
  assert.equal(sample.planned.moves, 720);
  assert.ok(sample.planned.deliveries.deliveries > 100);
  assert.ok(sample.planned.deliveries.deliveries > sample.planned.redeals);
  assert.ok(sample.planned.deliveries.withoutMatch > 0);
  assert.ok(sample.planned.deliveries.front > 0 && sample.planned.deliveries.mixed > 0);
  assert.ok(sample.planned.deliveries.small > 0 && sample.planned.deliveries.full > 0);
  assert.ok(sample.phases.every(phase => phase.turns > 0));
});

test('stock is added behind occupied front rows, revealed once and undone with score and random state', () => {
  const session = EndlessSession.start(supplySeed);
  for (const move of supplyPath.slice(0, -1)) assert.ok(session.move(move));
  const before = session.snapshot();
  assert.equal(session.score, 100);
  const move = supplyPath.at(-1)!;
  const settled = moveGood(session.board, move)!;
  const result = session.move(move)!;
  assert.deepEqual(result.events, settled.events);
  assert.equal(result.events.filter(event => event.type === 'match').length, 1);
  assert.equal(result.supplied.length, 2);
  assert.equal(result.redealt, false);
  assert.equal(session.score, 200);
  assert.equal(session.matches, 2);
  const after = session.snapshot();
  assert.equal(after.position.lastSupplyMove, after.position.moves);
  assert.deepEqual(result.supplied.map(shelf => result.board[shelf].stock[0].filter(Boolean).length), [1, 2]);

  const shelf = result.supplied[0];
  assert.equal(session.move({ from: { shelf, slot: 3 }, to: move.to }), null);
  assert.deepEqual(session.snapshot(), after);
  const restored = EndlessSession.restore(JSON.parse(JSON.stringify(after)))!;
  assert.deepEqual(restored.snapshot(), after);
  assert.ok(restored.undo());
  assert.equal(restored.score, 100);
  assert.deepEqual(restored.snapshot(), before);
  assert.deepEqual(restored.move(move), result);
  assert.deepEqual(restored.snapshot(), after);

  // Expose one of the delivered rows by moving its visible items into vacant slots.
  const rear = restored.board[shelf].stock[0];
  const empty = restored.board.flatMap((item, index) => index === shelf ? [] :
    item.front.flatMap((good, slot) => good ? [] : [{ shelf: index, slot }]));
  const visible = restored.board[shelf].front.flatMap((good, slot) => good ? [slot] : []);
  for (const [index, slot] of visible.entries()) {
    const exposure = restored.move({ from: { shelf, slot }, to: empty[index] })!;
    assert.equal(exposure.events.filter(event => event.shelf === shelf && event.type === 'reveal').length,
      index === visible.length - 1 ? 1 : 0);
  }
  assert.deepEqual(restored.board[shelf].front, rear);
});

test('six ordinary moves trigger a compact delivery after the full candidate hits its budget', () => {
  const session = EndlessSession.start(moveSupplySeed);
  for (const move of moveSupplyPath.slice(0, -1)) {
    const result = session.move(move)!;
    assert.deepEqual(result.events, []);
    assert.deepEqual(result.stock, { status: 'not_due', checks: [] });
  }
  const before = session.snapshot();
  assert.equal(before.position.moves, 5);
  assert.equal(session.move({ from: { shelf: 0, slot: 3 }, to: { shelf: 1, slot: 0 } }), null);
  assert.deepEqual(session.snapshot(), before);
  const result = session.move(moveSupplyPath.at(-1)!)!;
  assert.deepEqual(result.events, []);
  const rows = result.supplied.map(shelf => result.board[shelf].stock[0].filter(Boolean));
  assert.deepEqual(rows.map(row => row.length).sort(), [1, 2]);
  assert.equal(result.stock.status, 'supplied');
  assert.deepEqual(result.stock.checks.map(({ size, status }) => [size, status]), [[6, 'limit'], [3, 'solved']]);
  assert.notDeepEqual(result.stock.checks[0].shelves, result.stock.checks[1].shelves);
  let replay = result.board;
  for (const move of result.stockProof!) replay = moveGood(replay, move)!.board;
  assert.equal(goodsLeft(replay), 0);
  assert.equal(new Set(rows.flat()).size, 1);
  assert.equal(goodsLeft(result.board), goodsLeft(before.position.board) + 3);
  assert.equal(session.snapshot().position.lastSupplyMove, 6);
  assert.equal(session.score, before.position.matches * 100);
});

test('ordinary moves still advance the clock when a full reserve blocks deliveries', () => {
  const session = EndlessSession.start(moveSupplySeed);
  for (const move of moveSupplyPath) assert.ok(session.move(move));
  const before = session.snapshot().position;
  const a = { shelf: 0, slot: 0 };
  const b = { shelf: 5, slot: 2 };
  for (let index = 0; index < 40; index++) {
    const result = session.move(index % 2 ? { from: b, to: a } : { from: a, to: b })!;
    assert.deepEqual(result.events, []);
    assert.equal(result.stock.status, index < 5 ? 'not_due' : 'stock_cap');
    assert.deepEqual(result.stock.checks, []);
  }
  assert.deepEqual(session.snapshot().position, { ...before, moves: 46 });
});

test('a match-triggered delivery stays due across a save and succeeds after an ordinary reveal frees space', () => {
  const start = restockSave();
  const board: Board = start.position.board.map((shelf, index) => {
    if (index === 3) return { ...shelf, stock: [['pear', 'milk', null]] };
    if (index === 4) return { ...shelf, stock: [['milk', 'milk', 'pear']] };
    return shelf;
  });
  const session = EndlessSession.restore({ ...start, position: { ...start.position, board } })!;
  const match = session.move(clearForRestock)!;
  assert.equal(match.stock.status, 'stock_cap');
  assert.equal(session.snapshot().position.lastSupplyMove, 0);
  assert.equal(session.snapshot().position.randomState, start.position.randomState);

  const saved = JSON.parse(JSON.stringify(session.snapshot()));
  const resumed = EndlessSession.restore(saved)!;
  const reveal = { from: { shelf: 2, slot: 0 }, to: { shelf: 5, slot: 2 } };
  const result = resumed.move(reveal)!;
  assert.deepEqual(result.events, [{ type: 'reveal', shelf: 2 }]);
  assert.equal(result.stock.status, 'supplied');
  assert.equal(resumed.snapshot().position.lastSupplyMove, 3);
  assert.equal(resumed.score, 200);
  assert.deepEqual(session.move(reveal), result);
  assert.ok(resumed.undo());
  assert.deepEqual(resumed.snapshot(), saved);
  assert.deepEqual(resumed.move(reveal), result);
});

test('overlapping triggers accept just one delivery and can still mix two full rows', () => {
  const session = EndlessSession.start(5);
  const plan = solve(session.board, 3_500, 3);
  assert.equal(plan.status, 'solved');
  for (const move of plan.moves.slice(0, 3)) assert.ok(session.move(move));
  const before = session.snapshot();
  const ready = { ...before.position, moves: 5 };
  const atBothTriggers = EndlessSession.restore({ ...before, position: ready, history: [] })!;
  const move = plan.moves[3];
  const settled = moveGood(atBothTriggers.board, move)!;
  assert.equal(endlessStockDue(2, 6, 0), true);
  assert.equal(endlessStockDue(2, 4, 2), true);
  const result = atBothTriggers.move(move)!;
  assert.equal(result.events.filter(event => event.type === 'match').length, 1);
  assert.equal(result.supplied.length, 2);
  assert.equal(goodsLeft(result.board) - goodsLeft(settled.board), 6);
  assert.ok(result.supplied.every(shelf => result.board[shelf].stock[0].every(Boolean)));
  assert.equal(atBothTriggers.snapshot().position.lastSupplyMove, 6);
});

test('space diagnostics distinguish the goods cap, stock cap and too few usable shelves', () => {
  const occupied = { front: ['tea', null, null], stock: [] } as const;
  const stocked = { front: ['tea', null, null], stock: [['honey', null, null]] } as const;
  const dense = { front: ['pear', 'tea', 'tea'], stock: [['honey', 'honey', 'pear']] } as const;
  const empty = { front: EMPTY_ROW, stock: [] };
  const stockedPair = { front: ['tea', null, null], stock: [['honey', 'honey', null]] } as const;
  const capped: Board = [dense, dense, dense, { front: ['jam', 'jam', null], stock: [['jam', 'milk', 'milk']] },
    { front: ['milk', null, null], stock: [] }, empty];
  const stockCapped: Board = [stocked, stockedPair, stocked, stockedPair, occupied, occupied];
  const noShelves: Board = [stocked, stockedPair, stocked, stockedPair, stocked, empty];
  for (const [board, status] of [[capped, 'no_capacity'], [stockCapped, 'stock_cap'],
    [noShelves, 'no_eligible_shelves']] as const) {
    const result = addEndlessStock(board, 1, 7, 0, new Set());
    assert.deepEqual(result.report, { status, checks: [] });
    assert.equal(result.board, board);
    assert.equal(result.randomState, 7);
  }
});

test('two empty shelves receive a visible 2+1 even when the rear-row cap has been reached', () => {
  const { position } = restockSave();
  const board: Board = [
    { front: ['tea', 'tea', null], stock: [['jam', null, null]] },
    { front: ['tea', null, null], stock: [['jam', 'jam', null]] },
    { front: ['cocoa', 'cocoa', null], stock: [['pear', null, null]] },
    { front: ['cocoa', null, null], stock: [['pear', 'pear', null]] },
    { front: EMPTY_ROW, stock: [] },
    { front: EMPTY_ROW, stock: [] },
  ];
  const result = addEndlessStock(board, 1, position.randomState, 1, new Set());
  assert.equal(result.report.status, 'supplied');
  assert.deepEqual([...result.supplied].sort(), [4, 5]);
  assert.deepEqual(result.board.slice(0, 4), board.slice(0, 4));
  const [pair, single] = result.supplied;
  const newGoods = result.board[pair].front.filter(Boolean);
  assert.equal(newGoods.length, 2);
  assert.deepEqual(result.board[single].front.filter(Boolean), [newGoods[0]]);
  assert.ok(result.supplied.every(shelf => result.board[shelf].stock.length === 0));
  const move = {
    from: { shelf: single, slot: result.board[single].front.findIndex(Boolean) },
    to: { shelf: pair, slot: result.board[pair].front.indexOf(null) },
  };
  assert.deepEqual(moveGood(result.board, move)?.events, [{ type: 'match', shelf: pair, good: newGoods[0] }]);
  let replay = result.board;
  for (const move of result.proof!) replay = moveGood(replay, move)!.board;
  assert.equal(goodsLeft(replay), 0);
});

test('clearing a shelf starts a mixed delivery and seed and clocks replay it after loading and Undo', () => {
  const saved = restockSave();
  const session = EndlessSession.restore(saved)!;
  const settled = moveGood(session.board, clearForRestock)!;
  const result = session.move(clearForRestock)!;
  assert.deepEqual(result.events, [{ type: 'match', shelf: 0, good: 'tea' }]);
  assert.equal(session.score, 200);
  assert.equal(result.stock.status, 'supplied');
  assert.equal(result.stock.checks[0].size, 3);
  const [front, rear] = result.supplied;
  assert.equal(front, 0);
  assert.deepEqual(settled.board[front].front, EMPTY_ROW);
  assert.deepEqual(result.board[rear].front, settled.board[rear].front);
  assert.equal(settled.board[rear].stock.length, 0);
  assert.deepEqual(result.board[rear].stock[0].filter(Boolean), result.board[front].front.filter(Boolean).slice(0, 1));
  const after = session.snapshot();
  const restored = EndlessSession.restore(JSON.parse(JSON.stringify(after)))!;
  assert.deepEqual(restored.snapshot(), after);
  assert.ok(restored.undo());
  assert.deepEqual(restored.snapshot(), saved);
  assert.deepEqual(restored.move(clearForRestock), result);
  assert.deepEqual(restored.snapshot(), after);
});

test('ordinary back-and-forth moves supply an existing empty shelf with only one rear target', () => {
  const start = restockSave();
  const board: Board = [
    { front: ['tea', 'tea', null], stock: [['jam', 'milk', null]] },
    { front: ['tea', null, null], stock: [['jam', 'jam', null]] },
    { front: ['cocoa', 'cocoa', null], stock: [['pear', null, null]] },
    { front: ['cocoa', null, null], stock: [['pear', 'pear', null]] },
    { front: ['milk', 'milk', null], stock: [] },
    { front: EMPTY_ROW, stock: [] },
  ];
  const session = EndlessSession.restore({ ...start, position: {
    ...start.position, board, moves: 0, matches: 18, lastSupply: 18,
  } })!;
  const a = { shelf: 0, slot: 0 };
  const b = { shelf: 1, slot: 1 };
  for (let turn = 1; turn <= 21; turn++) {
    const result = session.move(turn % 2 ? { from: a, to: b } : { from: b, to: a })!;
    assert.deepEqual(result.events, []);
    assert.deepEqual(result.supplied, turn === 3 ? [5, 4] : []);
  }
  assert.equal(session.snapshot().position.moves, 21);
  assert.equal(session.snapshot().position.lastSupplyMove, 3);
  assert.equal(session.score, 1800);
  assert.equal(session.board[5].front.filter(Boolean).length, 2);
  assert.equal(session.board[4].stock[0].filter(Boolean).length, 1);
});

test('the stock search distinguishes a budget limit from an exhaustive deadlock', () => {
  const deadlock: Board = [
    { front: ['jam', 'jam', 'tea'], stock: [] }, { front: ['jam', 'tea', 'tea'], stock: [] },
  ];
  assert.equal(solveStock(deadlock, 0).status, 'limit');
  assert.equal(solveStock(deadlock, 42).status, 'unsolvable');
  const full: Board = [...deadlock, ...deadlock, ...deadlock];
  const result = addEndlessStock(full, 1, 7, 0, new Set());
  assert.equal(result.report.status, 'unsolvable');
  assert.ok(result.report.checks.every(check => check.status === 'unsolvable'));
  assert.equal(result.board, full);
});

test('a PR #15 save remembers a budget-limited delivery and retries without another match', () => {
  const old = EndlessSession.start(moveSupplySeed);
  for (const move of moveSupplyPath.slice(0, 5)) assert.ok(old.move(move));
  const { seed, version, position, history } = old.snapshot();
  // PR #15 rejected its only candidate on move six, after advancing Mulberry32.
  const board = moveGood(position.board, moveSupplyPath[5])!.board;
  const saved = { seed, version, history: [...history, position],
    position: { ...position, moves: 6, board, randomState: 248188488 } };
  const session = EndlessSession.restore(JSON.parse(JSON.stringify(saved)))!;
  assert.deepEqual(session.snapshot(), saved);
  const move = { from: { shelf: 1, slot: 0 }, to: { shelf: 0, slot: 1 } };
  const delivery = session.move(move)!;
  assert.deepEqual(delivery.events, []);
  assert.equal(delivery.stock.status, 'supplied');
  assert.equal(session.snapshot().position.lastSupplyMove, 7);
  assert.ok(session.undo());
  assert.deepEqual(session.snapshot(), saved);
  assert.deepEqual(session.move(move), delivery);
});

test('a poor move loses only once the final automatic reveal fills the last free slot', () => {
  const session = EndlessSession.start(lossSeed);
  for (const move of lossPath.slice(0, -1)) {
    assert.ok(session.move(move));
    assert.equal(session.lost, false);
  }
  const before = session.snapshot();
  assert.ok(hasLegalMove(session.board));
  const final = session.move(lossPath.at(-1)!)!;
  assert.deepEqual(final.events, [{ type: 'reveal', shelf: 2 }]);
  assert.ok(session.lost);
  assert.ok(!hasLegalMove(session.board) && goodsLeft(session.board) > 0);
  const restored = EndlessSession.restore(JSON.parse(JSON.stringify(session.snapshot())))!;
  assert.equal(restored.lost, true);
  assert.ok(restored.undo());
  assert.equal(restored.lost, false);
  assert.deepEqual(restored.snapshot().position, before.position);
});

test('clearing the final triple deals a new solvable board without ending the run', () => {
  const start = EndlessSession.start(500).snapshot();
  const board: Board = [
    { front: ['tea', null, 'tea'], stock: [] }, { front: ['tea', null, null], stock: [] },
    ...Array.from({ length: 4 }, () => ({ front: EMPTY_ROW, stock: [] })),
  ];
  const session = EndlessSession.restore({ ...start, position: { ...start.position, board, matches: 5, lastSupply: 5 } })!;
  const move = { from: { shelf: 1, slot: 0 }, to: { shelf: 0, slot: 1 } };
  const result = session.move(move)!;
  assert.ok(result.redealt && !session.lost && session.canUndo);
  assert.equal(session.score, 600);
  assert.equal(solve(session.board, 3_500, 3).status, 'solved');
  assert.ok(session.undo());
  assert.equal(session.score, 500);
  assert.deepEqual(session.board, board);
});

test('version 1 campaign migrates intact and a corrupt endless run leaves the previous record and campaign usable', () => {
  const moves = [LEVELS[1].solution[0]];
  let raw = JSON.stringify({ version: 1, locale: 'ru', volumes: { music: 0.25, effects: 0.75 },
    cleared: [1], active: { level: 2, moves } });
  const backend = {
    getItem: (key: string) => key === SAVE_KEY ? raw : null,
    setItem: (key: string, value: string) => { assert.equal(key, SAVE_KEY); raw = value; },
  };
  const store = new Storage(backend);
  assert.equal(store.endlessRun, null);
  const session = store.startEndless(supplySeed);
  for (const move of supplyPath) assert.ok(session.move(move));
  store.saveEndless(session);
  let restored = new Storage(backend);
  assert.deepEqual(restored.endlessRun?.snapshot(), session.snapshot());
  assert.equal(restored.endlessBest, 200);
  assert.ok(restored.endlessRun?.undo());
  restored.saveEndless(restored.endlessRun);
  assert.equal(new Storage(backend).endlessBest, 100);
  restored.startEndless(42);

  const corrupt = JSON.parse(raw);
  corrupt.endless.position.board[0].front[0] = 'unknown';
  raw = JSON.stringify(corrupt);
  restored = new Storage(backend);
  assert.equal(restored.endlessRun, null);
  assert.equal(restored.endlessBest, 100);
  assert.equal(restored.locale, 'ru');
  assert.deepEqual(restored.volumes, { music: 0.25, effects: 0.75 });
  assert.deepEqual(restored.open(2)?.moves, moves);
  assert.equal(restored.isCleared(1), true);
  assert.equal(restored.isUnlocked(3), false);
});

test('a PR #14 save preserves full stock, random state and Undo history while rebuilding its delivery clock', () => {
  const oldSession = EndlessSession.start(supplySeed);
  for (const move of supplyPath.slice(0, 3)) oldSession.move(move);
  const before = oldSession.snapshot();
  const stripClock = ({ board, matches, randomState, lastSupply }: typeof before.position) =>
    ({ board, matches, randomState, lastSupply });
  // Legacy stock and RNG output for seed 3, after its second match in PR #14.
  const settled = moveGood(before.position.board, supplyPath[3])!;
  const oldBoard = settled.board.map((shelf, index) => ({
    ...shelf, stock: index === 1 ? [['cookie', 'candle', 'cookie']] as const
      : index === 3 ? [['cookie', 'candle', 'candle']] as const : shelf.stock,
  }));
  const oldPosition = { board: oldBoard, matches: 2, lastSupply: 2, randomState: 2079754304 };
  const raw = JSON.stringify({
    version: 2, endlessRecord: 1900, locale: 'en', volumes: { music: 0.3, effects: 0.7 },
    endless: { seed: supplySeed, position: oldPosition, history: [...before.history, before.position].map(stripClock) },
  });
  const store = new Storage({ getItem: () => raw, setItem: () => {} });
  const restored = store.endlessRun!;
  assert.deepEqual(restored.snapshot().position, { ...oldPosition, moves: 4, lastSupplyMove: 4 });
  assert.equal(store.endlessBest, 1900);
  assert.equal(restored.score, 200);
  assert.equal(restored.undo(), true);
  assert.deepEqual(restored.snapshot().position, before.position);
});

test('long sessions keep at most eight undo snapshots and reject invalid generator, board and history data', () => {
  const session = EndlessSession.start(lossSeed);
  for (const move of lossPath.slice(0, -1)) session.move(move);
  const saved = session.snapshot();
  assert.equal(saved.history.length, 8);
  for (const invalid of [
    { ...saved, seed: -1 },
    { ...saved, position: { ...saved.position, randomState: Infinity } },
    { ...saved, position: { ...saved.position, lastSupply: 1 } },
    { ...saved, position: { ...saved.position, board: [] } },
    { ...saved, position: { ...saved.position, moves: -1 } },
    { ...saved, position: { ...saved.position, lastSupplyMove: saved.position.moves + 1 } },
    { ...saved, position: { ...saved.position, board: saved.position.board.map((shelf, i) =>
      i === 0 ? { ...shelf, stock: [EMPTY_ROW] } : shelf) } },
    { ...saved, history: [...saved.history, saved.position] },
  ]) assert.equal(EndlessSession.restore(invalid), null);
  for (let i = 0; i < 8; i++) assert.ok(session.undo());
  assert.equal(session.undo(), false);
});
