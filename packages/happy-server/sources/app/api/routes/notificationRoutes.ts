import { z } from 'zod';
import { type Fastify } from '../types';
import { db } from '@/storage/db';
import { warn } from '@/utils/log';
import {
    NotificationConfigSchema,
    FeishuWebhookConfigPublicSchema,
} from 'happy-wire';
import { sendFeishuMessage, buildTestCard } from '@/app/notifications/feishuAdapter';

const FeishuPutBody = z.object({
    url: z.string().url().nullable(),
    secret: z.string().nullable().optional(),
    enabled: z.boolean(),
});

export function notificationRoutes(app: Fastify) {

    app.get('/v1/notifications/feishu', {
        schema: {
            response: {
                200: FeishuWebhookConfigPublicSchema,
            },
        },
        preHandler: app.authenticate,
    }, async (request) => {
        const userId = request.userId;
        const account = await db.account.findUnique({
            where: { id: userId },
            select: { notificationConfig: true },
        });
        const parsed = NotificationConfigSchema.safeParse(account?.notificationConfig);
        const f = parsed.success ? parsed.data.feishu : undefined;
        return {
            url: f?.url ?? null,
            secret_set: !!f?.secret,
            enabled: !!f?.enabled,
            lastTestedAt: f?.lastTestedAt ?? null,
        };
    });

    app.put('/v1/notifications/feishu', {
        schema: {
            body: FeishuPutBody,
            response: {
                200: z.object({ success: z.literal(true) }),
            },
        },
        preHandler: app.authenticate,
    }, async (request) => {
        const userId = request.userId;
        const { url, secret, enabled } = request.body;

        const account = await db.account.findUnique({
            where: { id: userId },
            select: { notificationConfig: true },
        });
        const existing = NotificationConfigSchema.safeParse(account?.notificationConfig);
        const prevFeishu = existing.success ? existing.data.feishu : undefined;

        if (!url) {
            // Unset feishu entirely.
            const next = existing.success
                ? { ...existing.data, feishu: undefined }
                : {};
            await db.account.update({
                where: { id: userId },
                data: { notificationConfig: next as object },
            });
            return { success: true as const };
        }

        const nextFeishu = {
            url,
            // null clears the secret; undefined keeps the existing one
            secret: secret === null ? undefined : secret ?? prevFeishu?.secret,
            enabled,
            lastTestedAt: prevFeishu?.lastTestedAt,
        };
        const next = { ...(existing.success ? existing.data : {}), feishu: nextFeishu };
        await db.account.update({
            where: { id: userId },
            data: { notificationConfig: next as object },
        });
        return { success: true as const };
    });

    app.post('/v1/notifications/feishu/test', {
        schema: {
            response: {
                200: z.object({ success: z.literal(true) }),
                400: z.object({ error: z.string() }),
            },
        },
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const userId = request.userId;
        const account = await db.account.findUnique({
            where: { id: userId },
            select: { notificationConfig: true },
        });
        const parsed = NotificationConfigSchema.safeParse(account?.notificationConfig);
        const feishu = parsed.success ? parsed.data.feishu : undefined;
        if (!feishu?.url) {
            return reply.code(400).send({ error: 'feishu webhook not configured' });
        }
        try {
            await sendFeishuMessage(feishu, buildTestCard());
        } catch (err) {
            warn({ err, userId }, 'feishu test send failed');
            return reply.code(400).send({ error: err instanceof Error ? err.message : 'send failed' });
        }
        // mark lastTestedAt
        const next = { ...parsed.data!, feishu: { ...feishu, lastTestedAt: Date.now() } };
        await db.account.update({
            where: { id: userId },
            data: { notificationConfig: next as object },
        });
        return { success: true as const };
    });
}
