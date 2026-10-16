# Import from another program

**Import family tree…** brings a family tree from another genealogy program or site into the vault as [person cards](data.md). Nothing is written until you confirm, and importing the same file again creates no duplicates.

Other guides: [interface](interface.md) · [data](data.md) · [export](export.md).

![A GEDCOM file: the summary, Import, the report and the new family on the graph](https://raw.githubusercontent.com/vladushked/genealogy-graph-media/main/guides/import.gif)

Supported:

- **GEDCOM** 5.5, 5.5.1 and 7.0 (`.ged`) — the exchange format almost every genealogy program and site exports;
- **«Drevo Zhizni» 5** (`.at5`), a Russian genealogy program.

## Steps

Run **Import family tree…** from the command palette, or **Import…** in the **Import** section of the graph's side panel.

1. **Choose the file.** A damaged or foreign file is refused with an explanation.
2. **Photos** are taken from next to it: the folder of the `.ged` file (paths in it may be relative or absolute, even from another computer — then a file is looked up by name), or the `<archive>.files` folder of an `.at5`. If they are elsewhere, point to the folder, or import without photos. On a phone or tablet a folder cannot be read: choose the photo files themselves, they are matched by name.
3. **Review the summary**: how many people, links, couples and files; new cards, cards to complete, disagreements, namesakes, warnings from reading the file.
   - **Where cards go**: family folders in the vault root — one folder per surname (women by birth surname, men by surname; people without a surname join their father's, mother's or husband's folder) — or one folder.
   - **Possibly already in the vault**: people whose card might exist; choose the card or a new one.
4. **Import.** Cards are named by the file name template and the [name scheme](interface.md#names), as cards added on the graph; namesakes get a place or a number. In the Russian scheme family folders are plural surnames (Озеровы), in the Spanish the first surname, otherwise the surname as is. Photos are copied once into the vault (**Files folder** in the settings; by default Obsidian's attachment folder or `files`).
5. **Open report**: the report note `Import <file> <date>` lists what was created and completed, the disagreements and the missing files.

## Into a vault that already has cards

- Existing cards only gain the values they lack; nothing is overwritten. Where the file and a card disagree, the report says so and the card keeps its value.
- A re-import of the same file finds its cards through `source_record` and creates none twice.

## What GEDCOM gives

- **Text** in UTF-8, UTF-16 or a Windows code page: `ANSI` is read as Windows-1251 when its letters come in Cyrillic runs, otherwise as Windows-1252.
- **Names** give the surname, given name and patronymic — Russian files keep the patronymic as the last given name. A `TYPE married` name becomes the surname, with the other one as the birth surname.
- **Events and facts** fill the [properties](data.md#properties): birth, baptism, death with its cause, burial, occupation, education, residences, religion, nationality, social status. Facts without a property (emigration, title, custom `EVEN` and `FACT`), every `NOTE` and family notes go into the card's text. Source citations (`SOUR` with `PAGE`) go into `sources`.
- **Families** give parents (`PEDI adopted`/`foster` and `_FREL`/`_MREL` make adoptive parents), spouses and `marriages`; `ASSO` with a godparent role gives `godparents`.
- **Dates** keep their uncertainty: `ABT`, `BEF`, `AFT`, `BET … AND …` become the plugin's [date forms](data.md#dates).
- **The portrait** is the `_PRIM` picture, otherwise the first one.
- GEDCOM 7 archives (`.gdz`) are not read yet: unpack them and import the `.ged`.
