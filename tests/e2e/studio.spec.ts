import { expect, test, type Page } from '@playwright/test';
import { LEVELS } from '../../src/game/Levels.ts';
import type { Move, Slot } from '../../src/game/Board.ts';
import type { AdCallbacks } from '../../src/platform/Platform.ts';

const saveKey = 'shelf-sort-studio';
type Snapshot = { locale: string; cleared: number[]; volumes: { music: number; effects: number };
  active: { level: number; moves: Move[] } | null } | null;
type MockSdk = { calls: string[]; events: Record<string, () => void>;
  interstitial: AdCallbacks[]; rewarded: AdCallbacks[]; shift: number };

function canvas(page: Page, screen: string) { return page.locator(`canvas[aria-label="${screen}"]`); }
async function point(page: Page, x: number, y: number) {
  const box = (await page.locator('canvas[aria-label]').boundingBox())!;
  return { x: box.x + x * box.width / 480, y: box.y + y * box.height / 800 };
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
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(response.url()); });
  await page.goto('./');
  await expect(canvas(page, 'Play')).toBeVisible();
  await click(page, 338, 703);
  await expect(canvas(page, 'How to play')).toBeVisible();
  await click(page, 240, 614);

  await click(page, 240, 553);
  await expect(canvas(page, 'Choose a level')).toBeVisible();
  await click(page, 379, 128);
  await click(page, 142, 350);
  await expect(canvas(page, 'Choose a level')).toBeVisible();
  expect(await readSave(page)).toBeNull();
  await click(page, 101, 128);
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
});

test('SDK locale precedes the first frame and manual language and both volume controls survive reload', async ({ page }) => {
  await mocked(page, 'ru');
  await page.goto('./');
  await expect(canvas(page, 'Играть')).toBeVisible();
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

test.describe('touch emulation', () => {
  test.use({ hasTouch: true, deviceScaleFactor: 2 });
  test('taps and native drag place goods, with a portrait canvas inside each viewport', async ({ page, browserName }) => {
    if (browserName === 'firefox') test.skip(true, 'Playwright touchscreen.tap is unavailable in Firefox.');
    await page.goto('./');
    await expect(canvas(page, 'Play')).toBeVisible();
    for (const [width, height] of [[320, 569], [360, 640], [393, 852], [480, 800], [1280, 800], [852, 393]]) {
      await page.setViewportSize({ width, height });
      await expect.poll(async () => (await canvas(page, 'Play').boundingBox())!.width).toBeCloseTo(
        Math.min(width, height * 0.6), 0);
      const box = (await canvas(page, 'Play').boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
      expect(box.width / box.height).toBeCloseTo(0.6, 2);
      const state = await page.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth, vertical: document.documentElement.scrollHeight,
        density: document.querySelector('canvas')?.width, zoom: visualViewport?.scale,
      }));
      expect(state.horizontal).toBeLessThanOrEqual(width);
      expect(state.vertical).toBeLessThanOrEqual(height);
      expect(state.density).toBe(960);
      expect(state.zoom).toBe(1);
    }
    await tap(page, 240, 553);
    await expect(canvas(page, 'Choose a level')).toBeVisible();
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
