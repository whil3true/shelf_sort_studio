import type { AudioEffect } from '../audio/AudioAssetManifest.ts';
import type { BoardEvent } from '../game/Board.ts';

interface BoardStage {
  readonly events: ReadonlyMap<number, BoardEvent>;
  readonly matching: boolean;
  readonly effect: Extract<AudioEffect, 'match_three' | 'shelf_reveal'> | null;
}

export function* boardAnimationStages(remaining: readonly BoardEvent[]): Generator<BoardStage, void> {
  let revealed = false;
  while (remaining.length) {
    // Keep each shelf's event order and clear matches before starting reveals.
    const next = new Map<number, BoardEvent>();
    for (const event of remaining) {
      if (!next.has(event.shelf)) next.set(event.shelf, event);
    }
    const matches = [...next.values()].filter(event => event.type === 'match');
    const matching = matches.length > 0;
    const events = matching ? new Map(matches.map(event => [event.shelf, event])) : next;
    // The first stock animation cues the move, including any later stock stages.
    const effect = matching ? 'match_three' : revealed ? null : 'shelf_reveal';
    if (!matching) revealed = true;
    yield { events, matching, effect };
    remaining = remaining.filter(event => events.get(event.shelf) !== event);
  }
}
