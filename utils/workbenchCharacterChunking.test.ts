import { describe, expect, it } from 'vitest';
import { splitWorkbenchCharacterTextChunks } from './workbenchText';

describe('workbench character chunking', () => {
    it('keeps short chunks intact', () => {
        expect(splitWorkbenchCharacterTextChunks(['先刷新一下 Code 区'])).toEqual(['先刷新一下 Code 区']);
    });

    it('splits long Chinese replies on sentence punctuation', () => {
        expect(splitWorkbenchCharacterTextChunks([
            '英区直连一般没问题。你可以先刷新 Code 区试试。如果还不行再退出重进。',
        ], 18)).toEqual([
            '英区直连一般没问题。',
            '你可以先刷新 Code 区试试。',
            '如果还不行再退出重进。',
        ]);
    });

    it('falls back to length splitting for long Chinese replies without punctuation', () => {
        const text = '可能是codex那边服务本身在抖你刷新一下code区试试或者退出重进如果还不行就是服务端问题';
        const chunks = splitWorkbenchCharacterTextChunks([text], 22);

        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks.join('')).toBe(text);
    });

    it('splits the workbench no-punctuation service-status style reply', () => {
        const text = '英区直连应该没问题的可能是codex那边服务本身在抖你刷新一下code区试试或者退出重进如果还不行的话就是他们服务端的问题跟你网络没关系';
        const chunks = splitWorkbenchCharacterTextChunks([text]);

        expect(chunks).toEqual([
            '英区直连应该没问题的可能是codex那边服务本身在抖你刷新一下code区试试或者退出重进如果还不行的话',
            '就是他们服务端的问题跟你网络没关系',
        ]);
    });

    it('does not split dense non-CJK technical output', () => {
        const text = 'Error: bridge request failed because ECONNRESET occurred while reading the response stream';

        expect(splitWorkbenchCharacterTextChunks([text], 22)).toEqual([text]);
    });
});
