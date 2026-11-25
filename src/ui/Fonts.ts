export async function loadFonts(): Promise<void> {
  if (!document.fonts) return;
  const sample = 'Shelf Studio Полки';
  await Promise.allSettled([
    document.fonts.load('700 24px "Studio Serif"', sample),
    document.fonts.load('400 24px "Studio Sans"', sample),
    document.fonts.load('600 24px "Studio Sans"', sample),
    document.fonts.load('700 24px "Studio Sans"', sample),
  ]);
}
