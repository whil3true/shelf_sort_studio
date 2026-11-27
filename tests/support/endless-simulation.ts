import assert from 'node:assert/strict';
import { goodsLeft, moveGood, type Board, type Move } from '../../src/game/Board.ts';
import { EndlessSession, hasLegalMove, type EndlessMove } from '../../src/game/EndlessSession.ts';
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

function deliveryStats() {
  return { queries: 0, deliveries: 0, withoutMatch: 0, small: 0, full: 0, limits: 0, unsolvable: 0, legacyRejected: 0 };
}

function recordDelivery(
  stats: ReturnType<typeof deliveryStats>, result: EndlessMove, settled: Board, rngAdvanced: boolean,
) {
  if (result.supplied.length) {
    stats.deliveries++;
    const added = goodsLeft(result.board) - goodsLeft(settled);
    assert.ok(added === 3 || added === 6);
    if (added === 3) stats.small++;
    else stats.full++;
    if (!result.events.some(event => event.type === 'match')) stats.withoutMatch++;
  }
  if (result.stockCheck || (rngAdvanced && !result.redealt)) stats.queries++;
  if (result.stockCheck === 'limit') stats.limits++;
  if (result.stockCheck === 'unsolvable') stats.unsolvable++;
  if (!result.stockCheck && rngAdvanced && !result.redealt && !result.supplied.length) stats.legacyRejected++;
}

function population(board: Board) {
  const fronts = board.map(shelf => shelf.front.filter(Boolean).length);
  const filled = fronts.reduce((sum, count) => sum + count, 0);
  const vacant = board.length * 3 - filled;
  return { vacant, legalMoves: filled * vacant, goods: goodsLeft(board) };
}

export function simulateEndless(firstSeed: number, seedCount: number, moveLimit: number) {
  const starts = new Set<string>();
  const duration: number[] = [];
  const phases = Array.from({ length: 3 }, () => ({ turns: 0, types: 0, vacant: 0, stock: 0, goods: 0, legalMoves: 0 }));
  const deliveries = deliveryStats();
  const searchDuration: number[] = [];
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
      const randomState = session.snapshot().position.randomState;
      const time = performance.now();
      const result = session.move(move);
      const moveMs = performance.now() - time;
      duration.push(moveMs);
      assert.ok(result && !session.lost, label);

      const rngAdvanced = session.snapshot().position.randomState !== randomState;
      recordDelivery(deliveries, result, settled.board, rngAdvanced);
      if (result.stockCheck || (rngAdvanced && !result.redealt)) searchDuration.push(moveMs);
      const supply = result.supplied;
      if (supply.length) {
        assert.equal(supply.length, 2, label);
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
      const { vacant, legalMoves, goods } = population(session.board);
      phase.vacant += vacant;
      phase.legalMoves += legalMoves;
      phase.goods += goods;
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
    const lossByTurn = { first30: 0, first60: 0 };
    const deliveries = deliveryStats();
    let totalGoods = 0;
    let totalLegalMoves = 0;
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
        const move = options[Math.floor(random * options.length / 2 ** 32)];
        const settled = moveGood(session.board, move)!;
        const randomState = session.snapshot().position.randomState;
        const result = session.move(move);
        assert.ok(result);
        turns++;
        recordDelivery(deliveries, result, settled.board, session.snapshot().position.randomState !== randomState);
        const { goods, legalMoves } = population(session.board);
        totalGoods += goods;
        totalLegalMoves += legalMoves;
        if (session.lost) {
          assert.ok(goodsLeft(session.board) > 0 && !hasLegalMove(session.board));
          losses++;
          losingTurns += turn;
          if (turn <= 30) lossByTurn.first30++;
          if (turn <= 60) lossByTurn.first60++;
          lossTiers[endlessTier(session.matches)]++;
          if (result.events.some(event => event.type === 'reveal')) lostAfterReveal++;
          break;
        }
      }
      matches += session.matches;
    }
    return { losses, lossTiers, lossByTurn, lostAfterReveal, averageMoves: turns / seedCount,
      averageMovesToLoss: losses ? losingTurns / losses : null, averageTriples: matches / seedCount,
      averageGoods: totalGoods / turns, averageLegalMoves: totalLegalMoves / turns, deliveries };
  }

  const random = imperfect(false);
  const immediateMatch = imperfect(true);
  function runtime(samples: number[]) {
    samples.sort((a, b) => a - b);
    return { p95: samples[Math.floor(samples.length * 0.95)], p99: samples[Math.floor(samples.length * 0.99)],
      max: samples.at(-1) };
  }
  return {
    seedCount, distinctStarts: starts.size, moveLimit,
    planned: { moves: duration.length, redeals, averageTriples: triples / seedCount, deliveries },
    phases: phases.map(({ turns, types, vacant, stock, goods, legalMoves }) => ({
      turns, averageTypes: turns ? types / turns : null, averageVacant: turns ? vacant / turns : null,
      averageGoods: turns ? goods / turns : null,
      averageLegalMoves: turns ? legalMoves / turns : null,
      averageStockRows: turns ? stock / turns : null,
    })),
    random, immediateMatch,
    runtimeMoveMs: runtime(duration),
    runtimeSearchTurnMs: runtime(searchDuration),
    elapsedSeconds: (performance.now() - started) / 1_000,
  };
}
