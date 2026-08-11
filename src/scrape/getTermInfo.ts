import {
  ALL_INPUT_LABELS,
  INPUT_LABELS,
  END_STRINGS_TO_REMOVE,
  EMPTY_STRING,
} from '../constants';
import { TermInfo } from '../types';
import { cleanStr, normalizeWhitespace, removeFromEnd } from '../util/textUtils';
import { mergeLegacyBetsuhyoki } from './legacyBetsuhyoki';

export type LabeledLine = { label: string; value: string };

/**
 * Parses a "ラベル：値" line into its label and value.
 *
 * Tolerates a single leading stray character (the wiki markup occasionally
 * leaves a quote or brace in front of a label) and accepts both the full-width
 * (：) and half-width (:) colon. Returns null if the line does not start with a
 * recognised label.
 */
export function parseLabeledLine(line: string): LabeledLine | null {
  // eslint-disable-next-line no-irregular-whitespace
  const stripped = line.replace(/^[\s　"'“”｛{『「]+/, '');
  for (const label of ALL_INPUT_LABELS) {
    for (const offset of [0, 1]) {
      const rest = stripped.slice(offset);
      if (rest.startsWith(`${label}：`) || rest.startsWith(`${label}:`)) {
        return { label, value: rest.slice(label.length + 1).trim() };
      }
    }
  }
  return null;
}

/**
 * Splits a delimited list value (e.g. "通草、丁翁") into cleaned entries.
 */
function splitList(value: string): string[] {
  return value
    .split(/[、,，\s]/)
    .map((item) => cleanStr(item.trim()))
    .filter(Boolean);
}

/**
 * Builds a TermInfo object from a term entry's labeled lines, the extra readings
 * taken from the header, and the term's problem ID.
 *
 * @param lines - The labeled lines of the entry (anchors already removed).
 * @param extraReadings - Additional readings listed in the header after the first.
 * @param reading - The primary reading (used to de-duplicate alternate readings).
 * @param term - The primary term (used to de-duplicate alternate forms).
 * @param problemId - The problem ID, e.g. "Lv05_0001".
 * @returns The assembled TermInfo object.
 */
export function getTermInfo(
  lines: string[],
  extraReadings: string[],
  reading: string,
  term: string,
  problemId: string
): TermInfo {
  const termInfo: TermInfo = { 問題ID: problemId };

  const altReadings = [...extraReadings];
  const altForms: string[] = [];
  const notes: string[] = [];

  for (const line of lines) {
    const parsed = parseLabeledLine(line);
    if (!parsed || !parsed.value) continue;
    const { label, value } = parsed;

    if (label === INPUT_LABELS.meaning) {
      termInfo.意味 = normalizeWhitespace(value);
    } else if ((INPUT_LABELS.altReadings as readonly string[]).includes(label)) {
      altReadings.push(...splitList(value));
    } else if ((INPUT_LABELS.altForms as readonly string[]).includes(label)) {
      altForms.push(...splitList(removeFromEnd(value, END_STRINGS_TO_REMOVE)));
    } else if ((INPUT_LABELS.notes as readonly string[]).includes(label)) {
      notes.push(normalizeWhitespace(value));
    }
  }

  const cleanedAltReadings = dedupe(altReadings).filter(
    (r) => isValidInfo(r) && r !== reading
  );
  if (cleanedAltReadings.length > 0) {
    termInfo.別解 = cleanedAltReadings;
  }

  // Start from the wiki's 別表記, then supplement with the old deck's alternates.
  const cleanedAltForms = mergeLegacyBetsuhyoki(
    term,
    reading,
    dedupe(altForms).filter((f) => isValidInfo(f) && f !== term)
  );
  if (cleanedAltForms.length > 0) {
    termInfo.別表記 = cleanedAltForms;
  }

  const note = notes.filter(Boolean).join('\n');
  if (note && isValidInfo(note)) {
    termInfo.追記 = note;
  }

  // A handful of literary terms give a 元作品 citation (stored as 追記) instead of
  // a plain 意味, so only warn when an entry has neither.
  if (!termInfo.意味 && !termInfo.追記) {
    console.error(`${term || reading} (${problemId}): no 意味 or 追記 found`);
  }

  return termInfo;
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

/**
 * Checks whether the provided info is valid, filtering out なし and similar.
 */
function isValidInfo(info: string): boolean {
  return !EMPTY_STRING.includes(info);
}
