import assert from 'node:assert/strict';
import { goodsLeft, moveGood, type Board, type Move } from '../../src/game/Board.ts';
import { EndlessSession, hasLegalMove } from '../../src/game/EndlessSession.ts';
import { endlessTier, MAX_ENDLESS_GOODS, MAX_ENDLESS_STOCK } from '../../src/game/EndlessStock.ts';
import { solve } from '../../src/game/Solver.ts';

function certifiedPath(board: Board, label: string): Move[] {
  const result = solve(board, 3_500, 3);
  assert.equal(result.status, 'solved', label);
  let replay = board;
  for (const move of result.moves) replay = moveGood(replay, move)!.board;
  assert.equal(goodsLeft(replay), 0, label);
  return [...result.moves];
}

function crossShelfMoves(board: Board): Move[] {
  const empty = board.flatMap((shelf, index) => shelf.front.flatMap((good, slot) => good ? [] : [{ shelf: index, slot }]));
  return board.flatMap((shelf, index) => shelf.front.flatMap((good, slot) =>
    good ? empty.filter(to => to.shelf !== index).map(to => ({ from: { shelf: index, slot }, to })) : []));
}

export function simulateEndless(firstSeed: number, seedCount: number, moveLimit: number) {
  const starts = new Set<string>();
  const duration: number[] = [];
  const phases = Array.from({ length: 3 }, () => ({ turns: 0, types: 0, vacant: 0, stock: 0 }));
  let supplies = 0;
  let redeals = 0;
  let triples = 0;
  const started = performance.now();

  for (let seed = firstSeed; seed < firstSeed + seedCount; seed++) {
    const session = EndlessSession.start(seed);
    starts.add(JSON.stringify(session.board));
    let plan = certifiedPath(session.board, `initial seed ${seed}`);
    for (let turn = 0; turn < moveLimit; turn++) {
      const move = plan.shift();
      const label = `seed ${seed}, turn ${turn + 1}`;
      assert.ok(move, label);
      const settled = moveGood(session.board, move);
      assert.ok(settled, label);
      const time = performance.now();
      const result = session.move(move);
      duration.push(performance.now() - time);
      assert.ok(result && !session.lost, label);

      const supply = result.supplied;
      if (supply.length) {
        supplies++;
        assert.equal(supply.length, 2, label);
        assert.equal(goodsLeft(result.board), goodsLeft(settled.board) + 6, label);
        for (const [index, shelf] of result.board.entries()) {
          if (supply.includes(index)) {
            assert.equal(settled.board[index].stock.length, 0, label);
            assert.ok(shelf.front.some(Boolean) && shelf.stock.length === 1, label);
            assert.deepEqual(shelf.front, settled.board[index].front, label);
          } else assert.deepEqual(shelf, settled.board[index], label);
        }
      }
      if (result.redealt) {
        redeals++;
        assert.equal(goodsLeft(settled.board), 0, label);
      }
      if (supply.length || result.redealt) plan = certifiedPath(session.board, label);

      const phase = phases[endlessTier(session.matches)];
      const distinct = new Set(session.board.flatMap(shelf => [...shelf.front, ...shelf.stock.flat()]).filter(Boolean));
      const stock = session.board.reduce((sum, shelf) => sum + shelf.stock.length, 0);
      assert.ok(stock <= MAX_ENDLESS_STOCK && goodsLeft(session.board) <= MAX_ENDLESS_GOODS, label);
      phase.turns++;
      phase.types += distinct.size;
      phase.vacant += session.board.reduce((sum, shelf) => sum + shelf.front.filter(good => !good).length, 0);
      phase.stock += stock;
    }
    triples += session.matches;
  }

  function imperfect(preferImmediateMatches: boolean) {
    let losses = 0;
    let lostAfterReveal = 0;
    let turns = 0;
    let losingTurns = 0;
    let matches = 0;
    const lossTiers = [0, 0, 0];
    for (let seed = firstSeed; seed < firstSeed + seedCount; seed++) {
      const session = EndlessSession.start(seed);
      let random = seed + 6_122;
      for (let turn = 1; turn <= moveLimit; turn++) {
        const choices = crossShelfMoves(session.board);
        const scoring = preferImmediateMatches ? choices.filter(move =>
          moveGood(session.board, move)!.events.some(event => event.type === 'match')) : [];
        const options = scoring.length ? scoring : choices;
        assert.ok(options.length);
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        const result = session.move(options[Math.floor(random * options.length / 2 ** 32)]);
        assert.ok(result);
        turns++;
        if (session.lost) {
          assert.ok(goodsLeft(session.board) > 0 && !hasLegalMove(session.board));
          losses++;
          losingTurns += turn;
          lossTiers[endlessTier(session.matches)]++;
          if (result.events.some(event => event.type === 'reveal')) lostAfterReveal++;
          break;
        }
      }
      matches += session.matches;
    }
    return { losses, lossTiers, lostAfterReveal, averageMoves: turns / seedCount,
      averageMovesToLoss: losses ? losingTurns / losses : null, averageTriples: matches / seedCount };
  }

  const random = imperfect(false);
  const immediateMatch = imperfect(true);
  duration.sort((a, b) => a - b);
  return {
    seedCount, distinctStarts: starts.size, moveLimit,
    planned: { moves: duration.length, supplies, redeals, averageTriples: triples / seedCount },
    phases: phases.map(({ turns, types, vacant, stock }) => ({
      turns, averageTypes: turns ? types / turns : null, averageVacant: turns ? vacant / turns : null,
      averageStockRows: turns ? stock / turns : null,
    })),
    random, immediateMatch,
    runtimeMoveMs: { p95: duration[Math.floor(duration.length * 0.95)],
      p99: duration[Math.floor(duration.length * 0.99)], max: duration.at(-1) },
    elapsedSeconds: (performance.now() - started) / 1_000,
  };
}
