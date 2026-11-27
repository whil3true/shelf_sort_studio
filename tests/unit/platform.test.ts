import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { AudioRuntime, BrowserAudioOutput, type AudioOutput } from '../../src/audio/AudioRuntime.ts';
import { AUDIO_ASSETS, audioPath, type AudioEffect, type AudioEvent } from '../../src/audio/AudioAssetManifest.ts';
import assets from '../../src/audio/AudioAssets.json' with { type: 'json' };
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

function mockGlobal(t: TestContext, name: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, name, original);
    else Reflect.deleteProperty(globalThis, name);
  });
}

test('audio gates grouped pauses and the disabled manifest does not touch browser audio', t => {
  const calls: (string | boolean | Readonly<Volumes> | string[])[] = [];
  const output: AudioOutput = {
    unlock: () => calls.push('unlock'),
    play: (effect, replaces) => calls.push(replaces ? [effect, replaces] : effect),
    setVolumes: volumes => calls.push(volumes), setPaused: paused => calls.push(paused),
  };
  const rt = new AudioRuntime(output, { music: 1, effects: 0.5 });
  rt.unlock();
  rt.play('shelf_reveal', 'match_three');
  rt.pauseFor('browser', true);
  rt.pauseFor('ads', true);
  rt.pauseFor('browser', false);
  rt.pauseFor('ads', false);
  assert.deepEqual(calls, [{ music: 1, effects: 0.5 }, 'unlock', ['shelf_reveal', 'match_three'], true, false]);

  for (const event of Object.keys(AUDIO_ASSETS) as AudioEvent[]) {
    assert.equal(audioPath(event), assets.enabled ? `./assets/audio/${AUDIO_ASSETS[event]}` : null);
  }
  if (assets.enabled) return;

  const construct = t.mock.fn(function () {});
  mockGlobal(t, 'Audio', construct);
  mockGlobal(t, 'AudioContext', construct);
  const fetch = t.mock.method(globalThis, 'fetch');
  const browser = new BrowserAudioOutput();
  browser.setVolumes({ music: 1, effects: 1 });
  browser.unlock();
  for (const event of Object.keys(AUDIO_ASSETS)) {
    if (event !== 'background_music') browser.play(event as AudioEffect);
  }
  assert.equal(construct.mock.callCount(), 0);
  assert.equal(fetch.mock.callCount(), 0);
});

test('music uses one logical loop through navigation, overlapping SDK pauses and ad no-fill', async t => {
  const players: Player[] = [];
  let rejectStart = () => {};
  class Player {
    paused = true;
    loop = false;
    volume = 0;
    currentTime = 0;
    readyState = 0;
    starts = 0;
    metadata = () => {};
    released = false;
    loaded = false;
    constructor() { players.push(this); }
    play() {
      this.starts++;
      if (players.length === 1 && this.starts === 1) {
        return new Promise<void>((_resolve, reject) => { rejectStart = () => reject(new Error('autoplay denied')); });
      }
      this.paused = false;
      return Promise.resolve();
    }
    pause() { this.paused = true; }
    removeAttribute(name: string) { assert.equal(name, 'src'); this.released = true; }
    addEventListener(name: string, listener: () => void) {
      assert.equal(name, 'loadedmetadata');
      this.metadata = () => { this.readyState = 1; listener(); };
    }
    load() { this.loaded = true; }
  }

  mockGlobal(t, 'Audio', Player);
  const clearPosition = t.mock.fn();
  const mediaSession = { playbackState: 'playing', metadata: { title: 'Track' }, setPositionState: clearPosition };
  mockGlobal(t, 'navigator', { mediaSession, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/144.0.0.0' });
  const audio = new AudioRuntime(new BrowserAudioOutput(event => event === 'background_music' ? 'mock-music' : null),
    { music: 0.6, effects: 0.5 });
  const { platform, events, ads } = platformFixture();
  let now = 0;
  const lifecycle = new Lifecycle(platform, blocked => audio.pauseFor('platform', blocked), () => now);
  lifecycle.ready();
  assert.equal(players.length, 0);
  audio.unlock();
  audio.unlock();
  assert.equal(players.length, 1);
  assert.equal(players[0].starts, 2);
  rejectStart();
  await new Promise<void>(resolve => setImmediate(resolve));
  audio.unlock();
  assert.equal(players[0].starts, 2);
  assert.equal(players[0].loop, true);
  lifecycle.playing(true);
  lifecycle.playing(false);
  audio.setVolumes({ music: 0.6, effects: 0 });
  assert.equal(players[0].volume, 0.6);
  assert.equal(players.length, 1);

  players[0].currentTime = 14;
  now += INTERSTITIAL_COOLDOWN;
  const ad = lifecycle.interstitial();
  assert.equal(players[0].released, true);
  assert.equal(players[0].loaded, true);
  assert.equal(mediaSession.playbackState, 'none');
  assert.equal(mediaSession.metadata, null);
  assert.deepEqual(clearPosition.mock.calls.map(call => call.arguments), [[]]);
  events.get('game_api_pause')!();
  lifecycle.pauseFor('hidden', true);
  ads[0].onClose(false);
  ads[0].onClose(true);
  await ad;
  events.get('game_api_resume')!();
  events.get('game_api_resume')!();
  audio.unlock();
  assert.equal(players.length, 1);
  lifecycle.pauseFor('hidden', false);
  assert.equal(players.length, 2);
  assert.equal(players[1].starts, 0);
  lifecycle.pauseFor('hidden', true);
  players[1].metadata();
  assert.equal(players[1].starts, 0);
  lifecycle.pauseFor('hidden', false);
  assert.equal(players.length, 3);
  players[2].metadata();
  assert.equal(players[2].currentTime, 14);
  assert.equal(players[2].starts, 1);
  assert.equal(players[2].volume, 0.6);

  audio.setVolumes({ music: 0, effects: 1 });
  assert.equal(players[2].released, true);
  audio.setVolumes({ music: 0.25, effects: 1 });
  assert.equal(players.length, 4);
  players[3].metadata();
  assert.equal(players[3].volume, 0.25);
  assert.equal(players[3].currentTime, 14);
});

test('effects preload shared resources once, respect their own volume and stop across pauses', async t => {
  const gain = { gain: { value: 1 }, connect() {} };
  const calls: string[] = [];
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array([1])));
  class Context {
    state = 'suspended';
    createGain() { return gain; }
    createBufferSource() {
      return {
        connect() {},
        start() { calls.push('play'); },
        stop() { calls.push('stop'); },
      };
    }
    async decodeAudioData() { return {}; }
    async suspend() { this.state = 'suspended'; calls.push('suspend'); }
    async resume() {
      calls.push('resume');
      await Promise.resolve();
      this.state = 'running';
    }
  }
  mockGlobal(t, 'AudioContext', Context);
  const audio = new BrowserAudioOutput(event => event === 'item_pickup' || event === 'shelf_reveal' ? 'shared-effect' : null);
  assert.equal(fetch.mock.callCount(), 1);
  audio.setVolumes({ music: 0, effects: 0.35 });
  await new Promise<void>(resolve => setImmediate(resolve));
  audio.play('item_pickup');
  assert.deepEqual(calls, []);
  audio.unlock();
  audio.play('item_pickup');
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(gain.gain.value, 0.35);
  audio.setPaused(true);
  audio.play('shelf_reveal');
  audio.setPaused(false);
  audio.play('shelf_reveal');
  await new Promise<void>(resolve => setImmediate(resolve));
  audio.setVolumes({ music: 0.8, effects: 0 });
  audio.play('shelf_reveal');
  assert.equal(gain.gain.value, 0);
  assert.deepEqual(calls, ['resume', 'play', 'stop', 'suspend', 'resume', 'play']);
});

test('touch release retries a pending unlock and effects expire or are invalidated across pauses', async t => {
  const activation = { isActive: false };
  const resumes: (() => void)[] = [];
  const played = t.mock.fn();
  let now = 0;
  mockGlobal(t, 'performance', { now: () => now });
  mockGlobal(t, 'navigator', { userActivation: activation });
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array([1])));
  class Context {
    state = 'suspended';
    createGain() { return { gain: { value: 0 }, connect() {} }; }
    createBufferSource() { return { connect() {}, start: played, stop() {} }; }
    async decodeAudioData() { return {}; }
    async suspend() { this.state = 'suspended'; }
    resume() {
      return new Promise<void>(resolve => resumes.push(() => { this.state = 'running'; resolve(); }));
    }
  }
  mockGlobal(t, 'AudioContext', Context);
  const audio = new BrowserAudioOutput(event => event === 'item_pickup' ? 'effect' : null);
  audio.setVolumes({ music: 0, effects: 1 });
  await new Promise<void>(resolve => setImmediate(resolve));

  audio.unlock();
  audio.play('item_pickup');
  activation.isActive = true;
  audio.unlock();
  assert.equal(resumes.length, 2);
  now = 101;
  resumes[1]();
  resumes[0]();
  await Promise.resolve();
  assert.equal(played.mock.callCount(), 0);
  audio.play('item_pickup');
  assert.equal(played.mock.callCount(), 1);

  audio.setPaused(true);
  audio.setPaused(false);
  audio.play('item_pickup');
  audio.setPaused(true);
  audio.setPaused(false);
  resumes[2]();
  resumes[3]();
  await Promise.resolve();
  assert.equal(played.mock.callCount(), 1);
  audio.play('item_pickup');
  assert.equal(played.mock.callCount(), 2);
});

test('the shared pickup and reveal buffer replaces its previous voice and rapid UI clicks both play', async t => {
  const calls: string[] = [];
  const voices: { onended: (() => void) | null }[] = [];
  mockGlobal(t, 'performance', { now: () => 100 });
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array([1])));
  class Context {
    state = 'running';
    createGain() { return { gain: { value: 0 }, connect() {} }; }
    createBufferSource() {
      const id = voices.length;
      const voice = {
        connect() {}, disconnect() {},
        onended: null,
        start() { calls.push(`start:${id}`); },
        stop() { calls.push(`stop:${id}`); },
      };
      voices.push(voice);
      return voice;
    }
    async decodeAudioData() { return {}; }
    async suspend() { this.state = 'suspended'; }
  }
  mockGlobal(t, 'AudioContext', Context);
  const audio = new BrowserAudioOutput(event =>
    event === 'item_pickup' || event === 'shelf_reveal' ? 'shared' : event === 'ui_click' ? 'click' : null);
  audio.setVolumes({ music: 0, effects: 1 });
  await new Promise<void>(resolve => setImmediate(resolve));
  audio.unlock();

  audio.play('item_pickup');
  audio.play('shelf_reveal');
  // The stopped pickup's ended callback must not clear the active reveal voice.
  voices[0].onended?.();
  audio.play('item_pickup');
  audio.play('ui_click');
  audio.play('ui_click');
  assert.deepEqual(calls, ['start:0', 'stop:0', 'start:1', 'stop:1', 'start:2', 'start:3', 'start:4']);
  audio.setPaused(true);
  assert.deepEqual(calls.slice(7), ['stop:2', 'stop:3', 'stop:4']);
});

test('a failed decode prepares a reusable media fallback that only plays a ready sound on a new action', async t => {
  const players: Player[] = [];
  const decode = t.mock.fn(async () => { throw new Error('decode failed'); });
  class Context {
    state = 'running';
    createGain() { return { gain: { value: 0 }, connect() {} }; }
    decodeAudioData = decode;
    async suspend() { this.state = 'suspended'; }
    async resume() { this.state = 'running'; }
  }
  class Player {
    static readonly HAVE_ENOUGH_DATA = 4;
    readyState = 0;
    paused = true;
    volume = 0;
    currentTime = 1;
    readonly path: string;
    load = t.mock.fn();
    play = t.mock.fn(async () => { this.paused = false; });
    pause() { this.paused = true; }
    constructor(path: string) { this.path = path; players.push(this); }
  }
  mockGlobal(t, 'AudioContext', Context);
  mockGlobal(t, 'Audio', Player);
  mockGlobal(t, 'HTMLMediaElement', Player);
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array([1])));
  const audio = new BrowserAudioOutput(event =>
    event === 'match_three' ? 'match' : event !== 'background_music' ? 'shared' : null);
  audio.setVolumes({ music: 0, effects: 0.4 });
  audio.unlock();
  audio.play('item_pickup');
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(decode.mock.callCount(), 2);
  assert.equal(players.length, 2);
  const player = players.find(({ path }) => path === 'shared')!;
  const match = players.find(({ path }) => path === 'match')!;
  assert.equal(player.load.mock.callCount(), 1);
  audio.play('item_pickup');
  player.readyState = Player.HAVE_ENOUGH_DATA;
  assert.equal(player.play.mock.callCount(), 0);
  audio.play('item_pickup');
  player.currentTime = 0.05;
  audio.play('shelf_reveal');
  assert.equal(player.play.mock.callCount(), 2);
  assert.equal(player.currentTime, 0);
  assert.equal(player.volume, 0.4);
  match.readyState = Player.HAVE_ENOUGH_DATA;
  audio.play('match_three');
  assert.equal(match.paused, false);
  audio.play('shelf_reveal', 'match_three');
  assert.equal(match.paused, true);
  assert.equal(player.play.mock.callCount(), 3);
  audio.setPaused(true);
  assert.equal(player.paused, true);
  audio.play('item_pickup');
  assert.equal(player.play.mock.callCount(), 3);
});
