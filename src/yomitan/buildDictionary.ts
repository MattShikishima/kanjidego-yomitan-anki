import {
  EXPORT_DIRECTORY,
  KANJI_DE_GO_NAME,
  CROPPED_IMG_DIR,
  WIKI_ATTRIBUTION_URL,
} from '../constants';
import { Dictionary, TermEntry } from 'yomichan-dict-builder';
import { TermData } from '../types';
import path from 'path';
import { convertTermToDetailedDefinition } from './convertTermToDetailedDefinition';
import fs from 'fs';

export async function buildDictionary(termDataArr: TermData[]) {
  console.log('Building Yomitan dictionary');

  const dateString = new Date().toISOString().split('T')[0];
  const dictionary = new Dictionary({
    fileName: `${KANJI_DE_GO_NAME}.zip`,
  });

  dictionary.setIndex({
    title: `漢字でGo! [${dateString}]`,
    author: 'Marv',
    attribution: `https://formidi.github.io/KanzideGoFAQ/
${WIKI_ATTRIBUTION_URL}`,
    description: `From the Kanji de Go! unofficial wiki.
Built with https://github.com/MarvNC/yomichan-dict-builder`,
    revision: dateString,
    url: 'https://github.com/MarvNC/kanjidego-yomitan-anki',
  });

  await addAllImagesToDictionary(dictionary);

  // addTerm must be awaited: it flushes the term bank to the zip once it reaches
  // termBankMaxSize (10,000), and without awaiting, that reset never runs between
  // synchronous iterations, so every later addTerm re-serialises the whole
  // ever-growing term bank and the build runs out of memory.
  for (const termData of termDataArr) {
    await addTermToDictionary(termData, dictionary);
  }

  const exportDir = path.join(process.cwd(), EXPORT_DIRECTORY);
  const stats = await dictionary.export(exportDir);
  console.log(`Exported ${stats.termCount} terms to ${exportDir}!`);
}

async function addTermToDictionary(
  termData: TermData,
  dictionary: Dictionary
) {
  const { term, reading } = termData.termReading;
  // Some terms have an empty term string because they're too rare
  const termEntry = new TermEntry(term || reading);
  termEntry.setReading(reading);

  const detailedDefinition = convertTermToDetailedDefinition(termData);
  termEntry.addDetailedDefinition(detailedDefinition);

  termEntry.setTermTags('漢字でGo!');

  await dictionary.addTerm(termEntry.build());

  // Deprioritize alternates
  termEntry.setPopularity(-5);

  // Add alternate terms
  if (termData.termInfo.別表記) {
    for (const altTerm of termData.termInfo.別表記) {
      termEntry.setTerm(altTerm);
      await dictionary.addTerm(termEntry.build());
    }
  }
  // Add alternate readings
  if (termData.termInfo.別解) {
    for (const altReading of termData.termInfo.別解) {
      termEntry.setReading(altReading);
      // If the term and reading was the same
      if (term === reading) {
        termEntry.setTerm(altReading);
      }
      await dictionary.addTerm(termEntry.build());
    }
  }
}

async function addAllImagesToDictionary(dictionary: Dictionary) {
  const imageDir = path.join(process.cwd(), CROPPED_IMG_DIR);
  const imageFiles = fs.readdirSync(imageDir);
  for (const imageFile of imageFiles) {
    const imageFilePath = path.join(imageDir, imageFile);
    // The images are already-compressed PNGs, so store them uncompressed instead
    // of using the export's default DEFLATE. Re-deflating thousands of PNGs only
    // shrinks the zip by ~3% but makes the in-memory zip build run out of memory.
    dictionary.zip.file(`img/${imageFile}`, fs.readFileSync(imageFilePath), {
      compression: 'STORE',
    });
  }
  console.log(`Added ${imageFiles.length} images to dictionary`);
}
