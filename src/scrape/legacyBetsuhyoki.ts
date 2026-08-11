import fs from 'fs';
import path from 'path';
import { LEGACY_BETSUHYOKI_FILE } from '../constants';

type BetsuhyokiGroup = { reading: string; spellings: string[] };

/**
 * Normalises a spelling/reading for matching only — variation selectors and the
 * separators cleanStr strips are dropped so that e.g. "㴞る" and "㴞󠄂る" compare
 * equal. The original spelling is always kept in the output.
 */
function normalize(value: string): string {
  return (
    value
      .replace(/[︀-️]/g, '')
      .replace(/[\u{E0100}-\u{E01EF}]/gu, '')
      // eslint-disable-next-line no-irregular-whitespace
      .replace(/[・() 　]/g, '')
      .trim()
  );
}

function key(spelling: string, reading: string): string {
  return `${normalize(spelling)} ${normalize(reading)}`;
}

/**
 * Builds a lookup from (spelling, reading) to the full set of spellings recorded
 * for that word in the old Anki deck. Every spelling of a group points at the
 * whole group, so a match works even when the new wiki's main spelling was one
 * of the old alternates.
 */
function buildIndex(): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const filePath = path.join(process.cwd(), LEGACY_BETSUHYOKI_FILE);
  let groups: BetsuhyokiGroup[];
  try {
    groups = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    console.error(`Could not load legacy 別表記 list (${filePath}): ${error}`);
    return index;
  }
  for (const { reading, spellings } of groups) {
    for (const spelling of spellings) {
      const k = key(spelling, reading);
      const existing = index.get(k);
      if (existing) {
        for (const s of spellings) {
          if (!existing.includes(s)) existing.push(s);
        }
      } else {
        index.set(k, [...spellings]);
      }
    }
  }
  return index;
}

const legacyIndex = buildIndex();

/**
 * Augments the wiki's 別表記 for a term with the alternate spellings recorded for
 * the same word (matched by spelling + reading, never by ID) in the old Anki
 * deck. De-duplicates by normalised form and never includes the term itself.
 */
export function mergeLegacyBetsuhyoki(
  term: string,
  reading: string,
  existing: string[]
): string[] {
  const legacy = legacyIndex.get(key(term, reading));
  if (!legacy) return existing;

  const result = [...existing];
  const seen = new Set(existing.map(normalize));
  seen.add(normalize(term));
  for (const spelling of legacy) {
    const normalized = normalize(spelling);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(spelling);
    }
  }
  return result;
}
