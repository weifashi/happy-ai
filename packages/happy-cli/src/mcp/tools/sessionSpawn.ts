/**
 * happy_session_spawn — spawn a new agent session on a machine.
 *
 * Posts to `POST /v1/sessions/spawn` (HTTP wrapper around the socket RPC
 * `${machineId}:spawn-happy-session`). Body is `{ machineId, params }` where
 * `params` is the user-machine-key-encrypted spawn payload — the daemon is
 * the only consumer; the server just proxies bytes through.
 *
 * Server response is `{ ok, result, error }` where `result` is also encrypted
 * with the same machine key. Decrypted shape matches happy-app's
 * SpawnSessionResult: success | requestToApproveDirectoryCreation | error.
 *
 * Notes
 * - The machine encryption key is derived from the user's credentials, so it
 *   doesn't matter which machine we target — same key everywhere.
 * - When `resumeSessionId` is set we auto-stamp `intent: 'resume'` so newer
 *   daemons (>=0.3.3) honor the fork. Older daemons ignore the field.
 */

import axios from 'axios';
import { z } from 'zod';
import { Credentials } from '@/persistence';
import { configuration } from '@/configuration';
import { encrypt, decrypt, encodeBase64, decodeBase64 } from '@/api/encryption';

export const sessionSpawnInputSchema = {
    machineId: z
        .string()
        .min(1)
        .describe('Target machine ID (from happy_session_list .machineId or the daemon registration).'),
    directory: z
        .string()
        .min(1)
        .describe('Absolute path on the target machine where the agent should run.'),
    agent: z
        .enum(['claude', 'gemini', 'codex'])
        .describe('Which agent flavor to spawn.'),
    sessionTitle: z
        .string()
        .optional()
        .describe('Optional human-readable title shown in the happy-app session list.'),
    approvedNewDirectoryCreation: z
        .boolean()
        .optional()
        .default(false)
        .describe(
            'When false (default) and `directory` does not exist on the machine, the daemon refuses ' +
            'and this tool throws. Set to true to approve directory creation.',
        ),
    resumeSessionId: z
        .string()
        .optional()
        .describe(
            'If set, the daemon forks an existing agent history (Claude/Gemini/Codex sessionId on disk) ' +
            'into the new happy session. Triggers `intent: "resume"` automatically.',
        ),
};

interface SessionSpawnInput {
    machineId: string;
    directory: string;
    agent: 'claude' | 'gemini' | 'codex';
    sessionTitle?: string;
    approvedNewDirectoryCreation?: boolean;
    resumeSessionId?: string;
}

interface SessionSpawnResult {
    sessionId: string;
    machineId: string;
    agent: 'claude' | 'gemini' | 'codex';
}

type DaemonSpawnReply =
    | { type: 'success'; sessionId: string }
    | { type: 'requestToApproveDirectoryCreation'; directory: string }
    | { type: 'error'; errorMessage: string };

function resolveMachineKey(credentials: Credentials): { key: Uint8Array; variant: 'legacy' | 'dataKey' } {
    if (credentials.encryption.type === 'legacy') {
        return { key: credentials.encryption.secret, variant: 'legacy' };
    }
    return { key: credentials.encryption.machineKey, variant: 'dataKey' };
}

export async function runSessionSpawn(
    credentials: Credentials,
    input: SessionSpawnInput,
): Promise<SessionSpawnResult> {
    const { key, variant } = resolveMachineKey(credentials);

    const spawnParams: Record<string, unknown> = {
        type: 'spawn-in-directory',
        machineId: input.machineId,
        directory: input.directory,
        agent: input.agent,
        approvedNewDirectoryCreation: input.approvedNewDirectoryCreation ?? false,
        token: credentials.token,
    };
    if (input.sessionTitle) {
        spawnParams.sessionTitle = input.sessionTitle;
    }
    if (input.resumeSessionId) {
        spawnParams.resumeSessionId = input.resumeSessionId;
        spawnParams.intent = 'resume';
    }

    const encryptedParams = encodeBase64(encrypt(key, variant, spawnParams));

    let response: { data: { ok: boolean; result?: string; error?: string } };
    try {
        response = await axios.post(
            `${configuration.serverUrl}/v1/sessions/spawn`,
            { machineId: input.machineId, params: encryptedParams },
            {
                headers: { Authorization: `Bearer ${credentials.token}` },
                timeout: 35000,
            },
        );
    } catch (err: any) {
        const status = err?.response?.status;
        const message = err?.response?.data?.error || err?.message || 'spawn failed';
        if (status === 404) {
            throw new Error(`Machine ${input.machineId} not found for this account.`);
        }
        if (status === 504) {
            throw new Error(`Spawn RPC timed out — the daemon on ${input.machineId} may be offline: ${message}`);
        }
        throw new Error(`Spawn failed: ${message}`);
    }

    if (!response.data.ok || !response.data.result) {
        throw new Error(`Spawn failed: ${response.data.error || 'no result returned'}`);
    }

    const decoded = decodeBase64(response.data.result);
    const reply = decrypt(key, variant, decoded) as DaemonSpawnReply | null;
    if (!reply) {
        throw new Error('Failed to decrypt spawn response from daemon.');
    }

    if (reply.type === 'requestToApproveDirectoryCreation') {
        throw new Error(
            `Directory ${reply.directory} does not exist on machine ${input.machineId}. ` +
            'Re-run with approvedNewDirectoryCreation=true to let the daemon create it.',
        );
    }
    if (reply.type === 'error') {
        throw new Error(reply.errorMessage || 'Daemon refused to spawn session.');
    }

    return {
        sessionId: reply.sessionId,
        machineId: input.machineId,
        agent: input.agent,
    };
}
