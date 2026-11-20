interface AudioAsset { file: string; enabled: boolean }

export const AUDIO_ASSETS = {
  ui_click: { file: 'ui_click.ogg', enabled: false },
  item_pickup: { file: 'item_pickup.ogg', enabled: false },
  item_place: { file: 'item_place.ogg', enabled: false },
  item_invalid: { file: 'item_invalid.ogg', enabled: false },
  match_three: { file: 'match_three.ogg', enabled: false },
  shelf_reveal: { file: 'shelf_reveal.ogg', enabled: false },
  level_complete: { file: 'level_complete.ogg', enabled: false },
  background_music: { file: 'background_music.ogg', enabled: false },
} satisfies Record<string, AudioAsset>;

export type AudioEffect = Exclude<keyof typeof AUDIO_ASSETS, 'background_music'>;

export function audioPath(event: keyof typeof AUDIO_ASSETS): string | null {
  const asset = AUDIO_ASSETS[event];
  return asset.enabled ? `./assets/audio/${asset.file}` : null;
}
