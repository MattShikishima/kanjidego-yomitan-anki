import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { FONTS_DIRECTORY, JIGMO_FONTS, JIGMO_RELEASE_URL } from '../constants';

/**
 * Downloads and caches the Jigmo fonts (CC0) used by the .apkg's rare-kanji
 * font-face rules. Cached under FONTS_DIRECTORY so repeat builds don't
 * re-download the ~65MB of font files.
 */
export async function ensureJigmoFonts(): Promise<
  { mediaName: string; data: Buffer }[]
> {
  const fontsDir = path.join(process.cwd(), FONTS_DIRECTORY);
  if (!fs.existsSync(fontsDir)) fs.mkdirSync(fontsDir, { recursive: true });

  const missing = JIGMO_FONTS.filter(
    ([, mediaName]) => !fs.existsSync(path.join(fontsDir, mediaName))
  );
  if (missing.length > 0) {
    console.log(`Downloading Jigmo fonts from ${JIGMO_RELEASE_URL}...`);
    const res = await fetch(JIGMO_RELEASE_URL);
    if (!res.ok) {
      throw new Error(
        `Failed to download Jigmo fonts: ${res.status} ${res.statusText}`
      );
    }
    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    for (const [zipEntryName, mediaName] of missing) {
      const entry = zip.file(zipEntryName);
      if (!entry) {
        throw new Error(`Jigmo release zip is missing expected file: ${zipEntryName}`);
      }
      const data = await entry.async('nodebuffer');
      fs.writeFileSync(path.join(fontsDir, mediaName), data);
    }
  }

  return JIGMO_FONTS.map(([, mediaName]) => ({
    mediaName,
    data: fs.readFileSync(path.join(fontsDir, mediaName)),
  }));
}
