import { Component, MarkdownRenderer, Modal, setIcon, type App } from 'obsidian';
import type { Lang } from './i18n';
import type { Graph, Person } from './model';
import { ageBetween, ageLabel, bornAs, formatDate, PROFILE_TEXT, storyText, textValues, type ProfileWords } from './profile-text';
import type { PersonFields, Sex } from './schema';

/**
 * The person's profile, opened from the graph by a double click: the portrait on the left, the main facts on the right
 * in the reader's language, the note's story below. The Obsidian note stays the source; this is how it reads.
 */

export interface ProfileHost {
  graph(): Graph;
  selfId(): string;
  /** The card's properties, or null when the note is gone. */
  fields(id: string): PersonFields | null;
  /** The note text without its properties. */
  body(id: string): Promise<string>;
  /** A URL the portrait loads from, and the link text the note uses for it. */
  portrait(id: string): { url: string; links: string[] } | null;
  /** A person note a link in the story points to, or null for other notes. */
  personAt(link: string, source: string): string | null;
  openLink(link: string, source: string): void;
  openNote(id: string): void;
  edit(id: string): void;
  showOnGraph(id: string): void;
  /** The graph stops moving and drawing while the profile covers it, and resumes after. */
  freeze(): void;
  thaw(): void;
}

interface Relatives { parents: string[]; adoptive: string[]; spouses: string[]; children: string[]; siblings: string[] }

function relativesOf(graph: Graph, id: string): Relatives {
  const result: Relatives = { parents: [], adoptive: [], spouses: [], children: [], siblings: [] };
  const add = (list: string[], other: string) => { if (other !== id && !list.includes(other)) list.push(other); };
  for (const edge of graph.edges) {
    if (edge.relation === 'spouse') { if (edge.from === id) add(result.spouses, edge.to); else if (edge.to === id) add(result.spouses, edge.from); continue; }
    if (edge.to === id) add(edge.adoptive ? result.adoptive : result.parents, edge.from);
    else if (edge.from === id) add(result.children, edge.to);
  }
  const parents = new Set([...result.parents, ...result.adoptive]);
  for (const edge of graph.edges) {
    if (edge.relation === 'parent' && parents.has(edge.from) && !parents.has(edge.to)) add(result.siblings, edge.to);
  }
  return result;
}

export class ProfileModal extends Modal {
  private readonly words: ProfileWords;
  private readonly history: string[] = [];
  private component = new Component();
  private people = new Map<string, Person>();

  constructor(app: App, private readonly host: ProfileHost, private id: string, private readonly lang: Lang) {
    super(app);
    this.words = PROFILE_TEXT[lang];
  }

  onOpen() {
    this.host.freeze();
    this.containerEl.addClass('genealogy-profile-container');
    this.modalEl.addClass('genealogy-profile');
    this.titleEl.remove();
    this.component.load();
    void this.render();
  }

  onClose() {
    this.component.unload();
    this.contentEl.empty();
    this.host.thaw();
  }

  /** Another person's profile in the same window; «Назад» returns. */
  private show(id: string) {
    if (id === this.id) return;
    this.history.push(this.id);
    this.id = id;
    void this.render();
  }

  private back() {
    const previous = this.history.pop();
    if (!previous) return;
    this.id = previous;
    void this.render();
  }

  private async render() {
    const { contentEl, words } = this;
    const id = this.id;
    const graph = this.host.graph();
    this.people = new Map(graph.people.map((person) => [person.id, person]));
    const person = this.people.get(id);
    const fields = this.host.fields(id);
    if (!person || !fields) { this.close(); return; }
    // A new render owns the markdown it draws; the previous person's embeds unload.
    this.component.unload(); this.component = new Component(); this.component.load();
    contentEl.empty();
    contentEl.scrollTop = 0;
    const sex: Sex = fields.sex === 'male' || fields.sex === 'female' ? fields.sex : 'unknown';

    const top = contentEl.createDiv({ cls: 'genealogy-profile-top' });
    const photo = top.createDiv({ cls: 'genealogy-profile-photo' });
    const portrait = this.host.portrait(id);
    if (portrait) photo.createEl('img', { attr: { src: portrait.url, alt: person.name } });
    else {
      photo.addClass('is-empty');
      photo.createDiv({ cls: 'genealogy-profile-initials', text: initials(person.name) });
    }

    const info = top.createDiv({ cls: 'genealogy-profile-info' });
    // The buttons sit in the window's corner, outside the scrolling content, so the name lines up with the photo.
    this.modalEl.querySelector('.genealogy-profile-bar')?.remove();
    const bar = this.modalEl.createDiv({ cls: 'genealogy-profile-bar' });
    if (this.history.length) this.action(bar, 'arrow-left', words.back, () => this.back(), 'is-back');
    this.action(bar, 'locate-fixed', words.showOnGraph, () => { this.close(); this.host.showOnGraph(id); });
    this.action(bar, 'pencil', words.edit, () => { this.close(); this.host.edit(id); });
    this.action(bar, 'file-text', words.openNote, () => { this.close(); this.host.openNote(id); });
    this.action(bar, 'x', words.close, () => this.close());

    info.createEl('h1', { cls: 'genealogy-profile-name', text: person.name });
    const birthSurname = textValues(fields.birth_surname)[0];
    if (birthSurname && !person.name.includes(`(${birthSurname})`)) info.createDiv({ cls: 'genealogy-profile-born', text: bornAs(birthSurname, sex, this.lang) });
    const living = fields.life_status === 'living' || (!fields.life_status && !textValues(fields.death_date).length);
    const today = new Date();
    const now = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
    const age = ageBetween(fields.birth_date, living ? now : fields.death_date);
    const badges = info.createDiv({ cls: 'genealogy-profile-badges' });
    if (id === this.host.selfId()) badges.createSpan({ cls: 'genealogy-profile-badge is-self', text: words.self });
    if (living && fields.life_status === 'living') badges.createSpan({ cls: 'genealogy-profile-badge', text: sex === 'female' ? words.livingFemale : words.living });
    if (fields.identity === 'hypothesis') badges.createSpan({ cls: 'genealogy-profile-badge is-warning', text: words.hypothesis });
    if (fields.identity === 'probable') badges.createSpan({ cls: 'genealogy-profile-badge', text: words.probable });
    if (!badges.childElementCount) badges.remove();

    const facts = info.createDiv({ cls: 'genealogy-profile-facts' });
    const event = (date: unknown, place: unknown) => [formatDate(date, this.lang), ...textValues(place)].filter(Boolean).join(', ');
    // Dates and places of life, the age with them; an unknown death date of the deceased still says so.
    const lived = sex === 'female' ? words.livedFemale : sex === 'male' ? words.livedMale : words.lived;
    this.section(facts, words.life, [
      [words.birth, [event(fields.birth_date, fields.birth_place)]],
      [words.baptism, [event(fields.baptism_date, fields.baptism_place)]],
      [words.death, [living ? '' : event(fields.death_date, fields.death_place)]],
      [living ? words.age : lived, [age ? ageLabel(age, this.lang) : '']],
      [words.cause, textValues(fields.cause_of_death)],
      [words.burial, [event(fields.burial_date, fields.burial_place)]],
    ]);
    this.section(facts, words.about, [
      [words.names, textValues(fields.name_variants)],
      [words.occupation, textValues(fields.occupation)],
      [words.social, textValues(fields.social_status)],
      [words.education, textValues(fields.education)],
      [words.military, textValues(fields.military)],
      [words.residences, textValues(fields.residences)],
      [words.religion, textValues(fields.religion)],
      [words.nationality, textValues(fields.nationality)],
      [words.marriages, textValues(fields.marriages)],
    ]);

    const relatives = relativesOf(graph, id);
    const godparents = textValues(fields.godparents).map((link) => this.host.personAt(link, id) ?? link);
    const family = facts.createDiv({ cls: 'genealogy-profile-section' });
    family.createDiv({ cls: 'genealogy-profile-section-title', text: words.family });
    let any = false;
    for (const [label, list] of [[words.parents, relatives.parents], [words.adoptive, relatives.adoptive], [words.spouses, relatives.spouses],
      [words.children, relatives.children], [words.siblings, relatives.siblings], [words.godparents, godparents]] as Array<[string, string[]]>) {
      if (!list.length) continue;
      any = true;
      const row = family.createDiv({ cls: 'genealogy-profile-row' });
      row.createDiv({ cls: 'genealogy-profile-label', text: label });
      const chips = row.createDiv({ cls: 'genealogy-profile-chips' });
      for (const other of this.sorted(list)) this.chip(chips, other);
    }
    if (!any) family.remove();

    const extra = contentEl.createDiv({ cls: 'genealogy-profile-lists' });
    this.list(extra, words.sources, textValues(fields.sources));
    this.list(extra, words.questions, textValues(fields.questions));
    if (!extra.childElementCount) extra.remove();

    const story = contentEl.createDiv({ cls: 'genealogy-profile-story' });
    story.createDiv({ cls: 'genealogy-profile-section-title', text: words.story });
    const text = storyText(await this.host.body(id), portrait?.links ?? []);
    if (this.id !== id) return; // Another person was opened while the note was read.
    if (!text) {
      const empty = story.createDiv({ cls: 'genealogy-profile-empty' });
      empty.createDiv({ text: words.emptyStory });
      empty.createDiv({ cls: 'genealogy-profile-hint', text: words.emptyStoryHint });
      return;
    }
    const body = story.createDiv({ cls: 'markdown-rendered genealogy-profile-markdown' });
    await MarkdownRenderer.render(this.app, text, body, id, this.component);
    // Links to people open their profile here; other links open as in a note.
    body.addEventListener('click', (click) => {
      const link = (click.target as HTMLElement).closest('a.internal-link');
      if (!link) return;
      click.preventDefault();
      const href = link.getAttribute('data-href') ?? link.getAttribute('href') ?? '';
      const target = this.host.personAt(href, id);
      if (target) this.show(target);
      else { this.close(); this.host.openLink(href, id); }
    });
  }

  private action(parent: HTMLElement, icon: string, label: string, run: () => void, cls = '') {
    const button = parent.createEl('button', { cls: `clickable-icon genealogy-profile-action ${cls}`.trim(), attr: { type: 'button', 'aria-label': label } });
    setIcon(button, icon);
    button.addEventListener('click', run);
  }

  /** A section of label–value rows; rows without a value and sections without rows are left out. */
  private section(parent: HTMLElement, title: string, rows: Array<[string, string[]]>) {
    const filled = rows.map(([label, values]) => [label, values.filter(Boolean)] as const).filter(([, values]) => values.length);
    if (!filled.length) return;
    const section = parent.createDiv({ cls: 'genealogy-profile-section' });
    section.createDiv({ cls: 'genealogy-profile-section-title', text: title });
    for (const [label, values] of filled) {
      const row = section.createDiv({ cls: 'genealogy-profile-row' });
      row.createDiv({ cls: 'genealogy-profile-label', text: label });
      const value = row.createDiv({ cls: 'genealogy-profile-value' });
      for (const item of values) value.createDiv({ text: item });
    }
  }

  private list(parent: HTMLElement, title: string, items: string[]) {
    if (!items.length) return;
    const section = parent.createDiv({ cls: 'genealogy-profile-section' });
    section.createDiv({ cls: 'genealogy-profile-section-title', text: title });
    const list = section.createEl('ul');
    for (const item of items) list.createEl('li', { text: item });
  }

  /** Relatives oldest first; people without a birth year keep their order at the end. */
  private sorted(ids: string[]): string[] {
    const year = (id: string) => this.people.get(id)?.birthYear ?? Infinity;
    return [...ids].sort((a, b) => year(a) - year(b));
  }

  /** A relative: a small portrait or initials, the name and years; a person on the graph opens their profile. */
  private chip(parent: HTMLElement, id: string) {
    const person = this.people.get(id);
    const chip = parent.createEl(person ? 'button' : 'span', { cls: 'genealogy-profile-chip', attr: person ? { type: 'button' } : {} });
    const avatar = chip.createSpan({ cls: 'genealogy-profile-avatar' });
    const portrait = person ? this.host.portrait(id) : null;
    if (portrait) avatar.createEl('img', { attr: { src: portrait.url, alt: '' } });
    else avatar.setText(initials(person?.name ?? id));
    const text = chip.createSpan({ cls: 'genealogy-profile-chip-text' });
    text.createSpan({ cls: 'genealogy-profile-chip-name', text: person?.name ?? id });
    if (person?.lifeYears) text.createSpan({ cls: 'genealogy-profile-chip-years', text: person.lifeYears });
    if (person) chip.addEventListener('click', () => this.show(id));
  }
}

/** Two letters for a portrait placeholder: «Озеров Денис» → «ОД». */
function initials(name: string): string {
  return name.replace(/\([^)]*\)/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0].toLocaleUpperCase()).join('');
}
