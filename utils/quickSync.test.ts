import { describe, expect, it } from 'vitest';
import { QUICK_SYNC_STORES, shouldIncludeQuickSyncRow } from './quickSync';

describe('quickSync settings coverage', () => {
    it('includes theme and settings asset stores', () => {
        expect(QUICK_SYNC_STORES).toContain('themes');
        expect(QUICK_SYNC_STORES).toContain('assets');
    });

    it('syncs customization assets but skips runtime cache assets', () => {
        expect(shouldIncludeQuickSyncRow('assets', { id: 'appearance_preset_abc', data: '{}' })).toBe(true);
        expect(shouldIncludeQuickSyncRow('assets', { id: 'icon_chat', data: 'data:image/png;base64,abc' })).toBe(true);
        expect(shouldIncludeQuickSyncRow('assets', { id: 'wallpaper', data: 'linear-gradient(red, blue)' })).toBe(true);
        expect(shouldIncludeQuickSyncRow('assets', { id: 'chrome_css_presets', data: [] })).toBe(true);
        expect(shouldIncludeQuickSyncRow('assets', { id: 'bank_custom_furniture_assets_v1', data: '[]' })).toBe(true);
        expect(shouldIncludeQuickSyncRow('assets', { id: 'voice_123', data: { blob: new Blob() } })).toBe(false);
        expect(shouldIncludeQuickSyncRow('assets', { id: 'minimax_music_cache_123', data: { blob: new Blob() } })).toBe(false);
    });
});
