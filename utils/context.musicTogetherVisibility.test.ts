import { describe, expect, it } from 'vitest';
import { ContextBuilder } from './context';

describe('ContextBuilder.buildMusicAtmosphere', () => {
    it('includes the shared current song during together listening even when ambient music reading is disabled', () => {
        const result = ContextBuilder.buildMusicAtmosphere(
            {
                id: 'char-1',
                name: 'Silis',
                musicProfile: {
                    canReadUserMusic: false,
                    playlists: [],
                },
            } as any,
            'User',
            {
                songName: 'Put A Little Umph In It (Single Version)',
                artists: 'Jagged Edge / Ashanti',
                lyricWindow: [],
                activeIdx: -1,
            },
            null,
            true,
        );

        expect(result).toContain('Put A Little Umph In It (Single Version)');
        expect(result).toContain('Jagged Edge / Ashanti');
    });

    it('still hides ambient user playback when music reading is disabled outside together listening', () => {
        const result = ContextBuilder.buildMusicAtmosphere(
            {
                id: 'char-1',
                name: 'Silis',
                musicProfile: {
                    canReadUserMusic: false,
                    playlists: [],
                },
            } as any,
            'User',
            {
                songName: 'Private Song',
                artists: 'Private Artist',
                lyricWindow: [],
                activeIdx: -1,
            },
            null,
            false,
        );

        expect(result).not.toContain('Private Song');
        expect(result).not.toContain('Private Artist');
    });
});
