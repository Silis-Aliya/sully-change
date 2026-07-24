import { describe, expect, it } from 'vitest';
import { workbenchToChatMessages } from './workbenchBridge';

describe('workbenchToChatMessages hidden receipts', () => {
    it('includes hidden system receipts in later character context', () => {
        const char = { id: 'char-1', name: 'Silis' } as any;
        const messages = workbenchToChatMessages([
            {
                id: 'hidden-receipt',
                sessionId: 'session-1',
                role: 'system',
                kind: 'action',
                type: 'text',
                mode: 'sully',
                content: '📕 Silis点赞了一条小红书笔记',
                createdAt: 1,
                status: 'sent',
                metadata: {
                    hidden: true,
                    xhsActionReceipt: true,
                },
            },
            {
                id: 'visible-system',
                sessionId: 'session-1',
                role: 'system',
                kind: 'status',
                type: 'text',
                mode: 'sully',
                content: '普通可见系统消息',
                createdAt: 2,
                status: 'sent',
            },
        ] as any, char, '');

        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({
            role: 'system',
            content: '📕 Silis点赞了一条小红书笔记',
            metadata: {
                source: 'workbench',
                workbenchRole: 'system',
            },
        });
    });
});
