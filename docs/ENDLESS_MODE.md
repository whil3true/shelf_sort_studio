# Endless Mode

Six shelves use the campaign's move, match and reveal rules. Each triple scores 100 points. Once all automatic effects have settled, a board with goods and no vacant front slot ends the run. Restarting starts a fresh seed and keeps the best score. The displayed best is the greater of the current score and the record from previous runs. Undo can take back points from the current run.

## Stock generation

Each of the three difficulty tiers has verified base layouts. The seed selects a layout and permutes its goods, shelves and slots. The regression suite checks the layouts using the same move rules. These layouts serve as the opening board and the fallback if the run clears every item.

A delivery becomes due after enough successful moves, including moves that did not make a triple. An eligible match can trigger it sooner. Both triggers share one delivery and one cooldown. A delivery that cannot fit or pass verification stays due for the next successful move, even if the original trigger was a match and the move interval has yet to elapse. Only a delivery or a redeal resets the counters. Invalid moves and product selection leave the clock alone.

| Triples cleared | Goods palette | Total goods cap | Stock row cap | Moves to become due | Match trigger since last delivery |
| --- | ---: | ---: | ---: | ---: | --- |
| 0–5 | 6 | 24 | 4 | 6 | 2 triples and 2 moves |
| 6–17 | 8 | 27 | 4 | 3 | 1 triple |
| 18 and above | 11 | 30 | 5 | 3 | 1 triple |

A small delivery splits one triple across two rear rows, with one and two goods in either order. Empty slots stay in place when the row comes forward. A full delivery splits two triples as `AAB` and `ABB`, with goods shuffled within each row. The chance of proposing the full size first when it fits is 45%, 78% and 90% across the three tiers. A full-size proposal favors shelves with fewer front goods in the middle and late game, where revealing stock can make the remaining space tighter.

Both rows sit behind occupied fronts with no existing stock. Each shelf holds at most one rear row. The first proposal uses the seeded size and placement policy with a 36-state search. If it fails, up to three compact proposals can use other eligible shelf pairs and goods from the seed's palette. The compact search prioritizes clearing the fronts of stocked shelves and assembling pairs with room for their third item. The combined search expands at most 168 states per successful move, with no wall-clock timers or changes to the campaign search order.

Each delivery requires a complete solution under the normal move, match and reveal rules. A search can exhaust its budget for one candidate and still solve another. If nothing is accepted, the outcome is `solver_limit` whenever a search was incomplete, or `unsolvable` if every proposed layout was exhaustively rejected. The player's later choices can still fill the last free front slot. Clearing every item redeals using a verified layout for the current tier and resets the delivery cooldown.

The move result exposes diagnostics for tests and simulations. At most one outcome is counted per move. When multiple space constraints apply, the checks report total goods capacity first, then the stock-row cap, then eligible shelves. Per-candidate search results are counted separately from deliveries and deferrals.

## Saving and rewarded Undo

Save schema 2 reads the campaign fields from schema 1 and stores the Endless run independently. Each successful move saves the settled board, triple count, seed, random state, delivery clock and up to eight prior positions. PR #15 saves open with the same delivery clock and random state. Existing PR #14 runs keep their board, score, random state and Undo history. Since those saves only tracked triples, the move clock is reconstructed from the retained successful moves and visible delivery points in Undo history. An invalid Endless run is discarded independently of campaign progress, settings and the previous record. The defeat screen can be resumed from the menu after a reload.

The campaign and Endless Mode share the same SDK and audio lifecycle. Endless Undo uses the SDK reward and close callbacks after an explicit confirmation. Cancel, an unearned close, no-fill and SDK errors preserve the position. A rewarded Undo restores one complete position, including the preceding delivery and random state. No interstitials are scheduled by the Endless run.

## Reproducing QA

- `npm run verify` checks the types, unit tests, production build and assets.
- `npm run test:e2e` tests the production build in Chromium, Firefox and WebKit.
- `npm run test:endless` checks 1,000 seeds with 150 moves for each of three policies. The planned policy follows a verified path to clearance. The other policies choose random moves or take an immediate match when possible. The simulation independently replays the proof of every accepted layout and reports delivery rates, outcome and candidate counts, drought lengths, board density, defeats and turn cost by policy. Drought lengths count consecutive moves without a delivery, including the final stretch of each run. Arguments override seed count, move cap and the first seed, in that order.
- `npm run test:endless -- 3 5000 0` exercises three extended runs per policy.
- `npm run release:zip` validates and packages the production build.

### Physical Android and Yandex draft

1. Start Endless Mode in Chrome, drag a product and move another by tapping. Check RU and EN at both a narrow and a tall viewport.
2. Make ordinary transfers as well as matches. Look for a delivery after a non-matching move. Check that stock fades in after any board animation and that the empty slots in a 1+2 or 2+1 delivery stay empty. Empty a stocked shelf and confirm the rear goods come forward in place and the reveal cue plays once.
3. Minimize Chrome during a run, resume, then reload and continue with the same board and score. Check music resumes and the Android media card releases while minimized.
4. In the Yandex draft, cancel Undo, then close a rewarded video early. Check the board and score. Complete a video and confirm one rollback, including from defeat. Replay a move that triggered a delivery and check that the same goods land in the same slots. Start a fresh run and check the record and campaign progress.
