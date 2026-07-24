import { describe, expect, it } from 'vitest';
import { deriveListeningFromSnapshot } from './chatRequestPayload';

describe('deriveListeningFromSnapshot', () => {
    it('keeps the current song visible while an active together session is paused', () => {
        const result = deriveListeningFromSnapshot({
            current: { id: 9, name: 'Paused Song', artists: 'Singer' },
            queue: [],
            idx: 0,
            playing: false,
            progress: 12,
            duration: 180,
            lyric: [],
            activeLyricIdx: -1,
            listeningTogetherWith: ['char-1'],
            listeningTogetherStartedAt: Date.now(),
            listeningTogetherChangeCount: 0,
            listeningTogetherPreviousSong: null,
            cfg: {},
            recentTrackChange: null,
        } as any, 'char-1');

        expect(result.isListeningTogether).toBe(true);
        expect(result.userListeningContext).toMatchObject({
            songName: 'Paused Song',
            artists: 'Singer',
        });
    });
});
