import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_ROW, goodsLeft, moveGood, type Board } from '../../src/game/Board.ts';
import { EndlessSession, hasLegalMove } from '../../src/game/EndlessSession.ts';
import { dealEndless } from '../../src/game/EndlessStock.ts';
import { LEVELS } from '../../src/game/Levels.ts';
import { solve } from '../../src/game/Solver.ts';
import { SAVE_KEY, Storage } from '../../src/platform/Storage.ts';
import { lossPath, lossSeed, supplyPath, supplySeed } from '../support/endless-fixtures.ts';
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
  assert.ok(sample.planned.supplies > 100);
  assert.ok(sample.planned.supplies > sample.planned.redeals);
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

test('a deferred delivery leaves the settled board intact and retries on a later match', () => {
  const session = EndlessSession.start(0);
  const plan = solve(session.board, 3_500, 3);
  assert.equal(plan.status, 'solved');
  for (const move of plan.moves.slice(0, 4)) assert.ok(session.move(move));
  const previous = session.snapshot();
  const move = plan.moves[4];
  const settled = moveGood(session.board, move)!;
  const deferred = session.move(move)!;
  assert.deepEqual(deferred.supplied, []);
  assert.deepEqual(deferred.board, settled.board);
  assert.equal(session.snapshot().position.lastSupply, previous.position.lastSupply);
  assert.notEqual(session.snapshot().position.randomState, previous.position.randomState);
  assert.equal(session.lost, false);
  assert.ok(session.move(plan.moves[5]));
  assert.equal(session.move(plan.moves[6])?.supplied.length, 2);
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
    { ...saved, history: [...saved.history, saved.position] },
  ]) assert.equal(EndlessSession.restore(invalid), null);
  for (let i = 0; i < 8; i++) assert.ok(session.undo());
  assert.equal(session.undo(), false);
});
