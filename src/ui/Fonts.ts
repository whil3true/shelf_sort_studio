export const studioFont = '"Studio Nunito", Arial, sans-serif';

export async function loadFonts(): Promise<void> {
  if (!document.fonts) return;
  // Canvas measures text when it is created. Load both subsets before mounting
  // so the first screen and subsequent language switches use the same metrics.
  await document.fonts.load('700 24px "Studio Nunito"', 'Shelf 01 · Ёйъ… №').catch(() => {
    // Text still renders with the system fallback if a font fails to load.
  });
}
