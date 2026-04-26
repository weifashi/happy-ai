import React from 'react';
import { View, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Switch } from '@/components/Switch';
import { Text } from '@/components/StyledText';
import { Modal } from '@/modal';
import { Typography } from '@/constants/Typography';
import { useAuth } from '@/auth/AuthContext';
import { useHappyAction } from '@/hooks/useHappyAction';
import {
    getFeishuConfig,
    putFeishuConfig,
    testFeishu,
    type FeishuConfigPublic,
} from '@/sync/apiNotifications';
import { t } from '@/text';

export default function NotificationsFeishuScreen() {
    const { theme } = useUnistyles();
    const auth = useAuth();

    const [loading, setLoading] = React.useState(true);
    const [serverState, setServerState] = React.useState<FeishuConfigPublic | null>(null);
    const [url, setUrl] = React.useState('');
    const [secret, setSecret] = React.useState('');
    const [secretEdited, setSecretEdited] = React.useState(false);
    const [enabled, setEnabled] = React.useState(false);

    React.useEffect(() => {
        let mounted = true;
        getFeishuConfig(auth.credentials!)
            .then((cfg) => {
                if (!mounted) return;
                setServerState(cfg);
                setUrl(cfg.url ?? '');
                setEnabled(cfg.enabled);
            })
            .catch(() => { /* leave defaults */ })
            .finally(() => mounted && setLoading(false));
        return () => { mounted = false; };
    }, [auth.credentials]);

    const dirty =
        (url || '') !== (serverState?.url ?? '') ||
        enabled !== (serverState?.enabled ?? false) ||
        secretEdited;

    const [saving, save] = useHappyAction(async () => {
        await putFeishuConfig(auth.credentials!, {
            url: url.trim() ? url.trim() : null,
            secret: secretEdited ? (secret.trim() ? secret.trim() : null) : undefined,
            enabled,
        });
        const fresh = await getFeishuConfig(auth.credentials!);
        setServerState(fresh);
        setSecretEdited(false);
        setSecret('');
    });

    const [testing, runTest] = useHappyAction(async () => {
        try {
            await testFeishu(auth.credentials!);
            await Modal.alert(t('settingsFeishu.testSuccessTitle'), t('settingsFeishu.testSuccessMessage'));
            const fresh = await getFeishuConfig(auth.credentials!);
            setServerState(fresh);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await Modal.alert(t('settingsFeishu.testFailedTitle'), msg);
        }
    });

    return (
        <ItemList style={{ paddingTop: 0 }}>
            <ItemGroup title={t('settingsFeishu.webhookSection')} footer={t('settingsFeishu.footer')}>
                <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 4 }}>
                    <Text style={{ fontSize: 13, color: theme.colors.textSecondary, ...Typography.default() }}>
                        {t('settingsFeishu.urlLabel')}
                    </Text>
                    <TextInput
                        value={url}
                        onChangeText={setUrl}
                        placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                        placeholderTextColor={theme.colors.textSecondary}
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={!loading && !saving}
                        style={{
                            fontSize: 15,
                            color: theme.colors.text,
                            paddingVertical: Platform.OS === 'ios' ? 10 : 6,
                        }}
                    />
                </View>

                <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 4 }}>
                    <Text style={{ fontSize: 13, color: theme.colors.textSecondary, ...Typography.default() }}>
                        {t('settingsFeishu.secretLabel')}
                    </Text>
                    <TextInput
                        value={secretEdited ? secret : (serverState?.secret_set ? '••••••••' : '')}
                        onChangeText={(v) => { setSecret(v); setSecretEdited(true); }}
                        onFocus={() => { if (!secretEdited) { setSecret(''); setSecretEdited(true); } }}
                        placeholder={t('settingsFeishu.secretPlaceholder')}
                        placeholderTextColor={theme.colors.textSecondary}
                        autoCapitalize="none"
                        autoCorrect={false}
                        secureTextEntry
                        editable={!loading && !saving}
                        style={{
                            fontSize: 15,
                            color: theme.colors.text,
                            paddingVertical: Platform.OS === 'ios' ? 10 : 6,
                        }}
                    />
                    <Text style={{ fontSize: 12, color: theme.colors.textSecondary, ...Typography.default() }}>
                        {t('settingsFeishu.secretHint')}
                    </Text>
                </View>

                <Item
                    title={t('settingsFeishu.enableTitle')}
                    subtitle={t('settingsFeishu.enableSubtitle')}
                    icon={<Ionicons name="notifications-outline" size={29} color="#007AFF" />}
                    rightElement={
                        <Switch
                            value={enabled}
                            onValueChange={setEnabled}
                            disabled={loading || saving}
                        />
                    }
                    showChevron={false}
                />
            </ItemGroup>

            <ItemGroup>
                <Item
                    title={t('settingsFeishu.saveTitle')}
                    subtitle={dirty ? t('settingsFeishu.saveDirty') : t('settingsFeishu.saveClean')}
                    icon={<Ionicons name="cloud-upload-outline" size={29} color={dirty ? theme.colors.button.primary.background : theme.colors.textSecondary} />}
                    onPress={dirty && !saving ? save : undefined}
                    disabled={!dirty || saving || loading}
                    loading={saving}
                    showChevron={false}
                />
                <Item
                    title={t('settingsFeishu.testTitle')}
                    subtitle={
                        serverState?.lastTestedAt
                            ? t('settingsFeishu.testSubtitleWithTime', {
                                time: new Date(serverState.lastTestedAt).toLocaleString(),
                            })
                            : t('settingsFeishu.testSubtitle')
                    }
                    icon={<Ionicons name="paper-plane-outline" size={29} color="#FF9500" />}
                    onPress={!testing && !loading ? runTest : undefined}
                    disabled={testing || loading || !serverState?.url}
                    loading={testing}
                    showChevron={false}
                />
            </ItemGroup>
        </ItemList>
    );
}
