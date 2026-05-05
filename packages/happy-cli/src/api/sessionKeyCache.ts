/**
 * Local cache of per-session AES keys, encrypted with the CLI's machineKey.
 *
 * The daemon writes a key file when it creates a session; the MCP server
 * reads it back to decrypt session rows without needing the app's
 * contentKeyPair.privateKey (which the CLI never has).
 *
 * Storage: one file per session under `~/.happy-ai/session-keys/{sessionId}.key`
 * Format:  AES-256-GCM bundle produced by `encryptWithDataKey` / `decryptWithDataKey`.
 *          The AES key is base64-encoded before encryption (JSON-safe).
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configuration } from '@/configuration';
import { encryptWithDataKey, decryptWithDataKey, encodeBase64, decodeBase64 } from './encryption';

function keyPath(sessionId: string): string {
    return join(configuration.sessionKeysDir, `${sessionId}.key`);
}

export async function cacheSessionKey(
    sessionId: string,
    sessionAESKey: Uint8Array,
    machineKey: Uint8Array,
): Promise<void> {
    if (!existsSync(configuration.sessionKeysDir)) {
        mkdirSync(configuration.sessionKeysDir, { recursive: true });
    }
    const encrypted = encryptWithDataKey(encodeBase64(sessionAESKey), machineKey);
    await writeFile(keyPath(sessionId), encrypted);
}

export function readCachedSessionKey(
    sessionId: string,
    machineKey: Uint8Array,
): Uint8Array | null {
    const p = keyPath(sessionId);
    if (!existsSync(p)) {
        return null;
    }
    try {
        const blob = new Uint8Array(readFileSync(p));
        const b64 = decryptWithDataKey(blob, machineKey) as string | null;
        if (typeof b64 !== 'string') {
            return null;
        }
        return decodeBase64(b64);
    } catch {
        return null;
    }
}
