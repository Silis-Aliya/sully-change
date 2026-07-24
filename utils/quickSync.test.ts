import { describe, expect, it } from 'vitest';
import {
    collectBlobRefIds,
    collectDeletedBlobIds,
    QUICK_SYNC_STORES,
    recordKeyForQuickSync,
    restoreQuickSyncDeleteKey,
    shouldIncludeQuickSyncRow,
} from './quickSync';
import { shouldBackupLocalStorageKey } from './localSettingsBackup';

describe('quickSync settings coverage', () => {
    it('includes theme and settings asset stores', () => {
        expect(QUICK_SYNC_STORES).toContain('themes');
        expect(QUICK_SYNC_STORES).toContain('assets');
        expect(QUICK_SYNC_STORES).toContain('gallery');
        expect(QUICK_SYNC_STORES).toContain('user_profile');
        expect(QUICK_SYNC_STORES).toContain('diaries');
        expect(QUICK_SYNC_STORES).toContain('tasks');
        expect(QUICK_SYNC_STORES).toContain('anniversaries');
        expect(QUICK_SYNC_STORES).toContain('room_todos');
        expect(QUICK_SYNC_STORES).toContain('room_notes');
        expect(QUICK_SYNC_STORES).toContain('groups');
        expect(QUICK_SYNC_STORES).toContain('journal_stickers');
        expect(QUICK_SYNC_STORES).toContain('social_posts');
        expect(QUICK_SYNC_STORES).toContain('courses');
        expect(QUICK_SYNC_STORES).toContain('games');
        expect(QUICK_SYNC_STORES).toContain('novels');
        expect(QUICK_SYNC_STORES).toContain('songs');
        expect(QUICK_SYNC_STORES).toContain('bank_transactions');
        expect(QUICK_SYNC_STORES).toContain('bank_data');
        expect(QUICK_SYNC_STORES).toContain('xhs_activities');
        expect(QUICK_SYNC_STORES).toContain('xhs_stock');
        expect(QUICK_SYNC_STORES).toContain('quizzes');
        expect(QUICK_SYNC_STORES).toContain('guidebook');
        expect(QUICK_SYNC_STORES).toContain('scheduled_messages');
        expect(QUICK_SYNC_STORES).toContain('life_sim');
        expect(QUICK_SYNC_STORES).toContain('hotnews_snapshots');
        expect(QUICK_SYNC_STORES).toContain('pixel_home_assets');
        expect(QUICK_SYNC_STORES).toContain('pixel_home_layouts');
        expect(QUICK_SYNC_STORES).toContain('workbench_sessions');
        expect(QUICK_SYNC_STORES).toContain('workbench_messages');
        expect(QUICK_SYNC_STORES).toContain('workbench_summaries');
        expect(QUICK_SYNC_STORES).toContain('workbench_memories');
        expect(QUICK_SYNC_STORES).toContain('workbench_artifacts');
        expect(QUICK_SYNC_STORES).toContain('memory_vectors');
        expect(QUICK_SYNC_STORES).toContain('vr_music');
    });

    it('includes persistent full-backup options in incremental settings', () => {
        expect(shouldBackupLocalStorageKey('vr_po_base')).toBe(true);
        expect(shouldBackupLocalStorageKey('vr_po_device')).toBe(true);
        expect(shouldBackupLocalStorageKey('signal_my_authorship')).toBe(true);
        expect(shouldBackupLocalStorageKey('signal_my_lines')).toBe(true);
        expect(shouldBackupLocalStorageKey('signal_notice_ack')).toBe(true);
        expect(shouldBackupLocalStorageKey('mg_style_v1')).toBe(true);
        expect(shouldBackupLocalStorageKey('vr_po_admin_token')).toBe(false);
        expect(shouldBackupLocalStorageKey('signal_whisper')).toBe(false);
    });

    it('syncs customization assets but skips runtime cache assets', () => {
        expect(shouldIncludeQuickSyncRow('assets', { id: 'appearance_preset_abc', data: '{}' })).toBe(true);
        expect(shouldIncludeQuickSyncRow('assets', { id: 'icon_chat', data: 'data:image/png;base64,abc' })).toBe(true);
        expect(shouldIncludeQuickSyncRow('assets', { id: 'wallpaper', data: 'linear-gradient(red, blue)' })).toBe(true);
        expect(shouldIncludeQuickSyncRow('assets', { id: 'chrome_css_presets', data: [] })).toBe(true);
        expect(shouldIncludeQuickSyncRow('assets', { id: 'bank_custom_furniture_assets_v1', data: '[]' })).toBe(true);
        expect(shouldIncludeQuickSyncRow('assets', { id: 'acestep_song_123', data: { blob: new Blob() } })).toBe(true);
        expect(shouldIncludeQuickSyncRow('assets', { id: 'mmmusic_song_123', data: { blob: new Blob() } })).toBe(true);
        expect(shouldIncludeQuickSyncRow('assets', { id: 'voice_123', data: { blob: new Blob() } })).toBe(false);
        expect(shouldIncludeQuickSyncRow('assets', { id: 'minimax_music_cache_123', data: { blob: new Blob() } })).toBe(false);
    });

    it('collects blobref image ids from nested synced records', () => {
        expect(collectBlobRefIds({
            theme: { wallpaper: 'blobref:img_wallpaper_1' },
            char: { avatar: 'blobref:img_avatar_2' },
            localStorageSettings: {
                workbench_bridge_config_v1: JSON.stringify({ codexAvatar: 'blobref:img_code_avatar_4' }),
            },
            messages: [
                { metadata: { cardImage: 'url(blobref:img_card_3)' } },
                { content: 'plain text' },
            ],
        }).sort()).toEqual(['img_avatar_2', 'img_card_3', 'img_code_avatar_4', 'img_wallpaper_1']);
    });

    it('emits incremental deletions for image blobs that are no longer referenced', () => {
        expect(collectDeletedBlobIds(
            { keep: 'hash-a', removed_avatar: 'hash-b', removed_card: 'hash-c' },
            { keep: 'hash-a', added: 'hash-d' },
        ).sort()).toEqual(['removed_avatar', 'removed_card']);
    });

    it('uses memoryId as the incremental key for vector rows', () => {
        expect(recordKeyForQuickSync('memory_vectors', { memoryId: 'mem-43', vector: new Uint8Array(4) })).toBe('mem-43');
        expect(recordKeyForQuickSync('messages', { id: 43 })).toBe('43');
    });

    it('round-trips compound pixel-home layout keys for incremental deletion', () => {
        const key = recordKeyForQuickSync('pixel_home_layouts', { charId: 'char-1', roomId: 'bedroom' });
        expect(key).toBe('compound:["char-1","bedroom"]');
        expect(restoreQuickSyncDeleteKey('pixel_home_layouts', key!)).toEqual(['char-1', 'bedroom']);
    });
});
