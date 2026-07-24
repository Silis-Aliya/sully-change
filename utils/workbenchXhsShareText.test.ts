import { describe, expect, it } from 'vitest';
import { createWorkbenchXhsCaches, processWorkbenchXhsDirectives } from './workbenchXhsPostProcess';

describe('Workbench XHS share text', () => {
    it('keeps the character comment as visible text and adds the note as a separate card', async () => {
        const result = await processWorkbenchXhsDirectives({
            rawReply: '这个帖子你看看，我觉得挺有意思。\n[[XHS_SHARE: 1]]',
            sessionId: 'wb-share',
            char: { id: 'char-1', name: 'Silis', avatar: '' } as any,
            userProfile: { name: 'User' } as any,
            xhsCaches: createWorkbenchXhsCaches(),
            lastXhsNotesRef: {
                current: [{
                    noteId: 'note-1',
                    title: '测试帖子',
                    desc: '帖子正文',
                    likes: 1,
                    author: '作者',
                    authorId: 'author-1',
                }],
            },
        });

        expect(result.visibleReply).toBe('这个帖子你看看，我觉得挺有意思。');
        expect(result.extraMessages).toHaveLength(1);
        expect(result.extraMessages[0]).toMatchObject({
            role: 'character',
            type: 'xhs_card',
            content: '测试帖子',
            metadata: {
                sharedBy: 'character',
                xhsNote: { noteId: 'note-1' },
            },
        });
        expect(result.extraMessages[0].metadata?.shareComment).toBeUndefined();
    });
});
