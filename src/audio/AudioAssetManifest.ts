import assets from './AudioAssets.json' with { type: 'json' };

export const AUDIO_ASSETS = assets.files;
export type AudioEvent = keyof typeof AUDIO_ASSETS;
export type AudioEffect = Exclude<AudioEvent, 'background_music'>;

export function audioPath(event: AudioEvent): string | null {
  return assets.enabled ? `./assets/audio/${AUDIO_ASSETS[event]}` : null;
}
