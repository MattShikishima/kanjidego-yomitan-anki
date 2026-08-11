# Kanji de Go for Yomitan and Anki

An updated fork of
[MarvNC/kanjidego-yomitan-anki](https://github.com/MarvNC/kanjidego-yomitan-anki),
which scrapes [Kanji de Go (漢字で GO!)](https://plicy.net/GamePlay/155561) — a
game quizzing you on rare and exotic kanji — into a
[Yomitan](https://github.com/themoeway/yomitan) dictionary and an Anki deck.

**See the [original repository](https://github.com/MarvNC/kanjidego-yomitan-anki)
for full usage instructions, screenshots, downloads, and background.** This
README only covers what this fork changes.

## What's different in this fork

- **New data source.** The original fan wiki (`w.atwiki.jp/kanjidego`) was taken
  down, so scraping now targets the replacement wiki
  [漢字でGO! 問題集@wiki](https://w.atwiki.jp/yuia_sk/), which has a different page
  format and different URLs.
- **More levels.** Coverage now spans レベル 04–08, including the new highest
  level 8 that was added to the game. (Levels 1–3 are deliberately excluded —
  they're mostly common everyday words found outside the game, and the wiki
  barely covers them.)
- **Image fallback.** When the game's own image is missing from plicy, the
  wiki-hosted image is used instead.
- **Reworked hint cropping.** plicy re-rendered its artwork at a different scale,
  which broke the old fixed-pixel crop; the reading-hint row is now detected and
  removed in a scale-independent way.
- **Richer 別表記.** Alternate spellings from the old Anki deck are merged in
  (matched by spelling + reading) to supplement the sparser new wiki.
- **Better headwords for rare kanji.** Terms with no Unicode character fall back
  to their IDS (kanji composition), and a 〓 placeholder inside the text is
  replaced with the IDS so distinct characters don't collapse into one entry.
- **Wiki error corrections.** A small set of known wiki mistakes (mislabelled or
  misspelled entries) are patched via an overrides file.

## Building

```sh
npm install
npm run makeYomitan   # build the Yomitan dictionary
npm run makeAnki      # build the Anki deck CSV
```

Output is written to `export/`.
