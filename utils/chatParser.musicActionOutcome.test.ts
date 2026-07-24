import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatParser, type MusicActionHooks } from './chatParser';
import { DB } from './db';

const createdIds: number[] = [];

afterEach(async () => {
    if (createdIds.length) await DB.deleteMessages(createdIds.splice(0));
});

const baseHooks = (): MusicActionHooks => ({
    getListeningSnapshot: () => ({
        songId: 1,
        name: 'Current Song',
        artists: 'Current Artist',
        album: '',
        albumPic: '',
        duration: 180,
        fee: 0,
    }),
    joinListeningTogether: vi.fn(),
    addSongToCharPlaylist: vi.fn(async () => null),
});

const run = async (directive: string, hooks: MusicActionHooks) => {
    const charId = `music-outcome-${Date.now()}-${Math.random()}`;
    const addToast = vi.fn();
    await ChatParser.parseAndExecuteActions(directive, charId, 'Silis', addToast, hooks);
    const messages = await DB.getRecentMessagesByCharId(charId, 20, true);
    createdIds.push(...messages.map(message => message.id).filter((id): id is number => typeof id === 'number'));
    return { receipt: messages.find(message => message.metadata?.musicTogetherAction), addToast };
};

describe('MUSIC_ACTION outcome receipts', () => {
    it('records a failed next action when the queue cannot advance', async () => {
        const result = await run('[[MUSIC_ACTION:next_song]]', {
            ...baseHooks(),
            nextSong: () => null,
        });

        expect(result.receipt?.content).toContain('但当前没有可播放的歌曲');
        expect(result.receipt?.metadata?.musicTogetherActionOutcome).toBe('failed');
        expect(result.addToast).toHaveBeenCalledWith('当前没有可切换的歌曲', 'error');
    });

    it('describes single-song replay without claiming a different song was selected', async () => {
        const result = await run('[[MUSIC_ACTION:next_song]]', {
            ...baseHooks(),
            nextSong: () => ({ songName: 'Current Song', artists: 'Current Artist' }),
        });

        expect(result.receipt?.content).toContain('重新播放了');
        expect(result.receipt?.content).not.toContain('切到了下一首');
        expect(result.receipt?.metadata?.musicTogetherActionOutcome).toBe('success');
    });

    it('records a failed pick when the requested song is unavailable', async () => {
        const result = await run('[[MUSIC_ACTION:pick_song|2]]', {
            ...baseHooks(),
            pickSong: vi.fn(async () => null),
        });

        expect(result.receipt?.content).toContain('编号 2 的歌曲');
        expect(result.receipt?.metadata?.musicTogetherActionOutcome).toBe('failed');
        expect(result.addToast).toHaveBeenCalledWith('没有找到可播放的歌曲', 'error');
    });

    it('maps one-based pick numbers to zero-based player indexes', async () => {
        const pickSong = vi.fn(async () => ({ songName: 'First Song', artists: 'First Artist' }));
        await run('[[MUSIC_ACTION:pick_song|1]]', {
            ...baseHooks(),
            pickSong,
        });

        expect(pickSong).toHaveBeenCalledWith(0, expect.any(String));
    });

    it('does not claim a mode change when the hook is unavailable', async () => {
        const result = await run('[[MUSIC_ACTION:set_mode|shuffle]]', baseHooks());

        expect(result.receipt?.content).toContain('播放器暂时无法执行');
        expect(result.receipt?.metadata?.musicTogetherActionOutcome).toBe('failed');
        expect(result.addToast).toHaveBeenCalledWith('播放器暂时无法切换播放模式', 'error');
    });
});
