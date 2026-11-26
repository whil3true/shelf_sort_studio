import { AUDIO_ASSETS, audioPath, type AudioEffect, type AudioEvent } from './AudioAssetManifest.ts';
import type { Volumes } from '../platform/Storage.ts';

export interface AudioOutput {
  unlock(): void;
  play(effect: AudioEffect): void;
  setVolumes(volumes: Readonly<Volumes>): void;
  setPaused(paused: boolean): void;
}

export class BrowserAudioOutput implements AudioOutput {
  private music: HTMLAudioElement | null = null;
  private musicPosition = 0;
  private musicPlayPending = false;
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly voices = new Set<AudioBufferSourceNode>();
  private volumes: Readonly<Volumes> = { music: 0, effects: 0 };
  private unlocked = false;
  private paused = false;

  private readonly pathFor: typeof audioPath;

  constructor(pathFor: typeof audioPath = audioPath) {
    this.pathFor = pathFor;
    const paths = new Set((Object.keys(AUDIO_ASSETS) as AudioEvent[])
      .filter(event => event !== 'background_music').map(event => pathFor(event)));
    paths.delete(null);
    if (!paths.size) return;

    // Decode ahead of the first gesture. No effect can play until unlock().
    try {
      const browser = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
      const Constructor = browser.AudioContext ?? browser.webkitAudioContext;
      if (!Constructor) return;
      const context = new Constructor();
      const gain = context.createGain();
      gain.gain.value = this.volumes.effects;
      gain.connect(context.destination);
      this.context = context;
      this.gain = gain;
      for (const path of paths) {
        if (!path) continue;
        void fetch(path).then(response => response.ok ? response.arrayBuffer() : null)
          .then(bytes => bytes && context.decodeAudioData(bytes))
          .then(buffer => { if (buffer) this.buffers.set(path, buffer); })
          .catch(() => {});
      }
    } catch { /* An unavailable audio device leaves the game playable. */ }
  }

  unlock(): void {
    if (this.paused) return;
    this.unlocked = true;
    if (this.context && this.context.state !== 'running') void this.context.resume().catch(() => {});
    this.syncMusic();
  }

  setVolumes(volumes: Readonly<Volumes>): void {
    const musicChanged = volumes.music !== this.volumes.music;
    this.volumes = { ...volumes };
    if (this.gain) this.gain.gain.value = volumes.effects;
    if (musicChanged) this.syncMusic();
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      for (const voice of this.voices) voice.stop();
      this.voices.clear();
      void this.context?.suspend().catch(() => {});
    } else if (this.unlocked) {
      // Queue resume even when a no-fill callback arrives before suspend settles.
      void this.context?.resume().catch(() => {});
    }
    this.syncMusic();
  }

  play(effect: AudioEffect): void {
    const path = this.pathFor(effect);
    const context = this.context;
    if (!path || !context || !this.gain || !this.unlocked || this.paused || !this.volumes.effects) return;
    const buffer = this.buffers.get(path);
    // Drop unavailable effects immediately so they cannot play on a later screen.
    if (!buffer || context.state !== 'running') return;
    try {
      const voice = context.createBufferSource();
      voice.buffer = buffer;
      voice.connect(this.gain);
      voice.onended = () => { this.voices.delete(voice); voice.disconnect(); };
      voice.start();
      this.voices.add(voice);
    } catch { /* Unsupported or interrupted playback is silent. */ }
  }

  private syncMusic(): void {
    const path = this.pathFor('background_music');
    if (!path || !this.unlocked) return;
    if (this.paused || !this.volumes.music) {
      this.releaseMusic();
      return;
    }
    try {
      if (!this.music) {
        const player = new Audio(path);
        player.loop = true;
        player.preload = 'auto';
        this.music = player;
        if (this.musicPosition > 0) player.currentTime = this.musicPosition;
      }
      const player = this.music;
      player.volume = this.volumes.music;
      if (this.musicPlayPending || !player.paused || player.error) return;
      this.musicPlayPending = true;
      void player.play().catch(() => {}).finally(() => {
        if (this.music === player) this.musicPlayPending = false;
      });
    } catch {
      // A later trusted gesture can retry a rejected play().
      this.musicPlayPending = false;
    }
  }

  private releaseMusic(): void {
    const player = this.music;
    if (!player) return;
    if (Number.isFinite(player.currentTime)) this.musicPosition = player.currentTime;
    this.music = null;
    this.musicPlayPending = false;
    try {
      player.pause();
      // Releasing the source also releases Android's native media controls.
      player.removeAttribute('src');
      player.load();
    } catch { /* Some mobile browsers interrupt media teardown. */ }
    try {
      if (navigator.mediaSession) {
        navigator.mediaSession.playbackState = 'none';
        navigator.mediaSession.metadata = null;
      }
    } catch { /* Media Session is optional. */ }
  }
}

export class AudioRuntime {
  private readonly output: AudioOutput;
  private readonly pauseReasons = new Set<string>();

  constructor(output: AudioOutput, volumes: Readonly<Volumes>) {
    this.output = output;
    this.output.setVolumes(volumes);
  }

  unlock() { this.output.unlock(); }
  play(effect: AudioEffect) { this.output.play(effect); }
  setVolumes(volumes: Readonly<Volumes>) { this.output.setVolumes(volumes); }

  pauseFor(reason: string, paused: boolean) {
    const wasPaused = this.pauseReasons.size > 0;
    if (paused) this.pauseReasons.add(reason);
    else this.pauseReasons.delete(reason);
    const isPaused = this.pauseReasons.size > 0;
    if (wasPaused !== isPaused) this.output.setPaused(isPaused);
  }
}

export function attachAudioGestures(audio: AudioRuntime): () => void {
  const unlock = (event: Event) => {
    if (!event.isTrusted || document.hidden || (event instanceof MouseEvent && event.button !== 0)) return;
    audio.unlock();
  };
  // Android may grant activation only on release. Retrying unlock emits no SFX.
  const events = ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const;
  for (const event of events) window.addEventListener(event, unlock, { capture: true, passive: true });
  return () => { for (const event of events) window.removeEventListener(event, unlock, true); };
}
