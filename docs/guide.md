# Genealogy Graph: the full guide

Everything the plugin does, in detail. For a short overview see the [README](../README.md).

Interactive genealogy graph built from person notes. The graph opens as a compact group, spreads out with strong repulsion for half a second, then settles, coming to rest after about 2 seconds; after dragging a person it calms down in under 2 seconds. Forces and damping stay consistent while the simulation cools, so movement fades without an abrupt stop after opening. Every relationship comes from note properties. The plugin writes notes only when you add or edit people (see **Adding and editing people**) or run an import; with the setting **Rename by the template** (**Переименовывать по шаблону**) it also renames cards whose name or dates change. It works on desktop, phones and tablets (see **Phones and tablets**).

The interface is in English or Russian (setting **Language**: as in Obsidian by default; a vault that used the plugin before the translation keeps Russian). Names follow a **name scheme** — Russian, Western, Spanish, East Asian or Icelandic — and the file names of new cards a template, so the plugin works for families outside Russia too. Below, the controls are named in Russian as they were first written; the English interface uses the same layout.

Like Obsidian's own graph view, the live graph is drawn on a canvas and its force layout runs in a Web Worker, so a family of a thousand people still pans, zooms and drags smoothly; it draws only when something changes. Exported files are rendered separately as SVG (see **Экспорт**).

## Data

Every person is a note whose frontmatter says `type: person`. Notes in the templates folder (`templates` by default, configurable) are ignored. Properties are flat, so they stay editable in Obsidian's Properties panel; an empty value means "unknown". They follow GEDCOM, so a card maps to a GEDCOM `INDI` record and back; the GEDCOM tag is in brackets. The note text is the person's story (GEDCOM `NOTE`): write anything there, it never changes the graph.

| Property | Meaning |
|---|---|
| `name` | Node label (`NAME`); falls back to the file name |
| `surname`, `given_name`, `patronymic` | Parts of the name (`SURN`, `GIVN`; GEDCOM has no patronymic and keeps it in `GIVN`) |
| `birth_surname`, `name_variants` | Surname at birth (`NAME` with `TYPE birth`), other names (more `NAME` records) |
| `name_scheme` | The card's own name scheme: `russian`, `western`, `spanish`, `eastern` or `icelandic`; without it the vault's (settings). Not in GEDCOM |
| `sex` | `male`, `female` or `unknown` (`SEX`) |
| `birth_date`, `birth_place` | Birth (`BIRT`) |
| `baptism_date`, `baptism_place` | Baptism or christening (`BAPM`, `CHR`): a metric book entry |
| `death_date`, `death_place`, `cause_of_death` | Death (`DEAT`, `CAUS`); `death_date: "?"` means died, date unknown |
| `burial_date`, `burial_place` | Burial (`BURI`) |
| `life_status` | `living`, `deceased` or `unknown` |
| `occupation` | Occupation (`OCCU`); a list when there are several |
| `education`, `military`, `residences` | Lists: schools (`EDUC`), military service, places of residence with their year (`RESI`, census records) |
| `social_status`, `religion`, `nationality` | Social estate — крестьянин, мещанин… (`CAST`), religion (`RELI`), nationality (`NATI`) |
| `photo` | Optional explicit portrait (`OBJE`) |
| `parents`, `children`, `spouses`, `adoptive_parents` | Relationships (wiki-links or plain names), what GEDCOM keeps in `FAM` records; adoptions are drawn dashed |
| `marriages` | Facts of a marriage, one entry per spouse: `"[[Супруг]]: брак 1975-06-12, Москва; развод 1980"` (`MARR`, `DIV`) |
| `godparents` | Godparents (`ASSO`), links; not drawn |
| `identity` | `confirmed`, `probable` or `hypothesis` (dashed outline) |
| `sources`, `questions` | Sources (`SOUR`) and open research questions |
| `id`, `source_record` | Stable card id; where an imported card came from (used to find it again on re-import) |

**Dates** are text: `1915`, `1915-03`, `1915-03-07`, also `7 Mar 1915`, `March 7, 1915`, `07.03.1915`; approximate `1915?`, `~1915`, `около 1915`, `abt 1915`, `c. 1915`, `circa 1915`, `est 1915` (GEDCOM `ABT`, `EST`, `CAL`); before `<1915`, `до 1915`, `bef 1915`, `before 1915` and after `>1915`, `после 1915`, `aft 1915`, `after 1915` (`BEF`, `AFT`); between `1915..1920`, `1915–1920`, `между 1915 и 1920`, `bet 1915 and 1920` (`BET … AND …`); a decade `1910-е` or `1910s`; `?` for an event known to have happened on an unknown date. Dates of the Russian Empire stay old style, as written in the records.

**Generations are not stored.** The graph counts them from relationships: parent −1, child +1, spouse the same. Your «Найти себя» card is generation 0; a family not connected to you is numbered so that its youngest generation is 0.

- **Relationships** come from the relationship properties only; links in the note body never become relationship lines.
- **A relationship declared from both notes** is merged into one link.
- **Problems.** Self-links, unresolved links, parent links whose generations do not fit the rest of the family (a link that skips a generation, a parent who is also a descendant) and values outside the allowed ones (`sex`, `life_status`, `identity`) are not guessed at; such a parent link is still drawn. A warning button with their count appears in the top left corner of the graph only when there are any; it opens their list, grouped by note. Click a name to show the person on the graph, or the note icon to open the card. While the list is open, generation colors and sizes step aside: everyone is a plain gray node of one size, and the people involved are red, a deeper shade for more problems. Hovering a person lists their problems.
- **Life years.** Living: `b. 2001` (`р. 2001`); deceased: `1915–1980`, with `?` for an unknown year (`1915–?`); unknown status: `2001–`, which does not claim the person is alive. Without `life_status`, a death date means deceased and otherwise the status is unknown. Approximate years (`1915?`, `abt 1915`, `около 1915`) and decades (`1910s`, `1910-е`) are kept.
- **Portraits.** `photo: "[[files/portrait.jpg]]"` picks a portrait explicitly. Otherwise the first embedded image in the note body is used; PDF embeds are skipped. When the image is unavailable, the node is drawn as a plain circle.
- **Refresh.** The graph refreshes only when a person note or an image changes, and it skips the redraw if nothing it shows has changed.

## Adding and editing people

A family tree can be started from scratch in the graph.

- **Empty vault.** A large «+» in the middle of the graph opens the form for the first person; «Это я» makes them the «Найти себя» card.
- **Adding relatives.** When one person is selected, a «+» appears beside them: **Родитель**, **Ребёнок**, **Супруг(а)**, **Брат или сестра**, or a person with no link. The «+» at the bottom of the graph does the same at any time (with nobody selected it adds an unlinked person). The node's context menu has the same items.
- **The form** opens in the right sidebar (**Карточка человека**). It shows the person selected on the graph and edits their card; with unsaved changes, selecting someone else does not replace it. It is short — name, sex, birth and death dates, relatives; the birth surname, life status, places, baptism, burial, cause of death, occupation, social estate, religion, nationality and identity fold under **Подробнее**. Lists (residences, military service, education, marriages) are edited in the Properties panel. The cross in its top right corner closes a new card or drops unsaved changes.
  - Relationship fields (**Родители**, **Дети**, **Супруги**): click the field, then click people on the graph — each one is added (Esc ends picking) — or type a name.
  - The name fields follow the **name scheme** (settings): Russian — surname, given name, patronymic; Western — given names, surname; Spanish — given names, two surnames; East Asian and Hungarian — surname first, given name; Icelandic — given name, patronymic, a family name only if there is one. Outside the Russian and Icelandic schemes the patronymic field shows only for a card that has one. The full name (`name`) is written in the scheme's order: «Озерова Светлана Борисовна», «Mary Ann Smith», «Kim Min-jun», «Jón Sigurðsson»; a person may have no surname at all.
  - **A scheme per card.** A family with branches in several countries keeps the vault's scheme for most people and gives the others their own: **Схема имени** under «Подробнее» (property `name_scheme`). That card's form, name, file name and «Уточнить» follow its scheme — a Spanish card in a Russian vault is not asked for a patronymic. A new relative takes the scheme of the father, then the mother, then the child or sibling it is added to (a spouse's never): set `spanish` on the first Spanish ancestor and the branch stays Spanish. A birth place in a country of another tradition («Sevilla, España», «Reykjavík, Iceland») suggests its scheme above the name fields while the card follows the vault's; it is only a suggestion, as a Russian may be born in Madrid.
  - Filled in automatically from relatives, until you type over them, by the scheme. Russian: the father's surname in the person's form (Озеров → Озерова), a patronymic from the father's name, a wife's married surname, a father's name from a child's patronymic. Western and East Asian: the father's surname (the mother's without a father); a wife keeps hers. Spanish: the father's first surname and the mother's first surname («García Barcha»). Icelandic: a patronymic from the father's name (Jón → Jónsson, Jónsdóttir). A new child gets both parents when the person has one spouse; a second parent becomes the first one's spouse.
  - A sibling of a person without parents gets a common parent created as a hypothesis (`identity: hypothesis`, a question in `questions`), named after the patronymic when possible.
- **Writing.** Relationships are written into both cards. A new card is named by **File name of new cards**, `{name} {born}-{died}` by default — `Фамилия Имя Отчество ГГГГ-ГГГГ` in the Russian scheme, `Given Surname YYYY-YYYY` in the Western. The template takes `{name}` (the full name in the scheme's order, a different birth surname in parentheses), `{surname}`, `{given}`, `{patronymic}`, `{birth_surname}`, `{born}` and `{died}` (`?` when unknown, `{died}` empty for the living), for example `{surname}, {given} ({born}–{died})`; spaces and parentheses left empty are dropped. It goes into the folder of the relative it was added to (otherwise **Папка новых карточек**); **Шаблон карточки** gives it the template's properties and text.
- **Renaming.** With **Rename by the template** on (the default), a card whose file name followed the template is renamed when its name or dates change; cards named by hand are never renamed. Obsidian updates the links, so this needs **Автоматически обновлять внутренние ссылки** (Files and links); without it the plugin says so and does not rename.
- **Уточнить.** A yellow «?» button beside the problems button counts people with something to clarify: any empty main field (surname and patronymic where the name scheme has them, given name, sex, parents or the second parent, children, birth date, life status, the death date of someone deceased, photo), a hypothesis or partly confirmed identity, open `questions`. Its list puts the least filled cards first. While it is open the graph is drawn like for Проблемы, in shades of yellow.

## Import

**Импортировать родословную…** brings a family tree from another program into the vault. Supported: **GEDCOM** 5.5, 5.5.1 and 7.0 (`.ged`) — the exchange format of almost every genealogy program and site — and **«Древо Жизни» 5** (`.at5`). Nothing is written until you confirm.

1. Choose the file. A damaged or foreign file is refused with an explanation. Photos are taken from next to it: the folder of the `.ged` file (paths in it may be relative or absolute, even from another computer — then the file is looked up by name), or the `<archive>.files` folder of an `.at5`. If they are elsewhere, point to the folder, or import without photos.
2. Review the preview:
   - **Where cards go** — family folders in the vault root (one folder per surname: women by birth surname, men by surname; people without a surname join their father's, mother's or husband's folder) or one folder.
   - What will happen: new cards, cards to complete, disagreements, namesakes, warnings from reading the file.
   - **Possibly already in the vault** — people whose card might exist; choose the card or a new one.
3. **Импортировать.** Cards are named by the file name template and the name scheme, as cards added in the graph (namesakes get a place or a number); in the Russian scheme family folders are plural surnames (Озеровы), in the Spanish the first surname, otherwise the surname as is. Photos are copied once into the vault files folder (setting **Папка файлов**; by default Obsidian's attachment folder or `files`). Existing cards only gain values they lack; nothing is overwritten, and disagreements go to the report note `Импорт <файл> <дата>`.

Re-importing the same file finds its cards through `source_record` and creates no duplicates. Importers for other formats plug into the same steps.

**From GEDCOM.** Text in UTF-8, UTF-16 or a Windows code page (`ANSI` is read as Windows-1251 when its letters come in Cyrillic runs, otherwise as Windows-1252). Names give the surname, given name and patronymic — Russian files keep it as the last given name; a `TYPE married` name becomes the surname with the other one as the birth surname. Events and facts fill the properties above; facts without a property (emigration, title, custom `EVEN`/`FACT`), every `NOTE` and family notes go into the card text; source citations (`SOUR` with `PAGE`) go into `sources`. Family records give parents (`PEDI adopted`/`foster` and `_FREL`/`_MREL` make adoptive parents), spouses and `marriages`; `ASSO` with a godparent role gives `godparents`. The portrait is the `_PRIM` picture, otherwise the first one; GEDCOM 7 archives (`.gdz`) are not read yet — unpack them and import the `.ged`.

## Graph

- **Nodes.**
  - Color shows the generation: the generations of the vault are spread evenly over the color wheel, oldest violet to youngest red, so no color repeats.
  - Portraits are round and larger, with a thick ring in their generation color; other people have no ring.
  - Nodes farther from the median visible generation are smaller. Selecting people adds a little to their own size only.
  - More parent, child and spouse connections make a node larger. The connection multiplier is capped at twice the base radius. Counts use the full graph, including filtered or hidden relatives.
  - Deceased people are drawn in a darker shade of their generation color, and their portraits get a dark veil.
  - The view follows the light or dark Obsidian theme.
  - Names, life years and portraits fade out as you zoom out (fully gone below about 20% zoom), leaving plain colored nodes; selected people and route members keep their labels.
- **Spouses** sit side by side, level with each other, inside one light red shape: a pill for a couple. Spouses linked through a shared spouse (remarriages) get one merged shape, a chain of pills; three people married to one another make a rounded triangle. Names of a couple go on the outer sides of the shape instead of under it.
- **Children of a couple form a family.** A straight line with an arrow leaves the middle of the couple for each child.
  - Each marriage gets its own family, so half-siblings hang from different couples.
  - Parents who are not recorded as spouses are joined by a thin dashed line.
  - A single known parent with several children gets straight lines from the center of its node, hidden under the node itself.
  - A single parent with one child, or a child with more than two parents, keeps plain per-parent lines.
- **Layout.** When the selection or filters change, the layout settles from where it is instead of being laid out again. New cards appear next to a relative that is already on screen.
  - Once settled, the simulation sleeps until the graph changes or you interact with it. Hovering does not restart it.
  - **Отпустить граф** (the wind button under the gear) never lets the layout come to rest: people keep moving under the forces. It keeps the temperature the layout has while a person is dragged, so the released graph moves as it does under the hand. The button turns it on and off.
  - Spouses are one body in the layout: a couple, or a chain of remarriages, moves as a level row and repels as strongly as its people would apart. Nothing acts between spouses, so they never drift apart or squeeze together, whether you drag them or let the layout settle fully.
- **Поколение за поколением.** The play button under the gear (as the timelapse button of the graph view) starts from the oldest generation and adds the next one every 1.6 s, each newcomer next to a relative already shown. The camera follows the growing graph. Titles at the top name each generation («Поколение −3»), the years its people were born and how many they are, and how far it is from you («3-е колено от тебя — предки»); the newest generation is bright, the earlier ones fade a little. The last titles stay 2.5 s. Press the button (now a stop square) again to stop and show everyone.
- **Ctrl/Cmd+F** in the graph puts the cursor in the search.
  - Selecting people or a route never moves the graph: selected people are drawn larger, but the layout does not change.
  - Highlights blend: selecting people, highlighting generations and opening the problems list fade in and out over about a quarter of a second, and size changes ease too.

## Navigation

- Run **Открыть родословный граф**, or **Показать текущего человека на графе** from a person note.
- **Clicks and hover.**
  - A click selects the person (replacing the previous selection); their relatives stay highlighted. Shift+click adds people to the selection. Either way the camera fits the selected people with their parents, children and spouses — one generation each way, no further.
  - A click on a selected person (with or without Shift) deselects them, and the camera fits whoever stays selected with their closest relatives. A click on empty space or on a link clears the whole selection where the camera is; so does a first `Esc`, and a second `Esc` fits the whole graph.
  - A double click opens the person's profile (see below); Ctrl/Cmd-click opens the note in one reused tab (the person stays selected); a middle click opens it in a new tab.
  - The profile is a window over the graph, which blurs and stops moving and drawing until it closes. It reads like a profile page: the portrait on the left; on the right the name, then «Жизнь» (birth and death with dates and places, age, baptism, burial), facts and family in the reader's language (relatives are chips: a click opens their profile, «Назад» returns); sources and open questions; and the note's text below. The note stays the source: the corner buttons are «Показать на графе», «Изменить» (the side panel form) and «Открыть заметку». A note with only an import heading reads as empty. «Профиль» is also in the context menu.
  - Right-click opens a menu: open the note, open it in a new tab, select or deselect.
  - A hovered person is drawn slightly larger.
  - Hovering only enlarges the person; Ctrl+hover shows Obsidian's page preview. Relatives are highlighted for the selected people, not on hover.
  - Names under the circles are not clickable; use the circle.
- **Search and «me».**
  - Search in **Люди**: suggestions show matching names with life years; choosing one selects the person and brings them into view with their closest relatives.
  - **Найти себя** appears once your own card is chosen in settings.
- **Camera.** On opening, the camera reserves space for the expanded graph and holds that scale during the first half second, then smoothly follows the whole graph. Panning, zooming or dragging a node stops that. The mouse wheel glides the zoom around the pointer, as in Obsidian's graph view. The corner buttons, or `+`, `-` and `0` with the graph focused, zoom and fit the graph.
- **Resetting.** **Снять выбор** clears the selection and fits the graph. `Esc` cancels a selected link, leaves route mode, or clears the selection where the camera is; with nothing selected it fits the whole graph.
- **Filters.**
  - **Глубина** limits the view to 1–4 relationship steps from the selected people, or to the selected people only; it is inactive while nobody is selected.
  - **Скрыть несоединённых** hides people without links, or, with a selection, people unrelated to it.

## Phones and tablets

- **Gestures.** One finger pans the graph or drags a person; two fingers pinch to zoom around their middle. A tap selects, a double tap opens the profile, a finger held on a person for half a second opens their menu (the right-click menu: profile, note, adding relatives, selecting).
- **Phone layout.** The controls are finger-sized (40 px) and sit above Obsidian's navigation bar: the dock across the bottom, «⤢» above it (the zoom buttons give way to the pinch), the generations folded into a button of colored dots over «Я», as wide as two dock buttons (the highlighted ones larger): it narrows to a cross and the generations grow up out of it, «все» on top; the cross, a tap on empty space or moving the graph fold them away, so they never hide people; while the route or roots card is open the button steps aside; the focus as icons only. A tap on empty space also closes the side panel and the Проблемы and Уточнить lists, which have a cross of their own too. The side panel starts folded and opens across the whole width; the status line is hidden.
- **Export** is saved into the vault (to the attachments folder) and opens there, since a download does nothing in the mobile app.
- **Import** reads GEDCOM and «Древо Жизни» as on a computer; a phone cannot read a folder next to the file, so the photos are picked as files and matched by name.

## View modes

The panel in the top right corner uses the markup and styles of the graph view's settings: a gear without a background opens it, and the cross that folds it takes the gear's place. It holds **Люди** (search, selection, «Найти себя»), **Фильтры** (route between two, «Скрыть несоединённых», «Глубина», hidden links), **Отображение** (sizes of the generations focus), and **Ещё** (export, import); while it is folded, the buttons under the gear run «Поколение за поколением» and toggle «Отпустить граф». Its sections fold; the state is remembered. The line at the bottom shows how many people and links are visible.

How people are drawn is switched by buttons on the graph; the choice is remembered.
- **Focus**, two buttons at the top middle: **Поколения** (default) or **Число родственников**. The focus sets sizes, colors and the highlight column on the left.
  - **Поколения**: colors by generation; sizes by **Размер по поколениям** in the panel's **Отображение** section: **Старшие крупнее** (default) or **Младшие крупнее**, each generation step 28% smaller. The column holds the generations, oldest at the top, each with its color, numbered from yours (−2, −1, 0, +1); 0 carries «Я» once your card is chosen. Without it, 0 is the youngest generation of each separate family.
  - **Число родственников**: the more direct relatives (parents, children, spouses) a person has, the larger and warmer: blue for few through to red for the most (log scale). The column holds the counts present, most at the top; beyond twelve counts the largest share one button («12+»).
- Clicking buttons in the column highlights those people; everyone else and every link not between highlighted people fades. **все** clears it. Each focus remembers its own highlight.
- While Проблемы or Уточнить is open, the focus is set aside (see **Data**).

## Route between two people

Press **Маршрут родства**, then click two people, or select exactly two before entering the mode. The shortest chain of parent and spouse links is highlighted, including the half of a couple that leads to the child. A third click starts a new pair. The filter's description says what to click next. Hover highlighting is off in this mode. Among routes of the same length, the one through the fewest marriages is taken, so a route goes through a common ancestor rather than a parent's spouse.

The route card is laid out as in a maps app: a field for «Откуда» and one for «Куда», joined by a dotted line, with ⇅ beside them to swap the two along the same route; an empty field also takes a typed name. Between the fields runs the chain of roles, each next person to the previous one («мать → брат → сын»; a role centers the graph on that person), and below them is what «Куда» is to «Откуда»: «троюродный дядя». The term comes from the route's steps and the sexes on it: blood kin any number of steps up and then down (дядя, двоюродный дедушка, внучатый племянник, семиюродная сестра, «предок в 7-м колене»), half siblings (единокровный, единоутробный), one adoption step (приёмная мать), and in-laws with one marriage at either end (свекровь, шурин, падчерица, мачеха, зять, «двоюродный брат жены», «муж двоюродной сестры»). A route of another shape has only its chain, and in Russian a saying about distant kin in place of the term, the same for the pair each time («седьмая вода на киселе», «нашему забору двоюродный плетень»). Terms are in the language of the plugin's interface: in English «first cousin once removed», «great-uncle», «wife's first cousin»; the sayings are Russian only.

**Глубина** applies to the route:
- «только путь» shows just the chain;
- 1–4 steps add side branches around it, drawn lighter than the route;
- «вся семья» keeps the whole graph with everything off the route dimmed.


## Корни

The sprout button in the bottom dock shows where people come from: the chosen people and every line of their ancestors up to the oldest known, adoptive parents included. It starts from the selected people, or from «Я» when nobody is selected; a click on a person adds them to the roots or removes them, and so does the search (Ctrl/Cmd+F). Several roots share their common ancestors. The lines are highlighted as a route is.

A card above the dock lists the roots, how many ancestors they have and how far back («86 предков · до поколения −11»), and names the oldest. **Родня вокруг, колен** sets how much family shows around the lines:
- **0** — the lines alone;
- **1** — plus the brothers and sisters of every ancestor, and the children and siblings of the roots;
- **2** — plus their children (cousins), and so on up to **4**;
- **все** — the whole family, the lines highlighted.

A marriage takes no step: a relative's spouse shows with them. Hidden relatives are counted as «+N» on the person they hang from. «Корни» and «Маршрут родства» exclude each other; Esc leaves. Colors and sizes still follow the focus.

## Hiding branches

1. Click a link: the shape between spouses, a branch to a child, or a plain line. The link is highlighted, the people it would hide are previewed faded, and an eye button appears on it.
2. Click the eye to hide that side of the link.

Which side is hidden:
- The side holding the center (selected people, route ends and your own card) stays; without a center, the smaller side is hidden.
- If the two sides are also connected another way, for example through a marriage, nothing can be hidden: the eye is greyed out and says why.

A background click or `Esc` cancels. Hidden links are remembered and survive note renames; the **Скрыто связей** chip shows everything again.

Whenever relatives are hidden, by depth, by route mode or by a hidden link, the person they hang from shows a `+N` badge with the number of hidden people. Clicking the badge restores links hidden there; for depth-hidden relatives it explains which filter hides them.

## Export

**Экспорт** is for print or for the screen. It exports what the graph shows (in «Корни», the lines and kin around them), with portraits and labels in any script (see **Files**).

**Print starts from reading, not from the sheet.** **Как будут смотреть** sets the size of names: in hands at ~40 cm (9 pt), on a table or wall nearby at ~1 m (14 pt), on a wall from ~2 m (24 pt), or any size from 6 pt. The name size fixes the scale: millimetres per unit of the graph. Under the settings a line says what the print will actually give: «Имена 9 pt · буквы 3,2 мм — читаются с ~40 см», orange when names are smaller than asked, red below 6 pt («не прочитать»). A whole tree squeezed onto A0 no longer looks fine and prints at 1 mm.

**Что печатать:**
- **Весь граф** on one sheet, as large as the sheet allows. When names come out smaller than asked, the dialog names the smallest standard sheet that would do and takes it in one click, or says the tree has no such sheet («1,80 м × 1,78 м») and points to «Область», «Склейка» or a roll. **Переложить граф под форму листа** lays the graph out again for the sheet's proportions. On a plotter roll the width is fixed and the length follows the graph (up to 5 m, the PDF limit).
- **Область** on one sheet: over a miniature of the whole graph lies a frame of the sheet's shape, sized by the reading scale; drag it (or click where it should go) to print that part — say, your branch on A4 or 10×15 photo paper.
- **Склейка**: the graph at the reading scale over a grid of sheets with an overlap (10 mm by default), in whichever orientation needs fewer sheets. Each sheet carries «Лист 5 из 12 · ряд 2, столбец 1» and a dashed line where the next sheet is glued over. PDF only.

**Paper:** ISO A6–2A0 and B4–B0; photo 10×15 to 60×90 cm; US Letter, Legal, Tabloid; plotter rolls 610, 914 and 1067 mm; any custom size. Orientation is automatic or fixed; margins in mm.

**Files:** PDF is vector, with DejaVu Sans embedded: sharp at any size, the format for a print shop. The bundled font covers Latin (with Polish, Czech, Turkish, Vietnamese letters), Greek, Cyrillic, Armenian, Georgian, Hebrew and Arabic; Arabic is shaped and right-to-left names are written in display order. For Chinese, Japanese, Korean, Indic and other scripts, list TrueType fonts (`.ttf`) from the vault in **Fonts for PDF** (for example Noto Sans SC, Noto Sans KR): each name is written with the first font that has its letters, and the export says which letters no font has. OpenType/CFF fonts (`.otf`) and collections (`.ttc`) cannot be embedded. SVG and PNG are drawn by Obsidian itself and use the system fonts for any script. PNG and JPEG are rendered at 150, 300 or 600 dpi, with the resolution written into the file so a photo lab prints them at the right size; a page too large for the browser's canvas is refused with the highest dpi that fits. Portraits are embedded at the resolution the print needs (the largest person at 300 dpi, up to 1024 px).

**Для типографии:** 3 mm bleed (the paper colour runs past the trim) and crop marks at the corners, outside the bleed.

The preview is the sheet itself: paper, margins, bleed, crop marks and the part of the graph it holds, redrawn on every change. **Экран** exports SVG or PNG of the whole graph or the visible area in the graph's own proportions, as before. The dialog remembers its settings.

## Settings

- **Language**: as in Obsidian, English or Russian. Command names change after Obsidian restarts.
- Your own card for **Найти себя**: generation 0.
- **Папка файлов**: where imports copy photos and documents.
- **Name scheme** and **File name of new cards** (see **Adding and editing people**), with an example file name under them.
- **Fonts for PDF**: TrueType fonts for scripts the bundled font lacks.
- The templates folder that is excluded from the graph.

## Build

Requires Node.js 20+.

```sh
npm ci
npm test
npm run build
```

The bundled DejaVu Sans font is subset for exported files to Latin, Greek, Cyrillic, Armenian, Georgian, Hebrew, Arabic and common punctuation (`pyftsubset` with `--unicodes=U+0020-007E,U+00A0-02FF,U+0300-036F,U+0370-03FF,U+0400-052F,U+0530-058F,U+0590-05FF,U+0600-06FF,U+10A0-10FF,U+1E00-1EFF,U+1F00-1FFF,U+2000-206F,U+2070-209F,U+20A0-20CF,U+2100-218F,U+2190-21FF,U+FB1D-FB4F,U+FB50-FDFF,U+FE70-FEFF --layout-features='*' --no-hinting`). Its license is in `assets/LICENSE-font.txt`.
