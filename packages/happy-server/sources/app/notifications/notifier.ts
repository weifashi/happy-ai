import { db } from '@/storage/db';
import { warn, error } from '@/utils/log';
import { NotificationConfigSchema } from 'happy-wire';
import {
    sendFeishuMessage,
    buildSessionCompletedCard,
    type SessionCompletedMeta,
} from './feishuAdapter';

export interface SessionCompletedEvent {
    userId: string;
    sessionId: string;
    completedAt: Date;
}

/**
 * Public entry point for the presence layer. Fire-and-forget — never throws,
 * never blocks the caller. All errors are logged.
 */
export async function onSessionCompleted(event: SessionCompletedEvent): Promise<void> {
    try {
        if (!shouldNotify(event.userId, event.sessionId, 'session-completed')) {
            return;
        }

        const account = await db.account.findUnique({
            where: { id: event.userId },
            select: { notificationConfig: true },
        });
        if (!account?.notificationConfig) return;

        const parsed = NotificationConfigSchema.safeParse(account.notificationConfig);
        if (!parsed.success) {
            warn({ userId: event.userId }, 'invalid notificationConfig blob');
            return;
        }
        const feishu = parsed.data.feishu;
        if (!feishu || !feishu.enabled) return;

        const session = await db.session.findUnique({
            where: { id: event.sessionId },
            select: { id: true, tag: true, createdAt: true, lastActiveAt: true },
        });
        if (!session) return;

        const meta: SessionCompletedMeta = {
            sessionTag: session.tag,
            machineName: null,
            durationMs: Math.max(0, session.lastActiveAt.getTime() - session.createdAt.getTime()),
            completedAt: event.completedAt.getTime(),
            sessionUrl: `https://happy.ai/session/${session.id}`,
        };

        const payload = buildSessionCompletedCard(meta);
        await sendFeishuMessage(feishu, payload);
    } catch (err) {
        error({ err, userId: event.userId, sessionId: event.sessionId }, 'feishu notify failed');
    }
}

/**
 * 🪄 USER CONTRIBUTION POINT (5–10 lines)
 * ─────────────────────────────────────────────────────────────────────────
 * Decide whether a given event should be delivered. Default: always send.
 *
 * The notification layer is the only thing standing between a chatty event
 * stream and your Feishu group's silence. A bad strategy here → either you
 * miss real signals (too aggressive) or your team mutes the bot (too noisy).
 *
 * State you can introduce (module-level Map is fine for MVP — Postgres if
 * you need durability across server restarts):
 *
 *   const lastSentAt = new Map<string, number>();          // key → epoch ms
 *   const dailyCount = new Map<string, { day: string; n: number }>();
 *
 * Strategies — pick one or combine:
 *   1. cooldown   : drop if same key sent within N seconds
 *                   key = `${userId}:${sessionId}:${kind}` for per-session,
 *                   or `${userId}:${kind}` for global per-event
 *   2. daily-cap  : hard cap N notifications per user per UTC day
 *   3. quiet-hours: drop during user's sleep window (would need timezone)
 *   4. batching   : not implementable in `shouldNotify` alone — would need
 *                   a queue + flush worker. Out of scope for this hook.
 *
 * Recommended starter: 30s cooldown per (user,session,kind) — handles the
 * "session was momentarily inactive then re-activated then timed out again"
 * jitter case without hiding real distinct completions.
 *
 * Return true to send, false to drop silently.
 */
type NotificationKind = 'session-completed';
export function shouldNotify(
    _userId: string,
    _sessionId: string,
    _kind: NotificationKind,
): boolean {
    return true;
}
