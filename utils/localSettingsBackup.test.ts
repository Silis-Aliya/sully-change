import { beforeEach, describe, expect, it } from 'vitest';
import {
    exportLocalStorageSettings,
    applyLocalStorageSettingsPatch,
    importLocalStorageSettings,
    shouldBackupLocalStorageKey,
} from './localSettingsBackup';

describe('localSettingsBackup', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('applies allowed setting deletions for incremental sync', () => {
        localStorage.setItem('workbench_bridge_config_v1', '{"bridgeUrl":"http://pc:3001"}');
        localStorage.setItem('temporary_cache_blob', 'keep');

        applyLocalStorageSettingsPatch({}, ['workbench_bridge_config_v1', 'temporary_cache_blob']);

        expect(localStorage.getItem('workbench_bridge_config_v1')).toBeNull();
        expect(localStorage.getItem('temporary_cache_blob')).toBe('keep');
    });

    it('exports and imports XHS cookies and backup credentials', () => {
        localStorage.setItem('os_realtime_config', JSON.stringify({
            xhsEnabled: true,
            xhsMcpConfig: {
                enabled: true,
                liteMode: 'simple',
                cookie: 'xhs-cookie=secret',
            },
            xhsPhoneConfig: {
                enabled: true,
                accessToken: 'pixel-token',
            },
        }));
        localStorage.setItem('os_cloud_backup_config', JSON.stringify({
            provider: 'webdav',
            username: 'me',
            password: 'dav-pass',
            githubToken: 'gh-token',
        }));
        localStorage.setItem('aetheros.mcp.servers', JSON.stringify([{ token: 'mcp-token' }]));
        localStorage.setItem('workbench_bridge_config_v1', JSON.stringify({
            bridgeUrl: 'http://pc:8767',
            token: 'workbench-token',
            defaultAgent: 'codex',
            selectedModel: 'gpt-5.2-codex',
            modelProfile: 'deep',
            customInstructions: '先确认再修改',
            participantEnabled: true,
            participantCharacterId: 'char-1',
            fallbackApiBaseUrl: 'https://api.example.com/v1',
            fallbackApiKey: 'fallback-secret',
            fallbackApiModel: 'chat-model',
            fallbackApiName: '备用助手',
        }));
        localStorage.setItem('workbench_mode_v1', 'sully');

        const snapshot = exportLocalStorageSettings();
        localStorage.clear();
        importLocalStorageSettings(snapshot);

        expect(JSON.parse(localStorage.getItem('os_realtime_config') || '{}').xhsMcpConfig.cookie).toBe('xhs-cookie=secret');
        expect(JSON.parse(localStorage.getItem('os_realtime_config') || '{}').xhsPhoneConfig.accessToken).toBe('pixel-token');
        expect(JSON.parse(localStorage.getItem('os_cloud_backup_config') || '{}').password).toBe('dav-pass');
        expect(JSON.parse(localStorage.getItem('os_cloud_backup_config') || '{}').githubToken).toBe('gh-token');
        expect(JSON.parse(localStorage.getItem('aetheros.mcp.servers') || '[]')[0].token).toBe('mcp-token');
        expect(JSON.parse(localStorage.getItem('workbench_bridge_config_v1') || '{}').token).toBe('workbench-token');
        expect(JSON.parse(localStorage.getItem('workbench_bridge_config_v1') || '{}')).toMatchObject({
            selectedModel: 'gpt-5.2-codex',
            modelProfile: 'deep',
            customInstructions: '先确认再修改',
            participantEnabled: true,
            participantCharacterId: 'char-1',
            fallbackApiBaseUrl: 'https://api.example.com/v1',
            fallbackApiKey: 'fallback-secret',
            fallbackApiModel: 'chat-model',
            fallbackApiName: '备用助手',
        });
        expect(localStorage.getItem('workbench_mode_v1')).toBe('sully');
    });

    it('includes expected setting prefixes but ignores unrelated large cache keys', () => {
        expect(shouldBackupLocalStorageKey('chat_translate_enabled_char-1')).toBe(true);
        expect(shouldBackupLocalStorageKey('mp_lastMsgId_char-1')).toBe(true);
        expect(shouldBackupLocalStorageKey('temporary_cache_blob')).toBe(false);

        localStorage.setItem('chat_translate_enabled_char-1', 'true');
        localStorage.setItem('temporary_cache_blob', 'nope');
        localStorage.setItem('os_theme', 'x'.repeat(600 * 1024));

        const snapshot = exportLocalStorageSettings();
        expect(snapshot).toEqual({ 'chat_translate_enabled_char-1': 'true' });
    });
});
