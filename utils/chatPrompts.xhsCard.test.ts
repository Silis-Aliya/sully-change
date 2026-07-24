import { describe, expect, it } from 'vitest';
import { ChatPrompts } from './chatPrompts';

const char = { id: 'c1', name: 'Silis' } as any;
const userProfile = { name: '小雨' } as any;

describe('buildMessageHistory xhs cards', () => {
    it('keeps noteId and source link visible after an XHS share renders as a card', () => {
        const messages = [{
            id: 1,
            charId: 'c1',
            role: 'user',
            type: 'xhs_card',
            content: '夜晚散步',
            timestamp: Date.now(),
            metadata: {
                xhsNote: {
                    noteId: '64f123456789abcdef012345',
                    title: '夜晚散步',
                    desc: '',
                    author: 'Eve',
                    likes: 373,
                    sourceUrl: 'https://www.xiaohongshu.com/explore/64f123456789abcdef012345?xsec_token=tok',
                },
            },
        }] as any[];

        const { apiMessages } = ChatPrompts.buildMessageHistory(messages, 10, char, userProfile, []);
        const content = String(apiMessages[0]?.content || '');

        expect(content).toContain('noteId: 64f123456789abcdef012345');
        expect(content).toContain('链接: https://www.xiaohongshu.com/explore/64f123456789abcdef012345?xsec_token=tok');
        expect(content).toContain('正文: 未获取');
        expect(content).toContain('[[XHS_DETAIL: 64f123456789abcdef012345]]');
    });
});
