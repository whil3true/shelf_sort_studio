# Endless Mode

Six shelves use the campaign's move, match and reveal rules. Each triple scores 100 points. Once all automatic effects have settled, a board with goods and no vacant front slot ends the run. Restarting starts a fresh seed and keeps the best score. The displayed best is the greater of the current score and the record from previous runs. Undo can take back points from the current run.

## Stock generation

Each of the three difficulty tiers has verified base layouts. The seed selects a layout and permutes its goods, shelves and slots. The regression suite checks the layouts using the same move rules. These layouts serve as the opening board and the fallback if the run clears every item.

During the run, a delivery adds two mixed stock rows behind existing front rows. A delivery adds complete groups of three across the two shelves. Only occupied shelves without stock are eligible, with recently cleared shelves used as a fallback. The generator tries one candidate after an eligible match and uses the existing solver for up to 36 expanded states. It commits the delivery only when the solver finds a complete path from the new board. An unsuccessful or budget-limited search defers stock until a later eligible match. A player can still use up the available space by choosing a poor move.

| Triples cleared | Goods palette | Total goods cap | Stock row cap | Minimum triples between deliveries |
| --- | ---: | ---: | ---: | ---: |
| 0–5 | 6 | 21 | 3 | 2 |
| 6–17 | 8 | 24 | 4 | 1 |
| 18 and above | 11 | 27 | 4 | 1 |

Each shelf holds at most one stock row in this mode. The campaign solver uses the same search and tie-breaking with canonical shelf keys cached within each search.

## Saving and rewarded Undo

Save schema 2 reads the campaign fields from schema 1, and stores the Endless run independently. Each successful move writes the settled board, triple count, seed, random state, delivery progress and up to eight prior positions together. The defeat screen can be resumed from the menu after a reload. An invalid Endless run is discarded independently of campaign progress, settings and the previous record.

The campaign and Endless Mode share the same SDK and audio lifecycle. Endless Undo uses the SDK reward and close callbacks after an explicit confirmation. Cancel, an unearned close, no-fill and SDK errors preserve the position. A rewarded Undo restores one complete position, including the preceding delivery and random state. No interstitials are scheduled by the Endless run.

## Reproducing QA

- `npm run verify` checks the types, unit tests, production build and assets.
- `npm run test:e2e` tests the production build in Chromium, Firefox and WebKit.
- `npm run test:endless` checks 1,000 seeds with 150 moves for each of three policies. The planned policy replays a verified path to clearance after each delivery. The other policies choose random moves or preferentially take an immediate match. Arguments override seed count, move cap and the first seed, in that order.
- `npm run test:endless -- 1 5000 3` exercises an extended run.
- `npm run release:zip` validates and packages the production build.

### Physical Android and Yandex draft

1. Start Endless Mode in Chrome, drag a product and move another by tapping. Check RU and EN at both a narrow and a tall viewport.
2. Form several triples and watch stock appear behind occupied shelves. Empty a stocked shelf and confirm the rear row moves forward and its sound plays once.
3. Minimize Chrome during a run, resume, then reload and continue with the same board and score. Check music resumes and the Android media card releases while minimized.
4. In the Yandex draft, cancel Undo, then close a rewarded video early. Check the board and score. Complete a video and confirm one rollback, including from defeat. Start a fresh run and check the record and campaign progress.
