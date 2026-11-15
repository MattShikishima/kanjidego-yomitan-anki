import fs from 'fs';
import path from 'path';
import { GAME_ANSWER_KEY_URL, PAGES_DIRECTORY } from '../constants';
import { normalizeWhitespace } from '../util/textUtils';

/**
 * The game's own answer key, used as the source of each term's 意味.
 *
 * The browser build loads its questions from plain UTF-8 text files with a
 * disguised extension (img/battlebacks2/LvNN.xcf). Each problem is a block of
 * `key:value` lines separated by a row of dashes; 問題 is the 問題ID and
 * 文上/文下 are the two display lines of the meaning. Wiki editors copy the
 * meaning by hand, so roughly a fifth of wiki meanings carry transcription
 * slips; the game's text is used instead, with the wiki's own additions (the
 * readings it puts after hard words, and trailing ※ notes) carried over.
 *
 * Map value: the cleaned meaning, or null when the game text can't stand on its
 * own (see cleanGameMeaning). Terms missing from the map keep the wiki meaning.
 */
export type GameMeanings = Map<string, GameMeaning>;
export type GameMeaning = { text: string; glyphs: number };

// Marks a character the game draws as an icon because it has no font glyph.
const GLYPH = '\uFFFC';
// eslint-disable-next-line no-control-regex
const ESCAPE_CODE = /\u001b[A-Za-z]+(?:\[\d+\])?/g;
// A word followed by a kana reading in parentheses, e.g. 掴(つか) or 天后（てんこう）.
const READING_GLOSS =
  /([\p{Script=Han}々〆ヵヶ]+)[(（]([\p{Script=Hiragana}\p{Script=Katakana}ー・゠]+)[)）]/gu;

export async function loadGameMeanings(levels: string[]): Promise<GameMeanings> {
  const meanings: GameMeanings = new Map();
  for (const level of levels) {
    const text = await getAnswerKeyFile(level);
    if (text === null) continue;
    for (const block of text.split(/^-{8,}\s*$/m)) {
      const fields = parseBlock(block);
      const problemId = fields.get('問題');
      if (!problemId) continue;
      const meaning = cleanGameMeaning(
        (fields.get('文上') ?? '') + (fields.get('文下') ?? '')
      );
      if (meaning) meanings.set(problemId, meaning);
    }
  }
  return meanings;
}

/**
 * Returns the term's meaning: the game's text with the wiki's additions carried
 * over, or the wiki's text when the game has none or can't be completed.
 */
export function chooseMeaning(
  game: GameMeaning | undefined,
  wiki: string
): string {
  if (!game) return wiki;
  let gameChars = Array.from(game.text);
  if (game.glyphs > 0) {
    // Aligned against the wiki text as-is, readings included, since the game
    // often has a ruby reading right after the glyph too (『𥝱(じょ)』).
    const wikiAll = Array.from(wiki);
    const filled = fillGlyphs(gameChars, wikiAll, alignChars(wikiAll, gameChars));
    if (!filled) return wiki;
    gameChars = filled;
  }

  const { plain, glosses } = stripReadingGlosses(wiki);
  const wikiChars = Array.from(plain);
  const toGame = alignChars(wikiChars, gameChars);
  let chars = gameChars;

  // Readings: insert each one after the same word in the game text, if the end
  // of that word lines up in both texts and the game hasn't glossed it already.
  const inserts = new Map<number, string>();
  for (const { end, length, reading } of glosses) {
    const tail = Math.min(length, 2);
    const start = toGame[end - tail];
    let aligned = start >= 0;
    for (let i = 1; aligned && i < tail; i++) {
      aligned = toGame[end - tail + i] === start + i;
    }
    if (!aligned) continue;
    const at = toGame[end - 1] + 1;
    if (chars[at] === '(' || chars[at] === '（') continue;
    inserts.set(at, `(${reading})`);
  }
  for (const at of [...inserts.keys()].sort((a, b) => b - a)) {
    chars = [...chars.slice(0, at), inserts.get(at) as string, ...chars.slice(at)];
  }
  let result = chars.join('');

  // A trailing ※ note the wiki editors added. Only carried over when the two
  // texts are recognisably the same meaning, so a note never lands on an
  // unrelated entry (e.g. one the wiki has misplaced).
  const note = wiki.match(/※.*$/)?.[0];
  const matched = toGame.filter((i) => i >= 0).length;
  const similar = matched / Math.max(wikiChars.length, gameChars.length) >= 0.5;
  if (note && !result.includes('※') && similar) {
    result = `${result} ${note}`;
  }
  return result;
}

async function getAnswerKeyFile(level: string): Promise<string | null> {
  const url = GAME_ANSWER_KEY_URL(level);
  const cachePath = path.join(
    process.cwd(),
    PAGES_DIRECTORY,
    `${url.replace(/\W/g, '_')}.txt`
  );
  if (fs.existsSync(cachePath)) {
    return fs.promises.readFile(cachePath, 'utf-8');
  }
  console.log('Fetching:', url);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    await fs.promises.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.promises.writeFile(cachePath, text);
    return text;
  } catch (error) {
    // Not fatal: the level just keeps the wiki's meanings.
    console.error(`Could not load the game's answer key for Lv${level}: ${error}`);
    return null;
  }
}

function parseBlock(block: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of block.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0) fields.set(line.slice(0, colon), line.slice(colon + 1));
  }
  return fields;
}

/**
 * Turns the game's display markup into plain text:
 * - ESC + I[n] draws icon n. Leading/inline ones are category icons and are
 *   dropped; one directly inside 『』 or as a ruby base stands in for a
 *   character with no font glyph, and is kept as a GLYPH placeholder.
 * - <漢字|よみ> is ruby, rendered as 漢字(よみ) like the wiki's own readings.
 * - [...] sets off parentheticals, notes and literature sources; the brackets
 *   are dropped and the content kept. Stray <, > and the odd thin space go too.
 */
function cleanGameMeaning(raw: string): GameMeaning | null {
  let text = raw
    .replace(/([『<])\u001b[A-Za-z]+\[\d+\]/g, `$1${GLYPH}`) // eslint-disable-line no-control-regex
    .replace(ESCAPE_CODE, '')
    .replace(/<([^<>|]*)\|([^<>]*)>/g, (_, base: string, reading: string) =>
      `${base.trim()}(${reading.trim()})`
    )
    .replace(/[<>[\]\u2009]/g, '');
  text = normalizeWhitespace(text);
  if (!text) return null;
  return { text, glyphs: Array.from(text).filter((c) => c === GLYPH).length };
}

/**
 * Replaces each GLYPH with the wiki's character at the same spot, which the
 * wiki can show because it doesn't depend on the game's font. Only trusted when
 * the text on both sides lines up exactly; otherwise returns null.
 */
function fillGlyphs(
  gameChars: string[],
  wikiChars: string[],
  toGame: number[]
): string[] | null {
  const toWiki = new Array<number>(gameChars.length).fill(-1);
  toGame.forEach((g, w) => {
    if (g >= 0) toWiki[g] = w;
  });
  const out = [...gameChars];
  for (let g = 0; g < gameChars.length; g++) {
    if (gameChars[g] !== GLYPH) continue;
    if (g === 0 || toWiki[g - 1] < 0 || g + 1 >= gameChars.length) return null;
    // Exactly one wiki character sits between the glyph's neighbours, and the
    // next few characters continue in step on both sides.
    const w = toWiki[g - 1] + 1;
    for (let k = 1; k <= 3 && g + k < gameChars.length; k++) {
      if (toWiki[g + k] !== w + k) return null;
    }
    out[g] = wikiChars[w];
  }
  return out;
}

/**
 * Removes the wiki's reading glosses, recording for each the code-point index in
 * the stripped text just past the glossed word.
 */
function stripReadingGlosses(wiki: string): {
  plain: string;
  glosses: { end: number; length: number; reading: string }[];
} {
  let plain = '';
  let last = 0;
  const glosses: { end: number; length: number; reading: string }[] = [];
  for (const match of wiki.matchAll(READING_GLOSS)) {
    const [whole, word, reading] = match;
    plain += wiki.slice(last, match.index) + word;
    glosses.push({
      end: Array.from(plain).length,
      length: Array.from(word).length,
      reading,
    });
    last = (match.index ?? 0) + whole.length;
  }
  plain += wiki.slice(last);
  return { plain, glosses };
}

/**
 * Longest-common-subsequence alignment of two character arrays: for each index
 * of `a`, the index of the matching character in `b`, or -1.
 */
function alignChars(a: string[], b: string[]): number[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const lcs = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }
  const map = new Array<number>(n).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      map[i] = j;
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return map;
}
