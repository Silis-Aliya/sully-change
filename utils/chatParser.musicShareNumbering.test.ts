import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatParser, type MusicActionHooks } from './chatParser';
import { DB } from './db';
import { rememberMusicWakePickableSongs } from './musicTrackChange';

const createdIds: number[] = [];

afterEach(async () => {
    if (createdIds.length) await DB.deleteMessages(createdIds.splice(0));
});

describe('MUSIC_SHARE numbering', () => {
    it('shares the first displayed song for MUSIC_SHARE:1', async () => {
        const charId = `music-share-numbering-${Date.now()}`;
        rememberMusicWakePickableSongs(charId, [
            { id: 11, name: 'First Song', artists: 'First Artist', sourceLabel: 'TA的歌' },
            { id: 22, name: 'Second Song', artists: 'Second Artist', sourceLabel: 'TA的歌' },
        ]);
        const hooks: MusicActionHooks = {
            getListeningSnapshot: () => null,
            joinListeningTogether: vi.fn(),
            addSongToCharPlaylist: vi.fn(async () => null),
        };

        await ChatParser.parseAndExecuteActions(
            '[[MUSIC_SHARE:1]]',
            charId,
            'Silis',
            vi.fn(),
            hooks,
        );

        const messages = await DB.getRecentMessagesByCharId(charId, 20, true);
        createdIds.push(...messages.map(message => message.id).filter((id): id is number => typeof id === 'number'));
        const card = messages.find(message => message.type === 'music_card');
        expect(card?.metadata?.song?.name).toBe('First Song');
    });
});
