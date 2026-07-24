import type { RealtimeConfig } from '../types';
import { XhsMcpClient, normalizeXhsLiteDetail } from './xhsMcpClient';
import { detectXhsShortUrl, expandShortUrl, extractXhsNoteId } from './webpageExtractor';

export interface ResolvedXhsShareLink {
    detected: boolean;
    note: Record<string, any> | null;
    detailLoaded: boolean;
    error?: string;
}

export const resolveXhsShareLink = async (
    text: string,
    realtimeConfig?: RealtimeConfig,
): Promise<ResolvedXhsShareLink> => {
    const fullNoteId = extractXhsNoteId(text);
    const shortUrl = detectXhsShortUrl(text);
    if (!fullNoteId && !shortUrl) {
        return { detected: false, note: null, detailLoaded: false };
    }

    let noteId = fullNoteId || '';
    let xsecToken = text.match(/xsec_token=([^&\s]+)/)?.[1];
    let resolvedUrl = '';
    if (!noteId && shortUrl) {
        try {
            resolvedUrl = await expandShortUrl(shortUrl);
            noteId = extractXhsNoteId(resolvedUrl) || '';
            xsecToken = xsecToken || resolvedUrl.match(/xsec_token=([^&\s]+)/)?.[1];
        } catch (error: any) {
            return {
                detected: true,
                note: null,
                detailLoaded: false,
                error: error?.message || '短链展开失败',
            };
        }
    }
    if (!noteId) {
        return {
            detected: true,
            note: null,
            detailLoaded: false,
            error: '真实链接中没有可识别的笔记 ID',
        };
    }

    const titleFromText = (text.match(/【(.+?)】/)?.[1] || '')
        .replace(/\s*[|｜]\s*小红书.*$/, '')
        .trim();
    const sourceUrl = resolvedUrl
        || `https://www.xiaohongshu.com/explore/${noteId}${xsecToken ? `?xsec_token=${xsecToken}&xsec_source=pc_share` : ''}`;
    let note: Record<string, any> = {
        noteId,
        title: titleFromText,
        desc: '',
        author: '',
        authorId: '',
        likes: 0,
        xsecToken,
        sourceUrl,
    };

    const mcpUrl = realtimeConfig?.xhsMcpConfig?.serverUrl;
    if (!mcpUrl || !realtimeConfig?.xhsMcpConfig?.enabled) {
        return { detected: true, note, detailLoaded: false };
    }

    try {
        const result = await XhsMcpClient.getNoteDetail(mcpUrl, sourceUrl, xsecToken, { loadAllComments: true });
        if (!result.success || !result.data) {
            return {
                detected: true,
                note,
                detailLoaded: false,
                error: result.error || '小红书详情接口没有返回笔记数据',
            };
        }
        const fetched = normalizeXhsLiteDetail(result.data);
        note = {
            ...note,
            ...fetched,
            noteId: fetched.noteId || note.noteId,
            title: titleFromText || fetched.title || note.title,
            xsecToken: fetched.xsecToken || xsecToken,
            sourceUrl,
        };
        return { detected: true, note, detailLoaded: true };
    } catch (error: any) {
        return {
            detected: true,
            note,
            detailLoaded: false,
            error: error?.message || '小红书详情读取失败',
        };
    }
};
