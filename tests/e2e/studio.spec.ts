import { existsSync } from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { expect, test, type Page } from '@playwright/test';
import { LEVELS } from '../../src/game/Levels.ts';
import type { Move, Slot } from '../../src/game/Board.ts';
import type { AdCallbacks } from '../../src/platform/Platform.ts';
import { ART_REFRESH } from '../../src/ui/ArtAssets.ts';
import audioAssets from '../../src/audio/AudioAssets.json' with { type: 'json' };

const saveKey = 'shelf-sort-studio';
type Snapshot = { locale: string; cleared: number[]; volumes: { music: number; effects: number };
  active: { level: number; moves: Move[] } | null } | null;
type MockSdk = { calls: string[]; events: Record<string, () => void>;
  interstitial: AdCallbacks[]; rewarded: AdCallbacks[]; shift: number };

function canvas(page: Page, screen: string) { return page.locator(`canvas[aria-label="${screen}"]`); }
async function point(page: Page, x: number, y: number) {
  return page.locator('canvas[aria-label]').evaluate((canvas, { x, y }) => {
    const box = canvas.getBoundingClientRect();
    const style = getComputedStyle(document.body);
    const inset = (edge: string) => parseFloat(style.getPropertyValue(`--safe-${edge}`)) || 0;
    const left = inset('left'), right = inset('right'), top = inset('top'), bottom = inset('bottom');
    const width = box.width - left - right, height = box.height - top - bottom;
    const fit = Math.min(width / 480, height / 800);
    return {
      x: box.x + left + width / 2 + (x - 240) * fit,
      y: box.y + top + height / 2 + (y - 400) * fit,
    };
  }, { x, y });
}
async function click(page: Page, x: number, y: number) {
  const at = await point(page, x, y);
  await page.mouse.click(at.x, at.y);
}
async function tap(page: Page, x: number, y: number) {
  const at = await point(page, x, y);
  await page.touchscreen.tap(at.x, at.y);
}
function slotPoint(slot: Slot, count: number) {
  return {
    x: (count % 2 && slot.shelf === count - 1 ? 240 : slot.shelf % 2 ? 351 : 129) + (slot.slot - 1) * 63,
    y: 413 + (Math.floor(slot.shelf / 2) - (Math.ceil(count / 2) - 1) / 2) * 147,
  };
}
async function inputMove(page: Page, move: Move, type: 'click' | 'tap' | 'drag', count = LEVELS[0].board.length) {
  const from = slotPoint(move.from, count);
  const to = slotPoint(move.to, count);
  if (type === 'drag') {
    const origin = await point(page, from.x, from.y);
    const finish = await point(page, to.x, to.y);
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(finish.x, finish.y, { steps: 6 });
    await page.mouse.up();
  } else {
    const act = type === 'tap' ? tap : click;
    await act(page, from.x, from.y);
    await act(page, to.x, to.y);
  }
}

async function titleInk(page: Page, label: string): Promise<number> {
  await expect(canvas(page, label)).toBeVisible();
  const start = await point(page, 40, 70);
  const end = await point(page, 440, 131);
  const image = await loadImage(await page.screenshot({
    clip: { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y },
    scale: 'css',
  }));
  const context = createCanvas(image.width, image.height).getContext('2d');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] < 120 && pixels[i + 1] < 98 && pixels[i + 2] < 89) count++;
  }
  return count;
}

function readSave(page: Page): Promise<Snapshot> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), saveKey);
}

async function enter(page: Page) {
  await expect(canvas(page, 'Play')).toBeVisible();
  await click(page, 240, 553);
  await expect(canvas(page, 'Choose a level')).toBeVisible();
  await click(page, 142, 350);
  await expect(canvas(page, 'Level')).toBeVisible();
}

async function completeFirst(page: Page) {
  for (const [index, move] of LEVELS[0].solution.entries()) {
    // This fixed wait covers both match and stock animations before the next input.
    if (index) await page.waitForTimeout(440);
    await inputMove(page, move, 'click');
  }
  await expect(canvas(page, 'Shelves cleared!')).toBeVisible();
}

async function mocked(page: Page, locale = 'en') {
  await page.addInitScript(lang => {
    const mock: MockSdk = { calls: [], events: {}, interstitial: [], rewarded: [], shift: 0 };
    Object.assign(window, {
      studioMock: mock,
      YaGames: { init: async () => {
        mock.calls.push('init');
        return {
          environment: { i18n: { lang } },
          features: {
            LoadingAPI: { ready: () => mock.calls.push('ready') },
            GameplayAPI: { start: () => mock.calls.push('start'), stop: () => mock.calls.push('stop') },
          },
          on: (event: string, listener: () => void) => { mock.events[event] = listener; },
          adv: {
            showFullscreenAdv: ({ callbacks }: { callbacks: AdCallbacks }) => mock.interstitial.push(callbacks),
            showRewardedVideo: ({ callbacks }: { callbacks: AdCallbacks }) => mock.rewarded.push(callbacks),
          },
        };
      } },
    });
    const clock = performance.now.bind(performance);
    Object.defineProperty(performance, 'now', { value: () => clock() + mock.shift });
  }, locale);
}

function mockValue<T>(page: Page, fn: (mock: MockSdk) => T): Promise<T> {
  return page.evaluate(new Function(`return (${fn.toString()})(window.studioMock)`) as () => T);
}

test('menu, chapter locks, drag, tap, valid save, reload, undo, restart and victory', async ({ page }) => {
  const errors: string[] = [];
  const audioRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.includes('/assets/audio/')) audioRequests.push(request.url());
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(response.url()); });
  await page.goto('./');
  await expect(canvas(page, 'Play')).toBeVisible();
  await click(page, 338, 703);
  await expect(canvas(page, 'How to play')).toBeVisible();
  await click(page, 240, 614);

  await click(page, 240, 553);
  await expect(canvas(page, 'Choose a level')).toBeVisible();
  await click(page, 379, 148);
  await click(page, 142, 350);
  await expect(canvas(page, 'Choose a level')).toBeVisible();
  expect(await readSave(page)).toBeNull();
  await click(page, 101, 148);
  await click(page, 142, 350);
  await expect(canvas(page, 'Level')).toBeVisible();

  const move = LEVELS[0].solution[0];
  const occupied = LEVELS[0].board.flatMap((shelf, i) => shelf.front.flatMap((good, j) =>
    good ? [{ shelf: i, slot: j }] : [])).find(at => at.shelf !== move.from.shelf)!;
  await inputMove(page, { from: move.from, to: occupied }, 'drag');
  expect((await readSave(page))?.active?.moves).toEqual([]);
  await inputMove(page, move, 'drag');
  await expect.poll(async () => (await readSave(page))?.active?.moves).toEqual([move]);
  await page.reload();
  await expect(canvas(page, 'Play')).toBeVisible();
  await click(page, 240, 621);
  await expect(canvas(page, 'Level')).toBeVisible();
  await click(page, 91, 739);
  expect((await readSave(page))?.active?.moves).toEqual([]);
  await inputMove(page, move, 'click');
  await expect.poll(async () => (await readSave(page))?.active?.moves).toEqual([move]);
  await page.waitForTimeout(440);
  await click(page, 240, 739);
  await expect(canvas(page, 'Restart this level?')).toBeVisible();
  await click(page, 333, 474);
  expect((await readSave(page))?.active?.moves).toEqual([]);
  await completeFirst(page);
  expect((await readSave(page))?.cleared).toEqual([1]);
  await click(page, 240, 564);
  await expect(canvas(page, 'Level')).toBeVisible();
  expect((await readSave(page))?.active?.level).toBe(2);
  expect(errors).toEqual([]);
  if (!audioAssets.enabled) expect(audioRequests).toEqual([]);
});

test('production loads one texture per art ID and both local font subsets before the menu', async ({ page }) => {
  const responses = new Map<string, { status: number; mime: string }[]>();
  page.on('response', response => {
    const path = new URL(response.url()).pathname.replace(/^\/shelf_sort_studio\//, '');
    const result = { status: response.status(), mime: response.headers()['content-type'] };
    const history = responses.get(path) ?? [];
    history.push(result);
    responses.set(path, history);
  });
  await page.goto('./');
  await expect(canvas(page, 'Play')).toBeVisible();
  for (const { webp, fallback } of ART_REFRESH) {
    const installed = existsSync(new URL(`../../dist/${webp}`, import.meta.url));
    const expected = installed ? webp : fallback;
    expect(responses.get(expected), expected).toEqual([{ status: 200, mime: installed ? 'image/webp' : 'image/png' }]);
    expect(responses.has(installed ? fallback : webp)).toBe(false);
  }
  for (const alphabet of ['latin', 'cyrillic']) {
    const fonts = [...responses].filter(([path]) => path.startsWith(`assets/nunito-${alphabet}-wght-normal-`));
    expect(fonts.map(([, history]) => history)).toEqual([[{ status: 200, mime: 'font/woff2' }]]);
  }
  const ready = await page.evaluate(() => [...document.fonts]
    .filter(face => face.family.replaceAll('"', '') === 'Studio Nunito' && face.status === 'loaded').length);
  expect(ready).toBe(2);
});

test('drag renders a single item and restores its source after cancel or invalid drop', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 });
  await page.goto('./');
  await enter(page);

  const move = LEVELS[0].solution[0];
  const origin = slotPoint(move.from, 3);
  const target = slotPoint(move.to, 3);
  const heldAt = { x: 240, y: 235 };
  const occupied = slotPoint({ shelf: 1, slot: 2 }, 3);
  const sample = (at: { x: number; y: number }) => page.screenshot({
    clip: { x: Math.round(at.x) - 12, y: Math.round(at.y) - 12, width: 24, height: 24 }, scale: 'css',
  });
  const sourceBefore = await sample(origin);
  const targetBefore = await sample(target);
  const ghostCenter = { x: heldAt.x, y: heldAt.y - 11 };
  const ghostBefore = await sample(ghostCenter);
  const lift = async () => {
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(heldAt.x, heldAt.y);
  };

  await lift();
  await expect.poll(async () => (await sample(ghostCenter)).equals(ghostBefore)).toBe(false);
  const sourceDuringDrag = await sample(origin);
  expect(sourceDuringDrag.equals(sourceBefore)).toBe(false);
  await page.locator('canvas').dispatchEvent('pointercancel', { bubbles: true });
  await page.mouse.up();
  await expect.poll(async () => (await sample(origin)).equals(sourceBefore)).toBe(true);
  expect((await sample(ghostCenter)).equals(ghostBefore)).toBe(true);
  expect((await readSave(page))?.active?.moves).toEqual([]);

  await lift();
  await page.mouse.move(occupied.x, occupied.y);
  await page.mouse.up();
  await expect.poll(async () => (await sample(origin)).equals(sourceBefore)).toBe(true);
  expect((await readSave(page))?.active?.moves).toEqual([]);

  await lift();
  await page.mouse.move(target.x, target.y);
  await page.mouse.up();
  await expect.poll(async () => (await readSave(page))?.active?.moves).toEqual([move]);
  // The lifted slot must look exactly like the empty slot after a successful placement.
  await expect.poll(async () => (await sample(origin)).equals(sourceDuringDrag)).toBe(true);
  expect((await sample(target)).equals(targetBefore)).toBe(false);
});

test('stock sits behind the front slots, advances on reveal and restores with Undo and Reload', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 });
  const { board, solution: [first, reveal, next] } = LEVELS[9];
  // Start level 10, with two stock rows and an empty middle slot on the top-left shelf.
  await page.addInitScript(key => {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, JSON.stringify({
      version: 1, locale: 'en', cleared: Array.from({ length: 9 }, (_, i) => i + 1),
      active: { level: 10, moves: [] },
    }));
  }, saveKey);
  await page.goto('./');
  await expect(canvas(page, 'Play')).toBeVisible();
  await click(page, 240, 621);
  await expect(canvas(page, 'Level')).toBeVisible();

  const sample = async (shelf: number, x: number, y: number, width: number, height: number) => {
    const middle = slotPoint({ shelf, slot: 1 }, board.length);
    const at = await point(page, middle.x + x, middle.y + y);
    return page.screenshot({ clip: { ...at, width, height }, scale: 'css' });
  };
  const stockShelf = () => sample(0, -92, -49, 185, 86);
  const rearCenter = (shelf: number) => sample(shelf, -9, -40, 28, 21);
  const initial = await stockShelf();
  const stockInEmptySlot = await rearCenter(0);
  expect(stockInEmptySlot.equals(await rearCenter(2))).toBe(false);

  // A drag from the visible stock of an empty front slot cannot move the stock.
  const rear = slotPoint({ shelf: 0, slot: 1 }, board.length);
  const target = slotPoint(first.to, board.length);
  await page.mouse.move(rear.x + 5, rear.y - 25);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 6 });
  await page.mouse.up();
  expect((await readSave(page))?.active?.moves).toEqual([]);
  // Cancelling a drag from a front item clears the gesture before it can place the item.
  const origin = slotPoint(first.from, board.length);
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y);
  await page.evaluate(() => document.querySelector('canvas')!.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true })));
  await page.mouse.up();
  expect((await readSave(page))?.active?.moves).toEqual([]);

  const intoStockShelf: Move = { from: { shelf: 1, slot: 0 }, to: { shelf: 0, slot: 1 } };
  await inputMove(page, intoStockShelf, 'click', board.length);
  await expect.poll(async () => (await readSave(page))?.active?.moves).toEqual([intoStockShelf]);
  await click(page, 91, 739);
  await expect.poll(async () => (await stockShelf()).equals(initial)).toBe(true);

  await inputMove(page, first, 'drag', board.length);
  await expect.poll(async () => (await rearCenter(0)).equals(stockInEmptySlot)).toBe(true);
  const partial = await stockShelf();
  expect(partial.equals(initial)).toBe(false);
  await click(page, 91, 739);
  await expect.poll(async () => (await stockShelf()).equals(initial)).toBe(true);

  await inputMove(page, first, 'click', board.length);
  await expect.poll(async () => (await stockShelf()).equals(partial)).toBe(true);

  const undoControl = () => page.screenshot({ clip: { x: 40, y: 721, width: 90, height: 37 }, scale: 'css' });
  const undoReady = await undoControl();
  const taps = (move: Move) => [move.from, move.to].map(slot => slotPoint(slot, board.length));
  // Dispatch both moves in one browser task so the second lands before the reveal can advance.
  await page.locator('canvas').evaluate((element, coordinates) => {
    for (const { x, y } of coordinates) {
      const event = { bubbles: true, clientX: x, clientY: y, button: 0 };
      element.dispatchEvent(new MouseEvent('mousedown', { ...event, buttons: 1 }));
      element.dispatchEvent(new MouseEvent('mouseup', event));
    }
  }, [...taps(reveal), ...taps(next)]);
  expect((await readSave(page))?.active?.moves).toEqual([first, reveal]);
  await expect.poll(async () => (await undoControl()).equals(undoReady)).toBe(true);
  const revealed = await stockShelf();
  expect(revealed.equals(partial)).toBe(false);

  await inputMove(page, next, 'click', board.length);
  await expect.poll(async () => (await readSave(page))?.active?.moves).toEqual([first, reveal, next]);
  await expect.poll(async () => (await stockShelf()).equals(revealed)).toBe(false);
  await click(page, 91, 739);
  await expect.poll(async () => (await stockShelf()).equals(revealed)).toBe(true);
  await click(page, 91, 739);
  await expect.poll(async () => (await stockShelf()).equals(partial)).toBe(true);
  await inputMove(page, reveal, 'click', board.length);
  await expect.poll(async () => (await stockShelf()).equals(revealed)).toBe(true);

  await page.reload();
  await expect(canvas(page, 'Play')).toBeVisible();
  await click(page, 240, 621);
  await expect(canvas(page, 'Level')).toBeVisible();
  await expect.poll(async () => (await stockShelf()).equals(revealed)).toBe(true);
});

test('SDK locale precedes the first frame and manual language and both volume controls survive reload', async ({ page }) => {
  await mocked(page, 'ru');
  await page.goto('./');
  await expect(canvas(page, 'Играть')).toBeVisible();
  await expect.poll(() => titleInk(page, 'Играть')).toBeGreaterThan(250);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect.poll(() => mockValue(page, mock => mock.calls)).toEqual(['init', 'ready']);
  await click(page, 142, 703);
  await expect(canvas(page, 'Настройки')).toBeVisible();
  await click(page, 334, 325);
  await expect(canvas(page, 'Settings')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await click(page, 158, 414);
  await click(page, 319, 498);
  const save = await readSave(page);
  expect(save?.locale).toBe('en');
  expect(save?.volumes.music).toBeCloseTo(0.25, 1);
  expect(save?.volumes.effects).toBeCloseTo(0.75, 1);
  await page.reload();
  await expect(canvas(page, 'Play')).toBeVisible();
  await expect.poll(() => titleInk(page, 'Play')).toBeGreaterThan(250);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect((await readSave(page))?.volumes).toEqual(save?.volumes);
});

test('SDK pauses and background state overlap, rewarded is voluntary, no-fill and duplicate callbacks settle safely', async ({ page }) => {
  await mocked(page);
  await page.goto('./');
  await enter(page);
  await expect.poll(() => mockValue(page, mock => mock.calls)).toEqual(['init', 'ready', 'start']);
  await mockValue(page, mock => mock.events.game_api_pause());
  expect(await mockValue(page, mock => mock.calls.at(-1))).toBe('stop');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await mockValue(page, mock => mock.events.game_api_resume());
  await inputMove(page, LEVELS[0].solution[0], 'click');
  expect((await readSave(page))?.active?.moves).toEqual([]);
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  expect(await mockValue(page, mock => mock.calls.at(-1))).toBe('start');

  await click(page, 389, 739);
  await expect(canvas(page, 'See the next move?')).toBeVisible();
  await click(page, 333, 474);
  await expect.poll(() => mockValue(page, mock => mock.rewarded.length)).toBe(1);
  await mockValue(page, mock => {
    mock.rewarded[0].onClose(false);
    mock.rewarded[0].onRewarded();
  });
  await expect(canvas(page, 'Level')).toBeVisible();
  expect((await readSave(page))?.active?.moves).toEqual([]);
  await click(page, 389, 739);
  await click(page, 333, 474);
  await expect.poll(() => mockValue(page, mock => mock.rewarded.length)).toBe(2);
  await mockValue(page, mock => {
    mock.rewarded[1].onOpen();
    mock.rewarded[1].onRewarded();
    mock.rewarded[1].onRewarded();
    mock.rewarded[1].onClose();
    mock.rewarded[1].onError();
  });
  await expect.poll(() => mockValue(page, mock => mock.calls.at(-1))).toBe('start');

  await mockValue(page, mock => { mock.shift = 91_000; });
  expect(await mockValue(page, mock => mock.interstitial.length)).toBe(0);
  await completeFirst(page);
  await expect.poll(() => mockValue(page, mock => mock.interstitial.length)).toBe(1);
  await click(page, 240, 564);
  await expect(canvas(page, 'Shelves cleared!')).toBeVisible();
  await mockValue(page, mock => {
    mock.interstitial[0].onClose(false);
    mock.interstitial[0].onClose(true);
  });
  await click(page, 240, 564);
  await expect(canvas(page, 'Level')).toBeVisible();
});


type AudioProbe = {
  decoded: string[];
  effects: string[];
  sharedClipOverlaps: number;
  music?: HTMLMediaElement;
  starts: number;
  contexts: Set<BaseAudioContext>;
  screens: string[];
};
declare global {
  interface Window { studioAudio: AudioProbe }
}

async function observeNativeAudio(page: Page) {
  await page.addInitScript(({ musicFile, sharedFile }) => {
    const probe: AudioProbe = {
      decoded: [], effects: [], sharedClipOverlaps: 0, starts: 0, contexts: new Set(), screens: [],
    };
    window.studioAudio = probe;
    const fileNames = new WeakMap<ArrayBuffer, string>();
    const buffers = new WeakMap<AudioBuffer, string>();
    const arrayBuffer = Response.prototype.arrayBuffer;
    Response.prototype.arrayBuffer = async function () {
      const data = await arrayBuffer.call(this);
      if (this.url.includes('/assets/audio/')) fileNames.set(data, this.url.split('/').at(-1)!);
      return data;
    };
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = function (data, success, failure) {
      const file = fileNames.get(data);
      return decode.call(this, data, success, failure).then(buffer => {
        if (file) {
          probe.decoded.push(file);
          buffers.set(buffer, file);
          probe.contexts.add(this);
        }
        return buffer;
      });
    };
    let sharedClip: { voice: AudioBufferSourceNode; endsAt: number } | undefined;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      start.apply(this, args);
      const file = this.buffer && buffers.get(this.buffer);
      if (file) probe.effects.push(file);
      if (file === sharedFile && this.buffer) {
        const now = this.context.currentTime;
        if (sharedClip && sharedClip.endsAt > now) probe.sharedClipOverlaps++;
        sharedClip = { voice: this, endsAt: now + this.buffer.duration };
      }
    };
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function (...args) {
      stop.apply(this, args);
      if (sharedClip?.voice === this) sharedClip.endsAt = args[0] ?? this.context.currentTime;
    };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.src.endsWith('/' + musicFile)) {
        probe.music = this;
        probe.starts += 1;
      }
      return play.call(this);
    };
    new MutationObserver(records => {
      for (const { target } of records) {
        if (!(target instanceof HTMLCanvasElement)) continue;
        const screen = target.getAttribute('aria-label');
        if (screen && probe.screens.at(-1) !== screen) probe.screens.push(screen);
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['aria-label'] });
  }, { musicFile: audioAssets.files.background_music, sharedFile: audioAssets.files.shelf_reveal });
}

function musicState(page: Page) {
  return page.evaluate(() => {
    const { music, starts, screens, contexts } = window.studioAudio;
    return {
      starts, screens, time: music?.currentTime ?? 0, paused: music?.paused ?? true,
      attached: music?.hasAttribute('src') ?? false, loop: music?.loop ?? false,
      error: music?.error?.message ?? null, effectsRunning: Array.from(contexts).some(context => context.state === 'running'),
    };
  });
}

function effectsPlayed(page: Page) {
  return page.evaluate(() => window.studioAudio.effects);
}

async function waitForEffects(page: Page) {
  const expected = [...new Set(Object.values(audioAssets.files).filter(file => file !== audioAssets.files.background_music))];
  await expect.poll(() => page.evaluate(() => window.studioAudio.decoded.length)).toBe(expected.length);
  expect(await page.evaluate(() => window.studioAudio.decoded.sort())).toEqual(expected.sort());
}

test.describe('original audio playback', () => {
  test.skip(!audioAssets.enabled, 'Original OGG are disabled.');

  test('music starts on the first gesture, stays continuous and resumes after ads and browser pauses', async ({ page, browserName }) => {
    // Chromium also covers Chrome Android's desktop site mode, which has a desktop UA.
    const keepsSource = browserName !== 'chromium';
    const errors: string[] = [];
    const ogg = new Set<string>();
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      const url = new URL(response.url());
      if (response.status() >= 400) errors.push(`${response.status()} ${url.pathname}`);
      if (url.pathname.endsWith('.ogg') && response.ok()) ogg.add(url.pathname.split('/').at(-1)!);
    });
    await mocked(page);
    await observeNativeAudio(page);
    await page.goto('./');
    await expect(canvas(page, 'Play')).toBeVisible();
    await waitForEffects(page);
    expect((await musicState(page)).starts).toBe(0);

    await click(page, 240, 553);
    await expect(canvas(page, 'Choose a level')).toBeVisible();
    await expect.poll(async () => (await musicState(page)).time).toBeGreaterThan(0.1);
    const before = await musicState(page);
    expect(before).toMatchObject({ starts: 1, loop: true, paused: false, error: null });
    await click(page, 142, 350);
    await expect(canvas(page, 'Level')).toBeVisible();
    await click(page, 47, 54);
    await expect(canvas(page, 'Choose a level')).toBeVisible();
    await click(page, 47, 54);
    await expect(canvas(page, 'Play')).toBeVisible();
    const after = await musicState(page);
    expect(after.screens.slice(-5)).toEqual(['Play', 'Choose a level', 'Level', 'Choose a level', 'Play']);
    expect(after.starts).toBe(1);
    await expect.poll(async () => (await musicState(page)).time).toBeGreaterThan(before.time);

    // Seek once to make a restart from zero distinguishable from a genuine resume.
    await page.evaluate(() => { window.studioAudio.music!.currentTime = 12; });
    await expect.poll(async () => (await musicState(page)).time).toBeGreaterThan(12.1);
    await enter(page);
    await click(page, 433, 54);
    await expect(canvas(page, 'Settings')).toBeVisible();
    await click(page, 146, 325);
    await expect(canvas(page, 'Настройки')).toBeVisible();
    await click(page, 334, 325);
    await expect(canvas(page, 'Settings')).toBeVisible();
    await click(page, 240, 566);
    await expect(canvas(page, 'Level')).toBeVisible();
    expect(await musicState(page)).toMatchObject({ starts: 1, attached: true, paused: false });
    await click(page, 389, 739);
    await expect(canvas(page, 'See the next move?')).toBeVisible();
    await click(page, 333, 474);
    await expect.poll(() => mockValue(page, mock => mock.rewarded.length)).toBe(1);
    await expect.poll(async () => (await musicState(page)).effectsRunning).toBe(false);
    expect(await musicState(page)).toMatchObject({ starts: 1, attached: keepsSource, paused: true });
    await mockValue(page, mock => {
      mock.rewarded[0].onClose(false);
      mock.rewarded[0].onClose(true);
    });
    await expect.poll(async () => (await musicState(page)).time).toBeGreaterThan(12.1);
    expect(await musicState(page)).toMatchObject({ starts: 2, attached: true, paused: false });

    await mockValue(page, mock => { mock.events.game_api_pause(); mock.events.game_api_pause(); });
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await mockValue(page, mock => { mock.events.game_api_resume(); mock.events.game_api_resume(); });
    expect(await musicState(page)).toMatchObject({ starts: 2, attached: keepsSource, paused: true });
    await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
    await expect.poll(async () => (await musicState(page)).time).toBeGreaterThan(12.1);
    expect(await musicState(page)).toMatchObject({ starts: 3, error: null, paused: false });

    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    expect(await musicState(page)).toMatchObject({ starts: 3, attached: keepsSource, paused: true });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(async () => (await musicState(page)).time).toBeGreaterThan(12.1);
    expect(await musicState(page)).toMatchObject({ starts: 4, error: null, paused: false });

    // Mobile foregrounding can deliver visibilitychange without a new focus event.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hasFocus', { value: () => false });
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('blur'));
    });
    expect(await musicState(page)).toMatchObject({ starts: 4, attached: keepsSource, paused: true });
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(async () => (await musicState(page)).time).toBeGreaterThan(12.1);
    expect(await musicState(page)).toMatchObject({ starts: 5, error: null, paused: false });

    await completeFirst(page);
    await click(page, 240, 564);
    await expect(canvas(page, 'Level')).toBeVisible();
    expect(await musicState(page)).toMatchObject({ starts: 5, attached: true, paused: false });
    expect([...ogg].sort()).toEqual([...new Set(Object.values(audioAssets.files))].sort());
    expect(errors).toEqual([]);
  });

  test('an early action stays interactive and a sound still loading never plays late', async ({ page }) => {
    let releaseClickAsset = () => {};
    const blocked = new Promise<void>(resolve => { releaseClickAsset = resolve; });
    await page.route(`**/assets/audio/${audioAssets.files.ui_click}`, async route => {
      await blocked;
      await route.continue();
    });
    await observeNativeAudio(page);
    await page.goto('./');
    await expect(canvas(page, 'Play')).toBeVisible();
    await click(page, 240, 553);
    await expect(canvas(page, 'Choose a level')).toBeVisible();
    await expect.poll(async () => (await musicState(page)).effectsRunning).toBe(true);
    releaseClickAsset();
    await waitForEffects(page);
    expect(await effectsPlayed(page)).toEqual([]);
    await click(page, 142, 350);
    await expect(canvas(page, 'Level')).toBeVisible();
    await expect.poll(() => effectsPlayed(page)).toEqual([audioAssets.files.ui_click]);
  });

  test('each board action, control and victory plays exactly its effects with real Web Audio', async ({ page }) => {
    const files = audioAssets.files;
    await mocked(page);
    await observeNativeAudio(page);
    await page.goto('./');
    await expect(canvas(page, 'Play')).toBeVisible();
    await waitForEffects(page);
    await click(page, 24, 24);
    await expect.poll(async () => (await musicState(page)).effectsRunning).toBe(true);
    await enter(page);
    const menuSounds = await effectsPlayed(page);
    expect(menuSounds).toEqual([files.ui_click, files.ui_click]);
    const level = LEVELS[0];
    const move = level.solution[0];
    const occupied = level.board.flatMap((shelf, i) => shelf.front.flatMap((good, j) =>
      good ? [{ shelf: i, slot: j }] : [])).find(at => at.shelf !== move.from.shelf)!;
    await inputMove(page, { from: move.from, to: occupied }, 'drag');
    expect((await effectsPlayed(page)).slice(menuSounds.length)).toEqual([files.item_pickup, files.item_invalid]);

    const beforeCancel = (await effectsPlayed(page)).length;
    const from = slotPoint(move.from, level.board.length);
    const to = slotPoint(move.to, level.board.length);
    const origin = await point(page, from.x, from.y);
    const target = await point(page, to.x, to.y);
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 6 });
    await canvas(page, 'Level').dispatchEvent('pointercancel', { bubbles: true });
    await page.mouse.up();
    expect((await readSave(page))?.active?.moves).toEqual([]);
    expect((await effectsPlayed(page)).slice(beforeCancel)).toEqual([files.item_pickup]);

    const beforeControls = (await effectsPlayed(page)).length;
    const moveSounds = [files.item_pickup, files.item_place];
    await inputMove(page, move, 'drag');
    expect((await effectsPlayed(page)).slice(beforeControls)).toEqual(moveSounds);
    const nextMove = level.solution[1];
    await inputMove(page, nextMove, 'click');
    expect((await readSave(page))?.active?.moves).toEqual([move, nextMove]);
    expect((await effectsPlayed(page)).slice(beforeControls)).toEqual([...moveSounds, ...moveSounds]);
    await click(page, 91, 739);
    expect((await readSave(page))?.active?.moves).toEqual([move]);
    await click(page, 91, 739);
    expect((await readSave(page))?.active?.moves).toEqual([]);
    await inputMove(page, move, 'click');
    await click(page, 240, 739);
    await expect(canvas(page, 'Restart this level?')).toBeVisible();
    await click(page, 333, 474);
    await expect(canvas(page, 'Level')).toBeVisible();
    expect((await readSave(page))?.active?.moves).toEqual([]);
    expect((await effectsPlayed(page)).slice(beforeControls)).toEqual([
      ...moveSounds, ...moveSounds, files.ui_click, files.ui_click,
      ...moveSounds, files.ui_click, files.ui_click,
    ]);

    await mockValue(page, mock => { mock.shift = 91_000; });
    const start = (await effectsPlayed(page)).length;
    await completeFirst(page);
    await expect.poll(() => mockValue(page, mock => mock.interstitial.length)).toBe(1);
    const winSounds = [...moveSounds, ...moveSounds, ...moveSounds, files.match_three, ...moveSounds, files.match_three];
    expect((await effectsPlayed(page)).slice(start)).toEqual(winSounds);
    await mockValue(page, mock => {
      const ad = mock.interstitial[0];
      ad.onClose(true);
      ad.onClose(false);
      ad.onError();
    });
    await expect.poll(async () => (await effectsPlayed(page)).slice(start)).toEqual([...winSounds, files.level_complete]);
    await click(page, 240, 564);
    await expect(canvas(page, 'Level')).toBeVisible();
    expect((await readSave(page))?.active?.level).toBe(2);
    await mockValue(page, mock => mock.interstitial[0].onClose(true));
    expect((await effectsPlayed(page)).slice(start)).toEqual([...winSounds, files.level_complete, files.ui_click]);
  });

  test('quick valid UI presses each play once while clicks outside live buttons stay silent', async ({ page }) => {
    await observeNativeAudio(page);
    await page.goto('./');
    await expect(canvas(page, 'Play')).toBeVisible();
    await waitForEffects(page);
    await click(page, 24, 24);
    await expect.poll(async () => (await musicState(page)).effectsRunning).toBe(true);
    const play = await point(page, 240, 553);
    await page.mouse.dblclick(play.x, play.y);
    await expect(canvas(page, 'Choose a level')).toBeVisible();
    expect(await effectsPlayed(page)).toEqual([audioAssets.files.ui_click]);
    const laterChapter = await point(page, 240, 148);
    const firstChapter = await point(page, 101, 148);
    await page.mouse.click(laterChapter.x, laterChapter.y);
    // Let Phaser register the redrawn input zones.
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await page.mouse.click(firstChapter.x, firstChapter.y);
    expect(await effectsPlayed(page)).toEqual(Array(3).fill(audioAssets.files.ui_click));
  });

  test.describe('stock cues', () => {
    const scenarios: {
      title: string; id: number; matches: boolean; setup: Move[]; moveIndex?: number; playSetup?: boolean;
    }[] = [
      { title: 'last item moved from a shelf with one rear row', id: 6, matches: false, setup: [] },
      {
        title: 'last item moved from a shelf with two rear rows',
        id: 10, matches: false, setup: [], moveIndex: 1, playSetup: true,
      },
      { title: 'match then reveal', id: 7, matches: true, setup: [] },
      { title: 'match on a shelf with two rear rows', id: 18, matches: true, setup: [], moveIndex: 1 },
      {
        title: 'match then two simultaneous reveals', id: 7, matches: true,
        setup: [{ from: { shelf: 0, slot: 1 }, to: { shelf: 1, slot: 0 } }],
      },
    ];
    for (const { title, id, matches, setup, moveIndex = 0, playSetup = false } of scenarios) {
      test(`${title} plays one rear-row cue with no overlapping pickup sample`, async ({ page }) => {
        const files = audioAssets.files;
        const level = LEVELS[id - 1];
        const move = level.solution[moveIndex];
        const history = [...setup, ...level.solution.slice(0, moveIndex)];
        const savedMoves = playSetup ? setup : history;
        await page.addInitScript(({ key, id, moves }) => {
          localStorage.setItem(key, JSON.stringify({
            version: 1, locale: 'en', cleared: Array.from({ length: id - 1 }, (_, i) => i + 1),
            active: { level: id, moves },
          }));
        }, { key: saveKey, id, moves: savedMoves });
        await observeNativeAudio(page);
        await page.goto('./');
        await expect(canvas(page, 'Play')).toBeVisible();
        await waitForEffects(page);
        await click(page, 240, 621);
        await expect(canvas(page, 'Level')).toBeVisible();
        await expect.poll(async () => (await musicState(page)).effectsRunning).toBe(true);

        for (const priorMove of history.slice(savedMoves.length)) {
          const start = (await effectsPlayed(page)).length;
          await inputMove(page, priorMove, 'click', level.board.length);
          expect((await effectsPlayed(page)).slice(start)).toEqual([files.item_pickup, files.item_place]);
        }
        const start = (await effectsPlayed(page)).length;
        await inputMove(page, move, 'click', level.board.length);
        const expected = [
          files.item_pickup,
          ...(matches ? [files.item_place, files.match_three] : []),
          files.shelf_reveal,
        ];
        await expect.poll(async () => (await effectsPlayed(page)).slice(start)).toEqual(expected);
        expect((await readSave(page))?.active?.moves).toEqual([...history, move]);

        // Undo is disabled until the complete reveal animation has settled.
        await expect.poll(async () => {
          await click(page, 91, 739);
          return (await readSave(page))?.active?.moves;
        }).toEqual(history);
        expect((await effectsPlayed(page)).slice(start)).toEqual([...expected, files.ui_click]);
        expect(await page.evaluate(() => window.studioAudio.sharedClipOverlaps)).toBe(0);
      });
    }
  });
});

test.describe('high-density canvas', () => {
  test.use({ deviceScaleFactor: 2 });
  test('full-viewport canvas keeps the portrait controls reachable without scrolling or zooming', async ({ page }) => {
    await page.goto('./');
    await expect(canvas(page, 'Play')).toBeVisible();
    for (const [width, height] of [[320, 569], [360, 640], [393, 852], [480, 800], [1280, 800], [852, 393]]) {
      await page.setViewportSize({ width, height });
      await expect.poll(() => canvas(page, 'Play').boundingBox()).toEqual({ x: 0, y: 0, width, height });
      await click(page, 142, 703);
      await expect(canvas(page, 'Settings')).toBeVisible();
      await click(page, 240, 566);
      await expect(canvas(page, 'Play')).toBeVisible();
      const state = await page.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth, vertical: document.documentElement.scrollHeight,
        backingRatio: document.querySelector('canvas')!.width / document.querySelector('canvas')!.height, zoom: visualViewport?.scale,
      }));
      expect(state.horizontal).toBeLessThanOrEqual(width);
      expect(state.vertical).toBeLessThanOrEqual(height);
      expect(state.backingRatio).toBeCloseTo(width / height, 2);
      expect(state.zoom).toBe(1);
    }
  });
});

test('settings dim both gutters and safe areas through a live landscape resize', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('./');
  await enter(page);
  await page.addStyleTag({ content: 'body { --safe-left: 38px; --safe-right: 7px; --safe-top: 18px; --safe-bottom: 28px; }' });
  await page.setViewportSize({ width: 1278, height: 800 });
  await expect.poll(async () => (await canvas(page, 'Level').boundingBox())?.width).toBe(1278);

  const cornerLight = async (label: string) => {
    const image = await loadImage(await canvas(page, label).screenshot({ scale: 'css' }));
    const context = createCanvas(image.width, image.height).getContext('2d');
    context.drawImage(image, 0, 0);
    return [[2, 2], [image.width - 3, 2], [2, image.height - 3], [image.width - 3, image.height - 3]]
      .map(([x, y]) => context.getImageData(x, y, 1, 1).data[0]);
  };

  const initial = await cornerLight('Level');
  await click(page, 433, 54);
  await expect(canvas(page, 'Settings')).toBeVisible();
  const dimmed = await cornerLight('Settings');
  dimmed.forEach((value, index) => expect(initial[index] - value).toBeGreaterThan(60));

  await page.setViewportSize({ width: 852, height: 393 });
  await expect.poll(async () => (await canvas(page, 'Settings').boundingBox())?.width).toBe(852);
  const rotated = await cornerLight('Settings');
  rotated.forEach(value => expect(value).toBeLessThan(180));
  await page.mouse.click(18, 16);
  await expect(canvas(page, 'Settings')).toBeVisible();
  await click(page, 240, 566);
  const restored = await cornerLight('Level');
  restored.forEach((value, index) => expect(value - rotated[index]).toBeGreaterThan(60));
});

test.describe('touch emulation', () => {
  test.use({ hasTouch: true, deviceScaleFactor: 2 });
  test('taps and native drag place goods', async ({ page, browserName }) => {
    if (browserName === 'firefox') test.skip(true, 'Playwright touchscreen.tap is unavailable in Firefox.');
    if (audioAssets.enabled) await observeNativeAudio(page);
    await page.goto('./');
    await expect(canvas(page, 'Play')).toBeVisible();
    await tap(page, 240, 553);
    await expect(canvas(page, 'Choose a level')).toBeVisible();
    if (audioAssets.enabled) {
      await expect.poll(async () => (await musicState(page)).time).toBeGreaterThan(0.1);
      expect((await musicState(page)).starts).toBe(1);
    }
    await tap(page, 142, 350);
    await expect(canvas(page, 'Level')).toBeVisible();
    const move = LEVELS[0].solution[0];
    await inputMove(page, move, 'tap');
    await expect.poll(async () => (await readSave(page))?.active?.moves).toEqual([move]);
    if (browserName === 'chromium') {
      await page.waitForTimeout(440);
      await tap(page, 91, 739);
      const from = slotPoint(move.from, 3), to = slotPoint(move.to, 3);
      const a = await point(page, from.x, from.y), b = await point(page, to.x, to.y);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [b] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(async () => (await readSave(page))?.active?.moves).toEqual([move]);
    }
  });
});
