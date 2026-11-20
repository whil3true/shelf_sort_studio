import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioRuntime, BrowserAudioOutput, type AudioOutput } from '../../src/audio/AudioRuntime.ts';
import { AUDIO_ASSETS, audioPath, type AudioEffect } from '../../src/audio/AudioAssetManifest.ts';
import { Ads } from '../../src/platform/Ads.ts';
import { Lifecycle, INTERSTITIAL_COOLDOWN } from '../../src/platform/Lifecycle.ts';
import { standaloneHost, YandexPlatform, type AdCallbacks, type YandexSdk } from '../../src/platform/Platform.ts';
import { SAVE_KEY, Storage, selectLocale, type Volumes } from '../../src/platform/Storage.ts';
import { LEVELS } from '../../src/game/Levels.ts';

class Backend {
  raw: string | null = null;
  getItem(key: string) { assert.equal(key, SAVE_KEY); return this.raw; }
  setItem(key: string, value: string) { assert.equal(key, SAVE_KEY); this.raw = value; }
}

function platformFixture() {
  const calls: string[] = [];
  const events = new Map<string, () => void>();
  const ads: AdCallbacks[] = [];
  const sdk: YandexSdk = {
    environment: { i18n: { lang: 'ru' } },
    features: {
      LoadingAPI: { ready: () => calls.push('ready') },
      GameplayAPI: { start: () => calls.push('start'), stop: () => calls.push('stop') },
    },
    adv: {
      showFullscreenAdv: ({ callbacks }) => { calls.push('interstitial'); ads.push(callbacks); },
      showRewardedVideo: ({ callbacks }) => { calls.push('rewarded'); ads.push(callbacks); },
    },
    on: (event, listener) => { events.set(event, listener); },
  };
  return { calls, events, ads, platform: new YandexPlatform(sdk) };
}

test('one Game Ready precedes Gameplay start and overlapping pauses are independent', () => {
  const { calls, events, platform } = platformFixture();
  const states: boolean[] = [];
  const runtime = new Lifecycle(platform, value => states.push(value));
  runtime.playing(true);
  assert.deepEqual(calls, []);
  runtime.ready();
  runtime.ready();
  events.get('game_api_pause')!();
  runtime.pauseFor('hidden', true);
  events.get('game_api_resume')!();
  assert.equal(runtime.blocked, true);
  runtime.pauseFor('hidden', false);
  runtime.playing(false);
  assert.deepEqual(calls, ['ready', 'start', 'stop', 'start', 'stop']);
  assert.deepEqual(states, [true, false]);
});

test('interstitial cooldown begins on Ready and no-fill does not consume it', async () => {
  const { calls, ads, platform } = platformFixture();
  let now = 500;
  const lifecycle = new Lifecycle(platform, () => {}, () => now);
  await lifecycle.interstitial();
  lifecycle.ready();
  now += INTERSTITIAL_COOLDOWN - 1;
  await lifecycle.interstitial();
  assert.deepEqual(calls, ['ready']);
  now++;
  let pending = lifecycle.interstitial();
  ads[0].onClose(false);
  await pending;
  pending = lifecycle.interstitial();
  ads[1].onOpen();
  ads[1].onClose(true);
  await pending;
  await lifecycle.interstitial();
  assert.deepEqual(calls, ['ready', 'interstitial', 'interstitial']);
});

test('rewarded locks concurrency, settles once and ignores callbacks from an old transaction', async () => {
  const { ads, platform } = platformFixture();
  const blocks: boolean[] = [];
  const gate = new Ads(platform, blocked => blocks.push(blocked));
  const first = gate.show('rewarded');
  assert.deepEqual(await gate.show('rewarded'), { shown: false, rewarded: false });
  ads[0].onOpen();
  ads[0].onRewarded();
  ads[0].onRewarded();
  ads[0].onClose();
  ads[0].onError();
  assert.deepEqual(await first, { shown: true, rewarded: true });
  const second = gate.show('rewarded');
  ads[0].onRewarded();
  ads[0].onClose();
  ads[1].onClose(false);
  assert.deepEqual(await second, { shown: false, rewarded: false });
  assert.deepEqual(blocks, [true, false, true, false]);
});

test('a missing ad callback releases the transaction eventually', async () => {
  const { platform } = platformFixture();
  const states: boolean[] = [];
  const gate = new Ads(platform, blocked => states.push(blocked), 5);
  assert.deepEqual(await gate.show('rewarded'), { shown: false, rewarded: false });
  assert.deepEqual(states, [true, false]);
});

test('an active hidden board and Undo restore exactly across reload', () => {
  const backend = new Backend();
  const data = new Storage(backend);
  data.setLocale('en');
  data.setVolume('music', 0.23);
  for (const level of LEVELS.slice(0, 3)) {
    const run = data.open(level.id)!;
    for (const move of level.solution) run.move(move);
    data.saveRun(level.id, run);
  }
  assert.equal(data.nextLevel, 4);
  const run = data.open(4)!;
  run.move(LEVELS[3].solution[0]);
  data.saveRun(4, run);
  const loaded = new Storage(backend);
  assert.equal(loaded.locale, 'en');
  assert.equal(loaded.volumes.music, 0.23);
  assert.equal(loaded.isUnlocked(5), false);
  assert.equal(loaded.currentLevel, 4);
  assert.deepEqual(loaded.open(4)!.board, run.board);
  assert.ok(loaded.open(4)!.undo());
  assert.deepEqual(loaded.open(4)!.board, LEVELS[3].board);
});

test('corrupt runs recover without discarding valid settings or unlocking a skipped level', () => {
  const backend = new Backend();
  backend.raw = JSON.stringify({ version: 1, locale: 'ru', cleared: [1, 3], volumes: { music: 2 },
    active: { level: 2, moves: [{ from: { shelf: -1, slot: 0 }, to: { shelf: 0, slot: 0 } }] } });
  const save = new Storage(backend);
  assert.equal(save.locale, 'ru');
  assert.equal(save.volumes.music, 1);
  assert.equal(save.nextLevel, 2);
  assert.equal(save.currentLevel, null);
  backend.raw = '{';
  assert.equal(new Storage(backend).nextLevel, 1);
});

test('first locale uses SDK, manual choice wins over SDK and Pages stays standalone', () => {
  assert.equal(selectLocale(null, 'ru-RU', 'en'), 'ru');
  assert.equal(selectLocale('en', 'ru', 'ru'), 'en');
  assert.equal(selectLocale(null, undefined, 'en-US'), 'en');
  assert.equal(standaloneHost('whil3true.github.io'), true);
  assert.equal(standaloneHost('127.0.0.1'), true);
  assert.equal(standaloneHost('yandex.net'), false);
});

test('audio works with a mock output while all supplied paths are disabled', () => {
  const calls: (string | boolean | Readonly<Volumes>)[] = [];
  const output: AudioOutput = {
    unlock: () => calls.push('unlock'), play: effect => calls.push(effect),
    setVolumes: volumes => calls.push(volumes), setPaused: paused => calls.push(paused),
  };
  const rt = new AudioRuntime(output, { music: 1, effects: 0.5 });
  rt.unlock();
  rt.play('shelf_reveal');
  rt.pauseFor('browser', true);
  rt.pauseFor('ads', true);
  rt.pauseFor('browser', false);
  rt.pauseFor('ads', false);
  assert.deepEqual(calls, [{ music: 1, effects: 0.5 }, 'unlock', 'shelf_reveal', true, true, true, false]);

  const browser = new BrowserAudioOutput();
  browser.unlock();
  for (const [event, options] of Object.entries(AUDIO_ASSETS)) {
    if (event !== 'background_music') browser.play(event as AudioEffect);
    if (!options.enabled) assert.equal(audioPath(event as keyof typeof AUDIO_ASSETS), null);
  }
});
