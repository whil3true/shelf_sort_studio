import assert from 'node:assert/strict';
import test from 'node:test';
import { goodsLeft, type Board } from '../../src/game/Board.ts';
import { LEVELS } from '../../src/game/Levels.ts';
import { Session } from '../../src/game/Session.ts';
import { solve } from '../../src/game/Solver.ts';

test('three chapters of six levels use all fourteen goods and expand in stock depth', () => {
  assert.equal(LEVELS.length, 18);
  for (const chapter of [0, 1, 2]) assert.equal(LEVELS.filter(level => level.chapter === chapter).length, 6);
  const goods = new Set(LEVELS.flatMap(level => level.board.flatMap(shelf => [shelf.front, ...shelf.stock].flat())).filter(Boolean));
  assert.equal(goods.size, 14);
  assert.ok(LEVELS.slice(0, 3).every(level => level.board.every(shelf => !shelf.stock.length)));
  assert.ok(LEVELS[17].board.some(shelf => shelf.stock.length === 2));
});

for (const level of LEVELS) {
  test(`level ${level.id} wins by replaying its stored solution through the game session`, () => {
    const session = new Session(level.board);
    assert.equal(session.won, false);
    assert.equal(goodsLeft(session.board) % 3, 0);
    for (const [index, move] of level.solution.entries()) {
      assert.equal(session.won, false);
      assert.ok(session.move(move), `move ${index + 1}`);
    }
    assert.equal(session.won, true);
    assert.ok(session.undo());
    assert.equal(session.won, false);
  });
}

test('solver returns a winning continuation from an off-route state', () => {
  const session = new Session(LEVELS[5].board);
  const shelf = session.board.findIndex(row => row.front.some(Boolean) && row.front.includes(null));
  assert.ok(shelf >= 0);
  const front = session.board[shelf].front;
  const alternate = { from: { shelf, slot: front.findIndex(Boolean) }, to: { shelf, slot: front.indexOf(null) } };
  assert.notDeepEqual(alternate, LEVELS[5].solution[0]);
  assert.ok(session.move(alternate));
  const state = solve(session.board);
  assert.equal(state.status, 'solved');
  if (state.status === 'solved') for (const step of state.moves) assert.ok(session.move(step));
  assert.ok(session.won);
});

test('solver distinguishes a deadlock from its search budget', () => {
  const deadlock: Board = [
    { front: ['jam', 'jam', 'tea'], stock: [] },
    { front: ['tea', 'tea', 'jam'], stock: [] },
  ];
  assert.equal(solve(deadlock).status, 'unsolvable');
  assert.equal(solve(LEVELS[0].board, 0).status, 'limit');
});
