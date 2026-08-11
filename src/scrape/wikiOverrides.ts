import fs from 'fs';
import path from 'path';
import { WIKI_OVERRIDES_FILE } from '../constants';
import { TermData, TermInfo } from '../types';

/**
 * A correction for a known wiki error, keyed by 問題ID. Any field left out is
 * kept from the scrape. term/reading are applied before the term's info is built
 * (so 別表記 de-duplication and legacy matching use the corrected values); the
 * others replace the scraped values. An empty array clears a field. An override
 * for a 問題ID that isn't on the wiki at all is added as a new term (needs at
 * least term + reading).
 */
type WikiOverride = {
  note?: string;
  term?: string;
  reading?: string;
  意味?: string;
  別解?: string[];
  別表記?: string[];
  追記?: string;
};

const overrides = load();

function load(): Record<string, WikiOverride> {
  const filePath = path.join(process.cwd(), WIKI_OVERRIDES_FILE);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    console.error(`Could not load wiki overrides (${filePath}): ${error}`);
    return {};
  }
}

export function getWikiOverride(problemId: string): WikiOverride | undefined {
  return overrides[problemId];
}

/**
 * Applies an override's info fields (意味/別解/別表記/追記) to a term's info in
 * place. term/reading are handled by the caller before the info is built.
 */
export function applyInfoOverride(
  termInfo: TermInfo,
  override: WikiOverride
): void {
  if (override.意味 !== undefined) {
    termInfo.意味 = override.意味;
  }
  applyArrayField(termInfo, '別解', override.別解);
  applyArrayField(termInfo, '別表記', override.別表記);
  if (override.追記 !== undefined) {
    if (override.追記) termInfo.追記 = override.追記;
    else delete termInfo.追記;
  }
}

function applyArrayField(
  termInfo: TermInfo,
  key: '別解' | '別表記',
  value: string[] | undefined
): void {
  if (value === undefined) return;
  if (value.length > 0) termInfo[key] = value;
  else delete termInfo[key];
}

/**
 * Adds terms for any override whose 問題ID was not found in the scrape (i.e. the
 * wiki is missing the entry entirely).
 */
export function addMissingOverrides(termDataArr: TermData[]): void {
  const present = new Set(termDataArr.map((t) => t.termInfo.問題ID));
  for (const [problemId, override] of Object.entries(overrides)) {
    if (present.has(problemId)) continue;
    if (!override.term || !override.reading) {
      console.error(
        `Override ${problemId} is missing from the wiki but has no term/reading; skipping.`
      );
      continue;
    }
    const level = problemId.match(/Lv(\d+)_/)?.[1] ?? '';
    const termInfo: TermInfo = { 問題ID: problemId };
    applyInfoOverride(termInfo, override);
    termDataArr.push({
      termReading: { term: override.term, reading: override.reading },
      termInfo,
      termLevel: level,
    });
    console.log(`Added missing term ${problemId} (${override.term}) from overrides.`);
  }
}
