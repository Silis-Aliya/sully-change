import { describe, expect, it } from 'vitest';
import { ChatPrompts } from './chatPrompts';

const char = { id: 'c1', name: 'Silis' } as any;
const userProfile = { name: '小雨' } as any;

describe('buildMessageHistory music cards', () => {
    it('sends song metadata to the character instead of the placeholder label', () => {
        const messages = [{
            id: 1,
            charId: 'c1',
            role: 'user',
            type: 'music_card',
            content: '[音乐分享]',
            timestamp: Date.now(),
            metadata: {
                intent: 'share',
                song: {
                    name: 'MAGNETIC',
                    artists: 'Rain / 王嘉尔',
                    album: 'Pieces by Rain',
                    albumPic: 'https://example.com/cover.jpg',
                },
            },
        }] as any[];

        const { apiMessages } = ChatPrompts.buildMessageHistory(messages, 10, char, userProfile, []);
        const content = String(apiMessages[0]?.content || '');

        expect(content).toContain('MAGNETIC');
        expect(content).toContain('Rain / 王嘉尔');
        expect(content).toContain('小雨');
        expect(content).toContain('Silis');
        expect(content).not.toMatch(/\[音乐分享\]\s*$/);
    });
});
