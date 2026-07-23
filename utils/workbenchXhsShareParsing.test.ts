import { describe, expect, it } from 'vitest';
import { parseWorkbenchXhsShareSegments } from './workbenchText';

describe('parseWorkbenchXhsShareSegments', () => {
    it('converts normalized chat XHS shares into cards without losing surrounding text', () => {
        expect(parseWorkbenchXhsShareSegments([
            '哦',
            '[你分享了小红书笔记]',
            '标题: 让Claude听到人的声音',
            '作者: Eve',
            '赞: 373',
            '这个挺有意思',
        ].join('\n'))).toEqual([
            { type: 'text', content: '哦' },
            {
                type: 'xhs_card',
                note: {
                    title: '让Claude听到人的声音',
                    author: 'Eve',
                    likes: 373,
                    desc: '',
                    sharedBy: '你',
                },
            },
            { type: 'text', content: '这个挺有意思' },
        ]);
    });

    it('supports consecutive shares', () => {
        const result = parseWorkbenchXhsShareSegments([
            '[你分享了小红书笔记]',
            '标题：第一篇',
            '作者：A',
            '[Silis分享了一篇小红书笔记]',
            '标题：第二篇',
            '点赞：12',
        ].join('\n'));

        expect(result.filter(segment => segment.type === 'xhs_card')).toHaveLength(2);
    });

    it('leaves incomplete share markers as text', () => {
        expect(parseWorkbenchXhsShareSegments('[你分享了小红书笔记]\n随口一提')).toEqual([
            { type: 'text', content: '[你分享了小红书笔记]\n随口一提' },
        ]);
    });
});
