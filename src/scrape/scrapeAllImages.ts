import { TermData } from '../types';
import {
  CROPPED_IMAGE_NAME,
  CROPPED_IMG_DIR,
  IMAGES_DIRECTORY,
  IMAGE_NAME,
  KANJI_IMAGE_URL,
  TRIMMED_DIRECTORY,
} from '../constants';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import cliProgress from 'cli-progress';

// How many images to download/process at once. Downloads dominate the runtime
// and are latency-bound, so running several concurrently is far faster than one
// at a time; the limit keeps us from hammering the image hosts.
const IMAGE_CONCURRENCY = 12;

export async function scrapeAllImages(termDataArr: TermData[]) {
  const sourceImageDir = path.join(process.cwd(), IMAGES_DIRECTORY);
  const processedImageDir = path.join(process.cwd(), TRIMMED_DIRECTORY);
  const croppedImageDir = path.join(process.cwd(), CROPPED_IMG_DIR);

  await createDirectoryIfNotExists(sourceImageDir);
  await createDirectoryIfNotExists(processedImageDir);
  await createDirectoryIfNotExists(croppedImageDir);

  const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

  console.log('Scraping images');
  bar.start(termDataArr.length, 0);

  await runWithConcurrency(termDataArr, IMAGE_CONCURRENCY, async (termData) => {
    try {
      await downloadAndProcessImage(
        termData,
        sourceImageDir,
        processedImageDir,
        croppedImageDir
      );
    } finally {
      bar.increment();
    }
  });

  bar.stop();
}

/**
 * Downloads (if not already cached) and processes a single term's image.
 */
async function downloadAndProcessImage(
  termData: TermData,
  sourceImageDir: string,
  processedImageDir: string,
  croppedImageDir: string
): Promise<void> {
  const levelID = termData.termInfo.問題ID;
  if (!levelID) {
    console.error(`No level ID found for term ${termData.termReading.term}`);
    return;
  }
  const imageFilePath = path.join(sourceImageDir, IMAGE_NAME(levelID));

  // Check if image already exists
  if (!fs.existsSync(imageFilePath)) {
    // Prefer the plicy game render; fall back to the wiki-hosted image (some
    // IDs, e.g. the higher Lv.8 ones, are missing from plicy).
    const imageSources = [KANJI_IMAGE_URL(levelID)];
    if (termData.termImageUrl) {
      imageSources.push(termData.termImageUrl);
    }

    let downloaded = false;
    for (const source of imageSources) {
      if (await downloadImage(source, imageFilePath, sourceImageDir)) {
        downloaded = true;
        break;
      }
    }
    if (!downloaded) {
      console.error(`No image available for ${levelID}`);
      return;
    }
  }

  await processImage(sourceImageDir, processedImageDir, croppedImageDir, levelID);
}

/**
 * Runs an async worker over items with at most `limit` of them in flight at once.
 */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (index < items.length) {
        const current = index;
        index += 1;
        await worker(items[current]);
      }
    }
  );
  await Promise.all(runners);
}

/**
 * Process a single image by trimming transparency and cropping it.
 * The processed image will be saved in the processed directory,
 * and the cropped image will be saved in the cropped directory.
 * @param sourceImageDir The directory containing the source images.
 * @param processedImageDir The directory where the processed images will be saved.
 * @param croppedImageDir The directory where the cropped images will be saved.
 * @param ID The ID of the image.
 */
async function processImage(
  sourceImageDir: string,
  processedImageDir: string,
  croppedImageDir: string,
  ID: string
) {
  const sourceImagePath = path.join(sourceImageDir, IMAGE_NAME(ID));
  const processedImagePath = path.join(processedImageDir, IMAGE_NAME(ID));
  const croppedImagePath = path.join(croppedImageDir, CROPPED_IMAGE_NAME(ID));

  try {
    // Check if the processed image already exists
    if (!(await checkIfImageExists(processedImagePath))) {
      // Trim the image and save it
      await trimImage(sourceImagePath, processedImagePath);
    }

    // Check if the cropped image already exists
    if (!(await checkIfImageExists(croppedImagePath))) {
      // Only the transparent plicy game renders are cropped. Opaque fallback
      // screenshots (from the wiki) have a centred kanji, so they are kept whole.
      const { hasAlpha } = await sharp(processedImagePath).metadata();
      if (hasAlpha) {
        await cropImage(processedImagePath, croppedImagePath);
      } else {
        await fs.promises.copyFile(processedImagePath, croppedImagePath);
      }
    }
  } catch (error) {
    // A single unreadable/corrupt source image shouldn't abort the whole batch.
    console.error(`Error processing image ${ID}: ${error}`);
  }
}

async function checkIfImageExists(imagePath: string): Promise<boolean> {
  return fs.existsSync(imagePath);
}

async function createDirectoryIfNotExists(directory: string): Promise<void> {
  if (!fs.existsSync(directory)) {
    await fs.promises.mkdir(directory);
  }
}

/**
 * Downloads an image to destPath, returning whether it succeeded. A non-2xx
 * response or a network error is treated as a miss so the caller can fall back
 * to the next source rather than writing an error page to disk.
 */
async function downloadImage(
  url: string,
  destPath: string,
  destDir: string,
  attempts = 3
): Promise<boolean> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir);
        }
        fs.writeFileSync(destPath, Buffer.from(buffer));
        return true;
      }
      // A 404 is a genuine miss; other statuses (e.g. 429/5xx) may be transient
      // under load, so they are retried before giving up on this source.
      if (response.status === 404) {
        return false;
      }
    } catch (error) {
      if (attempt === attempts) {
        console.error(`Error fetching ${url}: ${error}`);
      }
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
  return false;
}

/**
 * Trims the transparency from an image.
 * @param imagePath The path to the image file.
 * @returns A Promise that resolves to a Sharp instance representing the trimmed image.
 */
async function trimImage(imagePath: string, outputPath: string): Promise<void> {
  await sharp(imagePath).trim().toFile(outputPath);
}

/**
 * Crops the reading-hint row off the top of a (trimmed) game image, leaving just
 * the kanji.
 *
 * The game renders a row of circles (the 文字指定 — how many kana the reading is)
 * above the kanji, separated by a transparent gap. We reduce each row to its mean
 * alpha to find content rows vs gaps: if the topmost content block is a short band
 * separated from the rest by a clear gap, it's the hint row and gets removed.
 * Images with no hint row (a single content block) are left whole. This adapts to
 * the game's image scale, which a fixed-pixel crop cannot.
 */
async function cropImage(imagePath: string, destFilePath: string) {
  const metadata = await sharp(imagePath).metadata();
  if (!metadata?.height || !metadata?.width) {
    console.error(`Error reading metadata for image ${destFilePath}`);
    return;
  }
  const { height, width } = metadata;

  const rowAlpha = await sharp(imagePath)
    .ensureAlpha()
    .extractChannel('alpha')
    .resize(1, height, { fit: 'fill' })
    .raw()
    .toBuffer();
  const rowHasContent = Array.from(rowAlpha, (alpha) => alpha > 5);
  const blocks = findContentBlocks(rowHasContent);

  // The hint row is a fixed-size UI element: across all images its height sits in
  // a tight 63–72px band. Requiring the first block to fall in this range (with a
  // little margin) avoids mistaking a kanji's own short top strokes for the hint
  // — e.g. 云云 (Lv04_0940), whose 47px top would otherwise be cropped off.
  const HINT_MIN_HEIGHT = 56;
  const HINT_MAX_HEIGHT = 80;

  let cropTop = 0;
  if (blocks.length >= 2) {
    const [firstStart, firstEnd] = blocks[0];
    const firstHeight = firstEnd - firstStart + 1;
    const gap = blocks[1][0] - firstEnd - 1;
    // Treat the first block as a hint row only if it sits at the top, is a small
    // fraction of the image, is a plausible hint height, and is clearly separated
    // from the kanji below.
    if (
      firstStart <= 3 &&
      firstHeight >= HINT_MIN_HEIGHT &&
      firstHeight <= HINT_MAX_HEIGHT &&
      firstHeight < height * 0.35 &&
      gap >= 4
    ) {
      cropTop = blocks[1][0];
    }
  }

  await sharp(imagePath)
    .extract({ top: cropTop, left: 0, width, height: height - cropTop })
    .trim()
    .toFile(destFilePath)
    .catch((err) => {
      console.error(`Error cropping image ${destFilePath}: ${err}`);
    });
}

/**
 * Returns the [start, end] row ranges of consecutive content rows.
 */
function findContentBlocks(rowHasContent: boolean[]): [number, number][] {
  const blocks: [number, number][] = [];
  let start = -1;
  for (let y = 0; y < rowHasContent.length; y++) {
    if (rowHasContent[y]) {
      if (start < 0) start = y;
    } else if (start >= 0) {
      blocks.push([start, y - 1]);
      start = -1;
    }
  }
  if (start >= 0) blocks.push([start, rowHasContent.length - 1]);
  return blocks;
}
