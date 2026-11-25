import { GOODS } from '../game/Board.ts';

function asset<Id extends string>(id: Id, directory: 'items' | 'shelves' | 'logo') {
  return { id, webp: `assets/art-refresh/${directory}/${id}.webp`, fallback: `assets/art/${id}.png` };
}

export const ART_REFRESH = [
  ...GOODS.map(id => asset(id, 'items')),
  asset('shelf', 'shelves'),
  asset('wordmark-ru', 'logo'),
  asset('wordmark-en', 'logo'),
];

export type ArtId = (typeof ART_REFRESH)[number]['id'];
export type ArtPaths = Record<ArtId, string>;

export function resolveArtPaths(hasFile: (publicPath: string) => boolean): ArtPaths {
  return Object.fromEntries(ART_REFRESH.map(({ id, webp, fallback }) => [
    id, hasFile(webp) ? webp : fallback,
  ])) as ArtPaths;
}

// Vite resolves URLs against the files present in public at startup/build time.
declare const __STUDIO_ART_PATHS__: ArtPaths;
export const artPaths = () => __STUDIO_ART_PATHS__;
