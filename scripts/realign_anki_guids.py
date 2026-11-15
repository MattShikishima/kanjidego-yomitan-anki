#!/usr/bin/env python3
"""
Realigns note guids in an exported 漢字でGO! Anki deck (one with real study
history) against a current project build, so re-importing the build updates
matching notes' fields in place — without losing scheduling (due dates,
intervals, ease, review history) — instead of adding duplicates.

Why this is needed: buildApkg.ts assigns each note a guid derived from its
content (問題ID + 単語 + 読み方), and Anki only updates a note in place on
import when the guid already matches. A deck exported from Anki has whatever
guid Anki originally assigned it (unrelated to this scheme), so a plain
re-import would just add every note a second time. This script finds, for
each note in your exported deck, the corresponding note in a fresh build and
copies that note's *actual* guid onto your note — nothing else (fields,
tags, scheduling) is touched.

Matching tiers, tried in order, most to least confident:
  1. 問題ID + 単語 + 読み方 all equal — an exact match by construction.
  2. 問題ID + 単語 equal (読み方 was corrected since your export)
  3. 単語 + 読み方 equal (問題ID was reassigned/reorganized since — this pair
     is the project's own dedup key, so at most one note can have it)
  4. 問題ID + 読み方 equal (単語/spelling was corrected since) — lowest
     priority: 問題ID alone is not a stable identifier by itself (wiki
     revisions have been observed reusing an ID for an entirely different
     word), so this tier is only trusted when it resolves to exactly one
     still-unclaimed candidate.

At every tier, a key matching more than one still-unclaimed candidate is
left for manual review (reported separately) rather than guessed. A note
that never matches at any tier is reported as unmatched — it keeps its
current guid, stays exactly as it is in your collection (scheduling
untouched), and simply won't receive future field updates; the corrected
version comes in as a new card on the next import instead.

Requires the `anki` package (`pip install anki`) — used only to read/write
real .apkg files across whatever schema version Anki happens to export.
This is a deliberate one-off exception to the project's Node/TypeScript
toolchain: reading arbitrary real-world Anki exports needs the actual
reference implementation, whereas src/anki/buildApkg.ts only ever needs to
*write* the single legacy format it controls, so it stays in sql.js.

Usage:
  python3 scripts/realign_anki_guids.py <exported-deck.apkg> <output.apkg> [current-build.apkg]

  <current-build.apkg> defaults to export/漢字でGO!.apkg relative to the repo
  root — rebuild it first with `npm run makeAnki` so it reflects the latest
  data.

After running, in Anki: back up your collection, delete the existing notes
for the deck you exported, import <output.apkg> (recreates them with
realigned guids and identical scheduling), then import the current build —
matched notes update in place, everything else comes in as new cards.
"""
import sys
from collections import defaultdict
from pathlib import Path

from anki.collection import (
    Collection,
    ExportAnkiPackageOptions,
    ImportAnkiPackageOptions,
    ImportAnkiPackageRequest,
)

NOTETYPE_NAME = '漢字でGO!'
FIELD_ORDER = [
    '単語', '元単語', '問題ID', '読み方', '別解', '別表記', '意味', '追記',
    '典拠', '典拠リンク', 'レベル', '画像', '切り抜き画像',
]
PID, TERM, READING = '問題ID', '単語', '読み方'

# Most to least confident, as described above.
TIERS = [
    (PID, TERM, READING),
    (PID, TERM),
    (TERM, READING),
    (PID, READING),
]

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CURRENT_BUILD = REPO_ROOT / 'export' / '漢字でGO!.apkg'


def load_notes(apkg_path: Path, work_dir: Path):
    work_dir.mkdir(parents=True, exist_ok=True)
    col = Collection(str(work_dir / 'col.anki2'))
    col.import_anki_package(
        ImportAnkiPackageRequest(
            package_path=str(apkg_path),
            options=ImportAnkiPackageOptions(
                with_scheduling=True,
                with_deck_configs=True,
            ),
        )
    )
    # Anki renames an imported note type to "漢字でGO!+", "漢字でGO!++", … when
    # the name is already taken, so accept those too (exact name preferred).
    candidates = [
        nt for nt in col.models.all_names_and_ids()
        if nt.name.rstrip('+') == NOTETYPE_NAME
    ]
    exact = [nt for nt in candidates if nt.name == NOTETYPE_NAME]
    if exact:
        candidates = exact
    if not candidates:
        raise RuntimeError(f'No "{NOTETYPE_NAME}" notetype found in {apkg_path}')
    if len(candidates) > 1:
        names = ', '.join(f'"{nt.name}"' for nt in candidates)
        raise RuntimeError(f'Several {NOTETYPE_NAME} notetypes in {apkg_path}: {names}')
    mid = candidates[0].id
    notes = []
    for note_id, guid, flds in col.db.execute(
        'select id, guid, flds from notes where mid = ?', mid
    ):
        values = dict(zip(FIELD_ORDER, flds.split('\x1f')))
        notes.append({'id': note_id, 'guid': guid, **values})
    return col, mid, notes


def index_by(notes, keys):
    idx = defaultdict(list)
    for n in notes:
        idx[tuple(n[k] for k in keys)].append(n)
    return idx


def match_notes(old_notes, new_notes):
    claimed_new_ids = set()
    matches = {}  # old note id -> new note dict
    candidates_seen = {}  # old note id -> list of (tier, candidate count)
    remaining = list(old_notes)

    for tier_keys in TIERS:
        idx = index_by(new_notes, tier_keys)
        still_remaining = []
        for old in remaining:
            key = tuple(old[k] for k in tier_keys)
            cands = [c for c in idx.get(key, []) if c['id'] not in claimed_new_ids]
            if len(cands) == 1:
                matches[old['id']] = cands[0]
                claimed_new_ids.add(cands[0]['id'])
            else:
                if cands:
                    candidates_seen.setdefault(old['id'], []).append(
                        (tier_keys, len(cands))
                    )
                still_remaining.append(old)
        remaining = still_remaining

    ambiguous = [(old, candidates_seen[old['id']]) for old in remaining if old['id'] in candidates_seen]
    unmatched = [old for old in remaining if old['id'] not in candidates_seen]
    return matches, ambiguous, unmatched


def main():
    if len(sys.argv) not in (3, 4):
        print(__doc__)
        sys.exit(1)

    in_path = Path(sys.argv[1]).resolve()
    out_path = Path(sys.argv[2]).resolve()
    current_path = Path(sys.argv[3]).resolve() if len(sys.argv) == 4 else DEFAULT_CURRENT_BUILD
    if not current_path.exists():
        print(f'Current build not found at {current_path}. Run `npm run makeAnki` first,')
        print('or pass its path explicitly as a third argument.')
        sys.exit(1)

    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)

        print(f'Loading current build: {current_path}')
        ref_col, _, new_notes = load_notes(current_path, tmp_dir / 'current')
        ref_col.close()

        print(f'Loading exported deck: {in_path}')
        col, _, old_notes = load_notes(in_path, tmp_dir / 'work')
        print(f'{len(old_notes)} notes of type {NOTETYPE_NAME!r} in the export.')
        print(f'{len(new_notes)} notes of type {NOTETYPE_NAME!r} in the current build.')

        matches, ambiguous, unmatched = match_notes(old_notes, new_notes)

        updated = 0
        for old_id, new_note in matches.items():
            col.db.execute('update notes set guid = ? where id = ?', new_note['guid'], old_id)
            updated += 1

        print(f'\nMatched and realigned: {len(matches)}')
        print(f'Ambiguous (multiple candidates, left untouched): {len(ambiguous)}')
        print(f'Unmatched (no candidate at any tier, left untouched): {len(unmatched)}')

        col.export_anki_package(
            out_path=str(out_path),
            options=ExportAnkiPackageOptions(
                with_scheduling=True,
                with_deck_configs=True,
                with_media=False,
                legacy=False,
            ),
            limit=None,
        )
        col.close()

    report_path = out_path.with_suffix('.report.tsv')
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write('status\tproblem_id\tterm\treading\tdetail\n')
        for old, tiers_seen in ambiguous:
            detail = '; '.join(f'{"+".join(k)}: {n} candidates' for k, n in tiers_seen)
            f.write(f"ambiguous\t{old[PID]}\t{old[TERM]}\t{old[READING]}\t{detail}\n")
        for old in unmatched:
            f.write(f"unmatched\t{old[PID]}\t{old[TERM]}\t{old[READING]}\t\n")

    print(f'\nWrote {out_path}')
    print(f'Wrote report ({len(ambiguous) + len(unmatched)} rows) to {report_path}')


if __name__ == '__main__':
    main()
