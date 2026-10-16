# The data: person cards

Every person is a note — a **card** — and the graph is drawn from the cards' properties. Your data stays plain Markdown: the properties follow GEDCOM, the exchange format of genealogy programs, so the vault stays readable without the plugin.

Other guides: [interface](interface.md) · [import](import.md) · [export](export.md).

![A card: properties on top, the person's story below](https://raw.githubusercontent.com/vladushked/genealogy-graph-media/main/guides/data-card.png)

## A card

A note is a person card when its frontmatter says `type: person`. Notes in the templates folder (`templates` by default, **Templates folder** in the settings) are left out.

```markdown
---
type: person
name: Emily Carter
surname: Carter
given_name: Emily
sex: female
birth_date: 1994
birth_place: Coventry, England
life_status: living
occupation: Archivist
photo: "[[attachments/emily.svg]]"
parents:
  - "[[Michael Carter 1962-]]"
  - "[[Susan Carter (Walsh) 1964-]]"
children:
  - "[[Noah Bennett 2021-]]"
  - "[[Grace Bennett 2024-]]"
spouses:
  - "[[Mark Bennett 1992-]]"
---

Keeps the family archive: letters, photographs and grandfather Robert's notebooks.
```

- Properties are flat, so they stay editable in Obsidian's Properties panel; an empty or missing value means «unknown».
- The note text is the person's story (GEDCOM `NOTE`): write anything there, it never changes the graph. Links in the text never become relationship lines.
- Cards are best added from the graph (see the [interface guide](interface.md#1-start-a-family-tree)): the plugin writes the links into both cards and names the file. Writing them by hand works just as well.

## Properties

The GEDCOM tag each property corresponds to is in brackets, so a card maps to a GEDCOM `INDI` record and back.

| Property | Meaning |
|---|---|
| `type` | `person`: marks the note as a card |
| `name` | The name on the graph (`NAME`); without it, the file name |
| `surname`, `given_name`, `patronymic` | Parts of the name (`SURN`, `GIVN`; GEDCOM has no patronymic and keeps it in `GIVN`) |
| `birth_surname`, `name_variants` | Surname at birth (`NAME` with `TYPE birth`); other names (more `NAME` records) |
| `name_scheme` | The card's own name tradition: `russian`, `western`, `spanish`, `eastern` or `icelandic`; without it, the vault's (see [Names](interface.md#names)) |
| `sex` | `male`, `female` or `unknown` (`SEX`) |
| `birth_date`, `birth_place` | Birth (`BIRT`) |
| `baptism_date`, `baptism_place` | Baptism or christening (`BAPM`, `CHR`): a parish register entry |
| `death_date`, `death_place`, `cause_of_death` | Death (`DEAT`, `CAUS`); `death_date: "?"` means died, date unknown |
| `burial_date`, `burial_place` | Burial (`BURI`) |
| `life_status` | `living`, `deceased` or `unknown`; without it a death date means deceased, otherwise unknown |
| `occupation` | Occupation (`OCCU`); a list when there are several |
| `education`, `military`, `residences` | Lists: schools (`EDUC`), military service, places of residence with their year (`RESI`, census records) |
| `social_status`, `religion`, `nationality` | Social estate (`CAST`), religion (`RELI`), nationality (`NATI`) |
| `photo` | The portrait (`OBJE`), for example `"[[files/portrait.jpg]]"`; without it, the first image embedded in the note (PDF embeds are skipped) |
| `parents`, `children`, `spouses`, `adoptive_parents` | Relationships: wiki-links or plain names, what GEDCOM keeps in `FAM` records; adoptions are drawn dashed |
| `marriages` | Facts of a marriage, one entry per spouse: `"[[Spouse]]: married 1975-06-12, Moscow; divorced 1980"` (`MARR`, `DIV`) |
| `godparents` | Godparents (`ASSO`), links; not drawn |
| `identity` | How sure the person is who the card says: `confirmed`, `probable` or `hypothesis` (a dashed outline) |
| `sources`, `questions` | Sources (`SOUR`) and open research questions |
| `id`, `source_record` | A stable card id; where an imported card came from (it finds the card again on a re-import) |

Values outside the allowed ones (`sex`, `life_status`, `identity`, `name_scheme`) are kept as written and listed under **Problems**.

## Dates

Dates are text, so uncertainty is written as it is in the records:

| Written | Means | GEDCOM |
|---|---|---|
| `1915`, `1915-03`, `1915-03-07`, `7 Mar 1915`, `March 7, 1915`, `07.03.1915` | a year, a month, a day | |
| `1915?`, `~1915`, `abt 1915`, `c. 1915`, `circa 1915`, `est 1915`, `около 1915` | about | `ABT`, `EST`, `CAL` |
| `<1915`, `bef 1915`, `before 1915`, `до 1915` | before | `BEF` |
| `>1915`, `aft 1915`, `after 1915`, `после 1915` | after | `AFT` |
| `1915..1920`, `1915–1920`, `bet 1915 and 1920`, `между 1915 и 1920` | between | `BET … AND …` |
| `1910s`, `1910-е` | a decade | |
| `?` | happened, date unknown | |

Dates of the Russian Empire stay old style, as written in the records; a note on a date (a disagreement between sources) belongs in the card's text.

## Relationships

- Relationships come from `parents`, `children`, `spouses` and `adoptive_parents` only. A link may be written from one card or from both; both are merged into one link.
- A link to a note that does not exist, a link to the card itself and a parent link whose generations do not fit the rest of the family (a link that skips a generation, a parent who is also a descendant) are not guessed at: such a parent link is still drawn, and the link is listed under **Problems**.
- **Generations are not stored.** The graph counts them from the relationships: a parent −1, a child +1, a spouse the same. Your own card (**Card for «Find me»** in the settings) is generation 0; a family not connected to you is numbered so that its youngest generation is 0.

## File names

New cards are named by **File name of new cards**, `{name} {born}-{died}` by default — `Emily Carter 1994-`, or `Фамилия Имя Отчество ГГГГ-ГГГГ` in the Russian scheme. With **Rename by the template** a card whose file name followed the template is renamed when its name or dates change; cards named by hand are never renamed. See [Names](interface.md#names) for the placeholders.
