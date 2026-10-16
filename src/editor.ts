import { AbstractInputSuggest, ItemView, Notice, setIcon, type App, type WorkspaceLeaf } from 'obsidian';
import { Cards, EDITED_FIELDS, type Relations } from './cards';
import { NEW_PARENT, parentSex, RELATION_FIELDS, type Relation, type RelationField } from './edit';
import { t } from './i18n';
import { assumedParent, inheritedScheme, nameFields, NAME_SCHEMES, ownScheme, schemeByPlace, schemeOf, suggestNames, usesPatronymic, type NamePart, type NameScheme, type Relative } from './names';
import { valueText, type FieldName, type PersonFields, type Sex } from './schema';

/**
 * The person form in the right sidebar: shows the person selected on the graph and creates new relatives. While a
 * relationship field is armed, clicking a person on the graph adds them to it (see EditorHost.startPick).
 */

export const EDITOR_VIEW_TYPE = 'genealogy-person-editor';

export interface EditorPerson { id: string; name: string; lifeYears?: string }

export interface EditorHost {
  cards: Cards;
  people(): EditorPerson[];
  /** True when the vault has no person cards yet. */
  isEmpty(): boolean;
  selfPath(): string;
  /** The vault's name scheme. */
  scheme(): NameScheme;
  setSelf(path: string): Promise<void>;
  /** Clicking a person on the graph calls `pick` until stopPick. */
  startPick(label: string, pick: (id: string) => void): void;
  stopPick(): void;
  openNote(path: string): void;
  /** People selected on the graph now. */
  selection(): string[];
  /** Selects a person on the graph (after a new card appears). */
  select(path: string): void;
}

type Draft = Record<string, string>;
type Mode = { kind: 'idle' } | { kind: 'create'; title: string; near: string | null; siblingOf: string | null } | { kind: 'edit'; path: string };

/** Text fields under «Подробнее», in order; life status and identity are dropdowns among them. */
const DETAIL_TEXT = [
  'birth_place', 'baptism_date', 'baptism_place', 'death_place', 'cause_of_death', 'burial_date', 'burial_place',
  'occupation', 'social_status', 'religion', 'nationality',
] as const;
const DETAIL_FIELDS: FieldName[] = ['birth_surname', 'life_status', ...DETAIL_TEXT, 'identity'];
const relationLabel = (field: RelationField) => t().editor.relations[field];
export const relationTitle = (relation: Relation) => t().editor.relationTitles[relation];

export class PersonEditorView extends ItemView {
  private mode: Mode = { kind: 'idle' };
  private draft: Draft = {};
  private relations: Relations = { parents: [], children: [], spouses: [] };
  /** Fields the user typed in: name hints no longer replace them. */
  private touched = new Set<string>();
  private dirty = false;
  private makeSelf = false;
  private picking: RelationField | null = null;
  private inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
  private relationEls = new Map<RelationField, HTMLElement>();
  /** «Место рождения — Испания: испанская схема?» above the name fields. */
  private schemeHint: HTMLElement | null = null;
  private saving = false;
  /** «Подробнее» stays open or folded across people. */
  private showDetails = false;

  constructor(leaf: WorkspaceLeaf, private host: EditorHost) { super(leaf); }
  getViewType() { return EDITOR_VIEW_TYPE; }
  getDisplayText() { return t().editor.title; }
  getIcon() { return 'user-round-pen'; }

  async onOpen() {
    this.contentEl.addClass('genealogy-editor');
    this.contentEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT' && !(event.target as HTMLElement).closest('.genealogy-editor-relation')) { event.preventDefault(); void this.save(); }
      if (event.key === 'Escape') { if (this.picking) this.stopPicking(); else if (this.mode.kind === 'create' || this.dirty) this.cancel(); }
    });
    this.follow(this.host.selection());
  }
  async onClose() { this.stopPicking(); }

  /** Draws the form again, in the current language. */
  redraw() {
    this.render();
    (this.leaf as unknown as { updateHeader?(): void }).updateHeader?.();
  }

  /** Shows the person selected on the graph, unless a new card or unsaved changes are on the form. */
  follow(selection: string[]) {
    if (this.mode.kind === 'create' || this.dirty || this.saving) return;
    if (selection.length === 1) {
      if (this.mode.kind === 'edit' && this.mode.path === selection[0]) return;
      this.loadPerson(selection[0]);
    } else if (this.mode.kind !== 'idle') { this.mode = { kind: 'idle' }; this.render(); }
    else if (!this.contentEl.childElementCount) this.render();
  }

  /** The vault changed: an unchanged form reloads the card it shows. */
  graphChanged() {
    if (this.mode.kind === 'edit' && !this.dirty && !this.saving) {
      if (this.host.cards.relative(this.mode.path)) this.loadPerson(this.mode.path); else { this.mode = { kind: 'idle' }; this.render(); }
    } else if (this.mode.kind === 'idle') this.render();
  }

  renamed(oldPath: string, newPath: string) {
    if (this.mode.kind === 'edit' && this.mode.path === oldPath) this.mode = { kind: 'edit', path: newPath };
    if (this.mode.kind === 'create' && this.mode.near === oldPath) this.mode.near = newPath;
    if (this.mode.kind === 'create' && this.mode.siblingOf === oldPath) this.mode.siblingOf = newPath;
    for (const field of RELATION_FIELDS) this.relations[field] = this.relations[field].map((id) => id === oldPath ? newPath : id);
  }

  private loadPerson(path: string) {
    const fields = this.host.cards.fields(path);
    this.mode = { kind: 'edit', path };
    this.draft = {};
    for (const field of EDITED_FIELDS) {
      const value = fields[field];
      this.draft[field] = valueText(value);
    }
    this.draft.name_scheme = ownScheme(fields.name_scheme) ?? '';
    this.relations = { parents: this.host.cards.related(path, 'parents', fields), children: this.host.cards.related(path, 'children', fields), spouses: this.host.cards.related(path, 'spouses', fields) };
    this.touched = new Set([...EDITED_FIELDS, 'name_scheme']);
    this.dirty = false;
    this.stopPicking();
    this.render();
  }

  /** The scheme the person on the form is named by: their own (chosen or inherited), or the vault's. */
  private scheme(): NameScheme { return schemeOf(this.draft.name_scheme, this.host.scheme()); }

  /** Starts a new card: on its own, or as a relative of `anchor`, with relationships and name hints filled in. */
  startCreate(relation: Relation | null, anchor: string | null) {
    this.stopPicking();
    const cards = this.host.cards;
    const person = anchor ? cards.relative(anchor) : null;
    this.relations = { parents: [], children: [], spouses: [] };
    this.draft = { sex: 'unknown', life_status: 'unknown', identity: 'confirmed' };
    this.touched = new Set();
    this.makeSelf = this.host.isEmpty() || !this.host.selfPath();
    let title = t().editor.newPerson;
    let siblingOf: string | null = null;
    if (person && relation) {
      title = `${relationTitle(relation)} — ${person.name}`;
      if (relation === 'parent') {
        const existing = person.parents.map((id) => cards.relative(id)).filter((item): item is Relative => Boolean(item));
        this.relations.children = [person.path];
        if (existing.length === 1) this.relations.spouses = [existing[0].path];
        this.draft.sex = parentSex(existing);
      } else if (relation === 'child') {
        this.relations.parents = [person.path, ...(person.spouses.length === 1 ? person.spouses : [])];
      } else if (relation === 'spouse') {
        this.relations.spouses = [person.path];
        this.draft.sex = person.sex === 'male' ? 'female' : person.sex === 'female' ? 'male' : 'unknown';
      } else {
        this.relations.parents = person.parents.length ? [...person.parents] : [NEW_PARENT];
        siblingOf = person.path;
      }
      this.makeSelf = false;
    }
    this.mode = { kind: 'create', title, near: person?.path ?? null, siblingOf };
    this.dirty = false;
    this.applyHints();
    this.render();
    if (!person || !relation) this.focusFirst();
  }

  private focusFirst() { window.setTimeout(() => (this.inputs.get(nameFields(this.scheme())[0]) as HTMLInputElement | undefined)?.focus(), 0); }

  private render() {
    const el = this.contentEl;
    el.empty();
    this.inputs.clear(); this.relationEls.clear();
    const mode = this.mode;
    if (mode.kind === 'idle') { this.renderIdle(el); return; }
    const words = t().editor;
    const head = el.createDiv({ cls: 'genealogy-editor-head' });
    head.createDiv({ cls: 'genealogy-editor-title', text: mode.kind === 'create' ? mode.title : this.host.cards.relative(mode.path)?.name ?? mode.path });
    const tools = head.createDiv({ cls: 'genealogy-editor-tools' });
    if (mode.kind === 'edit') {
      const open = tools.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': words.openNote } });
      setIcon(open, 'file-text');
      open.addEventListener('click', () => this.host.openNote(mode.path));
    }
    // Closes a new card or drops unsaved changes without scrolling down to «Отмена».
    const close = tools.createDiv({ cls: 'clickable-icon genealogy-editor-close', attr: { 'aria-label': mode.kind === 'create' ? words.closeUnsaved : words.dropChanges } });
    setIcon(close, 'x');
    close.addEventListener('click', () => this.cancel());
    close.toggle(mode.kind === 'create' || this.dirty);
    const form = el.createDiv({ cls: 'genealogy-editor-form' });
    // The short form: name, sex, dates and relatives; the rest folds under «Подробнее».
    const scheme = this.scheme();
    this.schemeHint = form.createDiv({ cls: 'genealogy-editor-hint' });
    this.updateSchemeHint();
    for (const field of nameFields(scheme)) {
      // A patronymic outside the schemes that have one is shown only when the card has it.
      if (field === 'patronymic' && !usesPatronymic(scheme) && !(this.draft.patronymic ?? '').trim()) continue;
      const [label, placeholder] = words.nameField(field, scheme);
      this.textField(form, field, label, placeholder);
    }
    this.selectField(form, 'sex', words.fields.sex, options(words.sexOptions));
    const dates = form.createDiv({ cls: 'genealogy-editor-pair' });
    this.textField(dates, 'birth_date', words.fields.birth_date, words.birthDateHint);
    this.textField(dates, 'death_date', words.fields.death_date, words.deathDateHint);
    for (const field of RELATION_FIELDS) this.relationField(form, field);
    const details = form.createEl('details', { cls: 'genealogy-editor-details' });
    details.open = this.showDetails;
    details.addEventListener('toggle', () => { this.showDetails = details.open; });
    const filled = DETAIL_FIELDS.filter((field) => (this.draft[field] ?? '').trim() && !(field === 'life_status' && this.draft[field] === 'unknown') && !(field === 'identity' && this.draft[field] === 'confirmed')).length;
    details.createEl('summary', { text: words.details(filled) });
    this.schemeField(details);
    this.textField(details, 'birth_surname', words.birthSurname(scheme), '');
    this.selectField(details, 'life_status', words.fields.life_status, options(words.lifeOptions));
    for (const field of DETAIL_TEXT) this.textField(details, field, words.fields[field], words.placeholders[field as keyof typeof words.placeholders] ?? '');
    this.selectField(details, 'identity', words.fields.identity, options(words.identityOptions));
    if (mode.kind === 'create' && !this.host.selfPath()) {
      const row = form.createEl('label', { cls: 'genealogy-editor-check' });
      const box = row.createEl('input', { type: 'checkbox' });
      box.checked = this.makeSelf;
      box.addEventListener('change', () => { this.makeSelf = box.checked; });
      row.appendText(words.thisIsMe);
    }
    const actions = el.createDiv({ cls: 'genealogy-editor-actions' });
    const save = actions.createEl('button', { cls: 'mod-cta', text: mode.kind === 'create' ? words.create : words.save });
    save.addEventListener('click', () => void this.save());
    save.toggleClass('is-disabled', mode.kind === 'edit' && !this.dirty);
    if (mode.kind === 'create' || this.dirty) actions.createEl('button', { text: words.cancel }).addEventListener('click', () => this.cancel());
    if (mode.kind === 'edit' && !this.dirty) this.renderAddRow(el, mode.path);
  }

  private renderIdle(el: HTMLElement) {
    const box = el.createDiv({ cls: 'genealogy-editor-idle' });
    const words = t().editor;
    box.createDiv({ text: this.host.isEmpty() ? words.emptyTree : words.choosePerson });
    box.createEl('button', { cls: 'mod-cta', text: this.host.isEmpty() ? words.addFirst : words.addPerson })
      .addEventListener('click', () => this.startCreate(null, null));
  }

  /** «Добавить: родителя · ребёнка · …» under a person's card. */
  private renderAddRow(el: HTMLElement, path: string) {
    const row = el.createDiv({ cls: 'genealogy-editor-add' });
    const words = t().editor;
    row.createSpan({ text: words.addLabel });
    const parents = this.relations.parents.length;
    for (const relation of ['parent', 'child', 'spouse', 'sibling'] as Relation[]) {
      const button = row.createEl('button', { text: words.addRelation[relation] });
      if (relation === 'parent' && parents >= 2) { button.disabled = true; button.title = words.bothParents; }
      button.addEventListener('click', () => this.startCreate(relation, path));
    }
  }

  private row(form: HTMLElement, label: string) {
    const row = form.createDiv({ cls: 'genealogy-editor-row' });
    row.createEl('label', { text: label });
    return row;
  }

  private textField(form: HTMLElement, field: string, label: string, placeholder: string): HTMLInputElement {
    const input = this.row(form, label).createEl('input', { type: 'text', value: this.draft[field] ?? '', attr: { placeholder } });
    input.addEventListener('focus', () => this.stopPicking());
    input.addEventListener('input', () => {
      this.draft[field] = input.value;
      this.touched.add(field);
      if (field === 'death_date' && !this.touched.has('life_status') && input.value.trim()) this.setValue('life_status', 'deceased');
      if (field === 'birth_place') this.updateSchemeHint();
      this.markDirty();
    });
    this.inputs.set(field, input);
    return input;
  }

  private selectField(form: HTMLElement, field: string, label: string, options: Array<[string, string]>) {
    const select = this.row(form, label).createEl('select', { cls: 'dropdown' });
    for (const [value, text] of options) select.createEl('option', { value, text });
    const current = this.draft[field] ?? '';
    if (current && !options.some(([value]) => value === current)) select.createEl('option', { value: current, text: current });
    select.value = current || options[0][0];
    select.addEventListener('focus', () => this.stopPicking());
    select.addEventListener('change', () => {
      this.draft[field] = select.value;
      this.touched.add(field);
      if (field === 'sex') this.applyHints();
      this.markDirty();
    });
    this.inputs.set(field, select);
  }

  /** «Схема имени»: the vault's, or one of the card's own; a change redraws the name fields for it. */
  private schemeField(form: HTMLElement) {
    const words = t().editor;
    const select = this.row(form, words.nameScheme).createEl('select', { cls: 'dropdown' });
    select.createEl('option', { value: '', text: words.schemeVault(words.schemeNames[this.host.scheme()]) });
    for (const scheme of NAME_SCHEMES) select.createEl('option', { value: scheme, text: words.schemeNames[scheme] });
    select.value = this.draft.name_scheme ?? '';
    select.addEventListener('focus', () => this.stopPicking());
    select.addEventListener('change', () => this.chooseScheme(select.value));
    this.inputs.set('name_scheme', select);
  }

  private chooseScheme(value: string) {
    this.touched.add('name_scheme');
    this.draft.name_scheme = value;
    this.markDirty();
    this.applyHints();
    this.render();
  }

  /** A birth place in a country of another naming tradition suggests its scheme, with a button to take it. */
  private updateSchemeHint() {
    const hint = this.schemeHint;
    if (!hint) return;
    hint.empty();
    const place = (this.draft.birth_place ?? '').trim();
    const suggested = schemeByPlace(place);
    // Only while the card follows the vault's scheme: a scheme of its own was chosen on purpose.
    if (!suggested || suggested === this.scheme() || ownScheme(this.draft.name_scheme)) { hint.hide(); return; }
    const words = t().editor;
    hint.show();
    hint.createSpan({ text: words.schemeByPlace(place, words.schemeNames[suggested]) });
    hint.createEl('button', { text: words.useScheme }).addEventListener('click', () => this.chooseScheme(suggested === this.host.scheme() ? '' : suggested));
  }

  private relationField(form: HTMLElement, field: RelationField) {
    const box = form.createDiv({ cls: 'genealogy-editor-relation' });
    this.relationEls.set(field, box);
    this.renderRelation(field);
  }

  private renderRelation(field: RelationField) {
    const box = this.relationEls.get(field);
    if (!box) return;
    box.empty();
    box.toggleClass('is-picking', this.picking === field);
    box.createEl('label', { text: relationLabel(field) });
    const chips = box.createDiv({ cls: 'genealogy-editor-chips' });
    const names = new Map(this.host.people().map((person) => [person.id, person.name]));
    for (const id of this.relations[field]) {
      const chip = chips.createDiv({ cls: `genealogy-editor-chip${id === NEW_PARENT ? ' is-hypothesis' : ''}` });
      const assumed = id === NEW_PARENT ? this.relatives('parents').find((item) => item.path === NEW_PARENT) : null;
      chip.createSpan({ text: id === NEW_PARENT ? t().editor.assumedParent(assumed?.name) : names.get(id) ?? id.replace(/^.*\/|\.md$/g, '') });
      const remove = chip.createSpan({ cls: 'genealogy-editor-chip-remove', text: '×', attr: { 'aria-label': t().editor.remove } });
      remove.addEventListener('click', () => this.removeRelation(field, id));
    }
    const input = chips.createEl('input', { type: 'text', cls: 'genealogy-editor-pick', attr: { placeholder: this.picking === field ? t().editor.clickPerson : t().editor.choose } });
    input.addEventListener('focus', () => this.startPicking(field));
    new RelativeSuggest(this.app, input, () => this.host.people().filter((person) => !this.relations[field].includes(person.id) && person.id !== this.editedPath()), (person) => {
      input.value = '';
      this.addRelation(field, person.id);
    });
    if (this.picking === field) window.setTimeout(() => input.focus(), 0);
  }

  private editedPath(): string | null { return this.mode.kind === 'edit' ? this.mode.path : null; }

  private startPicking(field: RelationField) {
    if (this.picking === field) return;
    const previous = this.picking;
    this.picking = field;
    if (previous) this.renderRelation(previous);
    this.relationEls.get(field)?.addClass('is-picking');
    this.relationEls.get(field)?.querySelector('input')?.setAttribute('placeholder', t().editor.clickPerson);
    this.host.startPick(relationLabel(field), (id) => this.addRelation(field, id));
  }

  private stopPicking() {
    if (!this.picking) return;
    const field = this.picking;
    this.picking = null;
    this.host.stopPick();
    this.renderRelation(field);
  }

  /** Called by the host when picking ends on the graph (Esc). */
  pickEnded() {
    if (!this.picking) return;
    const field = this.picking;
    this.picking = null;
    this.renderRelation(field);
  }

  private addRelation(field: RelationField, id: string) {
    if (id === this.editedPath()) { new Notice(t().editor.samePerson); return; }
    if (this.relations[field].includes(id)) return;
    const other = RELATION_FIELDS.find((item) => item !== field && this.relations[item].includes(id));
    if (other) { new Notice(t().editor.alreadyIn(relationLabel(other))); return; }
    if (field === 'parents' && this.relations.parents.filter((item) => item !== NEW_PARENT).length >= 2) { new Notice(t().editor.twoParents); return; }
    this.relations[field] = [...this.relations[field].filter((item) => !(field === 'parents' && item === NEW_PARENT)), id];
    this.relationsChanged(field);
  }

  private removeRelation(field: RelationField, id: string) {
    this.relations[field] = this.relations[field].filter((item) => item !== id);
    this.relationsChanged(field);
  }

  private relationsChanged(field: RelationField) {
    this.renderRelation(field);
    this.applyHints();
    this.markDirty();
  }

  private sibling(): Relative | null {
    return this.mode.kind === 'create' && this.mode.siblingOf ? this.host.cards.relative(this.mode.siblingOf) : null;
  }

  private relatives(field: RelationField): Relative[] {
    const sibling = this.sibling();
    return this.relations[field].map((id) => id === NEW_PARENT ? sibling && assumedParent(sibling, sibling.scheme ?? this.host.scheme(), NEW_PARENT) : this.host.cards.relative(id)).filter((item): item is Relative => Boolean(item));
  }

  /**
   * Fills name hints into fields the user has not typed in. A new card takes the name scheme of its relatives (see
   * inheritedScheme) until one is chosen on the form; a change of scheme redraws the name fields.
   */
  private applyHints() {
    if (this.mode.kind === 'create' && !this.touched.has('name_scheme')) {
      const sibling = this.sibling();
      const inherited = inheritedScheme(this.relatives('parents'), [...this.relatives('children'), ...(sibling ? [sibling] : [])]) ?? '';
      if (inherited !== (this.draft.name_scheme ?? '')) {
        this.draft.name_scheme = inherited;
        if (this.contentEl.childElementCount) this.render();
      }
    }
    const sex = (this.draft.sex ?? 'unknown') as Sex;
    const hints = suggestNames(this.scheme(), sex, this.relatives('parents'), this.relatives('children'), this.relatives('spouses'));
    for (const field of ['surname', 'given_name', 'patronymic'] as NamePart[]) if (!this.touched.has(field)) this.setValue(field, hints[field]);
  }

  private setValue(field: string, value: string) {
    this.draft[field] = value;
    const input = this.inputs.get(field);
    if (input) input.value = value || (input instanceof HTMLSelectElement ? input.options[0]?.value ?? '' : '');
  }

  private markDirty() {
    if (this.mode.kind !== 'edit' || this.dirty) return;
    this.dirty = true;
    // Show «Отмена» and enable «Сохранить» without rebuilding the form under the cursor.
    const actions = this.contentEl.querySelector('.genealogy-editor-actions');
    actions?.querySelector('.mod-cta')?.removeClass('is-disabled');
    if (actions && actions.childElementCount === 1) (actions as HTMLElement).createEl('button', { text: t().editor.cancel }).addEventListener('click', () => this.cancel());
    this.contentEl.querySelector('.genealogy-editor-add')?.remove();
    this.contentEl.querySelector<HTMLElement>('.genealogy-editor-close')?.show();
  }

  private cancel() {
    this.stopPicking();
    this.dirty = false;
    this.mode = { kind: 'idle' };
    const selection = this.host.selection();
    if (selection.length === 1) this.loadPerson(selection[0]); else this.render();
  }

  private collect(): PersonFields {
    const fields: PersonFields = {};
    for (const field of EDITED_FIELDS) {
      fields[field] = (this.draft[field] ?? '').trim();
    }
    fields.name_scheme = ownScheme(this.draft.name_scheme) ?? '';
    return fields;
  }

  private async save() {
    const mode = this.mode;
    if (mode.kind === 'idle' || this.saving || (mode.kind === 'edit' && !this.dirty)) return;
    const fields = this.collect();
    if (mode.kind === 'create' && !fields.surname && !fields.given_name && !fields.patronymic) { new Notice(t().editor.needName); return; }
    this.stopPicking();
    this.saving = true;
    try {
      if (mode.kind === 'create') {
        const created = { ...fields };
        for (const key of Object.keys(created) as FieldName[]) if (created[key] === '') delete created[key];
        const file = await this.host.cards.create(created, this.relations, mode.near, mode.siblingOf);
        if (this.makeSelf) await this.host.setSelf(file.path);
        new Notice(t().editor.created(file.basename));
        this.mode = { kind: 'idle' };
        // Stay on the relative the card was added to, so the next relative is one click away.
        if (mode.near) this.loadPerson(mode.near); else { this.host.select(file.path); this.loadPerson(file.path); }
      } else {
        await this.host.cards.update(mode.path, fields, this.relations);
        this.dirty = false;
        new Notice(t().editor.saved);
        this.loadPerson(mode.path);
      }
    } catch (error) {
      new Notice(t().editor.saveFailed(error instanceof Error ? error.message : String(error)));
    } finally {
      this.saving = false;
    }
  }
}

const options = (labels: Record<string, string>): Array<[string, string]> => Object.entries(labels);

class RelativeSuggest extends AbstractInputSuggest<EditorPerson> {
  constructor(app: App, input: HTMLInputElement, private people: () => EditorPerson[], private choose: (person: EditorPerson) => void) { super(app, input); }
  getSuggestions(query: string): EditorPerson[] {
    const normalize = (value: string) => value.toLocaleLowerCase().replace(/ё/g, 'е');
    const text = normalize(query.trim());
    if (!text) return [];
    return this.people().filter((person) => normalize(person.name).includes(text)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 30);
  }
  renderSuggestion(person: EditorPerson, el: HTMLElement) {
    el.createDiv({ text: person.name });
    if (person.lifeYears) el.createDiv({ text: person.lifeYears, cls: 'genealogy-suggest-years' });
  }
  selectSuggestion(person: EditorPerson) { this.choose(person); this.close(); }
}
