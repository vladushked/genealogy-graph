import { normalizePath, stringifyYaml, TFile, TFolder, type App } from 'obsidian';
import { references } from './model';
import { lifeStatusOf, readFields, readPerson, writeFields, type FieldName, type PersonFields, type Sex } from './schema';
import { addLink, cardBase, NEW_PARENT, RELATION_FIELDS, removeLink, REVERSE, type Naming, type RelationField } from './edit';
import { t } from './i18n';
import { assumedParent, ownScheme, personTitle, schemeOf, type Relative } from './names';

/**
 * Writes person cards for the editor: new cards with their relationships declared from both sides, edits of an
 * existing card, and the common parent assumed for a new sibling. Only the properties the editor shows are written;
 * everything else in a card stays as it is.
 */

export type Relations = Record<RelationField, string[]>;

export interface CardsHost {
  /** Folder for a card that has no relative to sit next to. */
  cardsFolder: string;
  /** Path of a note whose properties and text start new cards; empty for none. */
  template: string;
  /** Name scheme and file name template of new cards. */
  naming: Naming;
}

/** Properties the editor reads and writes. */
export const EDITED_FIELDS: FieldName[] = [
  'surname', 'given_name', 'patronymic', 'birth_surname', 'sex',
  'birth_date', 'birth_place', 'baptism_date', 'baptism_place', 'death_date', 'death_place', 'cause_of_death', 'burial_date', 'burial_place',
  'life_status', 'occupation', 'social_status', 'religion', 'nationality', 'identity',
];

export const newCardId = () => `lg-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export class Cards {
  constructor(private app: App, private host: () => CardsHost) {}

  private file(path: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  /** A card's properties in canonical names. */
  fields(path: string): PersonFields {
    const file = this.file(path);
    const frontmatter = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
    return frontmatter ? readFields(frontmatter).fields : {};
  }

  /** Vault paths a relationship property of a card points to; unresolved entries are left out. */
  related(path: string, field: RelationField, fields = this.fields(path)): string[] {
    const value = field === 'parents' ? fields.parents : field === 'children' ? fields.children : fields.spouses;
    return [...new Set(references(value).map((link) => this.resolve(link, path)).filter((target): target is string => Boolean(target)))];
  }

  private resolve(link: string, source: string): string | null {
    return this.app.metadataCache.getFirstLinkpathDest(link, source)?.path ?? null;
  }

  relative(path: string): Relative | null {
    const file = this.file(path);
    const frontmatter = file && this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!file || !frontmatter) return null;
    const { fields } = readFields(frontmatter);
    const view = readPerson(frontmatter);
    const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
    const sex: Sex = fields.sex === 'male' || fields.sex === 'female' ? fields.sex : 'unknown';
    return {
      path, name: view.name ?? file.basename, sex, scheme: ownScheme(fields.name_scheme),
      surname: text(fields.surname), given_name: text(fields.given_name), patronymic: text(fields.patronymic), birth_surname: text(fields.birth_surname),
      parents: this.related(path, 'parents', fields), children: this.related(path, 'children', fields), spouses: this.related(path, 'spouses', fields),
    };
  }

  /** `[[link]]` to a card as written in another card: the shortest link text that still resolves to it. */
  private link(target: string, source: string): string {
    const file = this.file(target);
    return `[[${file ? this.app.metadataCache.fileToLinktext(file, source, true) : target.replace(/\.md$/, '')}]]`;
  }

  /**
   * Creates a card and declares each relationship in both cards. `near` is a relative whose folder the card joins.
   * A NEW_PARENT among the parents first creates the common parent of the new person and `siblingOf`, as a hypothesis.
   */
  async create(fields: PersonFields, relations: Relations, near: string | null, siblingOf: string | null): Promise<TFile> {
    const parents = [...relations.parents];
    const index = parents.indexOf(NEW_PARENT);
    if (index >= 0) {
      if (!siblingOf) throw new Error(t().cards.noSibling);
      const sibling = this.relative(siblingOf);
      if (!sibling) throw new Error(t().cards.siblingNotFound);
      const scheme = sibling.scheme ?? this.host().naming.scheme;
      const assumed = assumedParent(sibling, scheme, NEW_PARENT);
      const parent = await this.create({
        identity: 'hypothesis', name: assumed.name, ...(sibling.scheme ? { name_scheme: sibling.scheme } : {}),
        surname: assumed.surname || undefined, given_name: assumed.given_name || '?', sex: assumed.sex, life_status: 'unknown',
        questions: [t().cards.commonParent(sibling.name, personTitle({ ...fields, birth_surname: undefined }, scheme))],
      }, { parents: [], children: [siblingOf], spouses: [] }, siblingOf, null);
      parents.splice(index, 1, parent.path);
    }
    const host = this.host();
    const folder = near ? parentFolder(near) : host.cardsFolder;
    const base = cardBase(fields, lifeStatusOf(fields), host.naming);
    let path = normalizePath(folder ? `${folder}/${base}.md` : `${base}.md`);
    for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = normalizePath(folder ? `${folder}/${base} (${n}).md` : `${base} (${n}).md`);
    await ensureFolder(this.app, folder);

    const template = await this.template();
    const own: PersonFields = { ...fields, id: newCardId(), name: fields.name ?? personTitle(fields, schemeOf(fields.name_scheme, host.naming.scheme)) };
    const all: Relations = { parents, children: relations.children, spouses: relations.spouses };
    for (const field of RELATION_FIELDS) own[field] = all[field].map((target) => this.link(target, path));
    const properties = { ...template.properties, ...writeFields(own) };
    const file = await this.app.vault.create(path, `---\n${stringifyYaml(properties)}---\n${template.body}`);
    for (const field of RELATION_FIELDS) for (const target of all[field]) await this.point(target, REVERSE[field], file.path, true);
    return file;
  }

  /** Saves edited properties and relationships of a card; relatives added or removed are updated in their cards too. */
  async update(path: string, fields: PersonFields, relations: Relations): Promise<void> {
    const file = this.file(path);
    if (!file) throw new Error(t().cards.notFound);
    const before: Relations = { parents: this.related(path, 'parents'), children: this.related(path, 'children'), spouses: this.related(path, 'spouses') };
    const properties = writeFields(Object.fromEntries(EDITED_FIELDS.map((field) => [field, blankToNull(fields[field])])));
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(properties)) {
        // The card type is never changed here; writeFields only adds one for a card that has none.
        if (key === 'type' && frontmatter[key] !== undefined) continue;
        frontmatter[key] = value;
      }
      // The card's own name scheme is written only when it has one: without it the card follows the vault's.
      if (ownScheme(fields.name_scheme)) frontmatter.name_scheme = fields.name_scheme; else delete frontmatter.name_scheme;
      const name = personTitle(fields, schemeOf(fields.name_scheme, this.host().naming.scheme));
      if (name !== '?') frontmatter.name = name;
      for (const field of RELATION_FIELDS) {
        const key = field;
        let value: unknown = frontmatter[key];
        for (const gone of before[field].filter((target) => !relations[field].includes(target))) value = removeLink(value, this.same(gone, path));
        for (const added of relations[field].filter((target) => !before[field].includes(target))) value = addLink(value, this.link(added, path), this.same(added, path));
        frontmatter[key] = value ?? [];
      }
    });
    for (const field of RELATION_FIELDS) {
      for (const gone of before[field].filter((target) => !relations[field].includes(target))) await this.point(gone, REVERSE[field], path, false);
      for (const added of relations[field].filter((target) => !before[field].includes(target))) await this.point(added, REVERSE[field], path, true);
    }
  }

  /** Removes a relationship from both cards. */
  async unlink(a: string, field: RelationField, b: string): Promise<void> {
    await this.point(a, field, b, false);
    await this.point(b, REVERSE[field], a, false);
  }

  /** Adds (or removes) a link to `target` in a relationship property of the card at `path`. */
  private async point(path: string, field: RelationField, target: string, add: boolean) {
    const file = this.file(path);
    if (!file) return;
    const key = field;
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      frontmatter[key] = add ? addLink(frontmatter[key], this.link(target, path), this.same(target, path)) : removeLink(frontmatter[key], this.same(target, path));
    });
  }

  /** Whether a link text written in the card at `source` points to the card at `target`. */
  private same(target: string, source: string) {
    const base = target.replace(/^.*\//, '').replace(/\.md$/, '');
    return (reference: string) => this.resolve(reference, source) === target || reference === base || reference === target.replace(/\.md$/, '');
  }

  /** Properties and text of the template note; its properties are the defaults a new card starts from. */
  private async template(): Promise<{ properties: Record<string, unknown>; body: string }> {
    const path = this.host().template;
    const file = path ? this.file(normalizePath(path.endsWith('.md') ? path : `${path}.md`)) : null;
    if (!file) return { properties: {}, body: '\n' };
    const cache = this.app.metadataCache.getFileCache(file);
    const content = await this.app.vault.cachedRead(file);
    const end = cache?.frontmatterPosition?.end.offset;
    const body = end !== undefined ? content.slice(end).replace(/^-*\n?/, '') : content;
    const { position: _position, ...properties } = (cache?.frontmatter ?? {}) as Record<string, unknown>;
    return { properties, body: body.startsWith('\n') ? body : `\n${body}` };
  }
}

const blankToNull = (value: unknown) => value === undefined || (typeof value === 'string' && !value.trim()) ? null : value;
const parentFolder = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

async function ensureFolder(app: App, folder: string) {
  if (!folder) return;
  let current = '';
  for (const part of folder.split('/')) {
    current = current ? `${current}/${part}` : part;
    const existing = app.vault.getAbstractFileByPath(current);
    if (existing instanceof TFolder) continue;
    if (existing) throw new Error(t().cards.notAFolder(current));
    await app.vault.createFolder(current);
  }
}
