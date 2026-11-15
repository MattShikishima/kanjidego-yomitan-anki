import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import initSqlJs, { Database } from 'sql.js';
import { CsvRecord } from '../types';
import {
  APKG_ALT_FORM_DECK_NAME,
  APKG_BACK_TEMPLATE_FILE,
  APKG_FIELD_NAMES,
  APKG_FILE_NAME,
  APKG_FRONT_TEMPLATE_FILE,
  APKG_LEVEL_DECK_NAMES,
  APKG_MODEL_ID,
  APKG_NOTE_TYPE_NAME,
  APKG_STYLING_FILE,
  APKG_TEMPLATE_NAME,
  CROPPED_IMG_DIR,
  EXPORT_DIRECTORY,
  KANJI_DE_GO_NAME,
  TRIMMED_DIRECTORY,
} from '../constants';
import { ensureJigmoFonts } from './fonts';

// A single monotonic counter (seeded from the current time) supplies every id
// this module hands out — note ids, card ids, deck ids — except the model id,
// which is fixed (APKG_MODEL_ID) so re-imports update notes in place. Ids only
// need to be unique within their own table, but drawing them all from one
// counter trivially guarantees that without tracking each table separately.
let idCounter = Date.now();
function nextId(): number {
  return idCounter++;
}

/**
 * Builds a .apkg (legacy Anki "apkg" format: a plain schema-11 SQLite
 * collection, zipped alongside its media) from the same deduplicated records
 * the CSV export uses. Deck layout: one subdeck per level, plus a single
 * subdeck holding every 別表記 (alt spelling) card regardless of its level.
 */
export async function buildApkg(records: CsvRecord[]): Promise<void> {
  console.log('Building .apkg');

  const SQL = await initSqlJs();
  const db = new SQL.Database();
  createSchema(db);

  const nowSeconds = Math.floor(Date.now() / 1000);
  // Anki's day-boundary stats (new-cards-today, review heatmap) are computed
  // relative to this. There's no way to know the importing user's timezone at
  // build time, so this just aligns to this machine's local midnight — the
  // same inherent limitation every apkg-building tool (e.g. genanki) has.
  const localMidnight = new Date();
  localMidnight.setHours(0, 0, 0, 0);
  const crt = Math.floor(localMidnight.getTime() / 1000);

  const modelId = APKG_MODEL_ID;
  const deckIds = createDecks();

  const model = buildModel(modelId, deckIds.root);
  const media = new MediaCollector();

  insertNotesAndCards(db, records, modelId, deckIds, nowSeconds, media);

  insertCol(db, crt, nowSeconds, modelId, model, deckIds);

  for (const font of await ensureJigmoFonts()) {
    media.addFile(font.mediaName, font.data);
  }

  const outPath = path.join(process.cwd(), EXPORT_DIRECTORY, APKG_FILE_NAME);
  await writeApkg(db.export(), media, outPath);
  db.close();

  console.log(`Wrote .apkg to ${outPath}`);
}

function createSchema(db: Database): void {
  db.run(`
    CREATE TABLE col (
      id integer PRIMARY KEY,
      crt integer NOT NULL,
      mod integer NOT NULL,
      scm integer NOT NULL,
      ver integer NOT NULL,
      dty integer NOT NULL,
      usn integer NOT NULL,
      ls integer NOT NULL,
      conf text NOT NULL,
      models text NOT NULL,
      decks text NOT NULL,
      dconf text NOT NULL,
      tags text NOT NULL
    );
    CREATE TABLE notes (
      id integer PRIMARY KEY,
      guid text NOT NULL,
      mid integer NOT NULL,
      mod integer NOT NULL,
      usn integer NOT NULL,
      tags text NOT NULL,
      flds text NOT NULL,
      sfld text NOT NULL,
      csum integer NOT NULL,
      flags integer NOT NULL,
      data text NOT NULL
    );
    CREATE TABLE cards (
      id integer PRIMARY KEY,
      nid integer NOT NULL,
      did integer NOT NULL,
      ord integer NOT NULL,
      mod integer NOT NULL,
      usn integer NOT NULL,
      type integer NOT NULL,
      queue integer NOT NULL,
      due integer NOT NULL,
      ivl integer NOT NULL,
      factor integer NOT NULL,
      reps integer NOT NULL,
      lapses integer NOT NULL,
      left integer NOT NULL,
      odue integer NOT NULL,
      odid integer NOT NULL,
      flags integer NOT NULL,
      data text NOT NULL
    );
    CREATE TABLE revlog (
      id integer PRIMARY KEY,
      cid integer NOT NULL,
      usn integer NOT NULL,
      ease integer NOT NULL,
      ivl integer NOT NULL,
      lastIvl integer NOT NULL,
      factor integer NOT NULL,
      time integer NOT NULL,
      type integer NOT NULL
    );
    CREATE TABLE graves (
      usn integer NOT NULL,
      oid integer NOT NULL,
      type integer NOT NULL
    );
    CREATE INDEX ix_notes_usn ON notes (usn);
    CREATE INDEX ix_cards_usn ON cards (usn);
    CREATE INDEX ix_revlog_usn ON revlog (usn);
    CREATE INDEX ix_cards_nid ON cards (nid);
    CREATE INDEX ix_cards_sched ON cards (did, queue, due);
    CREATE INDEX ix_revlog_cid ON revlog (cid);
    CREATE INDEX ix_notes_mid ON notes (mid);
  `);
}

type DeckIds = {
  root: number;
  byLevel: { [level: string]: number };
  altForm: number;
};

/**
 * Creates the deck hierarchy: "Default" (id 1, required by convention, kept
 * empty), the "漢字でGO!" root, one child per level, and the 別表記 child.
 * id 1 is reserved for "Default" by convention; idCounter is always far above
 * 1 (seeded from Date.now()), so nextId()
 * never needs to be told to skip it.
 */
function createDecks(): DeckIds {
  const byLevel: { [level: string]: number } = {};
  for (const level of Object.keys(APKG_LEVEL_DECK_NAMES)) {
    byLevel[level] = nextId();
  }
  return {
    root: nextId(),
    byLevel,
    altForm: nextId(),
  };
}

function deckJson(id: number, name: string): Record<string, unknown> {
  return {
    id,
    mod: 0,
    name,
    usn: 0,
    lrnToday: [0, 0],
    revToday: [0, 0],
    newToday: [0, 0],
    timeToday: [0, 0],
    collapsed: true,
    browserCollapsed: true,
    desc: '',
    dyn: 0,
    conf: 1,
    extendNew: 10,
    extendRev: 50,
  };
}

function buildModel(modelId: number, rootDeckId: number): Record<string, unknown> {
  const qfmt = fs.readFileSync(
    path.join(process.cwd(), APKG_FRONT_TEMPLATE_FILE),
    'utf-8'
  );
  const afmt = fs.readFileSync(
    path.join(process.cwd(), APKG_BACK_TEMPLATE_FILE),
    'utf-8'
  );
  const css = fs.readFileSync(path.join(process.cwd(), APKG_STYLING_FILE), 'utf-8');

  return {
    id: modelId,
    name: APKG_NOTE_TYPE_NAME,
    type: 0,
    mod: Math.floor(Date.now() / 1000),
    usn: 0,
    sortf: 0,
    did: rootDeckId,
    tmpls: [
      {
        name: APKG_TEMPLATE_NAME,
        ord: 0,
        qfmt,
        afmt,
        did: null,
        bqfmt: '',
        bafmt: '',
      },
    ],
    flds: APKG_FIELD_NAMES.map((name, ord) => ({
      name,
      ord,
      sticky: false,
      rtl: false,
      font: 'Noto Serif JP',
      size: 20,
      media: [],
    })),
    css,
    latexPre:
      '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
    latexPost: '\\end{document}',
    latexsvg: false,
    req: [[0, 'any', [0]]],
    tags: [],
    vers: [],
  };
}

function insertCol(
  db: Database,
  crt: number,
  nowSeconds: number,
  modelId: number,
  model: Record<string, unknown>,
  deckIds: DeckIds
): void {
  const conf = {
    curDeck: deckIds.root,
    estTimes: true,
    activeDecks: [deckIds.root],
    sortType: 'noteFld',
    timeLim: 0,
    sortBackwards: false,
    addToCur: true,
    curModel: String(modelId),
    nextPos: 1,
    collapseTime: 1200,
    schedVer: 2,
  };

  const dconf = {
    '1': {
      id: 1,
      mod: 0,
      name: 'Default',
      usn: 0,
      maxTaken: 60,
      autoplay: true,
      timer: 0,
      replayq: true,
      new: {
        bury: false,
        delays: [1, 10],
        initialFactor: 2500,
        ints: [1, 4, 0],
        order: 1,
        perDay: 20,
      },
      rev: {
        bury: false,
        ease4: 1.3,
        ivlFct: 1,
        maxIvl: 36500,
        perDay: 200,
        hardFactor: 1.2,
      },
      lapse: {
        delays: [10],
        leechAction: 1,
        leechFails: 8,
        minInt: 1,
        mult: 0,
      },
      dyn: false,
    },
  };

  const decks: Record<string, unknown> = {
    '1': deckJson(1, 'Default'),
    [deckIds.root]: deckJson(deckIds.root, KANJI_DE_GO_NAME),
    [deckIds.altForm]: deckJson(
      deckIds.altForm,
      `${KANJI_DE_GO_NAME}::${APKG_ALT_FORM_DECK_NAME}`
    ),
  };
  for (const [level, id] of Object.entries(deckIds.byLevel)) {
    decks[id] = deckJson(id, `${KANJI_DE_GO_NAME}::${APKG_LEVEL_DECK_NAMES[level]}`);
  }

  const models = { [modelId]: model };

  const modNowMs = nowSeconds * 1000;
  db.run('INSERT INTO col VALUES (1,?,?,?,?,0,0,0,?,?,?,?,?)', [
    crt,
    modNowMs,
    modNowMs,
    11,
    JSON.stringify(conf),
    JSON.stringify(models),
    JSON.stringify(decks),
    JSON.stringify(dconf),
    '{}',
  ]);
}

/** Collects media referenced during note insertion, keyed by filename (Anki's
 * media manifest is itself filename-keyed) so a file referenced by many
 * records — e.g. an image shared by a term and its 別表記 cards — is only
 * stored once. */
class MediaCollector {
  private byName = new Map<string, { index: number; name: string; data: Buffer }>();

  has(name: string): boolean {
    return this.byName.has(name);
  }

  addFile(name: string, data: Buffer): void {
    if (this.byName.has(name)) return;
    this.byName.set(name, { index: this.byName.size, name, data });
  }

  get entries(): { index: number; name: string; data: Buffer }[] {
    return [...this.byName.values()];
  }
}

const IMG_SRC_RE = /<img src="([^"]+)">/;

function insertNotesAndCards(
  db: Database,
  records: CsvRecord[],
  modelId: number,
  deckIds: DeckIds,
  nowSeconds: number,
  media: MediaCollector
): void {
  let due = 1;
  for (const record of records) {
    const flds = APKG_FIELD_NAMES.map((name) => record[name] ?? '').join('\x1f');
    const sortField = record.単語;
    const guid = crypto
      .createHash('sha1')
      .update(`${record.問題ID ?? ''}::${record.単語}::${record.読み方}`)
      .digest('base64')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 10);
    const csum = parseInt(
      crypto.createHash('sha1').update(sortField, 'utf8').digest('hex').slice(0, 8),
      16
    );
    const tags = (record.Tags ?? '').trim()
      ? ` ${(record.Tags ?? '').trim()} `
      : ' ';

    const noteId = nextId();
    db.run('INSERT INTO notes VALUES (?,?,?,?,-1,?,?,?,?,0,\'\')', [
      noteId,
      guid,
      modelId,
      nowSeconds,
      tags,
      flds,
      sortField,
      csum,
    ]);

    let did: number;
    if (record.元単語) {
      did = deckIds.altForm;
    } else {
      const levelDeckId = deckIds.byLevel[record.レベル];
      if (levelDeckId === undefined) {
        throw new Error(
          `No .apkg subdeck for level "${record.レベル}" (問題ID ${record.問題ID}, ` +
            `term ${record.単語}) — add it to APKG_LEVEL_DECK_NAMES/WIKI_PAGES.`
        );
      }
      did = levelDeckId;
    }

    const cardId = nextId();
    db.run(
      "INSERT INTO cards VALUES (?,?,?,0,?,-1,0,0,?,0,0,0,0,0,0,0,0,'')",
      [cardId, noteId, did, nowSeconds, due]
    );
    due++;

    for (const [field, dir] of [
      [record.画像, TRIMMED_DIRECTORY],
      [record.切り抜き画像, CROPPED_IMG_DIR],
    ] as const) {
      const match = field?.match(IMG_SRC_RE);
      if (!match) continue;
      const fileName = match[1];
      if (media.has(fileName)) continue;
      const filePath = path.join(process.cwd(), dir, fileName);
      if (fs.existsSync(filePath)) media.addFile(fileName, fs.readFileSync(filePath));
    }
  }
}

async function writeApkg(
  collectionData: Uint8Array,
  media: MediaCollector,
  outPath: string
): Promise<void> {
  const zip = new JSZip();
  zip.file('collection.anki2', Buffer.from(collectionData));

  const mediaManifest: { [index: string]: string } = {};
  for (const entry of media.entries) {
    mediaManifest[String(entry.index)] = entry.name;
    zip.file(String(entry.index), entry.data);
  }
  zip.file('media', JSON.stringify(mediaManifest));

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buffer);
}
