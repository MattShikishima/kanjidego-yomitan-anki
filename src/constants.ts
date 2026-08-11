// The original fan wiki (w.atwiki.jp/kanjidego) was taken down. This project now
// sources its data from the replacement wiki below, which serves the same purpose
// but presents the data in a different format and at different URLs.
export const WIKI_NAME = 'yuia_sk';
export const WIKI_BASE_URL = `https://w.atwiki.jp/${WIKI_NAME}`;
export const WIKI_PAGE_URL = (pageId: number | string) =>
  `${WIKI_BASE_URL}/pages/${pageId}.html`;
export const WIKI_SEARCH_URL = (keyword: string) =>
  `${WIKI_BASE_URL}/search?andor=and&keyword=${keyword}`;
export const WIKI_ATTRIBUTION_URL = `${WIKI_BASE_URL}/`;
export const WIKI_DISPLAY_NAME = '漢字でGO! 問題集@wiki';

// The game levels this project covers, mapped to the wiki pages that list
// their terms. Each level is split across several pages by problem-ID range.
export const WIKI_PAGES: {
  [key: string]: string[];
} = {
  '04': [
    WIKI_PAGE_URL(30), // Lv.4 (ID:1~500)
    WIKI_PAGE_URL(54), // Lv.4 (ID:501~1000)
    WIKI_PAGE_URL(55), // Lv.4 (ID:1001~1500)
    WIKI_PAGE_URL(56), // Lv.4 (ID:1501~)
  ],
  '05': [
    WIKI_PAGE_URL(21), // Lv.5 (ID:1~500)
    WIKI_PAGE_URL(47), // Lv.5 (ID:501~1000)
    WIKI_PAGE_URL(49), // Lv.5 (ID:1001~1500)
    WIKI_PAGE_URL(50), // Lv.5 (ID:1501~2000)
    WIKI_PAGE_URL(51), // Lv.5 (ID:2001~)
  ],
  '06': [
    WIKI_PAGE_URL(23), // Lv.6 (ID:1~500)
    WIKI_PAGE_URL(43), // Lv.6 (ID:501~1000)
    WIKI_PAGE_URL(44), // Lv.6 (ID:1001~)
  ],
  '07': [
    WIKI_PAGE_URL(16), // Lv.7 (ID:1~500)
    WIKI_PAGE_URL(36), // Lv.7 (ID:501~)
  ],
  '08': [
    WIKI_PAGE_URL(17), // Lv.8 (ID:1~100)
  ],
};

// atwiki sits behind Cloudflare, whose bot mitigation rejects Node's fetch (based
// on its TLS fingerprint). Pages are fetched via curl instead, using a browser
// user agent. The game images below are served by plicy directly and are fetched
// with the normal fetch API.
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0';

export const KANJI_IMAGE_URL = (ID: string) =>
  `https://html5.plicy.net/GameFilesUpdate/155561/234/img/pictures/${ID}.png`;

export const PAGES_DIRECTORY = '/pages';
export const IMAGES_DIRECTORY = '/images';
export const TRIMMED_DIRECTORY = `${IMAGES_DIRECTORY}/trimmed`;
export const CROPPED_IMG_DIR = `${IMAGES_DIRECTORY}/cropped`;
export const EXPORT_DIRECTORY = '/export';
export const IMAGE_NAME = (ID: string) => `${ID}.png`;
export const CROPPED_IMAGE_NAME = (ID: string) => `${ID}_cropped.png`;

export const JSON_FILE_NAME = 'termData.json';
// Alternate spellings (別表記) carried over from the old Anki deck, matched by
// spelling + reading, to supplement the sparser 別表記 on the new wiki.
export const LEGACY_BETSUHYOKI_FILE = 'src/data/legacyBetsuhyoki.json';
// Hand-maintained corrections for known wiki errors (e.g. a mistyped テキスト that
// turns a term into a duplicate), keyed by 問題ID. See src/scrape/wikiOverrides.ts.
export const WIKI_OVERRIDES_FILE = 'src/data/wikiOverrides.json';
export const KANJI_DE_GO_NAME = '漢字でGO!';

// Used as the term (headword) when a card has no representable character and no
// IDS to describe it — Anki's first field cannot be empty.
export const NO_TERM_PLACEHOLDER = '〓';

// The output fields of a term (see TermInfo in types.d.ts).
export const INFO_CATEGORIES = [
  '意味',
  '別解',
  '別表記',
  '問題ID',
  '追記',
] as const;

// The labels the new wiki uses for each field of a term entry, mapped onto the
// output fields above. Several input labels can feed the same output field
// (e.g. 別読み is an alternate reading, 補足/元作品 are notes).
export const INPUT_LABELS = {
  term: 'テキスト',
  ids: 'IDS',
  meaning: '意味',
  altReadings: ['別読み', '別解'],
  altForms: ['別表記'],
  notes: ['補足', '追記', '元作品', '他用例'],
  reference: '典拠',
} as const;

// Every recognised label, used to detect "ラベル：値" lines within a term entry.
export const ALL_INPUT_LABELS: string[] = [
  INPUT_LABELS.term,
  INPUT_LABELS.ids,
  INPUT_LABELS.meaning,
  ...INPUT_LABELS.altReadings,
  ...INPUT_LABELS.altForms,
  ...INPUT_LABELS.notes,
  INPUT_LABELS.reference,
];

// Trailing "etc." markers stripped from readings/alternate forms.
export const ETC_SUFFIXES = ['等', 'など', 'など多々', 'など多々あり。'];
export const END_STRINGS_TO_REMOVE = [
  'など',
  'など多々',
  'など多々あり。',
  'など(同訓異義語多数存在。)',
];
export const EMPTY_STRING = ['なし', 'なし(*1)', 'なし(*1)'];
