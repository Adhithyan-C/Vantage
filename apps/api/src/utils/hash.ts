import { createHash } from 'node:crypto';

export function normalizeForHash(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function contentHash(text: string): string {
  return createHash('sha256').update(normalizeForHash(text)).digest('hex').toLowerCase();
}
