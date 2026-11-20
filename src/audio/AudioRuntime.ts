import { AUDIO_ASSETS, audioPath, type AudioEffect } from './AudioAssetManifest.ts';
import type { Volumes } from '../platform/Storage.ts';

export interface AudioOutput {
  unlock(): void;
  play(effect: AudioEffect): void;
  setVolumes(volumes: Readonly<Volumes>): void;
  setPaused(paused: boolean): void;
}

export class BrowserAudioOutput implements AudioOutput {
  private music: HTMLAudioElement | null = null;
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly voices = new Set<AudioBufferSourceNode>();
  private volumes: Readonly<Volumes> = { music: 0, effects: 0 };
  private unlocked = false;
  private paused = false;
  private revision = 0;

  unlock(): void {
    this.unlocked = true;
    if (!this.context && Object.keys(AUDIO_ASSETS).some(event => event !== 'background_music'
      && audioPath(event as AudioEffect) !== null) && typeof AudioContext !== 'undefined') {
      try {
        this.context = new AudioContext();
        this.gain = this.context.createGain();
        this.gain.gain.value = this.volumes.effects;
        this.gain.connect(this.context.destination);
      } catch { /* An unavailable browser audio device leaves the game playable. */ }
    }
    if (!this.paused && this.context?.state !== 'running') void this.context?.resume().catch(() => {});
    this.syncMusic();
  }

  setVolumes(volumes: Readonly<Volumes>): void {
    this.volumes = { ...volumes };
    if (this.gain) this.gain.gain.value = volumes.effects;
    this.syncMusic();
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.revision++;
    if (paused) {
      for (const voice of this.voices) voice.stop();
      this.voices.clear();
      void this.context?.suspend().catch(() => {});
    } else if (this.unlocked) {
      void this.context?.resume().catch(() => {});
    }
    this.syncMusic();
  }

  play(effect: AudioEffect): void {
    const path = audioPath(effect);
    const context = this.context;
    if (!path || !context || !this.gain || !this.unlocked || this.paused || !this.volumes.effects) return;
    const revision = this.revision;
    let pending = this.buffers.get(path);
    if (!pending) {
      pending = fetch(path).then(response => response.ok ? response.arrayBuffer() : null)
        .then(bytes => bytes && context.decodeAudioData(bytes)).catch(() => null);
      this.buffers.set(path, pending);
    }
    void pending.then(buffer => {
      if (!buffer || revision !== this.revision || this.paused || !this.volumes.effects || context.state !== 'running') return;
      const voice = context.createBufferSource();
      voice.buffer = buffer;
      voice.connect(this.gain!);
      this.voices.add(voice);
      voice.onended = () => { this.voices.delete(voice); voice.disconnect(); };
      voice.start();
    }).catch(() => {});
  }

  private syncMusic(): void {
    const path = audioPath('background_music');
    if (!path || !this.unlocked) return;
    if (!this.music) {
      this.music = new Audio(path);
      this.music.loop = true;
      this.music.preload = 'none';
      this.music.addEventListener('error', () => this.music?.pause());
    }
    this.music.volume = this.volumes.music;
    if (this.paused || !this.volumes.music || this.music.error) {
      this.music.pause();
    } else if (this.music.paused) {
      void this.music.play().catch(() => {});
    }
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
    if (paused) this.pauseReasons.add(reason);
    else this.pauseReasons.delete(reason);
    this.output.setPaused(this.pauseReasons.size > 0);
  }
}

export function attachAudioGestures(audio: AudioRuntime): () => void {
  const unlock = () => audio.unlock();
  const events = ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const;
  for (const event of events) window.addEventListener(event, unlock, { capture: true, passive: true });
  return () => { for (const event of events) window.removeEventListener(event, unlock, true); };
}
