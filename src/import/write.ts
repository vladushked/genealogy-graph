import { normalizePath, stringifyYaml, TFile, TFolder, type App } from 'obsidian';
import { t } from '../i18n';
import { writeFields } from '../schema';
import type { ImportPlan } from './plan';

/**
 * Writes an import plan into the vault: media first (without duplicates), then new cards, then additions to
 * existing cards. Existing values are never replaced; text of existing cards is left alone.
 */

export interface WriteResult {
  created: number;
  updated: number;
  mediaCopied: number;
  mediaReused: number;
  mediaMissing: string[];
  errors: string[];
}

/** Reads a media file of the source by its path inside the media folder; null when it is not there. */
export type MediaSource = (path: string) => Promise<ArrayBuffer | null>;

export async function writeImport(app: App, plan: ImportPlan, readMedia: MediaSource | null, progress: (done: number, total: number) => void): Promise<WriteResult> {
  const result: WriteResult = { created: 0, updated: 0, mediaCopied: 0, mediaReused: 0, mediaMissing: [], errors: [] };
  const total = plan.media.length + plan.cards.length;
  let done = 0;
  const tick = async () => {
    done++;
    // Let the progress text paint every few files.
    if (done % 25 === 0 || done === total) { progress(done, total); await new Promise((resolve) => window.setTimeout(resolve, 0)); }
  };

  // Media: identical content is stored once; a different file with a taken name gets a numbered name.
  const actual = new Map<string, string>();
  const byHash = new Map<string, string>();
  for (const item of plan.media) {
    const bytes = readMedia ? await readMedia(item.source) : null;
    if (!bytes) { result.mediaMissing.push(item.source); await tick(); continue; }
    try {
      const digest = await sha256(bytes);
      let target = normalizePath(item.target);
      const known = byHash.get(digest);
      if (known) { actual.set(item.target, known); result.mediaReused++; await tick(); continue; }
      for (let n = 2; ; n++) {
        const existing = app.vault.getAbstractFileByPath(target);
        if (!(existing instanceof TFile)) break;
        if (existing.stat.size === bytes.byteLength && await sha256(await app.vault.readBinary(existing)) === digest) break;
        target = numbered(normalizePath(item.target), n);
      }
      if (app.vault.getAbstractFileByPath(target) instanceof TFile) result.mediaReused++;
      else { await ensureFolder(app, parent(target)); await app.vault.createBinary(target, bytes); result.mediaCopied++; }
      actual.set(item.target, target); byHash.set(digest, target);
    } catch (error) {
      result.errors.push(`${item.source}: ${(error as Error).message}`);
    }
    await tick();
  }
  const relink = (text: string) => text.replace(/\[\[([^\]|]+)/g, (match, path: string) => actual.has(path) ? `[[${actual.get(path)}` : match);

  for (const card of plan.cards) {
    try {
      const fields = { ...card.fields };
      if (typeof fields.photo === 'string') {
        // A portrait whose file could not be copied would be a broken link.
        const target = fields.photo.replace(/^\[\[|\]\]$/g, '');
        if (actual.has(target)) fields.photo = `[[${actual.get(target)}]]`; else delete fields.photo;
      }
      if (card.action === 'create') {
        const path = normalizePath(card.path);
        await ensureFolder(app, parent(path));
        const body = card.body.split('\n').filter((line) => !/^!\[\[/.test(line) || actual.has(line.slice(3, -2))).map(relink).join('\n');
        await app.vault.create(path, `---\n${stringifyYaml(writeFields(fields))}---\n\n${body}\n`);
        result.created++;
      } else if (Object.keys(fields).length) {
        const file = app.vault.getAbstractFileByPath(card.path);
        if (!(file instanceof TFile)) throw new Error(t().cards.notFound);
        const props = writeFields(fields);
        await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(props)) {
            // The type marker is only added to a card that has none; everything else in the patch was empty.
            if (key === 'type' && frontmatter[key] !== undefined) continue;
            frontmatter[key] = value;
          }
        });
        result.updated++;
      }
    } catch (error) {
      result.errors.push(`${card.path}: ${(error as Error).message}`);
    }
    await tick();
  }
  progress(total, total);
  return result;
}

const parent = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const numbered = (path: string, n: number) => {
  const dot = path.lastIndexOf('.');
  return dot > path.lastIndexOf('/') ? `${path.slice(0, dot)} ${n}${path.slice(dot)}` : `${path} ${n}`;
};

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

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
