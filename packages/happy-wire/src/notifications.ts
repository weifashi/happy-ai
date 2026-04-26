import { z } from 'zod';

/**
 * Feishu (Lark) custom-bot webhook configuration.
 *
 * The secret is the bot's signing key, not user content — it is stored
 * server-side in plaintext and never returned in GET responses.
 */
export const FeishuWebhookConfigSchema = z.object({
    url: z.string().url(),
    secret: z.string().optional(),
    enabled: z.boolean(),
});
export type FeishuWebhookConfig = z.infer<typeof FeishuWebhookConfigSchema>;

/**
 * Public-facing view returned to clients on GET. Hides the secret value.
 */
export const FeishuWebhookConfigPublicSchema = z.object({
    url: z.string().nullable(),
    secret_set: z.boolean(),
    enabled: z.boolean(),
    lastTestedAt: z.number().nullable(),
});
export type FeishuWebhookConfigPublic = z.infer<typeof FeishuWebhookConfigPublicSchema>;

/**
 * Top-level notification config persisted on Account.notificationConfig.
 * Object shape leaves room for additional channels (dingtalk, slack...) without
 * a Prisma migration each time.
 */
export const NotificationConfigSchema = z.object({
    feishu: FeishuWebhookConfigSchema.extend({
        lastTestedAt: z.number().optional(),
    }).optional(),
});
export type NotificationConfig = z.infer<typeof NotificationConfigSchema>;
