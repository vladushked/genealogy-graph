# Testing Genealogy Graph

Three layers, from fast to real:

| Layer | What | Where | Run |
|---|---|---|---|
| Unit | Pure functions: dates, names, kinship terms, layout, scene, export sizes, settings, import readers | `test/unit/*.test.ts` (node:test) | `npm run test:unit` |
| Vault | Every test vault read as the plugin reads Obsidian's metadata cache, compared with its `expected.json`; every import file read and planned | `test/vault/*.test.ts` (node:test) | `npm run test:vault` |
| UI | The plugin in a real Obsidian: clicks on the canvas, the side form, dialogs, files written | `test/e2e/*.e2e.ts` (WebdriverIO + wdio-obsidian-service) | `npm run test:e2e` |

`npm test` runs the first two; `npm run typecheck` checks the sources and all tests.

## Test vaults

The vaults are generated in a separate public repository, [lineage-test-vaults](https://github.com/vladushked/lineage-test-vaults), checked out as the submodule `test/fixtures` (`git submodule update --init`). All people there are fictional. Each vault has an `expected.json` written by the generator from its own description of the people — never from the plugin — so a test compares the plugin with an independent account of what is in the vault.

| Vault | Used for |
|---|---|
| `scenarios` | Hand-made families: a clean six-generation line, remarriages and half siblings, namesakes and equal file names, every way to write a date, broken links, values outside the schema, notes that are not people, strange names in many scripts, portraits in every format, adoption, cousins married |
| `international` | Western, Spanish, Korean, Chinese, Hungarian, Icelandic, Hebrew and Arabic names; English dates; opens in English with the Western name scheme |
| `scale-500`, `scale-1000` | Large generated families for speed |
| `empty` | A tree started from scratch |
| `imports/` | GEDCOM 5.5.1 and 7.0, ANSI files in Windows-1251 and -1252, a «Древо Жизни» archive, broken and empty files |

To work on vaults and plugin together, point the tests at another checkout: `LINEAGE_TEST_VAULTS=../lineage-test-vaults npm test`.

## UI tests

`npm run test:e2e` builds the plugin and runs every spec in a fresh copy of its vault. wdio-obsidian-service downloads Obsidian into `.obsidian-cache`. Versions are chosen by `OBSIDIAN_VERSIONS` (app/installer pairs), by default `latest/latest`; CI also runs the `minAppVersion` of `manifest.json`: `OBSIDIAN_VERSIONS=1.8.7/earliest`. `WDIO_INSTANCES` sets how many Obsidian windows run at once (2). Linux needs a display: locally the windows open on the desktop; without one run `xvfb-run -a npm run test:e2e`. A failing test leaves a screenshot in `test-results/`.

The helpers in `test/e2e/helpers.ts` drive the graph the way a user does: `showNode` puts a person in the middle of the view (the camera jumps and stops following the layout), `clickNode` sends real mouse events to that point and waits out the plugin's double-click time, `waitSettled` waits for the layout to rest, `state` reads what the graph shows.

## Scenarios

Each test names its scenario id in its title.

| ID | Scenario | Vault | Layer |
|---|---|---|---|
| VAULT-01 | Person cards are exactly the notes with `type: person` outside the templates folder | all | vault |
| VAULT-02 | Links declared from either card are merged; adoptions are dashed; an ambiguous short link resolves to one of the namesakes | all | vault |
| VAULT-03 | Life years under the names for every date notation, Russian and English | scenarios, international | vault |
| VAULT-04 | Portraits: explicit, embedded, broken path, PDF and text skipped, every image format | scenarios | vault |
| VAULT-05 | «me» is generation 0 | scenarios, international | vault |
| AUDIT-01 | Проблемы: missing cards, self links, values outside the schema, contradicting generations | scenarios | vault |
| AUDIT-02 | Уточнить: what each card lacks, by name scheme | scenarios, international | vault |
| AUDIT-03…05 | The problems and clarify buttons count them, list them by card, show a person from the list | scenarios | UI |
| EDIT-01…04 | First person and «me»; a child and a parent with name hints; links written into both cards; a new birth year renames the card and Obsidian updates the links | empty | UI |
| EDIT-03 | Name hints in every scheme | international | vault |
| EDIT-05 | File names follow the template, so renaming recognises them | all | vault |
| EDIT-06…07 | Spanish and Icelandic hints and field order in the form | international | UI |
| EDIT-08…09 | A card's own name scheme in a vault of another one: a Spanish father's child inherits it, gets Spanish surnames and no patronymic in «Уточнить»; a birth place in Spain suggests the scheme | international | UI |
| OPEN-01…04 | The command opens the graph with every person; no console errors; «Найти себя»; the empty vault invitation | scenarios, empty | UI |
| SELECT-01…05 | Click, Shift+click, deselect, Esc, a click on empty space; the side form follows; Ctrl+F search with namesakes | scenarios | UI |
| PROFILE-01…04 | Double click opens the profile; relative chips and «Назад»; the graph freezes; context menu | scenarios | UI |
| ROUTE-01 | Shortest route and kinship term in both languages | scenarios, international | vault |
| ROUTE-02…04 | Route mode by clicks, the term in the card, «not related», ⇅, Esc | scenarios | UI |
| ROOTS-01…03 | Ancestors up to the oldest; the «Корни» card; kin around grows with the threshold | scenarios | vault, UI |
| FILTERS-01…03 | Hide unconnected; depth; hiding a branch through a link and showing it again | scenarios | UI |
| FOCUS-01…04 | Focus modes, generation highlight (every chip on is the same as «все»), «Поколение за поколением», «Отпустить граф» | scenarios | UI |
| IMPORT-01…04 | Every import file: people, families, dates; a new vault gets every card, a re-import no duplicates; broken files refused | imports | vault |
| IMPORT-03 | A person already in the vault is completed, not duplicated | imports + scenarios | vault |
| IMPORT-05…07 | The import dialog: summary, cards in family folders, report note, re-import, refusal | empty | UI |
| EXPORT-01…02 | Print PDF with a notice of letters no font has; screen SVG | scenarios | UI |
| TOUCH-01…05 | Touch: two-finger pinch zooms, a held finger opens the person menu and lifting it keeps the menu, a tap selects, a double tap opens the profile and it stays; on a phone the export is saved into the vault | scenarios | UI |
| I18N-01…04 | Switching the language redraws the graph, tab and controls with no Russian left; the settings tab; an English vault from the start | scenarios, international | UI |
| SCALE-01…03 | A thousand people build without problems, open and settle, survive dragging | scale-500, scale-1000 | vault, UI |

## Phone and tablet layouts

The UI tests also run in Obsidian's own mobile mode (`app.emulateMobile`): `npm run test:e2e:phone` (a 430×932 window, Obsidian's phone layout) and `npm run test:e2e:tablet` (1180×820, the tablet layout), set by `LAYOUT=phone|tablet` in `openVault` (`test/e2e/helpers.ts`); CI runs both on the latest Obsidian. On those layouts the tests do what a finger would: put Obsidian's sidebar drawers and the side panel away before touching the graph (`clearGraph`), open the editor drawer to fill the form (`showEditor`), open the folded side panel (`openControls`). The export is saved into the vault there, and the export tests read it from the vault.

| ID | What | Vault | Kind |
| --- | --- | --- | --- |
| LAYOUT-01 | Every button over the graph shows its icon and its whole text (on a tablet Obsidian pads every button) | scenarios | UI |
| LAYOUT-02 | The controls over the graph do not cover each other or leave it; Obsidian's navigation bar covers none of them | scenarios | UI |
| LAYOUT-03 | Every highlighted generation keeps its color, not only the last one pressed | scenarios | UI |
| LAYOUT-04 | Phone: with the keyboard up (`--keyboard-height`) the dock stays clear above it and the person search lists its people above the field | scenarios | UI |

## Phone screenshots

`npm run phone` opens the `showcase` vault in Obsidian's own mobile mode (`app.emulateMobile`) on a screen the size of an iPhone 16 Pro Max (430×932, 3x) with touch input, and saves screenshots to `test-results/phone/`: the graph, the side panel, a selected person, the long-press menu, the profile, the route, «Уточнить», export (`wdio.phone.conf.mts`, `test/e2e/phone.shots.ts`). It is Chromium, not iOS WebKit: the layout and the gestures show, Safari's own quirks do not. To look by hand: `app.emulateMobile(true)` in the developer console of Obsidian, a narrow window or DevTools' device toolbar (`Ctrl+Shift+M`); `app.emulateMobile(false)` returns.

## README media

`npm run media` records `docs/media/demo.gif` and the directory screenshots in `docs/media/screenshots/` (1200×800) from the fictional `showcase` vault: the same wdio-obsidian-service setup as the UI tests (`wdio.media.conf.mts`, `docs/media/record.media.ts`), frames from Electron's `capturePage`, then `docs/media/assemble.mjs` builds the GIF with ffmpeg. An Obsidian window opens on the desktop while it records.
