import { describe, expect, it } from 'vitest';
import { formatMusicWakePickableSongs } from './musicTrackChange';

describe('music pickable song numbering', () => {
    it('uses one-based display numbers', () => {
        const output = formatMusicWakePickableSongs([
            { id: 1, name: 'Song A', artists: 'Artist A', sourceLabel: '用户队列' },
            { id: 2, name: 'Song B', artists: 'Artist B', sourceLabel: 'TA的歌' },
        ]);

        expect(output).toBe([
            '1. [用户队列]《Song A》 Artist A',
            '2. [TA的歌]《Song B》 Artist B',
        ].join('\n'));
    });
});
