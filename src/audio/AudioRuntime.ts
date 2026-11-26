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
  private waitingForMusicMetadata = false;
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly fallbackEffects = new Map<string, HTMLAudioElement>();
  private readonly voices = new Set<AudioBufferSourceNode>();
  private readonly lastEffectAt = new Map<AudioEffect, number>();
  private effectsResume: Promise<void> | null = null;
  private effectsPauseRevision = 0;
  private volumes: Readonly<Volumes> = { music: 0, effects: 0 };
  private unlocked = false;
  private paused = false;

  private readonly pathFor: typeof audioPath;
  // Android Chrome's desktop site mode can omit Android from the user agent.
  private readonly releaseSourceOnPause = /\b(?:Android|Chrome|Chromium)\b/i.test(navigator.userAgent);

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
      if (Constructor) {
        const context = new Constructor();
        const gain = context.createGain();
        gain.gain.value = this.volumes.effects;
        gain.connect(context.destination);
        this.context = context;
        this.gain = gain;
      }
    } catch { /* Fall back to preloaded media when Web Audio is unavailable. */ }

    for (const path of paths) {
      if (!path) continue;
      const context = this.context;
      if (!context) {
        this.prepareFallback(path);
        continue;
      }
      void fetch(path).then(response => {
        if (!response.ok) throw new Error(`Cannot load sound effect: ${path}`);
        return response.arrayBuffer();
      }).then(bytes => context.decodeAudioData(bytes))
        .then(buffer => this.buffers.set(path, buffer))
        .catch(() => this.prepareFallback(path));
    }
  }

  unlock(): void {
    if (this.paused) return;
    this.unlocked = true;
    // Touch activation can arrive on release while the pointerdown resume is still pending.
    if (this.context?.state !== 'running' && (!this.effectsResume || navigator.userActivation?.isActive !== false)) {
      this.resumeEffects();
    }
    this.syncMusic();
  }

  setVolumes(volumes: Readonly<Volumes>): void {
    const musicChanged = volumes.music !== this.volumes.music;
    this.volumes = { ...volumes };
    if (this.gain) this.gain.gain.value = volumes.effects;
    for (const player of this.fallbackEffects.values()) player.volume = volumes.effects;
    if (musicChanged) this.syncMusic();
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      this.effectsPauseRevision++;
      this.effectsResume = null;
      this.lastEffectAt.clear();
      for (const voice of this.voices) voice.stop();
      this.voices.clear();
      for (const player of this.fallbackEffects.values()) player.pause();
      void this.context?.suspend().catch(() => {});
    } else if (this.unlocked) {
      // Queue resume even when a no-fill callback arrives before suspend settles.
      this.resumeEffects();
    }
    this.syncMusic();
  }

  play(effect: AudioEffect): void {
    const path = this.pathFor(effect);
    if (!path || !this.unlocked || this.paused || !this.volumes.effects) return;
    const buffer = this.buffers.get(path);
    const fallback = this.fallbackEffects.get(path);
    if (!buffer && (!fallback || fallback.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA || !fallback.paused)) return;

    const now = performance.now();
    const previous = this.lastEffectAt.get(effect);
    if (previous !== undefined && now - previous < 50) return;
    this.lastEffectAt.set(effect, now);
    if (!buffer) {
      if (fallback) this.playFallback(fallback);
      return;
    }
    if (this.context?.state === 'running') {
      this.startEffect(buffer);
      return;
    }

    // A decoded clip can follow a gesture or ad resume by one audio startup interval.
    // Drop it if resume is slow or another pause supersedes the event.
    const revision = this.effectsPauseRevision;
    const deadline = now + 100;
    void this.effectsResume?.then(() => {
      if (revision === this.effectsPauseRevision && performance.now() <= deadline) this.startEffect(buffer);
    }, () => {});
  }

  private resumeEffects(): void {
    if (!this.context) return;
    const resume = this.context.resume();
    this.effectsResume = resume;
    const clear = () => { if (this.effectsResume === resume) this.effectsResume = null; };
    void resume.then(clear, clear);
  }

  private prepareFallback(path: string): void {
    try {
      const player = new Audio(path);
      player.preload = 'auto';
      player.volume = this.volumes.effects;
      player.load();
      this.fallbackEffects.set(path, player);
    } catch { /* Unsupported media leaves the game playable. */ }
  }

  private playFallback(player: HTMLAudioElement): void {
    try {
      player.currentTime = 0;
      void player.play().catch(() => {});
    } catch { /* A later gesture may be allowed to play. */ }
  }

  private startEffect(buffer: AudioBuffer): void {
    if (this.paused || !this.volumes.effects || this.context?.state !== 'running' || !this.gain) return;
    try {
      const voice = this.context.createBufferSource();
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
      this.pauseMusic();
      return;
    }
    try {
      if (!this.music) {
        const player = new Audio(path);
        player.loop = true;
        player.preload = 'auto';
        this.music = player;
        const position = this.musicPosition;
        if (position > 0 && player.readyState === 0) {
          // WebKit can discard a seek made before the new source has metadata.
          this.waitingForMusicMetadata = true;
          player.addEventListener('loadedmetadata', () => {
            if (this.music !== player) return;
            this.restoreMusicPosition(player, position);
            this.waitingForMusicMetadata = false;
            this.syncMusic();
          }, { once: true });
          player.load();
        } else if (position > 0) {
          this.restoreMusicPosition(player, position);
        }
      }
      const player = this.music;
      player.volume = this.volumes.music;
      if (this.waitingForMusicMetadata || !player.paused || player.error) return;
      void player.play().catch(() => {});
    } catch { /* A later trusted gesture can retry a rejected play(). */ }
  }

  private restoreMusicPosition(player: HTMLAudioElement, position: number): void {
    try { player.currentTime = position; } catch { /* Leave unseekable media playable. */ }
  }

  private pauseMusic(): void {
    const player = this.music;
    if (!player) return;
    try {
      if (this.releaseSourceOnPause) this.releaseMusicElement(player);
      else player.pause(); // Keep the loaded decoder and its position in WebKit and desktop Firefox.
    } catch { /* Some mobile browsers interrupt media teardown. */ }
    this.clearMediaSession();
  }

  private releaseMusicElement(player: HTMLAudioElement): void {
    if (!this.waitingForMusicMetadata && Number.isFinite(player.currentTime)) {
      this.musicPosition = player.currentTime;
    }
    this.waitingForMusicMetadata = false;
    this.music = null;
    player.pause();
    player.removeAttribute('src');
    player.load();
  }

  private clearMediaSession(): void {
    try {
      const session = navigator.mediaSession;
      if (!session) return;
      session.playbackState = 'none';
      session.metadata = null;
      session.setPositionState?.();
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
