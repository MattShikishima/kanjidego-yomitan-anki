# Upstream status

What the wiki and the game look like to the scraper, and what has changed.
Last checked **2026-11-15**, against a page cache from 2026-08-11.

## Summary

The pipeline still works unchanged. `npm run makeYomitan` and
`npm run makeAnki` both succeed against the live sources:

- atwiki still lets `curl` through Cloudflare.
- The same 15 pages hold the same 5810 terms (Lv.4 1520, Lv.5 2070, Lv.6 1480,
  Lv.7 640, Lv.8 100).
- The wiki's 更新履歴 page lists these same totals, so it has added no new
  terms.

## Wiki changes since 2026-08-11

Only small corrections were made. The game's answer key (see below) confirms
each of them.

| 問題ID    | Field    | Before            | After             |
| --------- | -------- | ----------------- | ----------------- |
| Lv05_0629 | 意味     | 生活**羊**品以外… | 生活**用**品以外… |
| Lv06_0684 | 読み方   | がくい            | かくい            |
| Lv06_0957 | 読み方   | にわなくぶり      | にわくなぶり      |
| Lv06_1140 | テキスト | 鞲                | 韝                |

Other notes on these changes:

- **Lv06_0684:** the wiki now has the reading that `wikiOverrides.json`
  already forced, so that override has been removed.
- **Lv06_1140:** the game image shows the 韋 radical, so 韝 is right.
- **GUID changes:** the Anki GUID is built from 問題ID + 単語 + 読み方. So
  Lv06_0957 and Lv06_1140 get new GUIDs, as does Lv05_1916 (抽薹, through its
  new reading override). On import they come in as new notes next to the old
  ones. Delete the three old notes, or run `scripts/realign_anki_guids.py`.
- **Ignored by the parser:** two hint labels changed (部分指定 → 4文字指定 on
  p51, 6文字指定 → 動物 6文字指定 on p36). The parser doesn't read them.

## Game images (plicy)

- **Image URL:** the game's file version (`Update_No`) is now **655**, while
  `KANJI_IMAGE_URL` still says 234. That's fine, because plicy ignores the
  version segment: 234, 655 and even 1 all resolve to the same current file.
- **Redirects:** image URLs now return `301` to
  `/GameFilesRedirect/0/png//Convert/<sha1>png_0_<ms-timestamp>.data`.
  `fetch` follows this transparently.
- **Checking the cache cheaply:** the `<sha1>` in the redirect is the SHA-1 of
  the PNG. A cached image can be checked against plicy with a HEAD request
  plus `sha1sum`, with no download.
- **All 5760 images plicy has are byte-identical to the cache.** Nothing was
  re-rendered, and the hint-crop calibration still holds.
- **The same 50 IDs still return 404:** Lv05_2061–2070, Lv07_0621–0640 and
  Lv08_0081–0100.
  - These problems are missing from the browser build entirely, not just
    their images. They are also missing from the download build
    ([Formidi/KanzideGo](https://github.com/Formidi/KanzideGo), whose images
    are `img/pictures/*.rpgmvp`, last pushed 2026-07-16).
  - Both builds stop at Lv05_2060, Lv07_0620 and Lv08_0080. The wiki
    presumably took the 50 newer problems from the smartphone app.
  - So the wiki screenshots remain the only image source for them.
    Lv05_2061–2070 still have none; the wiki's 更新履歴 says "画像追加予定".

## The game's own answer key

The browser build loads its questions from plain UTF-8 text files with a
disguised extension:

```
https://html5.plicy.net/GameFilesUpdate/155561/655/img/battlebacks2/LvNN.xcf
```

The file format:

- Each problem is a block of `key:value` lines.
- Blocks are separated by `--------------------------------`.
- The keys:
  - `問題` is the 問題ID.
  - `解１`–`解３` are the accepted readings, without okurigana.
  - `送前`/`送後` are the kana before/after the answer.
  - `文上`/`文下` are the meaning.
- Answers contain `₨` markers; strip them.
- The file has no kanji: the term exists only as the image.

The file covers 5760 of the 5810 terms (all but the 50 above). Before this
check, 5742 wiki 読み方 matched an accepted game answer. The 18 below didn't,
and were added to `wikiOverrides.json` (2026-11-15), so all 5760 now match:

| 問題ID    | Term         | Wiki 読み方                | Game answer                |
| --------- | ------------ | -------------------------- | -------------------------- |
| Lv04_0095 | 蔦屋重三郎   | つたやじゅうさぶろう       | つたやじゅうざぶろう       |
| Lv04_0406 | 松柏の操     | しゃうはくのみさお         | しょうはくのみさお         |
| Lv04_0555 | 天の逆鉾     | あまのさかほこ             | あめのさかほこ             |
| Lv04_0869 | 有卦に入る   | うけにはいる               | うけにいる                 |
| Lv04_1285 | 箝口令を敷く | かんこうれい               | かんこうれいをしく         |
| Lv05_0190 | 鄒魯の学     | すうろうのがく             | すうろのがく               |
| Lv05_0805 | 帙み         | ふみつづみ                 | ふみづつみ                 |
| Lv05_1104 | 鹵う         | さらう                     | うばう                     |
| Lv05_1154 | 彽る         | たいもとおる               | たちもとおる               |
| Lv05_1616 | 阿弥陀籤     | あみだぐじ                 | あみだくじ                 |
| Lv06_0084 | 須陀洹       | しゃだおん                 | しゅだおん                 |
| Lv06_0871 | 楓蔦黄       | もみずつたきばむ           | もみじつたきばむ           |
| Lv06_0943 | 狩衣花眺頃   | かりごろもはなのころごろ   | かりごろもはなのこのごろ   |
| Lv06_0949 | 海老鰭盥槽   | えびのはたぶね             | えびのはたふね             |
| Lv06_1206 | 醜い         | みぐるい                   | みぐるしい                 |
| Lv06_1416 | 鸑鷟         | かくさく                   | がくさく                   |
| Lv06_1424 | 𮑱陶         | おおえびかづら             | おおえびかずら             |
| Lv07_0203 | 睦月連理𢢫   | むつましづきれんりのたまつばき | むつましずきれんりのたまつばき |

Most are plain typos. A few are judgment calls where the wiki's form also
exists (あまのさかほこ, うけにはいる, the づ/ず pairs), but the game accepts only
the form shown.

Side effects of these corrections:

- **Legacy 別表記 group:** it was keyed on the old reading for 睦月連理𢢫, so
  `legacyBetsuhyoki.json` now uses むつましずき… too, which keeps 睦月連理玉椿.
- **鹵う (Lv05_1104):** now reads うばう, like 褫う (Lv05_1465). Its old
  alt-form card under 褫う merged into the main card.
- **彽る (Lv05_1154):** now reads たちもとおる, like 踟る (Lv05_1905). Its old
  alt-form card under 踟る merged into the main card. 彽る comes first, so the
  13 shared 別表記 cards moved from Lv05_1905 to Lv05_1154.
- **GUIDs:** together with the wiki changes above, 37 notes have new GUIDs
  compared with the 2026-08-31 build. Two old notes have no counterpart: the
  merged 鹵う/彽る alt-form cards. `scripts/realign_anki_guids.py` pairs up
  all the others.

## Meanings (意味)

The editors' rules (メンバー(編集者)へ) say to quote the game's meaning as-is,
but the wiki's meanings are typed in by hand. Compared with the answer key
(5760 terms):

| Result                                                 | Share |
| ------------------------------------------------------ | ----- |
| Identical                                              | 73.3% |
| Same words; only punctuation, width or line breaks differ | 1.6%  |
| Same words, plus readings or ※ notes the editors added | 6.8%  |
| 1–3 characters differ                                  | 16.8% |
| 4–10 characters differ                                 | 0.9%  |
| More than 10 characters differ                         | 0.1%  |
| No wiki 意味 (literature quotes under 元作品)          | 0.4%  |

Since 2026-11-15 the build takes 意味 from the answer key
(`src/scrape/gameAnswerKey.ts`):

- **Markup:** the game's display markup is turned into plain text.
  - `ESC I[n]` icon codes are dropped.
  - `<漢字|よみ>` ruby becomes 漢字(よみ), the wiki's own style.
  - `[...]` brackets are dropped and their content kept.
- **Wiki additions:** the readings the wiki editors put after hard words, and
  their trailing ※ notes, are carried over. The two texts are aligned, and a
  reading is only placed where the end of its word lines up in both. 674 of
  712 carry over; the game already glosses the other 38 itself.
- **Glyph icons:** 9 meanings show a character as an icon because the game's
  font lacks it. The wiki's character fills the gap when the text on both
  sides lines up (Lv06_1138, the Lv.8 entries). Otherwise the wiki's meaning
  is kept (Lv07_0560 𠫓まれる).
- **Kept from the wiki:**
  - the 50 problems the game data lacks;
  - the 25 literature problems, whose quote the wiki stores under 元作品.
- **Game errors:** a manual review of all ~1000 substantive changes found 7
  cases where the game is wrong or the wiki adds something. They are kept via
  `wikiOverrides.json`: Lv04_0393, Lv05_0289, Lv05_0379, Lv05_0858, Lv06_1206,
  Lv07_0343 and Lv07_0539.

Side effect on the Anki deck: when an alt spelling belongs to two problems,
the deck keeps the copy with the longest 意味. With the new meanings, five
alt-form cards switched owner and got new GUIDs: 海雲, 鯒, 鮲, 翌桧 and 明日檜.
