import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatParser, type MusicActionHooks } from './chatParser';
import { DB } from './db';

const createdIds: number[] = [];
afterEach(async () => {
    if (createdIds.length) await DB.deleteMessages(createdIds.splice(0));
});

const hooks = (isListeningTogether: boolean): MusicActionHooks => ({
    getListeningSnapshot: () => ({
        songId: 1,
        name: 'Test Song',
        artists: 'Test Artist',
        album: '',
        albumPic: '',
        duration: 180,
        fee: 0,
    }),
    isListeningTogether: () => isListeningTogether,
    joinListeningTogether: vi.fn(),
    addSongToCharPlaylist: vi.fn(async () => null),
});

describe('MUSIC_TOGETHER_REQUEST deduplication', () => {
    it('does not create another invite while already listening together', async () => {
        const charId = `music-together-active-${Date.now()}`;
        const content = await ChatParser.parseAndExecuteActions(
            '继续听 [[MUSIC_TOGETHER_REQUEST]]',
            charId,
            'Silis',
            vi.fn(),
            hooks(true),
        );

        const messages = await DB.getRecentMessagesByCharId(charId, 20, true);
        expect(content).toBe('继续听');
        expect(messages.filter(message => message.metadata?.togetherRequestFromCharacter)).toHaveLength(0);
    });

    it('does not create a duplicate while an earlier request is pending', async () => {
        const charId = `music-together-pending-${Date.now()}`;
        const id = await DB.saveMessage({
            charId,
            role: 'assistant',
            type: 'music_card',
            content: '[一起听邀请]',
            metadata: {
                intent: 'join',
                togetherRequestFromCharacter: true,
                inviteStatus: 'pending',
                song: { songId: 1, name: 'Test Song', artists: 'Test Artist' },
            },
        } as any);
        createdIds.push(id);

        await ChatParser.parseAndExecuteActions(
            '[[MUSIC_TOGETHER_REQUEST]]',
            charId,
            'Silis',
            vi.fn(),
            hooks(false),
        );

        const messages = await DB.getRecentMessagesByCharId(charId, 20, true);
        expect(messages.filter(message => message.metadata?.togetherRequestFromCharacter)).toHaveLength(1);
    });
});
