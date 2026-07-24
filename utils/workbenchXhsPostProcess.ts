import type { CharacterProfile, RealtimeConfig, UserProfile, WorkbenchMessage } from '../types';
import type { XhsNote } from './realtimeContext';
import {
    runXhsBrowse,
    runXhsDetail,
    runXhsMyProfile,
    runXhsSearch,
    type XhsCaches,
} from './agenticTools';
import {
    runXhsPhoneBrowse,
    runXhsPhoneMyProfile,
    runXhsPhoneOpenDetail,
    runXhsPhoneSearch,
    runXhsPhoneShareCurrent,
    type XhsPhoneActivityResult,
} from './xhsPhoneChannel';

type ToastType = 'success' | 'error' | 'info';

export const createWorkbenchXhsCaches = (): XhsCaches => ({
    xsecTokenCache: new Map(),
    noteTitleCache: new Map(),
    commentUserIdCache: new Map(),
    commentAuthorNameCache: new Map(),
    commentParentIdCache: new Map(),
});

export interface WorkbenchXhsPostProcessArgs {
    rawReply: string;
    sessionId: string;
    char: CharacterProfile;
    userProfile: UserProfile;
    realtimeConfig?: RealtimeConfig;
    xhsCaches: XhsCaches;
    lastXhsNotesRef: { current: XhsNote[] };
    addToast?: (message: string, type?: ToastType) => void;
}

export interface WorkbenchXhsPostProcessResult {
    visibleReply: string;
    extraMessages: WorkbenchMessage[];
}

const makeMessageId = () => `wbxhs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const stripXhsDirectives = (content: string) => content
    .replace(/\[\[XHS_PHONE_SEARCH:\s*.*?\]\]/gs, '')
    .replace(/\[\[XHS_PHONE_(?:BROWSE|OPEN_DETAIL|LIKE_CURRENT|SHARE_CURRENT|MY_PROFILE)\]\]/g, '')
    .replace(/\[\[XHS_SEARCH:\s*.*?\]\]/gs, '')
    .replace(/\[\[XHS_BROWSE(?::\s*.*?)?\]\]/gs, '')
    .replace(/\[\[XHS_MY_PROFILE\]\]/g, '')
    .replace(/\[\[XHS_DETAIL:\s*.*?\]\]/gs, '')
    .replace(/\[\[XHS_SHARE:\s*\d+\]\]/g, '')
    .replace(/\[\[XHS_LIKE:\s*.*?\]\]/gs, '')
    .replace(/\[\[XHS_FAV:\s*.*?\]\]/gs, '')
    .replace(/\[\[XHS_COMMENT:\s*.*?\]\]/gs, '')
    .replace(/\[\[XHS_REPLY:\s*.*?\]\]/gs, '')
    .replace(/\[\[XHS_POST:\s*.*?\]\]/gs, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const messageBase = (
    args: WorkbenchXhsPostProcessArgs,
    type: WorkbenchMessage['type'],
    content: string,
    metadata: Record<string, any> = {},
): WorkbenchMessage => ({
    id: makeMessageId(),
    sessionId: args.sessionId,
    role: 'character',
    kind: 'consult',
    type,
    mode: 'sully',
    content,
    createdAt: Date.now(),
    status: 'sent',
    metadata: {
        speakerName: args.char.name,
        speakerAvatar: args.char.avatar || '',
        characterId: args.char.id,
        source: 'workbench_xhs',
        ...metadata,
    },
});

const noteMessage = (args: WorkbenchXhsPostProcessArgs, note: XhsNote): WorkbenchMessage =>
    messageBase(args, 'xhs_card', note.title || '小红书笔记', {
        xhsNote: note,
        sharedBy: 'character',
    });

const textMessage = (args: WorkbenchXhsPostProcessArgs, content: string): WorkbenchMessage =>
    messageBase(args, 'text', content);

const phoneResultToNote = (
    result: Extract<XhsPhoneActivityResult, { ok: true }>,
    fallbackTitle: string,
): XhsNote & { sourceUrl?: string; comments?: any[] } => ({
    noteId: result.shareLink || `${result.mode}_${Date.now()}`,
    title: result.keyword ? `小红书：${result.keyword}` : fallbackTitle,
    desc: result.observationText || result.clipboardText || '',
    likes: 0,
    author: '小红书手机通道',
    authorId: '',
    sourceUrl: result.shareLink,
    comments: [],
});

const addTopNoteCards = (
    args: WorkbenchXhsPostProcessArgs,
    messages: WorkbenchMessage[],
    notes: XhsNote[],
    limit = 3,
) => {
    for (const note of notes.slice(0, limit)) {
        messages.push(noteMessage(args, note));
    }
};

export const processWorkbenchXhsDirectives = async (
    args: WorkbenchXhsPostProcessArgs,
): Promise<WorkbenchXhsPostProcessResult> => {
    const raw = args.rawReply || '';
    const extraMessages: WorkbenchMessage[] = [];
    const hasExplicitShare = /\[\[XHS_SHARE:\s*\d+\]\]/.test(raw);
    const ctx = {
        char: args.char,
        userProfile: args.userProfile,
        realtimeConfig: args.realtimeConfig,
        xhsCaches: args.xhsCaches,
        lastXhsNotesRef: args.lastXhsNotesRef,
        onProgress: (_channel: 'xhs' | 'diary', text: string) => args.addToast?.(text, 'info'),
    };

    const phoneSearchMatches = Array.from(raw.matchAll(/\[\[XHS_PHONE_SEARCH:\s*(.+?)\]\]/gs));
    for (const match of phoneSearchMatches) {
        const keyword = match[1].trim();
        if (!keyword) continue;
        args.addToast?.(`正在用手机小红书搜索：${keyword}`, 'info');
        const result = await runXhsPhoneSearch(args.realtimeConfig?.xhsPhoneConfig, keyword);
        if (result.ok) {
            extraMessages.push(noteMessage(args, phoneResultToNote(result, '小红书手机搜索结果')));
        } else {
            extraMessages.push(textMessage(args, `小红书手机搜索失败：${result.message}`));
        }
    }

    const runPhoneCurrent = async (
        token: string,
        label: string,
        runner: () => Promise<XhsPhoneActivityResult>,
        makeCard = false,
    ) => {
        if (!raw.includes(token)) return;
        args.addToast?.(`正在${label}`, 'info');
        const result = await runner();
        if (result.ok) {
            if (makeCard || result.shareLink) {
                extraMessages.push(noteMessage(args, phoneResultToNote(result, label)));
            } else {
                extraMessages.push(textMessage(args, result.observationText || `${label}完成`));
            }
        } else {
            extraMessages.push(textMessage(args, `${label}失败：${result.message}`));
        }
    };

    await runPhoneCurrent('[[XHS_PHONE_BROWSE]]', '浏览小红书', () => runXhsPhoneBrowse(args.realtimeConfig?.xhsPhoneConfig), true);
    await runPhoneCurrent('[[XHS_PHONE_OPEN_DETAIL]]', '打开当前小红书笔记', () => runXhsPhoneOpenDetail(args.realtimeConfig?.xhsPhoneConfig), true);
    await runPhoneCurrent('[[XHS_PHONE_SHARE_CURRENT]]', '分享当前小红书笔记', () => runXhsPhoneShareCurrent(args.realtimeConfig?.xhsPhoneConfig), true);
    await runPhoneCurrent('[[XHS_PHONE_MY_PROFILE]]', '查看小红书主页', () => runXhsPhoneMyProfile(args.realtimeConfig?.xhsPhoneConfig), true);

    const searchMatches = Array.from(raw.matchAll(/\[\[XHS_SEARCH:\s*(.+?)\]\]/gs));
    for (const match of searchMatches) {
        const keyword = match[1].trim();
        if (!keyword) continue;
        args.addToast?.(`正在小红书搜索：${keyword}`, 'info');
        const result = await runXhsSearch({ keyword }, ctx);
        if (result.ok) {
            if (!hasExplicitShare) addTopNoteCards(args, extraMessages, result.notes);
        } else if (result.reason === 'not_enabled') {
            extraMessages.push(textMessage(args, '小红书 MCP 还没有对这个角色开启。'));
        } else {
            extraMessages.push(textMessage(args, `没有搜到「${keyword}」相关的小红书笔记。`));
        }
    }

    const browseMatches = Array.from(raw.matchAll(/\[\[XHS_BROWSE(?::\s*(.+?))?\]\]/gs));
    for (const match of browseMatches) {
        const category = match[1]?.trim();
        args.addToast?.('正在浏览小红书', 'info');
        const result = await runXhsBrowse({ category }, ctx);
        if (result.ok) {
            if (!hasExplicitShare) addTopNoteCards(args, extraMessages, result.notes);
        } else if (result.reason === 'not_enabled') {
            extraMessages.push(textMessage(args, '小红书 MCP 还没有对这个角色开启。'));
        } else {
            extraMessages.push(textMessage(args, '这次没有刷到可用的小红书笔记。'));
        }
    }

    if (raw.includes('[[XHS_MY_PROFILE]]')) {
        args.addToast?.('正在读取小红书主页', 'info');
        const result = await runXhsMyProfile({}, ctx);
        if (result.ok) {
            if (!hasExplicitShare) addTopNoteCards(args, extraMessages, result.notes);
            if (!result.notes.length) {
                extraMessages.push(textMessage(args, result.feedsStr || result.profileStr || '小红书主页暂时没有可展示的笔记。'));
            }
        } else {
            extraMessages.push(textMessage(args, '小红书主页读取失败，请检查 MCP 登录身份。'));
        }
    }

    const detailMatches = Array.from(raw.matchAll(/\[\[XHS_DETAIL:\s*(.+?)\]\]/gs));
    for (const match of detailMatches) {
        const noteId = match[1].trim();
        if (!noteId) continue;
        args.addToast?.('正在读取小红书笔记详情', 'info');
        const result = await runXhsDetail({ noteId }, ctx);
        if (result.ok) {
            extraMessages.push(textMessage(args, result.detailText.slice(0, 1800)));
        } else {
            extraMessages.push(textMessage(args, '小红书笔记详情读取失败，请先搜索或分享这条笔记。'));
        }
    }

    const shareMatches = Array.from(raw.matchAll(/\[\[XHS_SHARE:\s*(\d+)\]\]/g));
    for (const match of shareMatches) {
        const idx = Number(match[1]) - 1;
        const note = args.lastXhsNotesRef.current[idx];
        if (note) {
            extraMessages.push(noteMessage(args, note));
        }
    }

    return {
        visibleReply: stripXhsDirectives(raw),
        extraMessages,
    };
};
