/**
 * Resolve a session's per-row encryption key from credentials + the server-returned
 * `dataEncryptionKey` blob, then decrypt the metadata/agentState fields.
 *
 * Lives here (not in api/) because it's only consumed by the MCP server, which
 * works off raw HTTP responses rather than the full ApiClient.getOrCreateSession
 * round-trip.
 */

import { Credentials } from '@/persistence';
import { decodeBase64, decryptWithDataKey, decryptLegacy } from '@/api/encryption';
import { decryptWithEphemeralKey } from '@/ui/auth';
import { readCachedSessionKey } from '@/api/sessionKeyCache';

interface DecryptedSessionRow {
    id: string;
    seq: number;
    createdAt: number;
    updatedAt: number;
    activeAt: number;
    active: boolean;
    metadata: Record<string, any> | null;
    agentState: Record<string, any> | null;
    isShared?: boolean;
    /** Resolved AES key for this session (or shared secret for legacy). Reuse to
     *  decrypt subsequent message payloads without re-running this dance. */
    encryptionKey: Uint8Array;
    encryptionVariant: 'legacy' | 'dataKey';
}

interface RawSessionRow {
    id: string;
    seq: number;
    createdAt: number;
    updatedAt: number;
    activeAt: number;
    active: boolean;
    metadata: string | null;
    agentState: string | null;
    dataEncryptionKey: string | null;
    isShared?: boolean;
}

/**
 * Resolve the per-session encryption key from the credentials. dataKey rows
 * carry an envelope (version byte + libsodium-box ciphertext) that opens with
 * the user's machineKey; legacy rows just inherit the master shared secret.
 */
function resolveSessionKey(
    credentials: Credentials,
    dataEncryptionKey: string | null,
    sessionId?: string,
): { key: Uint8Array; variant: 'legacy' | 'dataKey' } | null {
    if (credentials.encryption.type === 'legacy') {
        return { key: credentials.encryption.secret, variant: 'legacy' };
    }

    // Try local key cache first (daemon persists session AES keys here).
    if (sessionId) {
        const cached = readCachedSessionKey(sessionId, credentials.encryption.machineKey);
        if (cached) {
            return { key: cached, variant: 'dataKey' };
        }
    }

    // Fallback: try ephemeral-key decrypt on the server blob.
    if (!dataEncryptionKey) {
        return null;
    }

    const blob = decodeBase64(dataEncryptionKey);
    if (blob.length < 1 || blob[0] !== 0) {
        return null;
    }

    const opened = decryptWithEphemeralKey(blob.slice(1), credentials.encryption.machineKey);
    if (!opened) {
        return null;
    }

    return { key: opened, variant: 'dataKey' };
}

export function decryptSessionRow(
    credentials: Credentials,
    row: RawSessionRow,
): DecryptedSessionRow | null {
    const resolved = resolveSessionKey(credentials, row.dataEncryptionKey, row.id);
    if (!resolved) {
        return null;
    }

    let metadata: Record<string, any> | null = null;
    if (row.metadata) {
        try {
            metadata = resolved.variant === 'legacy'
                ? decryptLegacy(decodeBase64(row.metadata), resolved.key)
                : decryptWithDataKey(decodeBase64(row.metadata), resolved.key);
        } catch {
            metadata = null;
        }
    }

    let agentState: Record<string, any> | null = null;
    if (row.agentState) {
        try {
            agentState = resolved.variant === 'legacy'
                ? decryptLegacy(decodeBase64(row.agentState), resolved.key)
                : decryptWithDataKey(decodeBase64(row.agentState), resolved.key);
        } catch {
            agentState = null;
        }
    }

    return {
        id: row.id,
        seq: row.seq,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        activeAt: row.activeAt,
        active: row.active,
        metadata,
        agentState,
        isShared: row.isShared,
        encryptionKey: resolved.key,
        encryptionVariant: resolved.variant,
    };
}
