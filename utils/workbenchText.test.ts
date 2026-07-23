import { describe, expect, it } from 'vitest';
import {
    cleanWorkbenchContent,
    normalizeWorkbenchLineBreaks,
    stripWorkbenchAssistantMention,
} from './workbenchText';

const MENTION_RE = /(^|[\s，。！？、:：])@(AI助理|ai助理|Code|Codex|CLI|代码助理|电脑助理)(?=$|[\s，。！？、:：])/i;

describe('workbench text formatting', () => {
    it('normalizes escaped and html line breaks', () => {
        expect(normalizeWorkbenchLineBreaks('第一段\\n第二段<br>第三段')).toBe('第一段\n第二段\n第三段');
    });

    it('collapses excessive blank lines without flattening paragraphs', () => {
        expect(cleanWorkbenchContent('第一段\\n\\n\\n第二段')).toBe('第一段\n\n第二段');
    });

    it('strips assistant mention without collapsing newlines', () => {
        expect(stripWorkbenchAssistantMention('第一段\n@Codex\n第二段', MENTION_RE)).toBe('第一段\n第二段');
    });
});
