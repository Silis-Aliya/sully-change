import { describe, expect, it } from 'vitest';
import { getWorkbenchXhsOpenUrl } from '../apps/WorkbenchApp';

describe('Workbench XHS card behavior', () => {
    it('prefers the persisted source URL', () => {
        expect(getWorkbenchXhsOpenUrl({
            noteId: 'note-1',
            sourceUrl: 'https://www.xiaohongshu.com/explore/source-note',
        })).toBe('https://www.xiaohongshu.com/explore/source-note');
    });

    it('builds a tappable XHS URL from noteId and xsecToken', () => {
        expect(getWorkbenchXhsOpenUrl({
            noteId: 'note-2',
            xsecToken: 'token with spaces',
        })).toBe('https://www.xiaohongshu.com/explore/note-2?xsec_token=token%20with%20spaces&xsec_source=pc_feed');
    });

    it('returns an empty URL when the card has no locator', () => {
        expect(getWorkbenchXhsOpenUrl({ title: '只有标题' })).toBe('');
    });
});
