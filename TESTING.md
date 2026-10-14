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
| OPEN-01…04 | The command opens the graph with every person; no console errors; «Найти себя»; the empty vault invitation | scenarios, empty | UI |
| SELECT-01…05 | Click, Shift+click, deselect, Esc, a click on empty space; the side form follows; Ctrl+F search with namesakes | scenarios | UI |
| PROFILE-01…04 | Double click opens the profile; relative chips and «Назад»; the graph freezes; context menu | scenarios | UI |
| ROUTE-01 | Shortest route and kinship term in both languages | scenarios, international | vault |
| ROUTE-02…04 | Route mode by clicks, the term in the card, «not related», ⇅, Esc | scenarios | UI |
| ROOTS-01…03 | Ancestors up to the oldest; the «Корни» card; kin around grows with the threshold | scenarios | vault, UI |
| FILTERS-01…03 | Hide unconnected; depth; hiding a branch through a link and showing it again | scenarios | UI |
| FOCUS-01…04 | Focus modes, generation highlight, «Поколение за поколением», «Отпустить граф» | scenarios | UI |
| IMPORT-01…04 | Every import file: people, families, dates; a new vault gets every card, a re-import no duplicates; broken files refused | imports | vault |
| IMPORT-03 | A person already in the vault is completed, not duplicated | imports + scenarios | vault |
| IMPORT-05…07 | The import dialog: summary, cards in family folders, report note, re-import, refusal | empty | UI |
| EXPORT-01…02 | Print PDF with a notice of letters no font has; screen SVG | scenarios | UI |
| I18N-01…04 | Switching the language redraws the graph, tab and controls with no Russian left; the settings tab; an English vault from the start | scenarios, international | UI |
| SCALE-01…03 | A thousand people build without problems, open and settle, survive dragging | scale-500, scale-1000 | vault, UI |
