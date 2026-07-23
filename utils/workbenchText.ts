export const normalizeWorkbenchLineBreaks = (content: string) => content
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/\r\n|\r|\u2028|\u2029/g, '\n')
    .replace(/&lt;\s*br\s*\/?\s*&gt;/gi, '\n')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n');

export const cleanWorkbenchContent = (content: string) => normalizeWorkbenchLineBreaks(content)
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/g;
const SENTENCE_END_RE = /([。！？!?]+[」』”’"')）\]]*)/g;
const SOFT_BREAK_RE = /([，、；;：:]+[」』”’"')）\]]*)/g;
const CONNECTIVE_BREAK_RE = /(如果|要是|或者|还是|然后|但是|不过|所以|因为|就是|可以|先|再)/g;

const cjkDensity = (text: string) => {
    const cjk = text.match(CJK_RE)?.length || 0;
    return text.length ? cjk / text.length : 0;
};

const splitByMarkedBreaks = (text: string, markerRe: RegExp) => text
    .replace(markerRe, '$1\n')
    .split('\n')
    .map(part => part.trim())
    .filter(Boolean);

const splitLongCjkSegment = (text: string, maxChars: number) => {
    const result: string[] = [];
    let rest = text.trim();
    while (rest.length > maxChars) {
        const windowText = rest.slice(0, maxChars + 1);
        const softBreaks = [...windowText.matchAll(SOFT_BREAK_RE)];
        const lastSoftBreak = softBreaks.length ? softBreaks[softBreaks.length - 1] : undefined;
        const connectiveBreaks = [...windowText.matchAll(CONNECTIVE_BREAK_RE)];
        const lastConnectiveBreak = connectiveBreaks.length ? connectiveBreaks[connectiveBreaks.length - 1] : undefined;
        const minBreakAt = Math.floor(maxChars * 0.45);
        const breakAt = lastSoftBreak && typeof lastSoftBreak.index === 'number' && lastSoftBreak.index >= minBreakAt
            ? lastSoftBreak.index + lastSoftBreak[0].length
            : lastConnectiveBreak && typeof lastConnectiveBreak.index === 'number' && lastConnectiveBreak.index >= minBreakAt
                ? lastConnectiveBreak.index
            : maxChars;
        result.push(rest.slice(0, breakAt).trim());
        rest = rest.slice(breakAt).trim();
    }
    if (rest) result.push(rest);
    return result;
};

export const splitWorkbenchCharacterTextChunks = (chunks: string[], maxChars = 54): string[] => {
    const result: string[] = [];
    for (const chunk of chunks) {
        const text = chunk.trim();
        if (!text) continue;
        if (text.length <= maxChars || cjkDensity(text) < 0.45) {
            result.push(text);
            continue;
        }

        const sentenceParts = splitByMarkedBreaks(text, SENTENCE_END_RE);
        const baseParts = sentenceParts.length > 1 ? sentenceParts : splitByMarkedBreaks(text, SOFT_BREAK_RE);
        for (const part of baseParts) {
            if (part.length <= maxChars) {
                result.push(part);
            } else {
                result.push(...splitLongCjkSegment(part, maxChars));
            }
        }
    }
    return result;
};

export const stripWorkbenchAssistantMention = (content: string, mentionRe: RegExp) => {
    const withoutMentionOnlyLines = normalizeWorkbenchLineBreaks(content)
        .split('\n')
        .filter(line => {
            const trimmed = line.trim();
            return !(trimmed.startsWith('@') && mentionRe.test(trimmed));
        })
        .join('\n');

    return withoutMentionOnlyLines
        .replace(mentionRe, '$1')
        .replace(/[ \t\f\v]{2,}/g, ' ')
        .replace(/[ \t\f\v]+\n/g, '\n')
        .replace(/\n[ \t\f\v]+/g, '\n')
        .trim();
};
