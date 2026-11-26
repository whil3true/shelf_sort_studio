import Phaser from 'phaser';
import { EMPTY_ROW, GOODS, goodAt, goodsLeft, sameSlot, type Board, type BoardEvent, type Good, type Move, type Slot } from '../game/Board.ts';
import { LEVELS, levelById } from '../game/Levels.ts';
import type { Session } from '../game/Session.ts';
import type { SearchResult } from '../game/Solver.ts';
import type { AudioEffect } from '../audio/AudioAssetManifest.ts';
import type { Storage, Locale } from '../platform/Storage.ts';
import { ART_REFRESH, artPaths, type ArtId } from './ArtAssets';
import { CHAPTERS, word, type TextKey } from './Locale';
import { CONTROL_ICONS, StudioView, mutedInk, type Icon } from './StudioView';
import { configureCamera } from './viewport';

export interface StudioHost {
  ready(): void;
  playing(active: boolean): void;
  audio(event: AudioEffect): void;
  volumesChanged(): void;
  readonly rewardedAvailable: boolean;
  interstitial(): Promise<void>;
  reward(): Promise<boolean>;
}

type Screen = 'menu' | 'levels' | 'game' | 'victory';
type Modal = 'settings' | 'help' | 'restart' | 'replace' | 'hint';
interface Gesture {
  id: number; x: number; y: number; origin: Slot | null; dragging: boolean;
}
interface ReturningItem {
  origin: Slot;
  x: number;
  y: number;
  size: number;
}
interface BoardMotion {
  readonly events: ReadonlyMap<number, BoardEvent>;
  readonly render: ((progress: number) => void)[];
  progress: number;
}

const rearSize = 54;
const rearOffset = { x: 5, y: -25 };
const dragSize = 73;
const dragLift = 11;
const sliderAccent = 0x9a533b;

export class StudioScene extends Phaser.Scene {
  private view!: StudioView;
  private screen: Screen = 'menu';
  private modal: Modal | null = null;
  private chapter = 0;
  private level = 1;
  private session: Session | null = null;
  private selected: Slot | null = null;
  private gesture: Gesture | null = null;
  private returning: ReturningItem | null = null;
  private ghost: Phaser.GameObjects.Image | null = null;
  private readonly revealDepth = new Map<Good, number>();
  private hover: Slot | null = null;
  private hint: Move | null = null;
  private blocked = false;
  private animation = false;
  private beforeAnimation: Board | null = null;
  private motion: BoardMotion | null = null;
  private notice: TextKey | null = null;
  private pendingLevel = 0;
  private busy = false;
  private locale: Locale;
  private readonly store: Storage;
  private readonly host: StudioHost;

  constructor(store: Storage, locale: Locale, host: StudioHost) {
    super('studio');
    this.store = store;
    this.locale = locale;
    this.host = host;
  }

  preload() {
    const paths = artPaths();
    for (const { id } of ART_REFRESH) this.load.image(id, `./${paths[id]}`);
    for (const id of CONTROL_ICONS) {
      this.load.image(`control-${id}`, `./assets/art/control-${id}.png`);
    }
  }

  create() {
    this.prepareStockTextures();
    this.view = new StudioView(this, () => this.host.audio('ui_click'));
    configureCamera(this, () => {
      this.view.resizeBackdrop();
      this.cancelGesture();
    });
    this.input.on('pointerdown', this.pointerDown, this);
    this.input.on('pointermove', this.pointerMove, this);
    this.input.on('pointerup', this.pointerUp, this);
    this.input.on('pointerupoutside', this.cancelGesture, this);
    this.input.on('gameout', this.cancelGesture, this);
    const cancel = () => this.cancelGesture();
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('touchcancel', cancel, true);
    this.events.once('shutdown', () => {
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('touchcancel', cancel, true);
    });
    this.applyLocale();
    this.draw();
    // The first frame contains all textures, strings and input zones.
    this.game.events.once(Phaser.Core.Events.POST_RENDER, () => this.host.ready());
  }

  private prepareStockTextures() {
    for (const good of GOODS) this.shadeStock(`stock-${good}`, good, 1);
  }

  private shadeStock(key: string, good: Good, depth: number) {
    const { width, height } = this.textures.getFrame(good);
    const canvas = (this.textures.exists(key) ? this.textures.get(key) :
      this.textures.createCanvas(key, width, height)) as Phaser.Textures.CanvasTexture;
    const ctx = canvas.getContext();
    ctx.clearRect(0, 0, width, height);
    canvas.drawFrame(good, undefined, 0, 0, false);

    // Shade the sprite's own pixels so opacity stays constant through the reveal.
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = depth * 0.53;
    ctx.fillStyle = '#634137';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    canvas.refresh();
  }

  private refreshed(id: ArtId) {
    return artPaths()[id].endsWith('.webp');
  }

  private frontSize(good: Good) {
    return this.refreshed(good) ? 69 : 63;
  }

  setBlocked(blocked: boolean) {
    this.blocked = blocked;
    if (!this.view) return;
    if (blocked) {
      this.gesture = null;
      this.returning = null;
      this.selected = null;
      this.hover = null;
    }
    this.draw();
  }

  private tr(key: TextKey): string { return word(this.locale, key); }

  private applyLocale() {
    document.documentElement.lang = this.locale;
    document.title = `${this.tr('titleTop')} ${this.tr('titleBottom')}`;
  }

  private go(screen: Screen) {
    this.screen = screen;
    this.selected = null;
    this.gesture = null;
    this.returning = null;
    this.hover = null;
    this.hint = null;
    this.notice = null;
    this.modal = null;
    this.draw();
  }

  private overlay(modal: Modal | null) {
    this.modal = modal;
    this.selected = null;
    this.gesture = null;
    this.returning = null;
    this.hover = null;
    this.hint = null;
    this.notice = null;
    this.draw();
  }

  private syncScreenLabel = () => {
    const label = { menu: this.tr('play'), levels: this.tr('chapters'), game: this.tr('level'), victory: this.tr('won') }[this.screen];
    this.game.canvas.setAttribute('aria-label', this.modal ? this.modalLabel(this.modal) : label);
  };

  private draw() {
    this.view.clear();
    if (this.motion) this.motion.render.length = 0;
    this.ghost = null;
    // Phaser registers the new input zones during PRE_UPDATE, before exposing the screen.
    this.events.off(Phaser.Scenes.Events.PRE_UPDATE, this.syncScreenLabel);
    this.events.once(Phaser.Scenes.Events.PRE_UPDATE, this.syncScreenLabel);
    this.host.playing(this.screen === 'game' && !this.modal && !this.busy && !this.session?.won);
    if (this.screen === 'menu') this.drawMenu();
    else if (this.screen === 'levels') this.drawLevels();
    else if (this.screen === 'game') this.drawGame();
    else this.drawVictory();
    if (this.busy) {
      this.view.backdrop(0.6);
      this.view.surface('panel', 240, 400, 345, 120);
      this.view.label(this.tr(this.busyNotice), 240, 395, 22, { weight: 800, wrap: 310 });
    } else if (this.modal) {
      this.drawOverlay(this.modal);
    }
    if (this.blocked) {
      this.view.hit(240, 400, 480, 800, false);
    }
  }

  private get busyNotice(): TextKey {
    return this.modal === 'hint' ? 'checking' : 'loadingAd';
  }

  private drawMenu() {
    const view = this.view;
    const logo = `wordmark-${this.locale}` as const;
    const refreshed = this.refreshed(logo);
    view.image(logo, 240, 134, refreshed ? 352 : 400, refreshed ? 144 : 142);
    view.label(this.tr('theme'), 240, 220, 18, { color: mutedInk, weight: 600 });
    view.image('shop', 240, 376, 372, 230);
    view.button(240, 553, 382, 67, this.tr('play'), () => {
      this.chapter = Math.floor(((this.store.currentLevel ?? this.store.nextLevel ?? 18) - 1) / 6);
      this.go('levels');
    }, { kind: 'honey', size: 27 });
    const active = this.store.currentLevel;
    view.button(240, 621, 382, 61, active === null ? this.tr('resume') : `${this.tr('resume')} · ${this.tr('level')} ${active}`,
      () => { if (active !== null) this.open(active); }, { live: active !== null });
    view.button(142, 703, 180, 59, this.tr('settings'), () => this.overlay('settings'), { icon: 'settings', size: 20 });
    view.button(338, 703, 180, 59, this.tr('help'), () => this.overlay('help'), { icon: 'help', size: 20 });
  }

  private header(title: string, back: () => void, settings = false) {
    this.view.button(47, 54, 61, 56, '', back, { icon: 'back', live: !this.animation });
    this.view.label(title, 240, 52, 29, { weight: 800, wrap: 315 });
    if (settings) this.view.button(433, 54, 61, 56, '', () => this.overlay('settings'), { icon: 'settings', live: !this.animation });
  }

  private drawLevels() {
    const view = this.view;
    this.header(this.tr('chapters'), () => this.go('menu'));
    view.surface('panel', 240, 410, 430, 616);
    for (let index = 0; index < CHAPTERS.length; index++) {
      view.button(101 + index * 139, 148, 132, 54, `${this.tr('chapter')} ${index + 1}`,
        () => { this.chapter = index; this.draw(); }, { kind: this.chapter === index ? 'honey' : 'paper', size: 18 });
    }
    const levels = LEVELS.filter(item => item.chapter === this.chapter);
    const cleared = levels.filter(item => this.store.isCleared(item.id)).length;
    view.label(this.tr(CHAPTERS[this.chapter]), 240, 221, 32, { weight: 800, wrap: 380 });
    view.label(`${cleared}/6 ${this.tr('completed')}`, 240, 262, 17, { color: mutedInk, weight: 600 });
    for (const [index, item] of levels.entries()) {
      const x = 142 + index % 2 * 196;
      const y = 356 + Math.floor(index / 2) * 136;
      const live = this.store.isUnlocked(item.id);
      const done = this.store.isCleared(item.id);
      const description = done ? this.tr('cleared') : live ? this.tr('level') : this.tr('locked');
      view.button(x, y, 168, 108, String(item.id).padStart(2, '0'), () => this.tryOpen(item.id), {
        kind: done ? 'completed' : 'paper', size: 36, live, icon: done ? 'check' : live ? undefined : 'lock',
        caption: description,
      });
    }
  }

  private tryOpen(id: number) {
    if (this.store.currentLevel !== null && this.store.currentLevel !== id) {
      this.pendingLevel = id;
      this.overlay('replace');
    } else this.open(id);
  }

  private open(id: number) {
    const session = this.store.open(id);
    if (!session) return;
    this.session = session;
    this.level = id;
    this.chapter = levelById(id)!.chapter;
    this.go('game');
  }

  private drawGame() {
    const view = this.view;
    const board = this.beforeAnimation ?? this.session!.board;
    const dragged = this.gesture?.dragging ? this.gesture.origin : null;
    const lifted = dragged ?? this.returning?.origin;
    const moving = dragged ?? this.selected;
    this.header(`${this.tr('level')} ${String(this.level).padStart(2, '0')}`, () => this.go('levels'), true);
    view.label(this.tr(CHAPTERS[this.chapter]), 240, 93, 17, { color: mutedInk, weight: 600 });
    const intro: TextKey = this.level === 1 ? 'intro' : this.level <= 3 ? 'pair' : this.level <= 6 ? 'hidden' : 'goal';
    view.surface('notice', 240, 147, 427, 58);
    view.label(this.tr(intro), 240, 147, 18, { wrap: 397 });
    for (const [index, shelf] of board.entries()) {
      const { x, y } = this.shelfPosition(index, board.length);
      view.image('shelf', x, y, 216, 136);
      const event = this.motion?.events.get(index);
      const revealing = event?.type === 'reveal';
      const rear = shelf.stock[revealing ? 1 : 0];
      rear?.forEach((good, slot) => {
        if (!good) return;
        const at = this.slotPosition({ shelf: index, slot }, board.length);
        const item = view.image(`stock-${good}`, at.x + rearOffset.x, at.y + rearOffset.y, rearSize, rearSize);
        if (revealing) this.trackMotion(progress => item.setAlpha(progress));
      });

      if (event?.type === 'match') {
        const glow = view.box(x, y + 22, 184, 31, 0xf5d284, 0.44, 11);
        this.trackMotion(progress => glow.setAlpha(1 - progress));
      }
      shelf.front.forEach((good, indexInShelf) => {
        const slot = { shelf: index, slot: indexInShelf };
        const at = this.slotPosition(slot, board.length);
        const picked = !!moving && sameSlot(moving, slot);
        const valid = !!moving && good === null;
        const targeted = !picked && this.hover && sameSlot(this.hover, slot);
        const advised = this.hint && (sameSlot(this.hint.from, slot) || sameSlot(this.hint.to, slot));
        if ((picked && !dragged) || advised || targeted || valid) {
          const invalid = targeted && !valid;
          const fill = invalid ? 0xc57965 : picked || advised ? 0xffdda0 : 0xeeb99b;
          const stroke = invalid ? 0xfbd3c4 : picked || advised ? 0xfce4a8 : 0xffe0c2;
          view.box(at.x, at.y + 3, 59, 60, fill, picked || advised || targeted ? 0.79 : 0.59, 10, stroke);
        }
        const front = revealing ? shelf.stock[0][indexInShelf] : lifted && sameSlot(lifted, slot) ? null : good;
        if (!front) {
          view.box(at.x, at.y + 23, 21, 3, 0x684936, 0.33, 2);
          return;
        }
        const frontSize = this.frontSize(front);
        const item = view.image(front, at.x, at.y, frontSize, frontSize);
        if (revealing) {
          const key = `reveal-${front}`;
          this.trackMotion(progress => {
            const depth = 1 - progress;
            const size = frontSize + (rearSize - frontSize) * depth;
            const x = at.x + rearOffset.x * depth;
            const y = at.y + rearOffset.y * depth;
            if (this.revealDepth.get(front) !== depth) {
              this.shadeStock(key, front, depth);
              this.revealDepth.set(front, depth);
            }
            item.setTexture(key).setPosition(x, y).setDisplaySize(size, size);
          });
        } else if (event?.type === 'match') {
          this.trackMotion(progress => item.setY(at.y - 20 * progress).setAlpha(1 - progress));
        }
      });
    }
    if (lifted) {
      const good = goodAt(board, lifted);
      const x = this.returning?.x ?? this.gesture!.x;
      const y = this.returning?.y ?? this.gesture!.y - dragLift;
      const size = this.returning?.size ?? dragSize;
      if (good) this.ghost = view.image(good, x, y, size, size);
    }

    const deadlocked = !board.some(shelf => shelf.front.includes(null)) && goodsLeft(board) > 0;
    if (this.notice || deadlocked) view.label(this.tr(this.notice ?? 'noSpace'), 240, 674, 17, { wrap: 424, color: '#853f31' });
    const controls: [TextKey, Icon, () => void, boolean][] = [
      ['undo', 'undo', () => this.undo(), this.session!.canUndo],
      ['restart', 'restart', () => this.overlay('restart'), true],
      ['hint', 'hint', () => this.overlay('hint'), this.host.rewardedAvailable],
    ];
    controls.forEach(([text, icon, action, live], i) => view.button(91 + i * 149, 739, 139, 59,
      this.tr(text), () => { if (!this.animation) action(); }, { icon, size: 17, live: live && !this.animation }));
  }

  private trackMotion(render: (progress: number) => void) {
    const motion = this.motion!;
    motion.render.push(render);
    render(motion.progress);
  }

  private shelfPosition(index: number, count: number) {
    const rows = Math.ceil(count / 2);
    const row = Math.floor(index / 2);
    return { x: count % 2 === 1 && index === count - 1 ? 240 : index % 2 ? 351 : 129,
      y: 407 + (row - (rows - 1) / 2) * 147 };
  }

  private slotPosition(slot: Slot, count: number) {
    const { x, y } = this.shelfPosition(slot.shelf, count);
    return { x: x + (slot.slot - 1) * 63, y: y + 6 };
  }

  private slotAt(x: number, y: number): Slot | null {
    const board = this.session?.board;
    if (!board) return null;
    for (let shelf = 0; shelf < board.length; shelf++) {
      for (let slot = 0; slot < 3; slot++) {
        const at = this.slotPosition({ shelf, slot }, board.length);
        if (Math.abs(x - at.x) <= 31.5 && Math.abs(y - at.y) <= 34) return { shelf, slot };
      }
    }
    return null;
  }

  private coords(pointer: Phaser.Input.Pointer) {
    return this.cameras.main.getWorldPoint(pointer.x, pointer.y);
  }

  private get acceptsBoardInput() {
    return this.screen === 'game' && !this.modal && !this.blocked && !this.animation && !this.busy;
  }

  private pointerDown(pointer: Phaser.Input.Pointer) {
    if (!this.acceptsBoardInput || this.gesture || (pointer.button !== 0 && !pointer.wasTouch)) return;
    const { x, y } = this.coords(pointer);
    const slot = this.slotAt(x, y);
    if (!slot) return;
    const origin = goodAt(this.session!.board, slot) ? slot : null;
    this.gesture = { id: pointer.id, x, y, origin, dragging: false };
    if (this.returning) {
      this.returning = null;
      this.draw();
    }
    if (origin) this.host.audio('item_pickup');
  }

  private pointerMove(pointer: Phaser.Input.Pointer) {
    const gesture = this.gesture;
    if (!gesture || gesture.id !== pointer.id || !gesture.origin || !this.acceptsBoardInput) return;
    const { x, y } = this.coords(pointer);
    if (!gesture.dragging && Math.hypot(x - gesture.x, y - gesture.y) < 8) return;
    const hover = this.slotAt(x, y);
    const changed = !gesture.dragging || (hover && (!this.hover || !sameSlot(hover, this.hover))) || (!hover && !!this.hover);
    gesture.dragging = true;
    gesture.x = x;
    gesture.y = y;
    if (changed) {
      this.hover = hover;
      this.draw();
    }
    this.ghost?.setPosition(x, y - dragLift);
  }

  private pointerUp(pointer: Phaser.Input.Pointer) {
    const gesture = this.gesture;
    if (!gesture || gesture.id !== pointer.id) return;
    this.gesture = null;
    this.hover = null;
    if (!this.acceptsBoardInput) return;
    const { x, y } = this.coords(pointer);
    const to = this.slotAt(x, y);
    if (gesture.dragging && gesture.origin) {
      this.selected = null;
      if (to && this.commitMove({ from: gesture.origin, to })) return;
      this.host.audio('item_invalid');
      this.returnItem(gesture.origin, x, y);
      return;
    }
    if (!to) {
      this.selected = null;
    } else if (goodAt(this.session!.board, to)) {
      this.selected = this.selected && sameSlot(this.selected, to) ? null : to;
    } else if (this.selected && this.commitMove({ from: this.selected, to })) return;
    this.draw();
  }

  private cancelGesture() {
    if (!this.gesture && !this.returning) return;
    this.gesture = null;
    this.returning = null;
    this.hover = null;
    this.selected = null;
    this.draw();
  }

  private returnItem(origin: Slot, x: number, y: number) {
    const board = this.session!.board;
    const good = goodAt(board, origin);
    if (!good) return;
    const { x: endX, y: endY } = this.slotPosition(origin, board.length);
    const startY = y - dragLift;
    const endSize = this.frontSize(good);
    const returning: ReturningItem = { origin, x, y: startY, size: dragSize };
    this.returning = returning;
    this.draw();
    this.tweens.addCounter({
      from: 0, to: 1, duration: 145, ease: 'Cubic.Out',
      onUpdate: tween => {
        if (this.returning !== returning) return;
        const progress = tween.getValue() ?? 0;
        returning.x = Phaser.Math.Linear(x, endX, progress);
        returning.y = Phaser.Math.Linear(startY, endY, progress);
        returning.size = Phaser.Math.Linear(dragSize, endSize, progress);
        this.ghost?.setPosition(returning.x, returning.y).setDisplaySize(returning.size, returning.size);
      },
      onComplete: () => {
        if (this.returning !== returning) return;
        this.returning = null;
        this.draw();
      },
    });
  }

  private commitMove(move: Move): boolean {
    const session = this.session!;
    const previous = session.board;
    const result = session.move(move);
    if (!result) return false;

    this.selected = null;
    this.hint = null;
    this.notice = null;
    this.store.saveRun(this.level, session);
    this.host.audio('item_place');
    if (!result.events.length) {
      this.draw();
      return true;
    }

    this.animation = true;
    const landed = goodAt(previous, move.from)!;
    this.beforeAnimation = previous.map((shelf, index) => {
      if (move.from.shelf !== index && move.to.shelf !== index) return shelf;
      const front: [...typeof shelf.front] = [...shelf.front];
      if (move.from.shelf === index) front[move.from.slot] = null;
      if (move.to.shelf === index) front[move.to.slot] = landed;
      return { ...shelf, front };
    });
    this.animateBoard(result.events);
    return true;
  }

  private animateBoard(remaining: readonly BoardEvent[]) {
    if (!remaining.length) {
      this.beforeAnimation = null;
      this.motion = null;
      this.animation = false;
      if (this.session!.won) void this.completeLevel();
      else this.draw();
      return;
    }

    // Each shelf can reveal and match repeatedly during a single move.
    const next = new Map<number, BoardEvent>();
    for (const event of remaining) {
      if (!next.has(event.shelf)) next.set(event.shelf, event);
    }
    const matches = [...next.values()].filter(event => event.type === 'match');
    const events = matches.length ? new Map(matches.map(event => [event.shelf, event])) : next;
    const motion: BoardMotion = { events, progress: 0, render: [] };
    this.motion = motion;
    this.draw();

    if (matches.length) {
      for (const _event of matches) this.host.audio('match_three');
    } else {
      this.host.audio('shelf_reveal');
    }

    this.tweens.addCounter({
      from: 0, to: 1, duration: matches.length ? 155 : 210,
      ease: matches.length ? 'Cubic.In' : 'Sine.InOut',
      onUpdate: tween => {
        motion.progress = tween.getValue() ?? 0;
        motion.render.forEach(render => render(motion.progress));
      },
      onComplete: () => {
        this.beforeAnimation = this.beforeAnimation!.map((shelf, index) => {
          const event = events.get(index);
          if (!event) return shelf;
          if (event.type === 'match') return { ...shelf, front: EMPTY_ROW };
          const [front, ...stock] = shelf.stock;
          return { front, stock };
        });
        this.animateBoard(remaining.filter(event => events.get(event.shelf) !== event));
      },
    });
  }

  private undo() {
    if (!this.session?.undo()) return;
    this.store.saveRun(this.level, this.session);
    this.returning = null;
    this.selected = null;
    this.hint = null;
    this.notice = null;
    this.draw();
  }

  private async completeLevel() {
    this.host.audio('level_complete');
    this.go('victory');
    await this.host.interstitial();
  }

  private drawVictory() {
    const next = this.level < 18 ? this.level + 1 : null;
    this.view.surface('panel', 240, 402, 424, 634);
    this.view.image('victory', 240, 277, 228, 222);
    this.view.label(this.tr(next ? 'won' : 'wonAll'), 240, 421, 39, { weight: 800, wrap: 388 });
    this.view.label(this.tr(next ? 'wonText' : 'wonAllText'), 240, 478, 21, { color: mutedInk });
    if (next) this.view.button(240, 564, 359, 64, this.tr('next'), () => this.open(next), { kind: 'honey', icon: 'arrow' });
    this.view.button(240, 634, 359, 60, this.tr('levelSelect'), () => this.go('levels'), { icon: 'back' });
  }

  private modalLabel(modal: Modal): string {
    const labels: Record<Modal, TextKey> = { settings: 'settings', help: 'help',
      restart: 'restartTitle', replace: 'replaceTitle', hint: 'hintTitle' };
    return this.tr(labels[modal]);
  }

  private drawOverlay(modal: Modal) {
    const view = this.view;
    view.backdrop(0.49);
    if (modal === 'settings') {
      view.surface('panel', 240, 400, 430, 462);
      view.label(this.tr('settings'), 240, 219, 35, { weight: 800 });
      view.label(this.tr('language'), 69, 276, 18, { align: 'left', weight: 600 });
      for (const [index, locale] of (['ru', 'en'] as const).entries()) {
        view.button(146 + index * 188, 325, 169, 54, locale === 'ru' ? 'Русский' : 'English', () => {
          this.locale = locale;
          this.store.setLocale(locale);
          this.applyLocale();
          this.draw();
        }, { kind: this.locale === locale ? 'honey' : 'paper', size: 20 });
      }
      this.slider('music', 402);
      this.slider('effects', 486);
      view.button(240, 566, 340, 59, this.tr('close'), () => this.overlay(null), { kind: 'honey' });
      return;
    }
    if (modal === 'help') {
      view.surface('panel', 240, 402, 431, 560);
      view.label(this.tr('help'), 240, 181, 36, { weight: 800 });
      const examples = ['pear', 'jam', 'tea', 'honey'] as const;
      for (const [index, name] of examples.entries()) {
        view.image(name, 81, 261 + index * 85, 49, 49);
        view.label(this.tr((`help${index + 1}`) as TextKey), 112, 259 + index * 85, 20, { align: 'left', wrap: 299 });
      }
      view.button(240, 614, 341, 61, this.tr('close'), () => this.overlay(null), { kind: 'honey' });
      return;
    }
    view.surface('panel', 240, 400, 430, 284);
    view.label(this.modalLabel(modal), 240, 319, 29, { weight: 800 });
    const details = { restart: 'restartText', replace: 'replaceText', hint: 'hintText' } as const;
    view.label(this.tr(details[modal]), 240, 389, 20, { wrap: 340 });
    view.button(146, 474, 169, 57, this.tr('cancel'), () => this.overlay(null), { size: 18 });
    view.button(333, 474, 169, 57, this.tr(modal === 'hint' ? 'watch' : modal === 'restart' ? 'restart' : 'play'),
      () => {
        if (modal === 'replace') this.open(this.pendingLevel);
        if (modal === 'hint') void this.requestHint();
        if (modal === 'restart') {
          this.session!.restart();
          this.store.saveRun(this.level, this.session!);
          this.overlay(null);
        }
      }, { kind: modal === 'hint' ? 'honey' : 'clay', size: 18 });
  }

  private slider(channel: 'music' | 'effects', y: number) {
    const view = this.view;
    const left = 76;
    const width = 325;
    view.label(this.tr(channel), left, y - 20, 18, { align: 'left', weight: 600 });
    const value = this.store.volumes[channel];
    const number = view.label(`${Math.round(value * 100)}%`, 373, y - 20, 17, { color: mutedInk });
    view.box(left + width / 2, y + 12, width, 8, 0xe1c6a7, 1, 4);
    const fill = view.box(left, y + 12, width, 8, sliderAccent, 1, 4);
    const thumb = view.box(left + value * width, y + 12, 22, 22, sliderAccent, 1, 11, 0xfff2db);
    const render = (updated: number) => {
      const pixels = updated * width;
      fill.setScale(Math.max(0.001, updated), 1).setX(left + pixels / 2);
      thumb.setX(left + pixels);
      number.setText(`${Math.round(updated * 100)}%`);
    };
    render(value);
    const hit = view.hit(left + width / 2, y + 8, width + 22, 52);
    this.input.setDraggable(hit);
    const change = (pointer: Phaser.Input.Pointer) => {
      if (this.blocked) return;
      const updated = Phaser.Math.Clamp((this.coords(pointer).x - left) / width, 0, 1);
      this.store.setVolume(channel, updated);
      this.host.volumesChanged();
      render(updated);
    };
    hit.on('pointerdown', change);
    hit.on('drag', change);
  }

  private async requestHint() {
    if (!this.session || this.busy || this.blocked) return;
    const session = this.session;
    this.busy = true;
    this.draw();
    const result = await findHint(session.board, this.level, session.moves);
    if (result.status !== 'solved' || !result.moves.length || this.blocked) {
      this.busy = false;
      this.modal = null;
      this.notice = result.status === 'unsolvable' ? 'noHint' : 'hintLimit';
      this.draw();
      return;
    }
    this.modal = null;
    this.draw();
    const rewarded = await this.host.reward();
    this.busy = false;
    if (rewarded) this.hint = result.moves[0];
    else this.notice = 'noAd';
    this.draw();
  }
}

function findHint(board: Board, level: number, moves: readonly Move[]): Promise<SearchResult> {
  const solution = levelById(level)!.solution;
  if (moves.length < solution.length && moves.every((move, index) =>
    sameSlot(move.from, solution[index].from) && sameSlot(move.to, solution[index].to))) {
    return Promise.resolve({ status: 'solved', moves: solution.slice(moves.length), visited: 0 });
  }
  return new Promise(resolve => {
    let worker: Worker;
    try { worker = new Worker(new URL('../game/hint.worker.ts', import.meta.url), { type: 'module' }); }
    catch { resolve({ status: 'limit', visited: 0 }); return; }
    const finish = (result: SearchResult) => {
      window.clearTimeout(timer);
      worker.terminate();
      resolve(result);
    };
    const timer = window.setTimeout(() => finish({ status: 'limit', visited: 0 }), 2200);
    worker.onmessage = (event: MessageEvent<SearchResult>) => finish(event.data);
    worker.onerror = () => finish({ status: 'limit', visited: 0 });
    worker.postMessage(board);
  });
}
