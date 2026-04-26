import { AuthCredentials } from '@/auth/tokenStorage';
import { HappyError } from '@/utils/errors';
import { backoff } from '@/utils/time';
import { getServerUrl } from './serverConfig';

export interface FeishuConfigPublic {
    url: string | null;
    secret_set: boolean;
    enabled: boolean;
    lastTestedAt: number | null;
}

export interface FeishuConfigInput {
    url: string | null;
    secret?: string | null;   // null clears, undefined keeps existing
    enabled: boolean;
}

const json = { 'Content-Type': 'application/json' };

export async function getFeishuConfig(credentials: AuthCredentials): Promise<FeishuConfigPublic> {
    const API = getServerUrl();
    return await backoff(async () => {
        const res = await fetch(`${API}/v1/notifications/feishu`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${credentials.token}` },
        });
        if (!res.ok) throw new Error(`getFeishuConfig: ${res.status}`);
        return (await res.json()) as FeishuConfigPublic;
    });
}

export async function putFeishuConfig(
    credentials: AuthCredentials,
    body: FeishuConfigInput,
): Promise<void> {
    const API = getServerUrl();
    const res = await fetch(`${API}/v1/notifications/feishu`, {
        method: 'PUT',
        headers: { ...json, Authorization: `Bearer ${credentials.token}` },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new HappyError(`putFeishuConfig failed: ${res.status} ${err}`, false);
    }
}

export async function testFeishu(credentials: AuthCredentials): Promise<void> {
    const API = getServerUrl();
    const res = await fetch(`${API}/v1/notifications/feishu/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credentials.token}` },
    });
    if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new HappyError(data.error ?? `testFeishu failed: ${res.status}`, false);
    }
}
