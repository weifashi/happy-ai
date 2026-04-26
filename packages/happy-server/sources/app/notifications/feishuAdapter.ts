import * as crypto from 'crypto';
import type { FeishuWebhookConfig } from 'happy-wire';

/**
 * Metadata available when a session ends. Server-only fields — content is
 * end-to-end encrypted and never surfaces here.
 */
export interface SessionCompletedMeta {
    sessionTag: string;
    machineName: string | null;
    durationMs: number;
    completedAt: number;
    sessionUrl: string;
}

/**
 * Feishu message payload. Only `text` and `interactive` are used in MVP, but
 * the type is open enough for the user contribution to switch shapes.
 */
export type FeishuMessagePayload =
    | { msg_type: 'text'; content: { text: string } }
    | { msg_type: 'interactive'; card: Record<string, unknown> };

const FEISHU_REQUEST_TIMEOUT_MS = 5000;

/**
 * Compute the signature for a Feishu signed-bot webhook.
 * Algorithm (per Feishu docs):
 *   stringToSign = `${timestamp}\n${secret}`
 *   sign         = base64(HMAC_SHA256(stringToSign, ""))
 */
function buildSignature(secret: string, timestamp: number): string {
    const stringToSign = `${timestamp}\n${secret}`;
    return crypto.createHmac('sha256', stringToSign).update('').digest('base64');
}

/**
 * Send a single message to a Feishu bot. Throws on HTTP error or non-zero
 * `code` field in the JSON response so callers can decide whether to retry.
 *
 * No internal retry loop — we want failures visible in logs and the
 * notifier layer can decide retry/backoff policy.
 */
export async function sendFeishuMessage(
    config: FeishuWebhookConfig,
    payload: FeishuMessagePayload,
): Promise<void> {
    const body: Record<string, unknown> = { ...payload };
    if (config.secret) {
        const ts = Math.floor(Date.now() / 1000);
        body.timestamp = String(ts);
        body.sign = buildSignature(config.secret, ts);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FEISHU_REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(config.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!res.ok) {
            throw new Error(`feishu HTTP ${res.status}`);
        }
        const data = (await res.json()) as { code?: number; msg?: string };
        if (typeof data.code === 'number' && data.code !== 0) {
            throw new Error(`feishu code=${data.code} msg=${data.msg ?? ''}`);
        }
    } finally {
        clearTimeout(timer);
    }
}

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    return `${h}h${m % 60}m`;
}

/**
 * 🪄 USER CONTRIBUTION POINT (5–10 lines)
 * ─────────────────────────────────────────────────────────────────────────
 * Build the Feishu message users see when a session completes.
 *
 * The default below sends a plain-text line. Replace the body with a richer
 * interactive card to unlock colors / action buttons / field tables.
 *
 * Reference (interactive card spec):
 *   https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/feishu-cards
 *
 * Available fields on `meta`:
 *   - sessionTag, machineName
 *   - durationMs, completedAt (epoch ms)
 *   - sessionUrl (deep link)
 *
 * Trade-offs to consider:
 *   - text-only       → simple, low maintenance, works offline-friendly
 *   - interactive     → CTA buttons, but doc-hungry if you tweak layouts
 *   - color theming   → server only sees "active=false", we cannot tell
 *                       success vs timeout-error apart. Decide whether to
 *                       claim "completed" optimistically or be neutral.
 *
 * Example minimal interactive card:
 *
 *   return {
 *       msg_type: 'interactive',
 *       card: {
 *           header: { title: { tag: 'plain_text', content: 'Session ended' }, template: 'blue' },
 *           elements: [
 *               { tag: 'div', text: { tag: 'lark_md', content: `**${meta.sessionTag}**\nMachine: ${meta.machineName ?? 'unknown'}\nDuration: ${formatDuration(meta.durationMs)}` } },
 *               { tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: 'Open in Happy' }, url: meta.sessionUrl, type: 'primary' }] },
 *           ],
 *       },
 *   };
 */
export function buildSessionCompletedCard(meta: SessionCompletedMeta): FeishuMessagePayload {
    return {
        msg_type: 'text',
        content: {
            text: `🎯 Happy session "${meta.sessionTag}" ended` +
                (meta.machineName ? ` on ${meta.machineName}` : '') +
                (meta.durationMs > 0 ? ` · ${formatDuration(meta.durationMs)}` : ''),
        },
    };
}

/**
 * Test-message payload used by the "Send test" button in the settings UI.
 */
export function buildTestCard(): FeishuMessagePayload {
    return {
        msg_type: 'text',
        content: { text: '✅ Happy 飞书通知已接通' },
    };
}

// re-export internal helper for the user's potential card body
export { formatDuration };
