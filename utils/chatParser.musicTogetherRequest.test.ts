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

const collectCreated = async (charId: string) => {
    const messages = await DB.getRecentMessagesByCharId(charId, 50, true);
    createdIds.push(...messages.map(message => message.id).filter((id): id is number => typeof id === 'number'));
    return messages;
};

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

describe('MUSIC_ACTION receipts', () => {
    it('records next_song as a lightweight together action', async () => {
        const charId = `music-action-next-${Date.now()}`;
        const musicHooks = {
            ...hooks(true),
            nextSong: vi.fn(() => ({ songName: 'Next Song', artists: 'Next Artist' })),
        };

        const content = await ChatParser.parseAndExecuteActions(
            '[[MUSIC_ACTION:next_song]]',
            charId,
            'Silis',
            vi.fn(),
            musicHooks,
        );

        const messages = await collectCreated(charId);
        const receipt = messages.find(message => message.metadata?.musicTogetherAction === 'next_song');
        expect(content).toBe('');
        expect(receipt?.role).toBe('system');
        expect(receipt?.content).toBe('Silis 切到了下一首：《Next Song》— Next Artist');
        expect(receipt?.metadata?.hiddenSystemStyle).toBe(true);
    });

});
