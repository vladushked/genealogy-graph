const IMAGE_MIMES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp',
};

export function imageMime(extension: string): string | null {
  const key = extension.toLowerCase();
  return Object.hasOwn(IMAGE_MIMES, key) ? IMAGE_MIMES[key] : null;
}

function linkPath(value: string): string {
  return value.replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('|')[0].split('#')[0].trim();
}

export function resolvePhotoFile<T extends { extension: string }>(
  explicit: unknown,
  embeds: readonly { link: string }[] | undefined,
  resolve: (link: string) => T | null,
): T | null {
  const candidates = [explicit, ...(embeds ?? []).map((embed) => embed.link)];
  const visited = new Set<string>();
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const link = linkPath(candidate);
    if (!link || visited.has(link)) continue;
    visited.add(link);
    const file = resolve(link);
    if (file && imageMime(file.extension)) return file;
  }
  return null;
}
