import assert from 'node:assert/strict';
import test from 'node:test';
import { goodsLeft, isWon, moveGood, type Board, type Move } from '../../src/game/Board.ts';
import { Session } from '../../src/game/Session.ts';
import { boardAnimationStages } from '../../src/ui/BoardAnimation.ts';

const board: Board = [
  { front: ['jam', null, null], stock: [['tea', 'tea', 'tea'], ['jam', null, null]] },
  { front: ['jam', 'jam', null], stock: [] },
  { front: [null, null, null], stock: [] },
];
const first: Move = { from: { shelf: 0, slot: 0 }, to: { shelf: 1, slot: 2 } };

test('occupied, hidden and out-of-range slots are rejected without mutation', () => {
  const snapshot = structuredClone(board);
  assert.equal(moveGood(board, { ...first, to: { shelf: 1, slot: 1 } }), null);
  assert.equal(moveGood(board, { ...first, from: { shelf: 0, slot: 1 } }), null);
  assert.equal(moveGood(board, { ...first, to: { shelf: 0, slot: -1 } }), null);
  assert.deepEqual(board, snapshot);
});

test('a match and both source reveals settle atomically without counting a match twice', () => {
  const result = moveGood(board, first)!;
  assert.deepEqual(result.events, [
    { type: 'match', shelf: 1, good: 'jam' },
    { type: 'reveal', shelf: 0 },
    { type: 'match', shelf: 0, good: 'tea' },
    { type: 'reveal', shelf: 0 },
  ]);
  assert.equal(goodsLeft(result.board), 1);
  assert.equal(isWon(result.board), false);
});

test('consecutive stock stages cue the first reveal of each move and keep both match sounds', () => {
  const { events } = moveGood(board, first)!;
  for (let replay = 0; replay < 2; replay++) {
    const stages = [...boardAnimationStages(events)];
    assert.deepEqual(stages.map(stage => [...stage.events.values()]), events.map(event => [event]));
    assert.deepEqual(stages.map(stage => stage.effect), ['match_three', 'shelf_reveal', 'match_three', null]);
  }
});

test('parallel reveals and parallel matches each play once for the entire stage', () => {
  const bothWithStock: Board = [board[0], { ...board[1], stock: [['apple', 'apple', 'apple']] }, board[2]];
  const { events } = moveGood(bothWithStock, first)!;
  const stages = [...boardAnimationStages(events)];
  assert.deepEqual(stages.map(stage => ({
    shelves: [...stage.events.keys()],
    types: [...stage.events.values()].map(event => event.type),
    effect: stage.effect,
  })), [
    { shelves: [1], types: ['match'], effect: 'match_three' },
    { shelves: [1, 0], types: ['reveal', 'reveal'], effect: 'shelf_reveal' },
    { shelves: [1, 0], types: ['match', 'match'], effect: 'match_three' },
    { shelves: [0], types: ['reveal'], effect: null },
  ]);
});

test('a move within one shelf uses the source and destination of the same front', () => {
  const result = moveGood(board, { ...first, to: { shelf: 0, slot: 2 } })!;
  assert.deepEqual(result.board[0], { ...board[0], front: [null, null, 'jam'] });
  assert.deepEqual(result.events, []);
});

test('undo restores exact stock order and restart clears the move history', () => {
  const session = new Session(board);
  session.move(first);
  assert.equal(session.canUndo, true);
  assert.equal(session.undo(), true);
  assert.equal(session.board, board);
  assert.equal(session.undo(), false);
  session.move(first);
  session.restart();
  assert.equal(session.board, board);
  assert.deepEqual(session.moves, []);
});

test('victory requires every shelf and its stock to be empty', () => {
  const final: Board = [{ front: ['jam', null, 'jam'], stock: [] }, { front: ['jam', null, null], stock: [] }];
  assert.equal(isWon(moveGood(final, { from: { shelf: 1, slot: 0 }, to: { shelf: 0, slot: 1 } })!.board), true);
  assert.equal(isWon(board), false);
});
