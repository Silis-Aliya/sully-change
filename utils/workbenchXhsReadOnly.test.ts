import { describe, expect, it, vi } from 'vitest';
import { createWorkbenchXhsCaches, processWorkbenchXhsDirectives } from './workbenchXhsPostProcess';

describe('Workbench XHS read-only boundary', () => {
    it('strips every write directive without creating messages or side effects', async () => {
        const addToast = vi.fn();
        const result = await processWorkbenchXhsDirectives({
            sessionId: 'wb-read-only',
            char: {
                id: 'char-1',
                name: 'Silis',
                avatar: '',
                xhsEnabled: false,
            } as any,
            userProfile: { name: 'User' } as any,
            realtimeConfig: {
                xhsMcpConfig: { enabled: false, serverUrl: '' },
            } as any,
            xhsCaches: createWorkbenchXhsCaches(),
            lastXhsNotesRef: { current: [] },
            addToast,
            rawReply: [
                'Keep reading.',
                '[[XHS_LIKE: note-1]]',
                '[[XHS_FAV: note-1]]',
                '[[XHS_COMMENT: note-1 | comment]]',
                '[[XHS_REPLY: note-1 | comment-1 | reply]]',
                '[[XHS_POST: title | body | #tag]]',
                '[[XHS_PHONE_LIKE_CURRENT]]',
            ].join('\n'),
        });

        expect(result.visibleReply).toBe('Keep reading.');
        expect(result.extraMessages).toEqual([]);
        expect(addToast).not.toHaveBeenCalled();
    });
});
