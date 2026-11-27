import assert from 'node:assert/strict';
import { goodsLeft, moveGood, type Board, type Move } from '../../src/game/Board.ts';
import { EndlessSession, hasLegalMove, type EndlessMove } from '../../src/game/EndlessSession.ts';
import { endlessTier, MAX_ENDLESS_GOODS, MAX_ENDLESS_STOCK } from '../../src/game/EndlessStock.ts';
import { solve } from '../../src/game/Solver.ts';

function certifiedPath(board: Board, label: string): readonly Move[] {
  const result = solve(board, 3_500, 3);
  assert.equal(result.status, 'solved', label);
  return result.moves;
}

function replayProof(board: Board, moves: readonly Move[], label: string) {
  for (const move of moves) {
    const next = moveGood(board, move);
    assert.ok(next, label);
    board = next.board;
  }
  assert.equal(goodsLeft(board), 0, label);
}

function crossShelfMoves(board: Board): Move[] {
  const empty = board.flatMap((shelf, index) => shelf.front.flatMap((good, slot) => good ? [] : [{ shelf: index, slot }]));
  return board.flatMap((shelf, index) => shelf.front.flatMap((good, slot) =>
    good ? empty.filter(to => to.shelf !== index).map(to => ({ from: { shelf: index, slot }, to })) : []));
}

function population(board: Board) {
  const filled = board.reduce((sum, shelf) => sum + shelf.front.filter(Boolean).length, 0);
  const vacant = board.length * 3 - filled;
  return { vacant, legalMoves: filled * vacant, goods: goodsLeft(board) };
}

function metrics(samples: number[]) {
  samples.sort((a, b) => a - b);
  return {
    p95: samples.length ? samples[Math.floor(samples.length * 0.95)] : null,
    p99: samples.length ? samples[Math.floor(samples.length * 0.99)] : null,
    max: samples.at(-1) ?? null,
  };
}

function verifyDelivery(result: EndlessMove, settled: Board, label: string) {
  const { board, supplied, stockProof } = result;
  assert.equal(supplied.length, 2, label);
  assert.equal(new Set(supplied).size, 2, label);
  let front = 0;
  const added = new Map<string, number>();
  for (const [index, shelf] of board.entries()) {
    if (!supplied.includes(index)) {
      assert.deepEqual(shelf, settled[index], label);
      continue;
    }
    assert.equal(settled[index].stock.length, 0, label);
    const wasEmpty = settled[index].front.every(good => good === null);
    const suppliedRow = wasEmpty ? shelf.front : shelf.stock[0];
    if (wasEmpty) {
      front++;
      assert.equal(shelf.stock.length, 0, label);
    } else {
      assert.equal(shelf.stock.length, 1, label);
      assert.deepEqual(shelf.front, settled[index].front, label);
    }
    const [a, b, c] = suppliedRow;
    assert.ok(suppliedRow.some(Boolean) && !(a && a === b && a === c), label);
    for (const good of suppliedRow) {
      if (good) added.set(good, (added.get(good) ?? 0) + 1);
    }
  }
  assert.ok([...added.values()].every(count => count % 3 === 0), label);
  assert.ok(stockProof, label);
  replayProof(board, stockProof, label);
  return front === 2 ? 'front' : front === 1 ? 'mixed' : 'rear';
}

// Compare both versions using the same geometric and tier-capacity criteria.
function potentialCapacity(board: Board, matches: number) {
  const tier = endlessTier(matches);
  const goodsCap = [24, 27, MAX_ENDLESS_GOODS][tier];
  const rearCap = tier === 2 ? MAX_ENDLESS_STOCK : 4;
  const rearRows = board.filter(shelf => shelf.stock.length).length;
  const empty = board.filter(shelf => !shelf.stock.length && !shelf.front.some(Boolean)).length;
  const rear = board.length - rearRows - empty;
  return goodsLeft(board) + 3 <= goodsCap
    && empty + Math.min(rear, Math.max(0, rearCap - rearRows)) >= 2;
}

export function simulateEndless(firstSeed: number, seedCount: number, moveLimit: number) {
  const starts = new Set<string>();
  const phases = Array.from({ length: 3 }, () => ({ turns: 0, types: 0, vacant: 0, stock: 0, goods: 0, legalMoves: 0 }));
  const started = performance.now();

  function run(policy: 'planned' | 'random' | 'immediateMatch') {
    const outcomes: Record<EndlessMove['stock']['status'], number> = {
      not_due: 0, no_capacity: 0, no_eligible_shelves: 0, stock_cap: 0,
      solver_limit: 0, unsolvable: 0, supplied: 0, redealt: 0, no_moves: 0,
    };
    const checks = { solved: 0, limit: 0, unsolvable: 0 };
    const deliveries = { deliveries: 0, withoutMatch: 0, ordinaryTurns: 0, small: 0, full: 0, afterRetry: 0, front: 0, mixed: 0, rear: 0 };
    const duration: number[] = [];
    const searchDuration: number[] = [];
    const visited: number[] = [];
    const gaps: number[] = [];
    const potentialGaps: number[] = [];
    const potentialMisses = { no_capacity: 0, no_eligible_shelves: 0, stock_cap: 0, solver_limit: 0, unsolvable: 0 };
    let potentialTurns = 0;
    let maxSolverStreak = 0;
    let maxMatchlessGap = 0;
    let losses = 0;
    let lostAfterReveal = 0;
    let losingTurns = 0;
    let triples = 0;
    let totalGoods = 0;
    let totalLegalMoves = 0;
    let totalVacant = 0;
    const lossTiers = [0, 0, 0];
    const lossByTurn = { first30: 0, first60: 0 };

    for (let seed = firstSeed; seed < firstSeed + seedCount; seed++) {
      const session = EndlessSession.start(seed);
      if (policy === 'planned') starts.add(JSON.stringify(session.board));
      let plan: readonly Move[] = policy === 'planned' ? certifiedPath(session.board, `initial seed ${seed}`) : [];
      let planIndex = 0;
      let random = seed + 6_122;
      let gap = 0;
      let potentialGap = 0;
      let matchlessGap = 0;
      let solverStreak = 0;
      for (let turn = 1; turn <= moveLimit; turn++) {
        const label = `${policy}, seed ${seed}, turn ${turn}`;
        let move: Move;
        if (policy === 'planned') {
          move = plan[planIndex++];
        } else {
          const choices = crossShelfMoves(session.board);
          const scoring = policy === 'immediateMatch' ? choices.filter(move =>
            moveGood(session.board, move)!.events.some(event => event.type === 'match')) : [];
          const options = scoring.length ? scoring : choices;
          random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
          move = options[Math.floor(random * options.length / 2 ** 32)];
        }
        assert.ok(move, label);
        const settled = moveGood(session.board, move);
        assert.ok(settled, label);
        const time = performance.now();
        const result = session.move(move);
        const moveMs = performance.now() - time;
        assert.ok(result, label);
        duration.push(moveMs);
        const { status, checks: attempted } = result.stock;
        outcomes[status]++;
        const dueWithSpace = status !== 'not_due' && status !== 'redealt' && status !== 'no_moves'
          && potentialCapacity(settled.board, session.matches);
        if (dueWithSpace) potentialTurns++;
        if (dueWithSpace && status in potentialMisses) {
          potentialGap++;
          potentialMisses[status as keyof typeof potentialMisses]++;
        } else if (potentialGap) {
          potentialGaps.push(potentialGap);
          potentialGap = 0;
        }
        if (attempted.length) {
          searchDuration.push(moveMs);
          visited.push(attempted.reduce((sum, check) => sum + check.visited, 0));
          for (const check of attempted) checks[check.status]++;
        }

        const matched = result.events.some(event => event.type === 'match');
        if (!matched) deliveries.ordinaryTurns++;
        if (status === 'solver_limit' || status === 'unsolvable') maxSolverStreak = Math.max(maxSolverStreak, ++solverStreak);
        else solverStreak = 0;
        if (status === 'supplied') {
          deliveries[verifyDelivery(result, settled.board, label)]++;
          deliveries.deliveries++;
          if (!matched) deliveries.withoutMatch++;
          if (attempted.length > 1) deliveries.afterRetry++;
          const added = goodsLeft(result.board) - goodsLeft(settled.board);
          assert.ok(added === 3 || added === 6, label);
          if (added === 3) deliveries.small++;
          else deliveries.full++;
          gaps.push(gap);
          gap = 0;
        } else {
          assert.equal(result.supplied.length, 0, label);
          gap++;
        }
        matchlessGap = matched || status === 'supplied' ? 0 : matchlessGap + 1;
        maxMatchlessGap = Math.max(maxMatchlessGap, matchlessGap);

        if (result.redealt) assert.equal(goodsLeft(settled.board), 0, label);
        if (policy === 'planned') {
          assert.ok(!session.lost, label);
          if (result.supplied.length || result.redealt) {
            // Keep the same playing policy as PR #15. Use the actual proof when this
            // independent search has a different ordering and exhausts its budget.
            const path = solve(session.board, 3_500, 3);
            if (path.status === 'solved') plan = path.moves;
            else {
              assert.ok(result.stockProof, label);
              plan = result.stockProof;
            }
            planIndex = 0;
          }
        }

        const { vacant, legalMoves, goods } = population(session.board);
        const stock = session.board.reduce((sum, shelf) => sum + shelf.stock.length, 0);
        assert.ok(stock <= MAX_ENDLESS_STOCK && goods <= MAX_ENDLESS_GOODS, label);
        totalGoods += goods;
        totalLegalMoves += legalMoves;
        totalVacant += vacant;
        if (policy === 'planned') {
          const phase = phases[endlessTier(session.matches)];
          const distinct = new Set(session.board.flatMap(shelf => [...shelf.front, ...shelf.stock.flat()]).filter(Boolean));
          phase.turns++;
          phase.types += distinct.size;
          phase.vacant += vacant;
          phase.legalMoves += legalMoves;
          phase.goods += goods;
          phase.stock += stock;
        }
        if (session.lost) {
          assert.ok(goods > 0 && !hasLegalMove(session.board), label);
          losses++;
          losingTurns += turn;
          if (turn <= 30) lossByTurn.first30++;
          if (turn <= 60) lossByTurn.first60++;
          lossTiers[endlessTier(session.matches)]++;
          if (result.events.some(event => event.type === 'reveal')) lostAfterReveal++;
          break;
        }
      }
      gaps.push(gap);
      if (potentialGap) potentialGaps.push(potentialGap);
      triples += session.matches;
    }
    const moves = duration.length;
    const due = moves - outcomes.not_due - outcomes.redealt - outcomes.no_moves;
    return {
      moves, due, redeals: outcomes.redealt, outcomes, checks,
      deliveries: { ...deliveries, per100Moves: 100 * deliveries.deliveries / moves,
        per100Due: due ? 100 * deliveries.deliveries / due : null },
      gapsWithoutDelivery: { ...metrics(gaps), atLeast6: gaps.filter(gap => gap >= 6).length,
        atLeast12: gaps.filter(gap => gap >= 12).length, intervals: gaps.length, maxMatchlessGap, maxSolverStreak },
      dueWithPotentialCapacity: { turns: potentialTurns, misses: potentialMisses,
        streaks: potentialGaps.length, atLeast6: potentialGaps.filter(gap => gap >= 6).length, ...metrics(potentialGaps) },
      losses, lostAfterReveal, lossTiers, lossByTurn, averageMoves: moves / seedCount,
      averageMovesToLoss: losses ? losingTurns / losses : null, averageTriples: triples / seedCount,
      averageGoods: totalGoods / moves, averageVacant: totalVacant / moves, averageLegalMoves: totalLegalMoves / moves,
      runtimeMoveMs: metrics(duration), runtimeSearchTurnMs: metrics(searchDuration), expandedPerSearchTurn: metrics(visited),
    };
  }

  const planned = run('planned');
  const random = run('random');
  const immediateMatch = run('immediateMatch');
  return {
    firstSeed, seedCount, distinctStarts: starts.size, moveLimit, planned, random, immediateMatch,
    phases: phases.map(({ turns, types, vacant, stock, goods, legalMoves }) => ({
      turns, averageTypes: turns ? types / turns : null, averageVacant: turns ? vacant / turns : null,
      averageGoods: turns ? goods / turns : null, averageLegalMoves: turns ? legalMoves / turns : null,
      averageStockRows: turns ? stock / turns : null,
    })),
    elapsedSeconds: (performance.now() - started) / 1_000,
  };
}
