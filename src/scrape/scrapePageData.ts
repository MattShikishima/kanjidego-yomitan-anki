import fs from 'fs';
import path from 'path';
import {
  ETC_SUFFIXES,
  EXPORT_DIRECTORY,
  INPUT_LABELS,
  JSON_FILE_NAME,
  NO_TERM_PLACEHOLDER,
  WIKI_PAGES,
} from '../constants';
import { getPageDocument } from './getPageDocument';
import { TermData, TermReading, TermReference } from '../types';
import { scrapeAllImages } from './scrapeAllImages';
import { cleanStr, removeFromEnd } from '../util/textUtils';
import { getTermInfo, parseLabeledLine } from './getTermInfo';
import {
  addMissingOverrides,
  applyInfoOverride,
  getWikiOverride,
} from './wikiOverrides';

export async function scrapeAllPagesData() {
  const termDataArr: TermData[] = [];
  for (const level of Object.keys(WIKI_PAGES)) {
    for (const pageUrl of WIKI_PAGES[level]) {
      const data = await scrapePageData(pageUrl, level);
      termDataArr.push(...data);
    }
  }
  // Add any terms the wiki is missing entirely (supplied via overrides).
  addMissingOverrides(termDataArr);
  console.log(`Scraped ${termDataArr.length} terms`);
  const jsonDirectory = path.join(process.cwd(), EXPORT_DIRECTORY);
  if (!fs.existsSync(jsonDirectory)) {
    fs.mkdirSync(jsonDirectory);
  }
  const jsonFilePath = path.join(jsonDirectory, JSON_FILE_NAME);
  fs.writeFileSync(jsonFilePath, JSON.stringify(termDataArr, null, 2));
  console.log(`Wrote JSON to ${jsonFilePath}`);

  await scrapeAllImages(termDataArr);
  return termDataArr;
}

/**
 * Scrapes all the terms on a single wiki page.
 *
 * On the wiki, each term is an <h3> header of the form `ID:Lv05_0001` followed
 * by the reading, then a <div> containing the term's image and its
 * テキスト/意味/別読み/別表記/補足/元作品/典拠 fields.
 */
export async function scrapePageData(pageUrl: string, level: string) {
  const document = await getPageDocument(pageUrl);
  const wikibody = document.querySelector('#wikibody');
  if (!wikibody) {
    console.error(`No #wikibody found on ${pageUrl}`);
    return [];
  }

  const termHeaders = [...wikibody.querySelectorAll(':scope > h3')];
  const termDataArr: TermData[] = [];
  for (const header of termHeaders) {
    const headerInfo = parseHeader(header, level);
    // Section headings and other non-term <h3>s have no problem ID.
    if (!headerInfo) continue;
    const { problemId, reading, extraReadings } = headerInfo;

    const contentDiv = getContentDiv(header);
    let lines: string[] = [];
    let reference: TermReference | null = null;
    let wikiImageUrl: string | null = null;
    if (contentDiv) {
      reference = getReference(contentDiv);
      wikiImageUrl = getWikiImageUrl(contentDiv);
      // Flatten a copy with anchors removed so reference URLs / 🔗典拠 link text
      // don't bleed into the parsed fields.
      const clone = contentDiv.cloneNode(true) as Element;
      stripAnchors(clone);
      lines = flattenToLines(clone);
    }
    // Terms with no representable character fall back to their IDS (kanji
    // composition), then to a placeholder, so the headword is never empty. A 〓
    // (geta) in the テキスト stands in for a character with no Unicode codepoint;
    // substitute the IDS there so distinct rare kanji don't collapse to the same
    // 〓… text (e.g. Lv07_0466 vs Lv07_0467, both テキスト:〓し).
    const { term: kanji, ids } = getTermAndIds(lines);
    let term =
      kanji.includes('〓') && ids
        ? kanji.replace(/〓+/g, ids)
        : kanji || ids || NO_TERM_PLACEHOLDER;
    let termReadingValue = reading;

    // Correct known wiki errors before building the info, so 別表記/legacy handling
    // sees the corrected term and reading.
    const override = getWikiOverride(problemId);
    if (override?.term !== undefined) term = override.term;
    if (override?.reading !== undefined) termReadingValue = override.reading;

    const termReading: TermReading = { term, reading: termReadingValue };
    const termInfo = getTermInfo(
      lines,
      extraReadings,
      termReadingValue,
      term,
      problemId
    );
    if (override) {
      applyInfoOverride(termInfo, override);
    }
    const termData: TermData = { termReading, termInfo, termLevel: level };
    if (reference) {
      termData.termReference = reference;
    }
    if (wikiImageUrl) {
      termData.termImageUrl = wikiImageUrl;
    }
    termDataArr.push(termData);
  }
  return termDataArr;
}

/**
 * Parses a term header, returning its problem ID and reading(s), or null if the
 * header is not a term header.
 */
function parseHeader(
  header: Element,
  level: string
): {
  problemId: string;
  reading: string;
  extraReadings: string[];
} | null {
  const text = header.textContent || '';
  // Most levels list the full ID (ID:Lv05_0001); Lv.8 lists a bare number
  // (ID:0001). Anchoring at the start avoids matching an "ID:" inside a section
  // heading such as "Lv.8 (ID:1~100)".
  const idMatch = text.match(/^\s*ID[:：]\s*(Lv\d+_\d+|\d+)/);
  if (!idMatch) return null;
  let problemId = idMatch[1];
  // Normalise a bare number to the same LvNN_NNNN form used by the other levels
  // (and by the game's image files).
  if (!problemId.startsWith('Lv')) {
    problemId = `Lv${level}_${problemId.padStart(4, '0')}`;
  }

  // The reading follows the ID. Okurigana is coloured red in the markup but
  // flattens into the text content here. Multiple readings are separated by "、".
  const afterId = text
    .slice(idMatch[0].length)
    // eslint-disable-next-line no-irregular-whitespace
    .replace(/^[\s　]+/, '');
  const readings = afterId
    .split(/[、,，]/)
    .map((r) => removeFromEnd(cleanStr(r.trim()), ETC_SUFFIXES))
    .filter(Boolean);

  return {
    problemId,
    reading: readings[0] || '',
    extraReadings: readings.slice(1),
  };
}

/**
 * Returns the <div> immediately following a term header, which holds the term's
 * content, or null if there is none before the next header.
 */
function getContentDiv(header: Element): Element | null {
  let el = header.nextElementSibling;
  while (el && el.nodeName !== 'DIV' && el.nodeName !== 'H3') {
    el = el.nextElementSibling;
  }
  return el && el.nodeName === 'DIV' ? el : null;
}

/**
 * Removes all anchor elements from an element in place.
 */
function stripAnchors(el: Element): void {
  el.querySelectorAll('a').forEach((a) => a.remove());
}

/**
 * Flattens an element to trimmed, non-empty lines of text, treating <br> as a
 * line break.
 */
function flattenToLines(el: Element): string[] {
  let text = '';
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeName === 'BR') {
        text += '\n';
      } else if (child.nodeType === 3) {
        text += child.textContent;
      } else {
        walk(child);
      }
    }
  };
  walk(el);
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Extracts the term (headword) and its IDS (kanji composition) from a term's
 * lines. The テキスト value may be followed by an IDS or an annotation separated
 * by a full-width space; only the part before that is the term. The IDS may also
 * appear on its own line when the character has no Unicode codepoint. Either
 * value may be empty.
 */
function getTermAndIds(lines: string[]): { term: string; ids: string } {
  let term = '';
  let ids = '';
  for (const line of lines) {
    const parsed = parseLabeledLine(line);
    if (!parsed) continue;
    if (parsed.label === INPUT_LABELS.term) {
      // eslint-disable-next-line no-irregular-whitespace
      const parts = parsed.value.split('　');
      const candidate = cleanStr(parts[0].trim());
      // Some entries put a placeholder sentence in place of the character when
      // it has no Unicode codepoint; treat those as having no term.
      if (!/記載不可|ユニコード|未登録/.test(candidate)) {
        term = candidate;
      }
      // The テキスト line may also carry an IDS after the character.
      const idsMatch = parts.slice(1).join(' ').match(/IDS[:：]\s*(.+)/);
      if (idsMatch) {
        ids = idsMatch[1].trim();
      }
    } else if (parsed.label === INPUT_LABELS.ids) {
      ids = parsed.value.trim();
    }
  }
  return { term, ids };
}

/**
 * Gets the 典拠 reference (an external link) from a term's content, if present.
 * The link text differs by page (the bare URL, or "🔗典拠"), so the hostname is
 * used as the display text.
 */
function getReference(contentDiv: Element): TermReference | null {
  const anchor = contentDiv.querySelector('a[href^="http"], a[href^="//"]');
  if (!anchor) return null;
  let url = anchor.getAttribute('href') || '';
  if (url.startsWith('//')) url = `https:${url}`;
  if (!url) return null;
  try {
    const text = new URL(url).hostname.replace(/^www\./, '');
    return { text, url };
  } catch {
    return null;
  }
}

/**
 * Gets the URL of the term's wiki-hosted image (the first image in the content),
 * used as a fallback when the game image is unavailable.
 */
function getWikiImageUrl(contentDiv: Element): string | null {
  const img = contentDiv.querySelector('img');
  if (!img) return null;
  let src = img.getAttribute('src') || '';
  if (src.startsWith('//')) src = `https:${src}`;
  return src || null;
}
