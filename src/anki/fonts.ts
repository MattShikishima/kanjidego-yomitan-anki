import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { FONTS_DIRECTORY, JIGMO_FONTS, JIGMO_RELEASE_URL } from '../constants';

// Cache files live under a release-specific subdirectory (derived from the
// release URL's filename) rather than directly in FONTS_DIRECTORY, so bumping
// JIGMO_RELEASE_URL to a newer release changes the cache path and forces a
// fresh download instead of silently reusing files from the old one.
function releaseCacheDir(): string {
  const releaseName = path.basename(JIGMO_RELEASE_URL, '.zip');
  return path.join(process.cwd(), FONTS_DIRECTORY, releaseName);
}

/**
 * Downloads and caches the Jigmo fonts (CC0) used by the .apkg's rare-kanji
 * font-face rules. Cached under FONTS_DIRECTORY so repeat builds don't
 * re-download the ~65MB of font files.
 */
export async function ensureJigmoFonts(): Promise<
  { mediaName: string; data: Buffer }[]
> {
  const cacheDir = releaseCacheDir();
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  const missing = JIGMO_FONTS.filter(
    ([, mediaName]) => !fs.existsSync(path.join(cacheDir, mediaName))
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
      // Write to a temp path and rename into place atomically, so a build
      // killed mid-write (disk full, Ctrl-C, OOM) never leaves a truncated
      // file sitting at the filename future runs treat as "already cached".
      const destPath = path.join(cacheDir, mediaName);
      const tmpPath = `${destPath}.tmp-${process.pid}`;
      fs.writeFileSync(tmpPath, data);
      fs.renameSync(tmpPath, destPath);
    }
  }

  return JIGMO_FONTS.map(([, mediaName]) => ({
    mediaName,
    data: fs.readFileSync(path.join(cacheDir, mediaName)),
  }));
}
