# The interface, step by step

A walk through Genealogy Graph from the first card to the settings: on a [computer](#on-a-computer), then what changes on a [phone](#on-a-phone) and a [tablet](#on-a-tablet). The [reference](#reference) at the end describes how the graph is drawn and laid out.

Other guides: [data](data.md) · [import](import.md) · [export](export.md).

The interface is in English or Russian (**Settings → Genealogy Graph → Language**, as in Obsidian by default).

## On a computer

### 1. Start a family tree

Run **Open genealogy graph** from the command palette. In an empty vault a large **+** in the middle opens the form for the first person — yourself, for example.

![The first card, then a parent added from the «+» beside it](https://raw.githubusercontent.com/vladushked/genealogy-graph-media/main/guides/desktop-build.gif)

- **The form** opens in the right sidebar (**Person card**). It is short — name, sex, birth and death dates, relatives; the rest folds under **More**: birth surname, life status, places, baptism, burial, cause of death, occupation, social status, religion, nationality, identity and the [name scheme](#names). Lists (residences, military service, education, marriages) are edited in Obsidian's Properties panel.
- **This is me** makes the card yours: the graph counts generations from it (you are 0) and **Me** in the dock finds you. It can be chosen later in the settings (**Card for «Find me»**).
- **Create card** writes the note. Its name follows the template in the settings (**File name of new cards**, `{name} {born}-{died}` by default: `Emma Lane 1990-`).

### 2. Add relatives

Select a person: a **+** appears beside them with **Parent**, **Child**, **Spouse**, **Sibling**. The **+** at the right end of the dock does the same at any time (with nobody selected it adds a person with no link), and so does the right-click menu of a person.

- The form fills names in from the relatives until you type over them: the father's surname, the Spanish two surnames, a Russian patronymic and so on, by the [name scheme](#names).
- A new child gets both parents when the person has one spouse; a second parent becomes the first one's spouse.
- A sibling of a person without parents gets a common parent created as a hypothesis (`identity: hypothesis`, with a question in `questions`).
- **Relationship fields** (**Parents**, **Children**, **Spouses**): click the field, then click people on the graph — each one is added (`Esc` ends picking) — or type a name.
- Relationships are written into both cards. A new card goes into its family folder, as an [import](import.md) puts it: women by birth surname, everyone else by surname, people without a surname with their father, mother or husband (**Where new cards go**: family folders or one folder; the folders are in **Folder for new cards**). **Card template** gives it a template's properties and text.
- A selected person's card stays on the form for editing; with unsaved changes, selecting someone else does not replace it. The cross in its corner closes a new card or drops the changes.

### 3. Select people, open a profile

![A click selects a person with their closest family, Shift+click adds another, Esc clears](https://raw.githubusercontent.com/vladushked/genealogy-graph-media/main/guides/desktop-select.gif)

- **Click** a person: they are selected with their relatives highlighted, and the camera fits them with their parents, children and spouses. **Shift+click** adds people to the selection; a click on a selected person deselects them.
- A click on empty space or on `Esc` clears the selection; a second `Esc` fits the whole graph.
- **Ctrl/Cmd+click** opens the note in one reused tab; a **middle click** opens it in a new tab.
- **Right-click** opens the person's menu: profile, note, note in a new tab, edit in the sidebar, add a relative, select.
- Hovering enlarges a person a little; **Ctrl+hover** shows Obsidian's page preview.

![A double click opens the profile; a relative's chip opens theirs](https://raw.githubusercontent.com/vladushked/genealogy-graph-media/main/guides/desktop-profile.gif)

**Double-click** opens the person's **profile** over the graph, which blurs and stops until it closes. It reads like a profile page: the portrait, the name, life (birth and death with dates and places, age, baptism, burial), facts, family as chips — a chip opens that relative's profile, **Back** returns — sources, open questions and the note's text. The buttons in its corner show the person on the graph, edit the card and open the note.

### 4. Find a person

![Ctrl+F, a few letters, Enter](https://raw.githubusercontent.com/vladushked/genealogy-graph-media/main/guides/desktop-search.gif)

**Ctrl/Cmd+F** in the graph, or a click on the search field in the dock: suggestions show names with life years, namesakes told apart by them. Choosing one selects the person and brings them into view. **Me** selects your own card. From a person note, **Show current person on the graph** does the same.

### 5. Generations and the number of relatives

![Highlighting generations, then the focus on the number of relatives](https://raw.githubusercontent.com/vladushked/genealogy-graph-media/main/guides/desktop-generations.gif)

Two buttons at the top switch the **focus** — how people are colored and sized; the choice is remembered:

- **Generations** (default): a color per generation, oldest violet to youngest red. The column on the left lists the generations from yours (−2, −1, **0** with «Me», +1). Sizes follow **Size by generation** in the side panel: older or younger larger, 28% per generation.
- **Number of relatives**: the more parents, children and spouses a person has, the larger and warmer (blue to red). The column lists the counts present; beyond twelve the largest share one button («12+»).

Buttons in the column **highlight** those people — several at once; everything else fades. **all** clears it, and so does turning every button on. Each focus remembers its own highlight.

### 6. Kinship route

![The route from Emily to Edward with the kinship term](https://raw.githubusercontent.com/vladushked/genealogy-graph-media/main/guides/desktop-route.gif)

The route button in the dock: then click two people, or type their names into **From** and **To** (selecting exactly two people before also works). The shortest chain of parent and spouse links is highlighted, and the card above the dock tells what **To** is to **From** — «first cousin once removed», «great-uncle», «wife's first cousin» — with the chain of roles between them («mother → brother → son»; a role centers the graph on that person). ⇅ swaps the two along the same route.

- Among routes of the same length the one through the fewest marriages is taken, so it goes through a common ancestor rather than a parent's spouse.
- Terms cover blood kin any number of steps up and down, half siblings, one adoption step and in-laws with one marriage at either end; another shape of route has only its chain (in Russian, a saying about distant kin instead).
- **Depth** in the side panel applies: **route only**, 1–4 steps of side branches drawn lighter, or **whole family** with everything off the route dimmed.

### 7. Roots

![Roots: every line of ancestors, then kin around them](https://raw.githubusercontent.com/vladushked/genealogy-graph-media/main/guides/desktop-roots.gif)

The sprout button in the dock shows where people come from: the chosen people and every line of their ancestors up to the oldest known (adoptive parents included). It starts from the selected people, or from you when nobody is selected; a click on a person adds them or removes them, and so does the search. The card above the dock tells how many ancestors and how far back («86 ancestors · back to generation −11») and names the oldest. **Kin around, generations**:

- **0** — the lines alone;
- **1** — plus the siblings of every ancestor, and the children and siblings of the chosen people;
- **2** — plus their children (cousins), and so on up to **4**;
- **all** — the whole family with the lines highlighted.

A spouse shows with their partner and takes no step. Hidden relatives are counted as «+N» on the person they hang from. «Roots» and the kinship route exclude each other; `Esc` leaves.

### 8. Hide a branch

![A link clicked, its eye hides the ancestors, «+N» brings them back](https://raw.githubusercontent.com/vladushked/genealogy-graph-media/main/guides/desktop-hide.gif)

1. Click a link — the shape between spouses, a branch to a child, or a plain line. The people it would hide are previewed faded, and an eye appears on it.
2. Click the eye to hide that side.

The side holding the center (selected people, route ends and your own card) stays; without a center the smaller side goes. If the two sides are also connected another way, for example through a marriage, nothing can be hidden: the eye is greyed out and says why. A background click or `Esc` cancels.

Whenever relatives are hidden — by a hidden link, by **Depth** or by a route — the person they hang from shows **+N**. A click on it restores links hidden there; for relatives hidden by depth it says which filter hides them. **Hidden links** in the side panel shows everything again. Hidden links are remembered and survive note renames.

### 9. Problems and what to clarify

![«To clarify»: a name shows the person, the cross closes the list](https://raw.githubusercontent.com/vladushked/genealogy-graph-media/main/guides/desktop-checks.gif)

Two buttons in the top left corner, shown only when there is something:

- **Problems** (a warning sign): self-links, links to missing notes, parent links whose generations do not fit (a link that skips a generation, a parent who is also a descendant), values outside the allowed ones. They are listed by note; while the list is open the people involved are red, everyone else plain gray.
- **What to clarify** (a question mark): any empty main field — surname and patronymic where the name scheme has them, given name, sex, parents or the second parent, children, birth date, life status, the death date of someone deceased, photo — a hypothetical or partly confirmed identity, open `questions`. The least filled cards come first, in shades of yellow.

A name in a list shows the person, the note icon opens the card, the cross closes the list.

### 10. Generation by generation

![The family grows one generation at a time, with titles](https://raw.githubusercontent.com/vladushked/genealogy-graph-media/main/guides/desktop-timelapse.gif)

The play button under the gear starts from the oldest generation and adds the next one every 1.6 s, each newcomer next to a relative already shown. Titles name the generation, the years its people were born, how many they are and how far it is from you; the newest generation is bright. The button (now a square) stops it and shows everyone.

### 11. The side panel and filters

![Depth around a selected person in the side panel](https://raw.githubusercontent.com/vladushked/genealogy-graph-media/main/guides/desktop-panel.gif)

The gear in the top right corner opens the side panel; the cross folds it. Its sections fold, and the state is remembered:

- **Filters** — **Hide unconnected** (people without links, or with a selection people unrelated to it) and **Depth** (1–4 kinship steps around the selected people, or the selected only; inactive while nobody is selected); hidden links.
- **Display** — **Size by generation**.
- **Export** — [export](export.md) for print or the screen.
- **Import** — [import](import.md) from another program.

Under the gear while the panel is folded: **generation by generation** (the play button) and **Release the graph** (the wind button): the layout never comes to rest and people keep moving as while dragged; the button turns it off. The line at the bottom says how many people and links are visible.

### Navigation in short

| | |
|---|---|
| Pan | drag the background |
| Zoom | mouse wheel (glides around the pointer), the corner buttons, `+` / `-` with the graph focused |
| Fit the graph | **⤢** in the corner, `0`, or `Esc` with nothing selected |
| Search | `Ctrl/Cmd+F` |
| Move a person | drag them; the layout follows and settles in under 2 s |

### 12. Settings

**Settings → Genealogy Graph**:

- **Language**: as in Obsidian, English or Russian. Command names change after Obsidian restarts.
- **Card for «Find me»**: your own card, generation 0.
- **Name scheme**, **File name of new cards** with an example under it, **Rename by the template** (see [Names](#names)).
- **Where new cards go**, **Folder for new cards**, **Card template**.
- **Files folder**: where imports copy photos and documents.
- **Fonts for PDF**: TrueType fonts for scripts the bundled font lacks (see [export](export.md#fonts)).
- **Templates folder**: notes there are not on the graph.

## On a phone

The plugin works in the Obsidian app on iOS and Android with the same features; the controls are made for fingers and sit above Obsidian's navigation bar.

![Pinch, pan, tap, double tap for the profile, a finger held for the menu](https://raw.githubusercontent.com/vladushked/genealogy-graph-media/main/guides/phone-gestures.gif)

- **Gestures.** One finger pans the graph or drags a person; two fingers pinch to zoom around their middle. A **tap** selects, a **double tap** opens the profile, a finger **held** on a person for half a second opens their menu (profile, note, edit, add a relative, select). There is no Shift or Ctrl: use the menu.
- **The dock** runs across the bottom: **Me**, route, roots, search, **+**. **⤢** above it on the right fits the graph; the zoom buttons give way to the pinch.

![The generation button grows into the list; a tap on empty space folds it](https://raw.githubusercontent.com/vladushked/genealogy-graph-media/main/guides/phone-generations.gif)

- **Generations** fold into a button of colored dots over **Me** — a dot per generation (or number of relatives), the highlighted ones larger. A tap turns it into the list, «all» on top and a cross at the foot; the cross, a tap on empty space or moving the graph fold it back, so it never hides people. While the route or roots card is open the button steps aside.
- **The top row**: the problem and clarify buttons, then the focus as two icons.

![The side panel and the «clarify» list: a tap on empty space or the cross closes them](https://raw.githubusercontent.com/vladushked/genealogy-graph-media/main/guides/phone-panels.gif)

- **The side panel** starts folded and opens across the whole width. A **tap on empty space** closes whatever is open over the graph — the side panel, the generation list, problems, «to clarify» — and does nothing else.
- **The form** opens in Obsidian's right drawer: **Edit in sidebar** from a person's menu. Close the drawer to get back to the graph.
- **With the keyboard up** the search stays right above it, and its suggestions open above the field.
- **Export** is saved into the vault (the attachments folder) and opens there, since a download does nothing in the app. **Import** reads files as on a computer, but the photos are chosen as files: a phone cannot read the folder next to the family tree file.

## On a tablet

![A tablet: pinch, tap, a finger held for the menu](https://raw.githubusercontent.com/vladushked/genealogy-graph-media/main/guides/tablet-overview.gif)

A tablet has the computer's layout with the phone's gestures: the side panel and the generation column stay as on a computer, the zoom buttons give way to the pinch, and **⤢** is finger-sized. Export goes into the vault, as on a phone.

## Reference

### Names

A **name scheme** sets the order a name is written in, which parts the form asks for and what it fills in from relatives. The vault has one (**Name scheme** in the settings), and a card may have its own.

| Scheme | Name order | Filled in from relatives |
|---|---|---|
| Russian | Surname Given Patronymic | the father's surname in the person's form (Озеров → Озерова), a patronymic from the father's name, a wife's married surname, a father's name from a child's patronymic |
| Western | Given Middle Surname | the father's surname (the mother's without a father); a wife keeps hers |
| Spanish | Given Surname1 Surname2 | the father's first surname and the mother's first surname («García Barcha») |
| East Asian, Hungarian | Surname Given | as Western |
| Icelandic | Given Patronymic | a patronymic from the father's name (Jón → Jónsson, Jónsdóttir); a family name only if there is one |

Outside the Russian and Icelandic schemes the patronymic field shows only for a card that has one. A person may have no surname at all.

- **A scheme per card.** A family with branches in several countries keeps the vault's scheme for most people and gives the others their own: **Name scheme** under **More** (property `name_scheme`). That card's form, name, file name and «to clarify» follow it — a Spanish card in a Russian vault gets two surnames and is not asked for a patronymic.
- **Inherited.** A new relative takes the scheme of the father, then the mother, then the child or sibling it is added to — never a spouse's. Set it on the first ancestor of a branch and the branch keeps it.
- **Suggested by the birth place.** A birth place in a country of another tradition («Sevilla, España», «Reykjavík, Iceland») suggests its scheme above the name fields while the card follows the vault's. It is only a suggestion: a Russian may be born in Madrid.
- **File names.** **File name of new cards** takes `{name}` (the full name in the scheme's order, a different birth surname in parentheses), `{surname}`, `{given}`, `{patronymic}`, `{birth_surname}`, `{born}` and `{died}` (`?` when unknown, `{died}` empty for the living), for example `{surname}, {given} ({born}–{died})`; spaces and parentheses left empty are dropped.
- **Renaming.** With **Rename by the template** on (the default), a card whose file name followed the template is renamed when its name or dates change; cards named by hand are never renamed. Obsidian updates the links, so this needs **Automatically update internal links** (Files and links); without it the plugin says so and does not rename.

### How people are drawn

- **Color** shows the generation: the vault's generations spread evenly over the color wheel, oldest violet to youngest red, so no color repeats. Deceased people are a darker shade, their portraits under a dark veil. The view follows Obsidian's light or dark theme.
- **Portraits** are round and larger, with a ring in their generation color. A card's `photo` picks one; otherwise the first image embedded in the note is used (PDF embeds are skipped). Without an image the person is a plain circle.
- **Size.** People farther from the median visible generation are smaller; more parents, children and spouses make a person larger (up to twice the base size, counted over the whole family, hidden relatives included). Selected people grow a little.
- **Labels.** Names and life years: living `b. 2001`, deceased `1915–1980` (`1915–?` for an unknown year), unknown status `2001–`, which does not claim the person is alive; approximate years and decades are kept. Names, years and portraits fade out as you zoom out (gone below about 20%), except for selected people and route members. Names are not clickable; use the circle.
- **Couples** sit side by side, level, inside one light red pill; remarriages make a chain of pills, three people married to one another a rounded triangle. A couple's names go on the outer sides.
- **Children of a couple** hang from the middle of the pill, each marriage its own family, so half-siblings hang from different couples. Parents not recorded as spouses are joined by a thin dashed line. Adoptions are dashed; a hypothetical identity has a dashed outline.
- **Highlights blend**: selections, highlighted generations and the problem lists fade in and out over about a quarter of a second.

### How the graph moves

- Like Obsidian's own graph view, the graph is drawn on a canvas and its force layout runs in a background worker, so a family of a thousand people pans, zooms and drags smoothly; it draws only when something changes.
- On opening the graph spreads out for half a second and comes to rest in about 2 seconds; the camera follows it until you pan, zoom or drag. After a drag it calms down in under 2 seconds.
- When the selection or filters change, the layout settles from where it is instead of starting over; new cards appear next to a relative already on screen. Selecting people or a route never moves the graph.
- Spouses are one body in the layout: a couple or a chain of remarriages moves as a level row and repels as strongly as its people would apart.
- The graph refreshes only when a person note or an image changes, and skips the redraw if nothing it shows has changed. The plugin writes notes only when you add or edit people, run an import, or a card is renamed by the template.
