import { beforeEach, describe, expect, it } from 'vitest';
import {
    exportLocalStorageSettings,
    importLocalStorageSettings,
    shouldBackupLocalStorageKey,
} from './localSettingsBackup';

describe('localSettingsBackup', () => {
    beforeEach(() => {
        localStorage.clear();
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

        const snapshot = exportLocalStorageSettings();
        localStorage.clear();
        importLocalStorageSettings(snapshot);

        expect(JSON.parse(localStorage.getItem('os_realtime_config') || '{}').xhsMcpConfig.cookie).toBe('xhs-cookie=secret');
        expect(JSON.parse(localStorage.getItem('os_realtime_config') || '{}').xhsPhoneConfig.accessToken).toBe('pixel-token');
        expect(JSON.parse(localStorage.getItem('os_cloud_backup_config') || '{}').password).toBe('dav-pass');
        expect(JSON.parse(localStorage.getItem('os_cloud_backup_config') || '{}').githubToken).toBe('gh-token');
        expect(JSON.parse(localStorage.getItem('aetheros.mcp.servers') || '[]')[0].token).toBe('mcp-token');
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
