import { describe, expect, it, vi } from 'vitest';
import { createWorkbenchXhsCaches, processWorkbenchXhsDirectives } from './workbenchXhsPostProcess';

const baseArgs = () => ({
    sessionId: 'wb-test',
    char: {
        id: 'char-1',
        name: 'Silis',
        avatar: '',
        xhsEnabled: false,
    } as any,
    userProfile: {
        name: '我',
    } as any,
    realtimeConfig: {
        xhsMcpConfig: { enabled: false, serverUrl: '' },
    } as any,
    xhsCaches: createWorkbenchXhsCaches(),
    lastXhsNotesRef: { current: [] },
    addToast: vi.fn(),
});

describe('processWorkbenchXhsDirectives write boundaries', () => {
    it('strips likes without executing or recording them', async () => {
        const result = await processWorkbenchXhsDirectives({
            ...baseArgs(),
            rawReply: '我先点一下\n[[XHS_LIKE: note-1]]\n然后继续看代码',
        });

        expect(result.visibleReply).toBe('我先点一下\n\n然后继续看代码');
        expect(result.extraMessages).toHaveLength(0);
        if (result.extraMessages[0]) expect(result.extraMessages[0]).toMatchObject({
            role: 'system',
            kind: 'action',
            type: 'text',
            content: '小红书点赞失败：小红书 MCP 未开启',
            metadata: {
                source: 'workbench_xhs_receipt',
                xhsActionReceipt: true,
                hidden: true,
            },
        });
    });

    it('strips unsupported writes without executing them in Lite simple mode', async () => {
        const args = baseArgs();
        args.char.xhsEnabled = true;
        args.realtimeConfig.xhsMcpConfig = {
            enabled: true,
            serverUrl: 'https://xhs-lite.example.com/api',
            liteMode: 'simple',
        };

        const result = await processWorkbenchXhsDirectives({
            ...args,
            rawReply: [
                '我先看看。',
                '[[XHS_FAV: note-1]]',
                '[[XHS_COMMENT: note-1 | 写得很好]]',
                '[[XHS_REPLY: note-1 | comment-1 | 谢谢你]]',
            ].join('\n'),
        });

        expect(result.visibleReply).toBe('我先看看。');
        expect(result.extraMessages).toHaveLength(0);
        expect(args.addToast).not.toHaveBeenCalled();
    });
});
