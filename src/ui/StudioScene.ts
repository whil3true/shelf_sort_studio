import Phaser from 'phaser';
import { GOODS, goodAt, goodsLeft, sameSlot, type Board, type Good, type Move, type Slot } from '../game/Board.ts';
import { LEVELS, levelById } from '../game/Levels.ts';
import type { Session } from '../game/Session.ts';
import type { SearchResult } from '../game/Solver.ts';
import type { AudioEffect } from '../audio/AudioAssetManifest.ts';
import type { Storage, Locale } from '../platform/Storage.ts';
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
const art = [...GOODS, 'shelf', 'shop', 'victory', 'wordmark-ru', 'wordmark-en',
  ...CONTROL_ICONS.map(name => `control-${name}`)];

export class StudioScene extends Phaser.Scene {
  private view!: StudioView;
  private screen: Screen = 'menu';
  private modal: Modal | null = null;
  private chapter = 0;
  private level = 1;
  private session: Session | null = null;
  private selected: Slot | null = null;
  private gesture: Gesture | null = null;
  private ghost: Phaser.GameObjects.Image | null = null;
  private hover: Slot | null = null;
  private hint: Move | null = null;
  private blocked = false;
  private animation = false;
  private beforeAnimation: Board | null = null;
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
    for (const name of art) this.load.image(name, `./assets/art/${name}.png`);
  }

  create() {
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

  setBlocked(blocked: boolean) {
    this.blocked = blocked;
    if (!this.view) return;
    if (blocked) {
      this.gesture = null;
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
    this.hover = null;
    this.hint = null;
    this.notice = null;
    this.modal = null;
    this.draw();
  }

  private overlay(modal: Modal | null) {
    this.modal = modal;
    this.selected = null;
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
      this.view.label(this.tr(this.busyNotice), 240, 395, 22, { bold: true, wrap: 310 });
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
    view.image(`wordmark-${this.locale}`, 240, 134, 400, 142);
    view.label(this.tr('theme'), 240, 220, 19, { color: mutedInk });
    view.image('shop', 240, 376, 416, 257);
    view.button(240, 553, 382, 67, this.tr('play'), () => {
      this.chapter = Math.floor(((this.store.currentLevel ?? this.store.nextLevel ?? 18) - 1) / 6);
      this.go('levels');
    }, { kind: 'sage', size: 27 });
    const active = this.store.currentLevel;
    view.button(240, 621, 382, 61, active === null ? this.tr('resume') : `${this.tr('resume')} · ${this.tr('level')} ${active}`,
      () => { if (active !== null) this.open(active); }, { live: active !== null });
    view.button(142, 703, 180, 59, this.tr('settings'), () => this.overlay('settings'), { icon: 'settings', size: 20 });
    view.button(338, 703, 180, 59, this.tr('help'), () => this.overlay('help'), { icon: 'help', size: 20 });
  }

  private header(title: string, back: () => void, settings = false) {
    this.view.button(47, 54, 61, 56, '', back, { icon: 'back', live: !this.animation });
    this.view.label(title, 240, 52, 31, { serif: true, bold: true, wrap: 315 });
    if (settings) this.view.button(433, 54, 61, 56, '', () => this.overlay('settings'), { icon: 'settings', live: !this.animation });
  }

  private drawLevels() {
    const view = this.view;
    this.header(this.tr('chapters'), () => this.go('menu'));
    view.surface('panel', 240, 410, 430, 616);
    for (let index = 0; index < CHAPTERS.length; index++) {
      view.button(101 + index * 139, 148, 132, 54, `${this.tr('chapter')} ${index + 1}`,
        () => { this.chapter = index; this.draw(); }, { kind: this.chapter === index ? 'sage' : 'paper', size: 18 });
    }
    const levels = LEVELS.filter(item => item.chapter === this.chapter);
    const cleared = levels.filter(item => this.store.isCleared(item.id)).length;
    view.label(this.tr(CHAPTERS[this.chapter]), 240, 221, 30, { serif: true, bold: true });
    view.label(`${cleared}/6 ${this.tr('completed')}`, 240, 262, 19, { color: mutedInk });
    for (const [index, item] of levels.entries()) {
      const x = 142 + index % 2 * 196;
      const y = 356 + Math.floor(index / 2) * 136;
      const live = this.store.isUnlocked(item.id);
      const done = this.store.isCleared(item.id);
      const description = done ? this.tr('cleared') : live ? this.tr('level') : this.tr('locked');
      view.button(x, y, 168, 108, String(item.id).padStart(2, '0'), () => this.tryOpen(item.id), {
        kind: live && !done ? 'sage' : 'paper', size: 33, live, icon: done ? 'check' : live ? undefined : 'lock',
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
    this.header(`${this.tr('level')} ${String(this.level).padStart(2, '0')}`, () => this.go('levels'), true);
    view.label(this.tr(CHAPTERS[this.chapter]), 240, 93, 18, { color: mutedInk });
    const intro: TextKey = this.level === 1 ? 'intro' : this.level <= 3 ? 'pair' : this.level <= 6 ? 'hidden' : 'goal';
    view.surface('notice', 240, 147, 427, 58);
    view.label(this.tr(intro), 240, 147, 18, { wrap: 397 });
    for (const [index, shelf] of board.entries()) {
      const { x, y } = this.shelfPosition(index, board.length);
      view.image('shelf', x, y, 216, 136);
      if (shelf.stock.length) {
        view.box(x + 58, y - 43, 73, 23, 0x63432f, 0.76, 6);
        view.label(`${this.tr('stock')} ${shelf.stock.length}`, x + 58, y - 43, 13, { color: '#fff2cf', bold: true });
      }
      shelf.front.forEach((good, indexInShelf) => {
        const slot = { shelf: index, slot: indexInShelf };
        const at = this.slotPosition(slot, board.length);
        const moving = (this.gesture?.dragging && this.gesture.origin) || this.selected;
        const picked = !!moving && sameSlot(moving, slot);
        const valid = !!moving && good === null;
        const targeted = this.hover && sameSlot(this.hover, slot);
        const advised = this.hint && (sameSlot(this.hint.from, slot) || sameSlot(this.hint.to, slot));
        const fill = targeted && !valid ? 0xc87561 : picked || advised ? 0xffe2a0 : valid ? 0xc5d3a1 : 0x7b5136;
        const stroke = targeted && !valid ? 0xfbd3c4 : picked || advised ? 0xfce4a8 : valid ? 0xf4f7cb : 0x7b5033;
        view.box(at.x, at.y + 3, 59, 60, fill, picked || advised || targeted ? 0.79 : valid ? 0.59 : 0.16, 10, stroke);
        if (good) view.image(good, at.x, at.y, 63, 63).setAlpha(picked && this.gesture?.dragging ? 0.24 : 1);
        else view.box(at.x, at.y + 23, 21, 3, 0x684936, 0.33, 2);
      });
    }
    if (this.gesture?.dragging && this.gesture.origin) {
      const good = goodAt(board, this.gesture.origin);
      if (good) this.ghost = view.image(good, this.gesture.x, this.gesture.y - 11, 73, 73).setAlpha(0.93);
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
    this.ghost?.setPosition(x, y - 11);
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
    if (!this.gesture) return;
    this.gesture = null;
    this.hover = null;
    this.selected = null;
    this.draw();
  }

  private returnItem(origin: Slot, x: number, y: number) {
    this.draw();
    const board = this.session!.board;
    const good = goodAt(board, origin);
    if (!good) return;
    const at = this.slotPosition(origin, board.length);
    const item = this.view.image(good, x, y - 11, 68, 68);
    this.tweens.add({ targets: item, x: at.x, y: at.y, duration: 145, ease: 'Cubic.Out',
      onComplete: () => { if (item.active) item.destroy(); } });
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
    const landed = goodAt(previous, move.from) as Good;
    const matched = new Set(result.events.filter(event => event.type === 'match').map(event => event.shelf));
    const frontRows = previous.map((shelf, index) => {
      const front = [...shelf.front];
      if (move.from.shelf === index) front[move.from.slot] = null;
      if (move.to.shelf === index) front[move.to.slot] = landed;
      if (matched.has(index)) front.fill(null);
      return { ...shelf, front: front as [Good | null, Good | null, Good | null] };
    });
    this.beforeAnimation = frontRows;
    this.draw();
    for (const event of result.events) {
      if (event.type !== 'match') continue;
      this.host.audio('match_three');
      const at = this.slotPosition({ shelf: event.shelf, slot: 1 }, previous.length);
      const flash = this.view.box(at.x, at.y, 193, 73, 0xf5d284, 0.68, 12, 0xffefbc);
      this.tweens.add({ targets: flash, alpha: 0, scaleX: 1.04, scaleY: 0.9, duration: 210, ease: 'Cubic.Out' });
      for (let i = 0; i < 3; i++) {
        const item = this.view.image(event.good, at.x + (i - 1) * 63, at.y, 66, 66);
        this.tweens.add({ targets: item, y: at.y - 23, alpha: 0.05, duration: 220, ease: 'Cubic.In' });
      }
    }
    this.time.delayedCall(225, () => {
      this.beforeAnimation = null;
      if (result.events.some(event => event.type === 'reveal')) this.host.audio('shelf_reveal');
      this.draw();
      const reveals = [...new Set(result.events.filter(event => event.type === 'reveal').map(event => event.shelf))];
      for (const shelf of reveals) {
        const at = this.slotPosition({ shelf, slot: 1 }, previous.length);
        const glow = this.view.box(at.x, at.y, 196, 70, 0xffdf9f, 0.42, 11);
        this.tweens.add({ targets: glow, y: at.y + 8, alpha: 0, duration: 145,
          onComplete: () => { if (glow.active) glow.destroy(); } });
      }
      this.time.delayedCall(reveals.length ? 148 : 0, () => {
        this.animation = false;
        if (session.won) void this.completeLevel();
        else this.draw();
      });
    });
    return true;
  }

  private undo() {
    if (!this.session?.undo()) return;
    this.store.saveRun(this.level, this.session);
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
    this.view.label(this.tr(next ? 'won' : 'wonAll'), 240, 421, 39, { serif: true, bold: true, wrap: 388 });
    this.view.label(this.tr(next ? 'wonText' : 'wonAllText'), 240, 478, 21, { color: mutedInk });
    if (next) this.view.button(240, 564, 359, 64, this.tr('next'), () => this.open(next), { kind: 'sage', icon: 'arrow' });
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
      view.label(this.tr('settings'), 240, 219, 35, { bold: true, serif: true });
      view.label(this.tr('language'), 69, 276, 20, { align: 'left', bold: true });
      for (const [index, locale] of (['ru', 'en'] as const).entries()) {
        view.button(146 + index * 188, 325, 169, 54, locale === 'ru' ? 'Русский' : 'English', () => {
          this.locale = locale;
          this.store.setLocale(locale);
          this.applyLocale();
          this.draw();
        }, { kind: this.locale === locale ? 'sage' : 'paper', size: 20 });
      }
      this.slider('music', 402);
      this.slider('effects', 486);
      view.button(240, 566, 340, 59, this.tr('close'), () => this.overlay(null), { kind: 'sage' });
      return;
    }
    if (modal === 'help') {
      view.surface('panel', 240, 402, 431, 560);
      view.label(this.tr('help'), 240, 181, 36, { bold: true, serif: true });
      const examples = ['pear', 'jam', 'tea', 'honey'] as const;
      for (const [index, name] of examples.entries()) {
        view.image(name, 81, 261 + index * 85, 49, 49);
        view.label(this.tr((`help${index + 1}`) as TextKey), 112, 259 + index * 85, 20, { align: 'left', wrap: 299 });
      }
      view.button(240, 614, 341, 61, this.tr('close'), () => this.overlay(null), { kind: 'sage' });
      return;
    }
    view.surface('panel', 240, 400, 430, 284);
    view.label(this.modalLabel(modal), 240, 319, 29, { bold: true, serif: true });
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
      }, { kind: modal === 'hint' ? 'sage' : 'clay', size: 18 });
  }

  private slider(channel: 'music' | 'effects', y: number) {
    const view = this.view;
    const left = 76;
    const width = 325;
    view.label(this.tr(channel), left, y - 20, 20, { align: 'left', bold: true });
    const value = this.store.volumes[channel];
    const number = view.label(`${Math.round(value * 100)}%`, 373, y - 20, 17, { color: mutedInk });
    view.box(left + width / 2, y + 12, width, 8, 0xdac5a6, 1, 4);
    const fill = view.box(left, y + 12, width, 8, 0x6f7d5c, 1, 4);
    const thumb = view.box(left + value * width, y + 12, 22, 22, 0x6f7d5c, 1, 11, 0xfff2db);
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
