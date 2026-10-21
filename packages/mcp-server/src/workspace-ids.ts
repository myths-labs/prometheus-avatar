import { createHash, randomUUID } from 'node:crypto';

/**
 * Fixed namespace for entry ids derived from an `external_key` (UUIDv5, RFC 4122).
 *
 * NEVER change this value or the name layout in `deriveEntryId`: every entry that was ever written with an
 * external_key is addressed by the id these produce, so changing either would make the same external_key
 * point at a new entry and silently duplicate everything an agent saved before.
 */
export const WORKSPACE_ID_NAMESPACE = 'de12e56a-86ff-4cde-9978-986e6a0815e0';

export const newWorkspaceUuid = (): string => randomUUID();

/** RFC 4122 name-based UUID, version 5 (SHA-1). */
export function uuidV5(name: string, namespace: string = WORKSPACE_ID_NAMESPACE): string {
    const hash = createHash('sha1').update(Buffer.from(namespace.replace(/-/g, ''), 'hex')).update(name, 'utf8').digest();
    hash[6] = (hash[6] & 0x0f) | 0x50;
    hash[8] = (hash[8] & 0x3f) | 0x80;
    const hex = hash.subarray(0, 16).toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Trim and Unicode-normalise (NFC) so the same visible key always maps to the same entry. Returns null when unusable. */
export function normalizeExternalKey(key: string): string | null {
    const value = key.normalize('NFC').trim();
    // eslint-disable-next-line no-control-regex
    return value.length >= 1 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}

/** The same (category, external_key) always yields the same entry id, on any machine, in any session. */
export function deriveEntryId(categoryId: string, normalizedExternalKey: string): string {
    return uuidV5(`entry\u0000${categoryId}\u0000${normalizedExternalKey}`);
}
