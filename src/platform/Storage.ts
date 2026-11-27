import { EndlessSession } from '../game/EndlessSession.ts';
import { levelById, LEVELS, type Level } from '../game/Levels.ts';
import { Session } from '../game/Session.ts';
import type { Move, Slot } from '../game/Board.ts';

export type Locale = 'ru' | 'en';
export interface Volumes { music: number; effects: number }
interface Run { level: number; moves: readonly Move[] }
interface Save {
  version: 2;
  locale: Locale | null;
  volumes: Volumes;
  cleared: number[];
  active: Run | null;
  endless: ReturnType<EndlessSession['snapshot']> | null;
  endlessRecord: number;
}

export const SAVE_KEY = 'shelf-sort-studio';
const fresh = (): Save => ({
  version: 2, endless: null, endlessRecord: 0, locale: null, volumes: { music: 0.65, effects: 0.8 }, cleared: [], active: null,
});

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function volume(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function slot(value: unknown): Slot | null {
  const data = object(value);
  return typeof data?.shelf === 'number' && typeof data.slot === 'number'
    ? { shelf: data.shelf, slot: data.slot } : null;
}

function restore(level: Level, moves: unknown[]): Session | null {
  const session = new Session(level.board);
  for (const value of moves) {
    const step = object(value);
    const from = slot(step?.from);
    const to = slot(step?.to);
    if (!from || !to || !session.move({ from, to })) return null;
  }
  return session.won ? null : session;
}

export class Storage {
  private state: Save = fresh();
  private readonly backend?: Pick<globalThis.Storage, 'getItem' | 'setItem'>;
  private restored: Session | null = null;
  private endless: EndlessSession | null = null;

  constructor(backend?: Pick<globalThis.Storage, 'getItem' | 'setItem'>) {
    this.backend = backend;
    try {
      const raw = backend?.getItem(SAVE_KEY);
      if (!raw) return;
      const data = object(JSON.parse(raw));
      if (data?.version !== 1 && data?.version !== 2) return;
      const levels = Array.isArray(data.cleared) ? new Set(data.cleared) : new Set();
      const unlocked = LEVELS.findIndex(level => !levels.has(level.id));
      this.state.cleared = LEVELS.slice(0, unlocked < 0 ? LEVELS.length : unlocked).map(level => level.id);
      if (data.locale === 'ru' || data.locale === 'en') this.state.locale = data.locale;
      const volumes = object(data.volumes);
      this.state.volumes.music = volume(volumes?.music, this.state.volumes.music);
      this.state.volumes.effects = volume(volumes?.effects, this.state.volumes.effects);
      const active = object(data.active);
      const level = typeof active?.level === 'number' ? levelById(active.level) : undefined;
      if (level && this.isUnlocked(level.id) && Array.isArray(active?.moves)) {
        this.restored = restore(level, active.moves);
        if (this.restored) this.state.active = { level: level.id, moves: this.restored.moves };
      }
      if (data.version === 2) {
        this.endless = EndlessSession.restore(data.endless);
        this.state.endless = this.endless?.snapshot() ?? null;
        const best = data.endlessRecord;
        if (typeof best === 'number' && Number.isSafeInteger(best) && best >= 0) this.state.endlessRecord = best;
        if (this.endless?.lost) this.finishEndless(this.endless);
      }
    } catch {
      // An inaccessible browser store still allows an in-memory session.
    }
  }

  get locale(): Locale | null { return this.state.locale; }
  get volumes(): Readonly<Volumes> { return this.state.volumes; }
  get currentLevel(): number | null { return this.state.active?.level ?? null; }
  get nextLevel(): number | null { return LEVELS[this.state.cleared.length]?.id ?? null; }
  isCleared(id: number): boolean { return this.state.cleared.includes(id); }
  isUnlocked(id: number): boolean { return !!levelById(id) && id <= this.state.cleared.length + 1; }

  open(id: number): Session | null {
    const level = levelById(id);
    if (!level || !this.isUnlocked(id)) return null;
    if (this.state.active?.level === id && this.restored) return this.restored;
    const session = new Session(level.board);
    this.saveRun(id, session);
    return session;
  }

  saveRun(level: number, session: Session): void {
    if (session.won) {
      if (!this.isCleared(level)) this.state.cleared.push(level);
      this.state.active = null;
      this.restored = null;
    } else {
      this.state.active = { level, moves: session.moves };
      this.restored = session;
    }
    this.persist();
  }

  get endlessRun(): EndlessSession | null { return this.endless; }

  get endlessBest(): number {
    return Math.max(this.state.endlessRecord, this.endless?.score ?? 0);
  }

  startEndless(seed = crypto.getRandomValues(new Uint32Array(1))[0]): EndlessSession {
    this.state.endlessRecord = this.endlessBest;
    const session = EndlessSession.start(seed);
    this.endless = session;
    this.saveEndless(session);
    return session;
  }

  saveEndless(session: EndlessSession): void {
    if (session !== this.endless) return;
    this.state.endless = session.snapshot();
    this.persist();
  }

  finishEndless(session: EndlessSession): void {
    if (session !== this.endless || !session.lost) return;
    this.state.endlessRecord = this.endlessBest;
    this.endless = null;
    this.state.endless = null;
    this.persist();
  }

  setLocale(locale: Locale): void {
    this.state.locale = locale;
    this.persist();
  }

  setVolume(channel: keyof Volumes, value: number): void {
    this.state.volumes[channel] = volume(value, this.state.volumes[channel]);
    this.persist();
  }

  private persist(): void {
    try { this.backend?.setItem(SAVE_KEY, JSON.stringify(this.state)); } catch { /* Continue in memory. */ }
  }
}

export function openStorage(): Storage {
  try { return new Storage(window.localStorage); } catch { return new Storage(); }
}

export function selectLocale(saved: Locale | null, sdk?: string, browser?: string): Locale {
  const normalized = (sdk ?? browser ?? 'en').toLowerCase().split(/[-_]/)[0];
  return saved ?? (normalized === 'ru' ? 'ru' : 'en');
}
