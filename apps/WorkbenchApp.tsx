import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { ChatParser } from '../utils/chatParser';
import { processImage } from '../utils/file';
import type { Emoji, EmojiCategory, WorkbenchArtifact, WorkbenchBridgeConfig, WorkbenchMemory, WorkbenchMessage, WorkbenchMode, WorkbenchOfficialUsage, WorkbenchSession, WorkbenchSummary } from '../types';
import {
    DEFAULT_WORKBENCH_CONFIG,
    buildWorkbenchCurrentProgressContext,
    buildWorkbenchTaskIndex,
    buildWorkbenchSummaryText,
    consultCharacterFromWorkbench,
    extractWorkbenchCodeMemories,
    downloadWorkbenchArtifact,
    fetchWorkbenchModels,
    fetchWorkbenchFallbackModels,
    fetchWorkbenchOfficialUsage,
    loadWorkbenchBridgeConfig,
    saveWorkbenchBridgeConfig,
    sendWorkbenchBridgeMessage,
    sendWorkbenchFallbackMessage,
    summarizeWorkbenchProgressCardWithBridge,
    summarizeWorkbenchProgressCardWithCharacter,
    testWorkbenchBridge,
} from '../utils/workbenchBridge';
import type { WorkbenchModelOption } from '../utils/workbenchBridge';

type WorkbenchSpace = 'work' | 'inspiration';
type WorkbenchConversationItem = WorkbenchSession & { messageCount: number };

const WORKBENCH_SPACES: Record<WorkbenchSpace, {
    sessionId: string;
    title: string;
    emptyTitle: string;
    emptyDescription: string;
}> = {
    work: {
        sessionId: 'main',
        title: '工作区',
        emptyTitle: '从这里安排电脑上的工作',
        emptyDescription: '开关关闭时交给本机 CLI 或远程电脑；打开时由选中的角色一起工作。',
    },
    inspiration: {
        sessionId: 'inspiration',
        title: '灵感区',
        emptyTitle: '先把想法和代码草稿放在这里',
        emptyDescription: '电脑不在线时也可以整理需求、写简单代码和记灵感；之后再切回工作区执行。',
    },
};

const makeId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const getSessionSpace = (session: WorkbenchSession): WorkbenchSpace => {
    if (session.space === 'inspiration' || session.id === 'inspiration' || session.id.startsWith('inspiration_')) return 'inspiration';
    return 'work';
};

const createWorkbenchSession = async (_space: WorkbenchSpace, title = '新对话'): Promise<WorkbenchSession> => {
    const now = Date.now();
    const id = `code_${now}_${Math.random().toString(36).slice(2, 8)}`;
    const session = { id, title, createdAt: now, updatedAt: now };
    await DB.saveWorkbenchSession(session);
    return session;
};

const deriveConversationTitle = (text: string) => {
    const cleaned = text
        .replace(/```[\s\S]*?```/g, '')
        .replace(/[#*_`>\[\]{}()]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleaned) return '新对话';
    return cleaned.length > 18 ? `${cleaned.slice(0, 18)}…` : cleaned;
};

const roleLabel = (m: WorkbenchMessage) => {
    if (m.role === 'user') return 'You';
    if (m.role === 'sully' || m.role === 'character') return m.metadata?.speakerName || '角色';
    if (m.kind === 'error') return 'SYSTEM ERROR';
    if (m.role === 'system') return 'System';
    return m.metadata?.speakerName || m.metadata?.displayName || 'CLI';
};

const parseProgressCard = (content: string) => {
    const fields: Record<string, string> = {};
    const header = content.match(/\[Code\s*进度(?:-[^\]]+)?\]/i)?.[0];
    if (header) fields.__title = header.replace(/^\[|\]$/g, '');
    let currentKey = '';
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || /^\[Code\s*进度(?:-[^\]]+)?\]$/i.test(line)) continue;
        const match = line.match(/^(任务|状态|决策|进度|待办|备注)[：:]\s*(.*)$/);
        if (match) {
            currentKey = match[1];
            fields[currentKey] = match[2].trim();
        } else if (currentKey) {
            fields[currentKey] = `${fields[currentKey]}\n${line}`.trim();
        }
    }
    return fields;
};

const profileLabel = (profile?: WorkbenchBridgeConfig['modelProfile']) => {
    if (profile === 'fast') return '快速';
    if (profile === 'deep') return '深度';
    return '均衡';
};

const agentDisplayName = (config: WorkbenchBridgeConfig, agent?: string, displayName?: string) => {
    if (displayName?.trim()) return displayName.trim();
    const resolved = (agent || config.defaultAgent || '').toLowerCase();
    if (resolved === 'codex') return 'Codex';
    if (resolved === 'claude') return 'Claude Code';
    return 'CLI';
};

const estimateMessageTokens = (item: WorkbenchMessage) => {
    const meta = item.metadata || {};
    const usage = meta.usage || {};
    const known = meta.usageTokens ?? meta.tokens ?? usage.total_tokens ?? usage.totalTokens;
    if (typeof known === 'number' && Number.isFinite(known)) return Math.max(0, Math.round(known));
    return Math.max(1, Math.ceil(item.content.length / 2));
};

const startOfWeek = (now: Date) => {
    const d = new Date(now);
    const day = d.getDay() || 7;
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - day + 1);
    return d.getTime();
};

const startOfMonth = (now: Date) => {
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    return d.getTime();
};

const buildUsageStats = (items: WorkbenchMessage[]) => {
    const now = new Date();
    const weekStart = startOfWeek(now);
    const monthStart = startOfMonth(now);
    return items.reduce(
        (stats, item) => {
            const tokens = estimateMessageTokens(item);
            stats.current += tokens;
            stats.total += tokens;
            if (item.createdAt >= weekStart) stats.week += tokens;
            if (item.createdAt >= monthStart) stats.month += tokens;
            return stats;
        },
        { current: 0, week: 0, month: 0, total: 0 }
    );
};

const formatTokens = (value: number) => `${value.toLocaleString('zh-CN')} tokens`;

const cleanWorkbenchContent = (content: string) => content.replace(/\n{3,}/g, '\n\n').trim();
const codeMemoryKey = (content: string) => content
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .slice(0, 24);
const sanitizeWorkbenchReply = (content: string) => ChatParser.sanitize(content, { keepCitations: true })
    .replace(/^\s*\[当前\s*Code\s*对话\s*\/[^\]]+\]\s*/i, '')
    .replace(/\[(?:用户|角色|AI\s*助手)\s+[^\]\n]{1,80}\]\s*/gi, '')
    .replace(/<\s*\/?\s*[语語]音[^>]*>/g, '')
    .replace(/<#[\s\S]*?#>/g, '')
    .replace(/\[\[(?!(?:SEND_EMOJI|QUOTE|引用)[：:])[\s\S]*?\]\]/g, '')
    .replace(/\[[^\[\]\n]{0,24}发送了表情包[：:][^\]\n]{1,120}\]/g, '')
    .trim();
const SEND_EMOJI_RE = /\[\[SEND_EMOJI:\s*([^\]]+?)\s*\]\]/g;
const QUOTE_RE_DOUBLE = /\[\[(?:QU[OA]TE|引用)[：:]\s*([\s\S]*?)\]\]/;
const QUOTE_RE_SINGLE = /\[(?:QU[OA]TE|引用)[：:]\s*([^\]]*)\]/;
const REPLY_RE_CN = /\[回复\s*[""“]([^""”]*?)[""”](?:\.{0,3})\]\s*[：:]?\s*/;
const QUOTE_RE_NL = /\[[^\[\]\n「」]{0,24}引用了[^\[\]\n「」]{0,24}「([^」\n]*?)」[^\[\]\n]{0,24}\]\s*/;
const QUOTE_CLEAN_DOUBLE = /\[\[(?:QU[OA]TE|引用)[：:][\s\S]*?\]\]/g;
const QUOTE_CLEAN_SINGLE = /\[(?:QU[OA]TE|引用)[：:][^\]]*\]/g;
const REPLY_CLEAN_CN = /\[回复\s*[""“][^""”]*?[""”](?:\.{0,3})\]\s*[：:]?\s*/g;
const QUOTE_CLEAN_NL = /\[[^\[\]\n「」]{0,24}引用了[^\[\]\n「」]{0,24}「[^」\n]*?」[^\[\]\n]{0,24}\]\s*/g;

const stripWorkbenchQuoteTags = (content: string) => content
    .replace(QUOTE_CLEAN_DOUBLE, '')
    .replace(QUOTE_CLEAN_SINGLE, '')
    .replace(REPLY_CLEAN_CN, '')
    .replace(QUOTE_CLEAN_NL, '')
    .trim();

const renderWorkbenchContent = (content: string, emojiMap: Map<string, Emoji>) => {
    const text = cleanWorkbenchContent(content);
    const nodes: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    SEND_EMOJI_RE.lastIndex = 0;
    while ((match = SEND_EMOJI_RE.exec(text))) {
        const before = text.slice(lastIndex, match.index);
        if (before) nodes.push(<React.Fragment key={`t-${lastIndex}`}>{before}</React.Fragment>);
        const name = match[1].trim();
        const emoji = emojiMap.get(name);
        nodes.push(emoji ? (
            <img
                key={`e-${match.index}`}
                src={emoji.url}
                alt={name}
                title={name}
                loading="lazy"
                decoding="async"
                className="my-1 block max-h-32 max-w-32 rounded-xl object-contain"
            />
        ) : (
            <span key={`e-${match.index}`}>{match[0]}</span>
        ));
        lastIndex = match.index + match[0].length;
    }
    const rest = text.slice(lastIndex);
    if (rest) nodes.push(<React.Fragment key={`t-${lastIndex}`}>{rest}</React.Fragment>);
    return nodes.length ? nodes : text;
};

const renderProgressCard = (fields: Record<string, string>) => (
    <div className="min-w-[220px] max-w-full rounded-2xl border border-violet-100 bg-[#F3F0FB] p-3 shadow-sm">
        <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
            <span className="h-7 w-7 rounded-lg bg-slate-900 text-white flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 6h8M8 10h8M8 14h5" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
                </svg>
            </span>
            {fields.__title || 'Code 进度'}
        </div>
        <div className="mt-3 space-y-2">
            {(['任务', '状态', '决策', '进度', '待办', '备注'] as const).map(key => (
                <div key={key} className="grid grid-cols-[2.75rem_1fr] gap-2 text-xs leading-relaxed">
                    <span className="font-semibold text-slate-400">{key}</span>
                    <span className="text-slate-700">{fields[key] || '暂无'}</span>
                </div>
            ))}
        </div>
    </div>
);

const formatFileSize = (size: number) => size >= 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1)} MB`
    : size >= 1024 ? `${Math.round(size / 1024)} KB` : `${size || 0} B`;

const renderWorkbenchMessageContent = (
    message: WorkbenchMessage,
    emojiMap: Map<string, Emoji>,
    onDownload?: (artifact: WorkbenchArtifact) => void,
) => {
    if (message.kind === 'error') return 'SYSTEM ERROR';
    const progressCard = message.metadata?.progressCard ? parseProgressCard(message.content) : null;
    if (progressCard) return renderProgressCard(progressCard);
    if (message.type === 'emoji') {
        const name = message.metadata?.emojiName || '表情';
        return (
            <img
                src={message.content}
                alt={name}
                title={name}
                loading="lazy"
                decoding="async"
                className="sully-emoji-msg max-w-[var(--sully-emoji-size,96px)] max-h-[var(--sully-emoji-size,96px)] w-auto h-auto object-contain hover:scale-105 transition-transform drop-shadow-md active:scale-95"
            />
        );
    }
    if (message.type === 'file' && message.metadata?.artifact) {
        const artifact = message.metadata.artifact as WorkbenchArtifact;
        return (
            <span className="block min-w-[220px] max-w-full">
                <span className="flex items-center gap-3">
                    <span className="h-10 w-10 shrink-0 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14 2v6h6M8 13h8M8 17h5" />
                        </svg>
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-slate-800">{artifact.name}</span>
                        <span className="block truncate text-[11px] text-slate-400">{formatFileSize(artifact.size)}{artifact.relativePath ? ` · ${artifact.relativePath}` : ''}</span>
                    </span>
                    <span
                        role="button"
                        tabIndex={0}
                        title="下载文件"
                        onClick={event => { event.stopPropagation(); onDownload?.(artifact); }}
                        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') onDownload?.(artifact); }}
                        className="h-9 w-9 shrink-0 rounded-lg border border-slate-200 bg-white text-slate-600 flex items-center justify-center active:scale-95"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
                        </svg>
                    </span>
                </span>
                {artifact.preview && <code className="mt-3 block max-h-28 overflow-hidden whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">{artifact.preview.slice(0, 1200)}</code>}
            </span>
        );
    }
    return renderWorkbenchContent(message.content, emojiMap);
};

const workbenchMessageText = (message: WorkbenchMessage) => (
    message.type === 'emoji'
        ? `[表情: ${message.metadata?.emojiName || '表情包'}]`
        : message.content
);

const IconButton: React.FC<{
    label: string;
    onClick: () => void;
    children: React.ReactNode;
    className?: string;
}> = ({ label, onClick, children, className = '' }) => (
    <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={label}
        className={`h-9 w-9 shrink-0 rounded-lg border border-slate-200 bg-white text-slate-500 flex items-center justify-center active:scale-95 hover:bg-slate-50 ${className}`}
    >
        {children}
    </button>
);

const WorkbenchMessageRow: React.FC<{
    message: WorkbenchMessage;
    avatar: string;
    emojiMap: Map<string, Emoji>;
    selected: boolean;
    selectionMode: boolean;
    onLongPress: (message: WorkbenchMessage) => void;
    onToggleSelect: (messageId: string) => void;
}> = ({ message, avatar, emojiMap, selected, selectionMode, onLongPress, onToggleSelect }) => {
    const timerRef = useRef<number | null>(null);
    const movedRef = useRef(false);
    const isUser = message.role === 'user';
    const isEmojiOnly = message.type === 'emoji';

    const clearLongPress = () => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    const startLongPress = () => {
        movedRef.current = false;
        clearLongPress();
        timerRef.current = window.setTimeout(() => {
            if (!movedRef.current) onLongPress(message);
            clearLongPress();
        }, 520);
    };

    const activateMessage = () => {
        if (selectionMode) onToggleSelect(message.id);
    };

    return (
        <div className={`flex gap-2.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
            {!isUser && (avatar ? (
                <img
                    src={avatar}
                    alt="avatar"
                    loading="lazy"
                    decoding="async"
                    className="mt-5 h-8 w-8 rounded-full object-cover shadow-sm ring-1 ring-black/5 shrink-0"
                />
            ) : (
                <div className={`mt-5 h-8 w-8 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${(message.role === 'sully' || message.role === 'character') ? 'bg-violet-100 text-violet-700' : message.kind === 'error' ? 'bg-rose-100 text-rose-700' : 'bg-slate-900 text-white'}`}>
                    {(message.role === 'sully' || message.role === 'character') ? String(message.metadata?.speakerName || '角色').slice(0, 1) : message.kind === 'error' ? '!' : 'C'}
                </div>
            ))}
            {selectionMode && isUser && (
                <button
                    type="button"
                    onClick={() => onToggleSelect(message.id)}
                    className={`mt-9 h-5 w-5 rounded-full border flex items-center justify-center shrink-0 ${selected ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-300 text-transparent'}`}
                    aria-label={selected ? '取消选择' : '选择消息'}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" />
                    </svg>
                </button>
            )}
            <div className={`max-w-[72%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
                <div className={`text-[11px] mb-1 ${isUser ? 'text-slate-400 pr-1' : 'text-slate-500'}`}>
                    {roleLabel(message)} · {new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </div>
                <button
                    type="button"
                    style={isEmojiOnly ? {
                        appearance: 'none',
                        WebkitAppearance: 'none',
                        background: 'transparent',
                        backgroundColor: 'transparent',
                        border: 0,
                        boxShadow: 'none',
                        padding: 0,
                    } : undefined}
                    onClick={activateMessage}
                    onPointerDown={startLongPress}
                    onPointerMove={() => { movedRef.current = true; clearLongPress(); }}
                    onPointerUp={clearLongPress}
                    onPointerCancel={clearLongPress}
                    onPointerLeave={clearLongPress}
                    onContextMenu={e => {
                        e.preventDefault();
                        onLongPress(message);
                    }}
                    className={`text-left text-[15px] leading-relaxed whitespace-pre-wrap break-all transition-transform active:scale-[0.98] ${
                        isEmojiOnly
                            ? '!bg-transparent !p-0 !shadow-none !border-0 !rounded-none'
                            : isUser
                                ? 'rounded-2xl rounded-br-sm bg-[#EEEAF8] text-slate-900 shadow-sm px-5 py-3'
                                : message.kind === 'error'
                                    ? 'rounded-2xl rounded-bl-sm bg-rose-50 text-rose-700 border border-rose-100 shadow-sm px-5 py-3'
                                    : 'rounded-2xl rounded-bl-sm bg-white text-slate-700 border border-black/5 shadow-sm px-5 py-3'
                    } ${selected ? 'ring-2 ring-emerald-400 ring-offset-2' : ''}`}
                >
                    {message.replyTo && !isEmojiOnly && (
                        <span className={`mb-2 block rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug ${
                            isUser ? 'border-black/10 bg-white/65 text-slate-600' : 'border-slate-200 bg-slate-50 text-slate-500'
                        }`}>
                            <span className="block font-semibold">{message.replyTo.name}</span>
                            <span className="line-clamp-2">{message.replyTo.content}</span>
                        </span>
                    )}
                    {renderWorkbenchMessageContent(message, emojiMap)}
                </button>
            </div>
            {selectionMode && !isUser && (
                <button
                    type="button"
                    onClick={() => onToggleSelect(message.id)}
                    className={`mt-9 h-5 w-5 rounded-full border flex items-center justify-center shrink-0 ${selected ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-300 text-transparent'}`}
                    aria-label={selected ? '取消选择' : '选择消息'}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" />
                    </svg>
                </button>
            )}
        </div>
    );
};

const ensureCharacterProgressCardHeader = (card: string, _charName: string) => {
    const trimmed = card.trim();
    if (/^\[Code 进度-[^\]]+\]/.test(trimmed)) return trimmed.replace(/^\[Code 进度-[^\]]+\]/, '[Code 进度]');
    if (/^\[Code 进度\]/.test(trimmed)) return trimmed;
    return `[Code 进度]\n${trimmed}`;
};

const WorkbenchIndex: React.FC<{
    activeSessionId?: string;
    conversations: WorkbenchConversationItem[];
    usageText: string;
    open: boolean;
    canExecute: boolean;
    onNewConversation: () => void;
    onSelectConversation: (sessionId: string) => void;
    onRenameConversation: (sessionId: string, title: string) => void;
    onDeleteConversation: (sessionId: string) => void;
}> = ({ activeSessionId, conversations, usageText, open, canExecute, onNewConversation, onSelectConversation, onRenameConversation, onDeleteConversation }) => {

    return (
        <aside
            className={`workbench-index-scroll shrink-0 border-l border-white/70 bg-white/34 backdrop-blur-2xl overflow-y-auto text-slate-700 transition-[width,min-width,opacity] duration-200 ${open ? 'w-[38%] min-w-[150px] max-w-[240px] opacity-100' : 'w-0 min-w-0 opacity-0 pointer-events-none'}`}
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
            <div className="px-3 py-4 space-y-4">
                <div className="flex items-center gap-2">
                    <button className="min-w-0 flex items-center gap-1.5 text-left active:scale-[0.99]" aria-label="工作区索引">
                        <span className="text-base font-semibold text-slate-800 truncate">Code</span>
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
                        </svg>
                    </button>
                </div>

                <div className="border-b border-slate-200/55 pb-3">
                    <div className="flex items-center gap-2 rounded-lg bg-slate-200/70 px-2 py-2">
                        <span className={`h-2 w-2 rounded-full ${canExecute ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                        <span className="text-xs font-semibold text-slate-700">{canExecute ? '电脑已连接' : '仅聊天'}</span>
                    </div>
                </div>


                <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2 px-1">
                        <div className="text-[11px] font-semibold text-slate-400">对话</div>
                        <button
                            type="button"
                            onClick={onNewConversation}
                            className="h-6 w-6 rounded-md flex items-center justify-center text-slate-400 hover:bg-white/60 hover:text-slate-700 active:scale-95"
                            aria-label="新对话"
                            title="新对话"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
                            </svg>
                        </button>
                    </div>
                    {conversations.map((item, index) => (
                        <div
                            key={item.id}
                            className={`group flex items-center gap-1 rounded-lg px-1.5 py-1 ${item.id === activeSessionId ? 'bg-slate-200/80 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.45)]' : 'hover:bg-white/50'}`}
                        >
                            <input
                                value={item.title}
                                placeholder={`#${index + 1}`}
                                onFocus={() => onSelectConversation(item.id)}
                                onChange={e => onRenameConversation(item.id, e.target.value)}
                                className="min-w-0 flex-1 bg-transparent px-1 py-0.5 text-xs font-medium text-slate-700 placeholder:text-slate-300 outline-none truncate"
                                aria-label="对话名称"
                            />
                            <button
                                type="button"
                                onClick={() => onDeleteConversation(item.id)}
                                className="h-6 w-6 shrink-0 rounded-md flex items-center justify-center text-slate-400 hover:bg-rose-50 hover:text-rose-500 active:scale-95"
                                aria-label="删除对话"
                                title="删除对话"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 6 6 18M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    ))}
                </div>

                <div className="pt-1 text-[10px] text-slate-400 px-1 truncate">
                    {usageText}
                </div>
            </div>
        </aside>
    );
};

const WorkbenchApp: React.FC = () => {
    const {
        closeApp,
        addToast,
        apiConfig,
        characters,
        activeCharacterId,
        userProfile,
        groups,
        realtimeConfig,
        theme: osTheme,
    } = useOS();
    const [session, setSession] = useState<WorkbenchSession | null>(null);
    const [messages, setMessages] = useState<WorkbenchMessage[]>([]);
    const [conversations, setConversations] = useState<WorkbenchConversationItem[]>([]);
    const [config, setConfig] = useState<WorkbenchBridgeConfig>(() => loadWorkbenchBridgeConfig());
    const [draftConfig, setDraftConfig] = useState<WorkbenchBridgeConfig>(() => loadWorkbenchBridgeConfig());
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    const [testResult, setTestResult] = useState('');
    const [testing, setTesting] = useState(false);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [thinkingSpeaker, setThinkingSpeaker] = useState<'codex' | 'character' | null>(null);
    const [summaryBusy, setSummaryBusy] = useState(false);
    const [progressPanelOpen, setProgressPanelOpen] = useState(false);
    const [progressCards, setProgressCards] = useState<WorkbenchSummary[]>([]);
    const [progressSummaryMode, setProgressSummaryMode] = useState<'codex' | 'character'>('codex');
    const [progressModeMenuOpen, setProgressModeMenuOpen] = useState(false);
    const [indexOpen, setIndexOpen] = useState(true);
    const [activeSpace, setActiveSpace] = useState<WorkbenchSpace>('work');
    const [instructionsOpen, setInstructionsOpen] = useState(false);
    const [connectionOpen, setConnectionOpen] = useState(true);
    const [fallbackApiOpen, setFallbackApiOpen] = useState(false);
    const [bridgeStatus, setBridgeStatus] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle');
    const [emojiMap, setEmojiMap] = useState<Map<string, Emoji>>(() => new Map());
    const [emojiList, setEmojiList] = useState<Emoji[]>([]);
    const [emojiCategories, setEmojiCategories] = useState<EmojiCategory[]>([]);
    const [emojiPanelOpen, setEmojiPanelOpen] = useState(false);
    const [activeEmojiCategory, setActiveEmojiCategory] = useState('all');
    const [actionTarget, setActionTarget] = useState<WorkbenchMessage | null>(null);
    const [editTarget, setEditTarget] = useState<WorkbenchMessage | null>(null);
    const [editContent, setEditContent] = useState('');
    const [quotedMessage, setQuotedMessage] = useState<WorkbenchMessage | null>(null);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(() => new Set());
    const [officialUsage, setOfficialUsage] = useState<WorkbenchOfficialUsage | null>(null);
    const [officialUsageStatus, setOfficialUsageStatus] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
    const [modelOptions, setModelOptions] = useState<WorkbenchModelOption[]>([]);
    const [modelStatus, setModelStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [fallbackModelOptions, setFallbackModelOptions] = useState<WorkbenchModelOption[]>([]);
    const [fallbackModelStatus, setFallbackModelStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [codeMemories, setCodeMemories] = useState<WorkbenchMemory[]>([]);
    const [codeMemoryDrafts, setCodeMemoryDrafts] = useState<Record<string, string>>({});
    const [codeMemoryOpen, setCodeMemoryOpen] = useState(false);
    const bottomRef = useRef<HTMLDivElement | null>(null);
    const codexAvatarInputRef = useRef<HTMLInputElement | null>(null);
    const messagePressTimerRef = useRef<number | null>(null);
    const messagePressMovedRef = useRef(false);

    const spaceMeta = WORKBENCH_SPACES[activeSpace];
    const bridgeReady = !!config.bridgeUrl.trim();
    const fallbackReady = !!config.fallbackApiBaseUrl?.trim() && !!config.fallbackApiModel?.trim();
    const usageStats = useMemo(() => buildUsageStats(messages), [messages]);
    const usageLimit = Number(config.monthlyUsageLimit || 0);
    const usagePct = usageLimit > 0 ? Math.min(100, Math.round((usageStats.month / usageLimit) * 100)) : 0;
    const usageText = usageLimit > 0
        ? `本月 ${usageStats.month.toLocaleString('zh-CN')}/${usageLimit.toLocaleString('zh-CN')}`
        : `本月 ${usageStats.month.toLocaleString('zh-CN')} tokens`;
    const participantEnabled = !!config.participantEnabled;
    const avatarRowAlign = 'items-center';
    const avatarSizeClass = osTheme.chatAvatarSize === 'small'
        ? 'h-7 w-7'
        : osTheme.chatAvatarSize === 'large'
            ? 'h-12 w-12'
            : 'h-9 w-9';
    const avatarRadiusClass = osTheme.chatAvatarShape === 'square'
        ? 'rounded-sm'
        : osTheme.chatAvatarShape === 'rounded'
            ? 'rounded-xl'
            : 'rounded-full';
    const avatarOffsetY = osTheme.chatAvatarOffsetY || 0;
    const showAssistantAvatar = osTheme.chatAvatarVisibility !== 'hide_ai'
        && osTheme.chatAvatarVisibility !== 'hide_both';
    const selectedParticipant = useMemo(() => (
        characters.find(c => c.id === config.participantCharacterId)
        || characters.find(c => c.id === activeCharacterId)
        || characters[0]
    ), [activeCharacterId, characters, config.participantCharacterId]);
    const getMessageAvatar = (message: WorkbenchMessage) => {
        if (message.role === 'codex') {
            return message.metadata?.speakerAvatar || config.codexAvatar || '';
        }
        if (message.role !== 'character' && message.role !== 'sully') return '';
        const characterId = message.metadata?.characterId;
        return message.metadata?.speakerAvatar
            || (characterId ? characters.find(c => c.id === characterId)?.avatar : '')
            || '';
    };
    const thinkingAvatar = thinkingSpeaker === 'codex'
        ? config.codexAvatar || ''
        : thinkingSpeaker === 'character'
            ? selectedParticipant?.avatar || ''
            : '';
    const thinkingInitial = thinkingSpeaker === 'character'
        ? String(selectedParticipant?.name || '角').slice(0, 1)
        : 'C';
    const currentMode: WorkbenchMode = participantEnabled ? 'sully' : 'codex';
    const workExecutable = bridgeStatus === 'online';
    const assistantAvailable = workExecutable || fallbackReady;

    useEffect(() => {
        setActiveSpace(workExecutable ? 'work' : 'inspiration');
    }, [workExecutable]);
    const officialUsagePercent = officialUsage?.usedPercent ?? officialUsage?.weeklyPercent;
    const officialUsageTitle = officialUsageStatus === 'loading'
        ? '同步中'
        : officialUsageStatus === 'ready'
            ? officialUsage?.label || (officialUsagePercent === undefined ? '已连接' : `本周 ${officialUsagePercent}%`)
            : workExecutable
                ? '不可读取'
                : '需要电脑桥接';
    const officialUsageHint = officialUsageStatus === 'ready'
        ? [
            officialUsage?.resetAt ? `重置 ${new Date(officialUsage.resetAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}` : '',
            officialUsage?.updatedAt ? `更新 ${new Date(officialUsage.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '',
        ].filter(Boolean).join(' · ') || '来自电脑端'
        : officialUsageStatus === 'loading'
            ? '正在从电脑端读取'
        : workExecutable
            ? '电脑端暂未提供 /usage'
            : '连接电脑后读取官方用量';
    const visibleEmojiCategories = useMemo(() => {
        const charId = selectedParticipant?.id;
        return emojiCategories.filter(cat => (
            !cat.allowedCharacterIds
            || cat.allowedCharacterIds.length === 0
            || !charId
            || cat.allowedCharacterIds.includes(charId)
        ));
    }, [emojiCategories, selectedParticipant?.id]);
    const hiddenEmojiCategoryIds = useMemo(() => new Set(
        emojiCategories
            .filter(cat => !visibleEmojiCategories.some(visible => visible.id === cat.id))
            .map(cat => cat.id),
    ), [emojiCategories, visibleEmojiCategories]);
    const visibleEmojis = useMemo(() => emojiList.filter(emoji => {
        if (emoji.categoryId && hiddenEmojiCategoryIds.has(emoji.categoryId)) return false;
        if (activeEmojiCategory === 'all') return true;
        if (activeEmojiCategory === 'default') return !emoji.categoryId || emoji.categoryId === 'default';
        return emoji.categoryId === activeEmojiCategory;
    }), [activeEmojiCategory, emojiList, hiddenEmojiCategoryIds]);
    const emojiCategoryOptions = useMemo(() => [
        { id: 'all', name: '全部' },
        { id: 'default', name: '默认' },
        ...visibleEmojiCategories,
    ], [visibleEmojiCategories]);

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            DB.getEmojis(),
            DB.getEmojiCategories().catch(() => [] as EmojiCategory[]),
        ])
            .then(([items, categories]) => {
                if (cancelled) return;
                setEmojiList(items);
                setEmojiCategories(categories);
                setEmojiMap(new Map(items.map(item => [item.name, item])));
            })
            .catch(() => {
                if (!cancelled) {
                    setEmojiList([]);
                    setEmojiCategories([]);
                    setEmojiMap(new Map());
                }
            });
        return () => { cancelled = true; };
    }, []);

    const loadConversations = async (): Promise<WorkbenchConversationItem[]> => {
        const sessions = await DB.getWorkbenchSessions();
        const items = await Promise.all(
            sessions
                .filter(s => !s.deletedAt)
                .map(async s => {
                    const msgs = await DB.getWorkbenchMessages(s.id, Number.MAX_SAFE_INTEGER);
                    return { ...s, messageCount: msgs.length };
                })
        );
        return items
            .filter(s => s.messageCount > 0 || s.id === session?.id)
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    };

    const loadCodeMemories = async () => {
        const rows = await DB.getRecentWorkbenchMemories(100).catch(() => [] as WorkbenchMemory[]);
        const sorted = [...rows].sort((a, b) => b.updatedAt - a.updatedAt);
        setCodeMemories(sorted);
        setCodeMemoryDrafts(Object.fromEntries(sorted.map(memory => [memory.id, memory.content])));
    };

    const loadProgressCards = async (sessionId?: string) => {
        if (!sessionId) {
            setProgressCards([]);
            return;
        }
        const rows = await DB.getRecentWorkbenchSummaries(500).catch(() => [] as WorkbenchSummary[]);
        setProgressCards(rows.filter(item => item.sessionId === sessionId).sort((a, b) => b.createdAt - a.createdAt));
    };

    const refreshModelOptions = async (sourceConfig: WorkbenchBridgeConfig = draftConfig, notify = true) => {
        if (!sourceConfig.bridgeUrl.trim()) {
            setModelOptions([]);
            setModelStatus('idle');
            if (notify) addToast('先填写并连接 CLI', 'info');
            return;
        }
        setModelStatus('loading');
        try {
            const rows = await fetchWorkbenchModels(sourceConfig);
            setModelOptions(rows);
            setModelStatus('ready');
            if (notify && rows.length === 0) addToast('当前 CLI 未提供模型列表，可手动填写模型 ID', 'info');
        } catch (error) {
            setModelOptions([]);
            setModelStatus('error');
            if (notify) addToast(error instanceof Error ? error.message : '模型列表读取失败', 'error');
        }
    };

    const refreshFallbackModelOptions = async () => {
        if (!draftConfig.fallbackApiBaseUrl?.trim()) {
            addToast('先填写备用聊天 API 地址', 'info');
            return;
        }
        setFallbackModelStatus('loading');
        try {
            const rows = await fetchWorkbenchFallbackModels(draftConfig);
            setFallbackModelOptions(rows);
            setFallbackModelStatus('ready');
            if (!rows.length) addToast('备用 API 未返回模型列表，可继续手动填写模型 ID', 'info');
        } catch (error) {
            setFallbackModelOptions([]);
            setFallbackModelStatus('error');
            addToast(error instanceof Error ? error.message : '备用 API 模型读取失败', 'error');
        }
    };

    const refresh = async () => {
        const staleErrorIds = (await DB.getRawStoreData('workbench_messages').catch(() => [] as WorkbenchMessage[]))
            .filter((message: WorkbenchMessage) => message.kind === 'error')
            .map((message: WorkbenchMessage) => message.id);
        if (staleErrorIds.length > 0) await DB.deleteWorkbenchMessages(staleErrorIds);
        const list = await loadConversations();
        setConversations(list);
        const active = session ? list.find(s => s.id === session.id) : null;
        const nextSession = active || list[0] || null;
        setSession(nextSession);
        setMessages(nextSession ? await DB.getWorkbenchMessages(nextSession.id, Number.MAX_SAFE_INTEGER) : []);
        await loadProgressCards(nextSession?.id);
        await loadCodeMemories();
        const next = loadWorkbenchBridgeConfig();
        setConfig(next);
        setDraftConfig(next);
    };

    useEffect(() => {
        void refresh();
    }, []);

    useEffect(() => {
        if (settingsOpen) void loadCodeMemories();
    }, [settingsOpen]);

    useEffect(() => {
        let cancelled = false;
        if (!config.bridgeUrl.trim()) {
            setBridgeStatus('idle');
            setTestResult('');
            setOfficialUsage(null);
            setOfficialUsageStatus('idle');
            return;
        }
        setBridgeStatus(previous => previous === 'online' ? 'online' : 'checking');
        const check = () => {
            void testWorkbenchBridge(config)
                .then(() => {
                    if (cancelled) return;
                    setBridgeStatus('online');
                    setTestResult('连接成功');
                })
                .catch(() => {
                    if (cancelled) return;
                    setBridgeStatus('offline');
                    setTestResult('连接已断开');
                });
        };
        const timer = window.setTimeout(check, 250);
        const interval = window.setInterval(check, 10_000);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
            window.clearInterval(interval);
        };
    }, [config.bridgeUrl, config.token, config.runtimeMode, config.defaultAgent, config.customAgentCommand]);

    useEffect(() => {
        let cancelled = false;
        if (bridgeStatus !== 'online') {
            setOfficialUsage(null);
            setOfficialUsageStatus(bridgeStatus === 'idle' ? 'idle' : 'unavailable');
            return;
        }
        setOfficialUsageStatus('loading');
        void fetchWorkbenchOfficialUsage(config)
            .then(data => {
                if (cancelled) return;
                setOfficialUsage(data);
                setOfficialUsageStatus('ready');
            })
            .catch(() => {
                if (cancelled) return;
                setOfficialUsage(null);
                setOfficialUsageStatus('unavailable');
            });
        return () => {
            cancelled = true;
        };
    }, [bridgeStatus, config.bridgeUrl, config.token, config.runtimeMode]);

    useEffect(() => {
        if (!settingsOpen || bridgeStatus !== 'online') {
            if (bridgeStatus !== 'online') {
                setModelOptions([]);
                setModelStatus('idle');
            }
            return;
        }
        void refreshModelOptions(config, false);
    }, [settingsOpen, bridgeStatus, config.bridgeUrl, config.token, config.defaultAgent, config.customAgentCommand]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [messages.length, busy]);

    const capabilityLabel = workExecutable ? '电脑已连接' : '仅聊天';
    const modeCopy = participantEnabled
        ? '一起工作 · ' + (selectedParticipant?.name || '未选择角色') + ' · ' + capabilityLabel
        : capabilityLabel;

    const updateWorkbenchConfig = (updates: Partial<WorkbenchBridgeConfig>) => {
        const next = { ...config, ...updates };
        saveWorkbenchBridgeConfig(next);
        const stored = loadWorkbenchBridgeConfig();
        setConfig(stored);
        setDraftConfig(stored);
    };

    const appendMessage = async (message: WorkbenchMessage) => {
        await DB.saveWorkbenchMessage(message);
        setMessages(prev => [...prev, message]);
    };

    const appendAssistantReply = async (
        base: Omit<WorkbenchMessage, 'id' | 'content' | 'createdAt' | 'type'>,
        rawReply: string,
        split = true,
        quoteContext: WorkbenchMessage[] = messages,
    ): Promise<WorkbenchMessage[]> => {
        const saved: WorkbenchMessage[] = [];
        const resolveQuoteTarget = (quotedTextRaw: string): WorkbenchMessage['replyTo'] | undefined => {
            const raw = (quotedTextRaw || '').trim();
            const candidates: string[] = [];
            const pushCandidate = (value?: string) => {
                const text = (value || '')
                    .trim()
                    .replace(/(?:[…⋯]+|\.{3,})$/, '')
                    .trim();
                if (text && !candidates.includes(text)) candidates.push(text);
            };
            pushCandidate(raw.match(/<原文>([\s\S]*?)<\/原文>/)?.[1]);
            pushCandidate(raw.match(/<译文>([\s\S]*?)<\/译文>/)?.[1]);
            pushCandidate(raw.replace(/<\/?翻译>|<\/?原文>|<\/?译文>/g, '').replace(/%%BILINGUAL%%/gi, ''));
            const mergedContext = [
                ...messages,
                ...quoteContext.filter(candidate => !messages.some(existing => existing.id === candidate.id)),
            ];
            const users = mergedContext.filter(m => m.role === 'user' && workbenchMessageText(m).trim());
            const reversed = users.slice().reverse();
            let target: WorkbenchMessage | undefined;
            for (const candidate of candidates) {
                target = reversed.find(m => workbenchMessageText(m).includes(candidate))
                    || (candidate.length > 10 ? reversed.find(m => workbenchMessageText(m).includes(candidate.slice(0, 10))) : undefined);
                if (target) break;
            }
            if (!target) target = reversed[0];
            if (!target) return undefined;
            const targetText = workbenchMessageText(target);
            return {
                id: target.id,
                content: targetText.length > 10 ? `${targetText.slice(0, 10)}...` : targetText,
                name: roleLabel(target),
            };
        };
        if (!split) {
            const cleaned = sanitizeWorkbenchReply(rawReply || '收到，但这轮没有返回正文。');
            const quoteMatch = cleaned.match(QUOTE_RE_DOUBLE) || cleaned.match(QUOTE_RE_SINGLE) || cleaned.match(REPLY_RE_CN) || cleaned.match(QUOTE_RE_NL);
            const content = stripWorkbenchQuoteTags(cleaned);
            const message: WorkbenchMessage = {
                ...base,
                id: makeId('wbm'),
                type: 'text',
                content: ChatParser.hasDisplayContent(content) ? content : '收到，但这轮没有返回正文。',
                replyTo: quoteMatch ? resolveQuoteTarget(quoteMatch[1]) : undefined,
                createdAt: Date.now(),
            };
            await appendMessage(message);
            return [message];
        }
        const parts = ChatParser.splitResponse(rawReply || '收到，但这轮没有返回正文。');
        let pendingReplyTarget: WorkbenchMessage['replyTo'] | undefined;
        for (const part of parts) {
            if (part.type === 'emoji') {
                const emoji = emojiMap.get(part.content);
                if (!emoji) continue;
                const message: WorkbenchMessage = {
                    ...base,
                    id: makeId('wbm'),
                    type: 'emoji',
                    content: emoji.url,
                    createdAt: Date.now(),
                    metadata: { ...(base.metadata || {}), emojiName: emoji.name },
                };
                await appendMessage(message);
                saved.push(message);
                continue;
            }
            const cleaned = sanitizeWorkbenchReply(part.content);
            if (!cleaned) continue;
            const chunks = ChatParser.chunkText(cleaned);
            for (const chunk of chunks) {
                const quoteMatch = chunk.match(QUOTE_RE_DOUBLE) || chunk.match(QUOTE_RE_SINGLE) || chunk.match(REPLY_RE_CN) || chunk.match(QUOTE_RE_NL);
                const chunkReplyTarget = quoteMatch ? resolveQuoteTarget(quoteMatch[1]) : undefined;
                const cleanChunk = stripWorkbenchQuoteTags(sanitizeWorkbenchReply(chunk));
                if (!cleanChunk || !ChatParser.hasDisplayContent(cleanChunk)) {
                    if (chunkReplyTarget) pendingReplyTarget = chunkReplyTarget;
                    continue;
                }
                const message: WorkbenchMessage = {
                    ...base,
                    id: makeId('wbm'),
                    type: 'text',
                    content: cleanChunk,
                    replyTo: chunkReplyTarget || pendingReplyTarget,
                    createdAt: Date.now(),
                };
                await appendMessage(message);
                saved.push(message);
                pendingReplyTarget = undefined;
            }
        }
        if (saved.length === 0) {
            const fallback: WorkbenchMessage = {
                ...base,
                id: makeId('wbm'),
                type: 'text',
                content: '收到，但这轮没有返回正文。',
                createdAt: Date.now(),
            };
            await appendMessage(fallback);
            saved.push(fallback);
        }
        return saved;
    };

    const saveSummary = async (sessionId: string, source: string) => {
        const now = Date.now();
        await DB.saveWorkbenchSummary({
            id: makeId('wbs'),
            sessionId,
            content: buildWorkbenchSummaryText(source, now, spaceMeta.title),
            createdAt: now,
        });
    };

    const savePanelConfig = () => {
        const next = { ...DEFAULT_WORKBENCH_CONFIG, ...draftConfig };
        saveWorkbenchBridgeConfig(next);
        const stored = loadWorkbenchBridgeConfig();
        setConfig(stored);
        setDraftConfig(stored);
        setBridgeStatus('checking');
        setTestResult('已保存');
        addToast('Code 设置已保存', 'success');
    };

    const saveCodeMemory = async (memory: WorkbenchMemory) => {
        const content = (codeMemoryDrafts[memory.id] || '').trim();
        if (!content) {
            addToast('Code Memory 不能为空；不需要就删除它', 'info');
            return;
        }
        await DB.saveWorkbenchMemory({ ...memory, content, updatedAt: Date.now() });
        await loadCodeMemories();
        addToast('Code Memory 已更新', 'success');
    };

    const deleteCodeMemory = async (memoryId: string) => {
        if (!window.confirm('删除这条 Code Memory？之后不会再作为跨对话长期规则提供给 Code。')) return;
        await DB.deleteWorkbenchMemory(memoryId);
        await loadCodeMemories();
        addToast('Code Memory 已删除', 'info');
    };

    const testBridge = async () => {
        setTesting(true);
        setTestResult('');
        try {
            const result = await testWorkbenchBridge(draftConfig);
            const next = { ...DEFAULT_WORKBENCH_CONFIG, ...draftConfig };
            saveWorkbenchBridgeConfig(next);
            const stored = loadWorkbenchBridgeConfig();
            setConfig(stored);
            setDraftConfig(stored);
            setBridgeStatus('online');
            setTestResult(`连接成功 · ${result}`);
            void refreshOfficialUsage(stored);
        } catch (e: any) {
            setBridgeStatus('offline');
            setTestResult(e?.message || '连接失败');
        } finally {
            setTesting(false);
        }
    };

    const refreshOfficialUsage = async (sourceConfig = config) => {
        if (!sourceConfig.bridgeUrl.trim()) {
            setOfficialUsage(null);
            setOfficialUsageStatus('idle');
            return;
        }
        setOfficialUsageStatus('loading');
        try {
            const data = await fetchWorkbenchOfficialUsage(sourceConfig);
            setOfficialUsage(data);
            setOfficialUsageStatus('ready');
        } catch {
            setOfficialUsage(null);
            setOfficialUsageStatus('unavailable');
        }
    };

    const updateCodexAvatar = async (file?: File | null) => {
        if (!file) return;
        try {
            const dataUrl = await processImage(file, { maxWidth: 256, quality: 0.82 });
            if (dataUrl) setDraftConfig(prev => ({ ...prev, codexAvatar: dataUrl }));
        } catch (error) {
            addToast(error instanceof Error ? error.message : '头像读取失败', 'error');
        }
    };

    const newConversation = async () => {
        const s = await createWorkbenchSession(activeSpace);
        setSession(s);
        setMessages([]);
        setProgressCards([]);
        setQuotedMessage(null);
        setSelectionMode(false);
        setSelectedMessageIds(new Set());
        setConversations(prev => [{ ...s, messageCount: 0 }, ...prev.filter(item => item.id !== s.id)]);
    };

    const selectConversation = async (sessionId: string) => {
        const target = conversations.find(item => item.id === sessionId);
        if (!target) return;
        setSession(target);
        setMessages(await DB.getWorkbenchMessages(sessionId, Number.MAX_SAFE_INTEGER));
        await loadProgressCards(sessionId);
        setQuotedMessage(null);
        setSelectionMode(false);
        setSelectedMessageIds(new Set());
    };

    const renameConversation = async (sessionId: string, title: string) => {
        const nextTitle = title;
        setConversations(prev => prev.map(item => item.id === sessionId ? { ...item, title: nextTitle } : item));
        if (session?.id === sessionId) setSession(prev => prev ? { ...prev, title: nextTitle } : prev);
        const target = conversations.find(item => item.id === sessionId) || session;
        if (target && target.id === sessionId) {
            await DB.saveWorkbenchSession({ ...target, title: nextTitle });
        }
    };

    const toggleSelectedMessage = (messageId: string) => {
        setSelectedMessageIds(prev => {
            const next = new Set(prev);
            if (next.has(messageId)) next.delete(messageId);
            else next.add(messageId);
            if (next.size === 0) setSelectionMode(false);
            return next;
        });
    };

    const startMultiSelect = (message: WorkbenchMessage) => {
        setActionTarget(null);
        setSelectionMode(true);
        setSelectedMessageIds(new Set([message.id]));
    };

    const deleteMessagesById = async (ids: string[]) => {
        const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
        if (!uniqueIds.length) return;
        await DB.deleteWorkbenchMessages(uniqueIds);
        setMessages(prev => prev.filter(item => !uniqueIds.includes(item.id)));
        if (quotedMessage && uniqueIds.includes(quotedMessage.id)) setQuotedMessage(null);
        setSelectedMessageIds(new Set());
        setSelectionMode(false);
        setActionTarget(null);
        setConversations(await loadConversations());
        addToast(uniqueIds.length > 1 ? `已删除 ${uniqueIds.length} 条 Code 消息` : 'Code 消息已删除', 'info');
    };

    const deleteSingleMessage = async (message: WorkbenchMessage) => {
        if (!window.confirm('删除这条 Code 消息？')) return;
        await deleteMessagesById([message.id]);
    };

    const deleteSelectedMessages = async () => {
        const ids = Array.from(selectedMessageIds);
        if (!ids.length) return;
        if (!window.confirm(`删除选中的 ${ids.length} 条 Code 消息？`)) return;
        await deleteMessagesById(ids);
    };

    const canEditMessage = (message: WorkbenchMessage) => (
        message.type !== 'emoji'
        && message.type !== 'file'
        && message.kind !== 'summary'
        && message.kind !== 'error'
        && !message.metadata?.progressCard
    );

    const startEditingMessage = (message: WorkbenchMessage) => {
        if (!canEditMessage(message)) return;
        setActionTarget(null);
        setEditTarget(message);
        setEditContent(message.content);
    };

    const saveEditedMessage = async () => {
        if (!editTarget) return;
        await DB.updateWorkbenchMessageContent(editTarget.id, editContent);
        setMessages(prev => prev.map(message => message.id === editTarget.id
            ? { ...message, content: editContent, metadata: { ...(message.metadata || {}), editedAt: Date.now() } }
            : message));
        setEditTarget(null);
        setEditContent('');
        addToast('Code 消息已修改', 'success');
    };

    const summarizeProgressCard = async () => {
        if (summaryBusy || busy) return;
        const activeMessages = session ? messages.filter(m => m.sessionId === session.id) : messages;
        if (!session || activeMessages.length === 0) {
            addToast('当前 Code 对话还没有可总结内容', 'info');
            return;
        }
        setSummaryBusy(true);
        try {
            let source: 'codex' | 'character' = progressSummaryMode;
            let card = '';
            if (progressSummaryMode === 'codex' && workExecutable) {
                try {
                    const taskIndex = [
                        await buildWorkbenchCurrentProgressContext(session.id),
                        await buildWorkbenchTaskIndex(session.id),
                    ].filter(Boolean).join('\n\n');
                    card = await summarizeWorkbenchProgressCardWithBridge(config, {
                        sessionId: session.id,
                        sessionTitle: session.title,
                        messages: activeMessages,
                        taskIndex,
                    });
                } catch (codexError) {
                    if (!participantEnabled || !selectedParticipant) throw codexError;
                }
            }
            if (!card) {
                if (!participantEnabled || !selectedParticipant) {
                    throw new Error(progressSummaryMode === 'character'
                        ? '请先打开一起工作并选择总结角色'
                        : '未连接 CLI；请先连接电脑桥接，或打开一起工作让角色总结');
                }
                source = 'character';
                card = await summarizeWorkbenchProgressCardWithCharacter({
                    apiConfig,
                    char: selectedParticipant,
                    userProfile,
                    groups,
                    realtimeConfig,
                    sessionTitle: session.title,
                    messages: activeMessages,
                });
            }
            if (participantEnabled && selectedParticipant) {
                card = ensureCharacterProgressCardHeader(card, selectedParticipant.name);
            }
            const now = Date.now();
            const summaryId = makeId('wbs');
            const summaryRow: WorkbenchSummary = {
                id: summaryId,
                sessionId: session.id,
                content: card,
                createdAt: now,
            };
            await DB.saveWorkbenchSummary(summaryRow);
            setProgressCards(prev => [summaryRow, ...prev.filter(item => item.id !== summaryRow.id)]);
            setProgressPanelOpen(true);
            let codeMemoryCount = 0;
            try {
                const extractedMemories = await extractWorkbenchCodeMemories(apiConfig, {
                    sessionTitle: session.title,
                    messages: activeMessages,
                    progressCard: card,
                });
                if (extractedMemories.length) {
                    const existing = await DB.getRecentWorkbenchMemories(300).catch(() => []);
                    const byKey = new Map(existing.map(item => [codeMemoryKey(item.content), item]).filter(([key]) => !!key));
                    const rows = extractedMemories.map(content => content.trim()).filter(Boolean).map(content => {
                        const key = codeMemoryKey(content);
                        const previous = byKey.get(key);
                        const row = previous
                            ? { ...previous, sessionId: session.id, summaryId, content, updatedAt: now }
                            : { id: makeId('wbmem'), sessionId: session.id, summaryId, content, createdAt: now, updatedAt: now };
                        byKey.set(key, row);
                        return row;
                    });
                    if (rows.length) {
                        await DB.saveWorkbenchMemories(rows);
                        codeMemoryCount = rows.length;
                        const sessionRows = (await DB.getRecentWorkbenchMemories(500))
                            .filter(item => item.sessionId === session.id)
                            .sort((a, b) => b.updatedAt - a.updatedAt);
                        await Promise.all(sessionRows.slice(30).map(item => DB.deleteWorkbenchMemory(item.id)));
                    }
                }
            } catch (memoryError) {
                console.warn('[Workbench] Code Memory extraction skipped', memoryError);
            }
            if (participantEnabled && selectedParticipant) {
                await DB.saveMessage({
                    charId: selectedParticipant.id,
                    role: 'assistant',
                    type: 'code_card' as any,
                    content: card,
                    metadata: {
                        source: 'workbench_progress',
                        workbenchSessionId: session.id,
                        workbenchSessionTitle: session.title,
                        workbenchSummaryId: summaryId,
                        progressCard: true,
                        summarySource: source,
                    },
                } as any);
                window.dispatchEvent(new CustomEvent('active-msg-progress', {
                    detail: { charId: selectedParticipant.id },
                }));
            }
            await appendMessage({
                id: makeId('wbm'),
                sessionId: session.id,
                role: 'system',
                kind: 'summary',
                mode: currentMode,
                content: card,
                createdAt: now,
                status: 'sent',
                metadata: {
                    progressCard: true,
                    source,
                    characterId: participantEnabled ? selectedParticipant?.id : undefined,
                    speakerName: participantEnabled ? selectedParticipant?.name : undefined,
                },
            });
            setConversations(await loadConversations());
            const memoryText = codeMemoryCount > 0 ? `，新增 ${codeMemoryCount} 条 Code Memory` : '';
            addToast(participantEnabled && selectedParticipant ? `Code 进度卡已写入 ${selectedParticipant.name} 的聊天${memoryText}` : `Code 进度卡已生成${memoryText}`, 'success');
        } catch (e: any) {
            addToast(e?.message || 'Code 进度卡总结失败', 'error');
        } finally {
            setSummaryBusy(false);
        }
    };

    const clearMessagePressTimer = () => {
        if (messagePressTimerRef.current !== null) {
            window.clearTimeout(messagePressTimerRef.current);
            messagePressTimerRef.current = null;
        }
    };

    const startMessagePress = (message: WorkbenchMessage) => {
        messagePressMovedRef.current = false;
        clearMessagePressTimer();
        messagePressTimerRef.current = window.setTimeout(() => {
            if (!messagePressMovedRef.current) setActionTarget(message);
            clearMessagePressTimer();
        }, 520);
    };

    const moveMessagePress = () => {
        messagePressMovedRef.current = true;
        clearMessagePressTimer();
    };

    const send = async (overrideText?: string, options?: { type?: WorkbenchMessage['type']; metadata?: Record<string, any> }) => {
        const text = (overrideText ?? input).trim();
        if (!text || busy) return;
        const readableText = options?.type === 'emoji'
            ? `[表情: ${options.metadata?.emojiName || '表情包'}]`
            : text;
        let s = session || await createWorkbenchSession(activeSpace);
        if (s.title === '新对话' || s.title === WORKBENCH_SPACES[activeSpace].title) {
            s = { ...s, title: deriveConversationTitle(readableText) };
            await DB.saveWorkbenchSession(s);
        }
        setSession(s);
        if (overrideText === undefined) setInput('');
        setEmojiPanelOpen(false);
        const replySnapshot = quotedMessage
            ? {
                id: quotedMessage.id,
                content: workbenchMessageText(quotedMessage).slice(0, 180),
                name: roleLabel(quotedMessage),
            }
            : undefined;
        setQuotedMessage(null);
        setBusy(true);
        const userMessage: WorkbenchMessage = {
            id: makeId('wbm'),
            sessionId: s.id,
            role: 'user',
            kind: 'chat',
            type: options?.type || 'text',
            mode: 'codex',
            content: text,
            replyTo: replySnapshot,
            createdAt: Date.now(),
            status: 'sent',
            metadata: options?.metadata,
        };
        await appendMessage(userMessage);
        try {
            setConversations(await loadConversations());
        } catch (e: any) {
            addToast(e?.message || '消息保存失败', 'error');
        } finally {
            setBusy(false);
        }
    };

    const nudgeAssistant = async () => {
        if (busy) return;
        if (!assistantAvailable) {
            addToast('CLI 未连接，备用聊天 API 也未配置', 'info');
            return;
        }
        const s = session || await createWorkbenchSession(activeSpace);
        setSession(s);
        setEmojiPanelOpen(false);
        setThinkingSpeaker('codex');
        setBusy(true);
        try {
            const recent = messages
                .filter(message => message.sessionId === s.id)
                .slice(-10);
            if (!recent.length) {
                addToast('先在 Code 里写一点内容，再请 AI 助理回应', 'info');
                return;
            }
            const taskIndex = await buildWorkbenchTaskIndex(s.id);
            const contextIndex = [
                await buildWorkbenchCurrentProgressContext(s.id),
                taskIndex,
            ].filter(Boolean).join('\n\n');
            const bridgeReply = workExecutable
                ? await sendWorkbenchBridgeMessage(config, {
                    sessionId: s.id,
                    mode: 'codex',
                    capabilityMode: 'execute',
                    content: '请回应当前 Code 对话中用户尚未得到回应的最新内容。',
                    recentMessages: recent,
                    taskIndex: contextIndex,
                })
                : await sendWorkbenchFallbackMessage(config, {
                    content: '请回应当前 Code 对话中用户尚未得到回应的最新内容。',
                    recentMessages: recent,
                    taskIndex: contextIndex,
                });
            const assistantBase: Omit<WorkbenchMessage, 'id' | 'content' | 'createdAt' | 'type'> = {
                sessionId: s.id,
                role: 'codex',
                kind: 'chat',
                mode: 'codex',
                status: 'sent',
                metadata: {
                    source: workExecutable ? 'bridge' : 'fallback-api',
                    agent: bridgeReply.agent || config.defaultAgent,
                    speakerName: agentDisplayName(config, bridgeReply.agent, bridgeReply.displayName),
                    speakerAvatar: config.codexAvatar || '',
                },
            };
            await appendAssistantReply(assistantBase, bridgeReply.reply, false, recent);
            for (const incoming of workExecutable ? bridgeReply.artifacts || [] : []) {
                const now = Date.now();
                const artifact: WorkbenchArtifact = {
                    ...incoming,
                    id: incoming.id || makeId('wba'),
                    sessionId: s.id,
                    storageKind: 'bridge',
                    createdAt: now,
                    updatedAt: incoming.updatedAt || now,
                };
                await DB.saveWorkbenchArtifact(artifact);
                await appendMessage({
                    id: makeId('wbm'),
                    sessionId: s.id,
                    role: 'codex',
                    type: 'file',
                    kind: 'action',
                    mode: 'codex',
                    content: artifact.name,
                    createdAt: now,
                    status: 'sent',
                    metadata: {
                        source: 'bridge',
                        agent: bridgeReply.agent || config.defaultAgent,
                        speakerName: agentDisplayName(config, bridgeReply.agent, bridgeReply.displayName),
                        speakerAvatar: config.codexAvatar || '',
                        artifact,
                    },
                });
            }
            setConversations(await loadConversations());
        } catch (e: any) {
            addToast(e?.message || 'AI 助理回应失败', 'error');
        } finally {
            setBusy(false);
            setThinkingSpeaker(null);
        }
    };

    const nudgeParticipant = async () => {
        if (busy) return;
        if (!participantEnabled || !selectedParticipant) {
            addToast('请先打开一起工作并选择角色', 'info');
            return;
        }
        const s = session || await createWorkbenchSession(activeSpace);
        setSession(s);
        setEmojiPanelOpen(false);
        setThinkingSpeaker('character');
        setBusy(true);
        try {
            const recent = messages
                .filter(message => message.sessionId === s.id)
                .slice(-80);
            if (!recent.length) {
                addToast('先在 Code 里写一点内容，再催动角色回应', 'info');
                return;
            }
            const taskIndex = await buildWorkbenchTaskIndex(s.id);
            const capability = {
                space: activeSpace,
                bridgeOnline: workExecutable,
                executeMode: false,
            };
            const reply = await consultCharacterFromWorkbench({
                apiConfig,
                char: selectedParticipant,
                userProfile,
                groups,
                realtimeConfig,
                recentMessages: recent,
                content: '',
                sessionTitle: s.title,
                taskIndex,
                capability,
            });
            await appendAssistantReply({
                sessionId: s.id,
                role: 'character',
                kind: 'consult',
                mode: 'sully',
                status: 'sent',
                metadata: {
                    speakerName: selectedParticipant.name,
                    speakerAvatar: selectedParticipant.avatar || '',
                    characterId: selectedParticipant.id,
                    nudged: true,
                },
            }, reply, true, recent);
            setConversations(await loadConversations());
        } catch (e: any) {
            addToast(e?.message || '角色回应失败', 'error');
        } finally {
            setBusy(false);
            setThinkingSpeaker(null);
        }
    };

    const sendEmoji = (emoji: Emoji) => {
        void send(emoji.url, { type: 'emoji', metadata: { emojiName: emoji.name } });
    };

    const deleteConversation = async (sessionId: string) => {
        const target = conversations.find(item => item.id === sessionId);
        if (!target) return;
        if (!window.confirm(`删除「${target.title || '新对话'}」的逐句对话？已生成的 Code 进度卡和 Code Memory 会保留为索引。`)) return;
        await DB.deleteWorkbenchSession(sessionId);
        const nextList = (await loadConversations()).filter(item => item.id !== sessionId);
        setConversations(nextList);
        if (session?.id === sessionId) {
            const nextSession = nextList[0] || null;
            setSession(nextSession);
            setMessages(nextSession ? await DB.getWorkbenchMessages(nextSession.id, Number.MAX_SAFE_INTEGER) : []);
        }
        addToast('逐句对话已删除，进度卡已保留', 'info');
    };

    return (
        <div
            className="relative h-full w-full flex flex-col text-slate-900 overflow-hidden"
            style={{
                background:
                    'linear-gradient(135deg, #fbf5ed 0%, #f7f0ef 30%, #f4f1fb 68%, #edf5ff 100%)',
            }}
        >
            <style>{`.workbench-index-scroll{scrollbar-width:none;-ms-overflow-style:none;}.workbench-index-scroll::-webkit-scrollbar{display:none;}`}</style>
            <div className="shrink-0 border-b border-white/70 bg-white/36 backdrop-blur-2xl" style={{ paddingTop: 'var(--safe-top)' }}>
                <div className="px-3 py-2.5 flex items-center gap-2">
                    <IconButton label="退出" onClick={closeApp} className="bg-white/54 border-white/70">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
                        </svg>
                    </IconButton>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                            <h1 className="text-sm font-semibold leading-none truncate">{spaceMeta.title}</h1>
                            <span className={`h-2 w-2 rounded-full ${participantEnabled ? 'bg-violet-500' : workExecutable ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                        </div>
                        <p className="text-[11px] text-slate-500 truncate mt-1">{modeCopy}</p>
                    </div>
                    <IconButton label="Code 使用教程" onClick={() => setHelpOpen(true)} className="bg-white/54 border-white/70 rounded-full">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="9" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.8 9a2.35 2.35 0 1 1 3.5 2.05c-.8.46-1.3.96-1.3 1.95" />
                            <path strokeLinecap="round" d="M12 17h.01" />
                        </svg>
                    </IconButton>
                    <IconButton label="查看 Code 进度卡" onClick={() => { void loadProgressCards(session?.id); setProgressPanelOpen(true); }} className="bg-white/54 border-white/70">
                        <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 ${summaryBusy ? 'animate-pulse' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 6h8M8 10h8M8 14h5" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
                        </svg>
                    </IconButton>
                    <IconButton label="Code 设置" onClick={() => { setDraftConfig(config); setSettingsOpen(true); setTestResult(''); }} className="bg-white/54 border-white/70">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.04.04a2 2 0 0 1-2.83 2.83l-.04-.04A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 0 1-4 0v-.06A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.04.04a2 2 0 0 1-2.83-2.83l.04-.04A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 0 1 0-4h.06A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.04-.04a2 2 0 0 1 2.83-2.83l.04.04A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 0 1 4 0v.06A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.04-.04a2 2 0 0 1 2.83 2.83l-.04.04A1.7 1.7 0 0 0 19.4 9" />
                        </svg>
                    </IconButton>
                </div>
                <div className="px-3 pb-2.5 flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => updateWorkbenchConfig({ participantEnabled: !participantEnabled, participantCharacterId: selectedParticipant?.id || config.participantCharacterId || '' })}
                        className={`h-8 w-14 rounded-full p-0.5 transition-colors ${participantEnabled ? 'bg-emerald-500' : 'bg-slate-200'}`}
                        aria-label="一起工作开关"
                        title="一起工作开关"
                    >
                        <span className={`block h-7 w-7 rounded-full bg-white shadow-sm transition-transform ${participantEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                    <div className="text-[11px] font-semibold text-slate-500 shrink-0">
                        {participantEnabled ? '一起工作' : '仅 AI 助理'}
                    </div>
                    <select
                        value={selectedParticipant?.id || ''}
                        onChange={e => updateWorkbenchConfig({ participantCharacterId: e.target.value, participantEnabled: true })}
                        disabled={!characters.length}
                        className="min-w-0 max-w-[38%] h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 outline-none disabled:opacity-40"
                        aria-label="选择一起工作的角色"
                    >
                        {characters.length === 0 && <option value="">无角色</option>}
                        {characters.map(char => (
                            <option key={char.id} value={char.id}>{char.name}</option>
                        ))}
                    </select>
                    <div className="ml-auto text-[11px] text-slate-400 truncate max-w-[42%]">
                        {usageText}
                    </div>
                </div>
                {usageLimit > 0 && (
                    <div className="h-0.5 bg-slate-100">
                        <div className="h-full bg-slate-900 transition-all" style={{ width: `${usagePct}%` }} />
                    </div>
                )}
            </div>

            <div className="relative min-h-0 flex-1 flex overflow-hidden">
                <div className="min-w-0 flex-1 flex flex-col bg-white">
                    <div className="flex-1 overflow-y-auto bg-white workbench-index-scroll">
                        <div className="min-h-full px-4 py-5 space-y-5">
                            {messages.length === 0 && (
                                <div className="h-full min-h-[360px] flex items-center justify-center">
                                    <div className="w-full max-w-[310px] text-center">
                                        <div className="mx-auto w-12 h-12 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-700 mb-4">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l-4 3 4 3" />
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M16 9l4 3-4 3" />
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l-4 14" />
                                            </svg>
                                        </div>
                                        <h2 className="text-lg font-semibold tracking-tight">{spaceMeta.emptyTitle}</h2>
                                        <p className="text-sm text-slate-500 mt-2 leading-relaxed">{spaceMeta.emptyDescription}</p>
                                    </div>
                                </div>
                            )}
                            {messages.map(m => {
                                const avatar = m.role === 'user' ? '' : getMessageAvatar(m);
                                const isEmojiOnly = m.type === 'emoji';
                                const isProgressCard = m.role === 'system' && !!m.metadata?.progressCard;
                                if (isProgressCard) {
                                    return (
                                        <div key={m.id} className="flex justify-center px-1">
                                            <button
                                                type="button"
                                                onClick={() => { if (selectionMode) toggleSelectedMessage(m.id); }}
                                                onPointerDown={() => startMessagePress(m)}
                                                onPointerMove={moveMessagePress}
                                                onPointerUp={clearMessagePressTimer}
                                                onPointerCancel={clearMessagePressTimer}
                                                onPointerLeave={clearMessagePressTimer}
                                                onContextMenu={event => { event.preventDefault(); setActionTarget(m); }}
                                                className={`w-full max-w-[92%] text-left bg-transparent border-0 p-0 shadow-none active:scale-[0.995] ${selectedMessageIds.has(m.id) ? 'ring-2 ring-emerald-400 ring-offset-2 rounded-lg' : ''}`}
                                            >
                                                {renderWorkbenchMessageContent(m, emojiMap)}
                                            </button>
                                        </div>
                                    );
                                }
                                return (
                                <div key={m.id} className={`flex gap-2.5 ${m.role === 'user' ? 'justify-end' : `justify-start ${avatarRowAlign}`}`}>
                                    {m.role !== 'user' && showAssistantAvatar && (avatar ? (
                                        <img
                                            src={avatar}
                                            alt="avatar"
                                            loading="lazy"
                                            decoding="async"
                                            style={{ transform: `translateY(${avatarOffsetY}px)` }}
                                            className={`${avatarSizeClass} ${avatarRadiusClass} object-cover shadow-sm ring-1 ring-black/5 shrink-0`}
                                        />
                                    ) : (
                                        <div
                                            style={{ transform: `translateY(${avatarOffsetY}px)` }}
                                            className={`${avatarSizeClass} ${avatarRadiusClass} flex items-center justify-center text-[11px] font-semibold shrink-0 ${(m.role === 'sully' || m.role === 'character') ? 'bg-violet-100 text-violet-700' : m.kind === 'error' ? 'bg-rose-100 text-rose-700' : 'bg-slate-900 text-white'}`}
                                        >
                                            {(m.role === 'sully' || m.role === 'character') ? String(m.metadata?.speakerName || '角').slice(0, 1) : m.kind === 'error' ? '!' : 'C'}
                                        </div>
                                    ))}
                                    <div className={`max-w-[72%] ${m.role === 'user' ? 'items-end' : 'items-start'} flex flex-col`}>
                                        <div className={`text-[11px] mb-1 ${m.role === 'user' ? 'text-slate-400 pr-1' : 'text-slate-500'}`}>
                                            {roleLabel(m)} · {new Date(m.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                        <button
                                            type="button"
                                            style={isEmojiOnly ? {
                                                appearance: 'none',
                                                WebkitAppearance: 'none',
                                                background: 'transparent',
                                                backgroundColor: 'transparent',
                                                border: 0,
                                                boxShadow: 'none',
                                                padding: 0,
                                            } : undefined}
                                            onClick={() => { if (selectionMode) toggleSelectedMessage(m.id); }}
                                            onPointerDown={() => startMessagePress(m)}
                                            onPointerMove={moveMessagePress}
                                            onPointerUp={clearMessagePressTimer}
                                            onPointerCancel={clearMessagePressTimer}
                                            onPointerLeave={clearMessagePressTimer}
                                            onContextMenu={e => { e.preventDefault(); setActionTarget(m); }}
                                            className={`text-left text-[15px] leading-relaxed whitespace-pre-wrap break-all transition-transform active:scale-[0.98] ${
                                            isEmojiOnly
                                                ? '!bg-transparent !p-0 !shadow-none !border-0 !rounded-none'
                                                : m.role === 'user'
                                                ? 'rounded-2xl rounded-br-sm bg-[#EEEAF8] text-slate-900 shadow-sm px-5 py-3'
                                                : m.kind === 'error'
                                                    ? 'rounded-2xl rounded-bl-sm bg-rose-50 text-rose-700 border border-rose-100 shadow-sm px-5 py-3'
                                                    : 'rounded-2xl rounded-bl-sm bg-white text-slate-700 border border-black/5 shadow-sm px-5 py-3'
                                        } ${selectedMessageIds.has(m.id) ? 'ring-2 ring-emerald-400 ring-offset-2' : ''}`}>
                                            {m.replyTo && !isEmojiOnly && (
                                                <span className={`mb-2 block rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug ${
                                                    m.role === 'user' ? 'border-black/10 bg-white/65 text-slate-600' : 'border-slate-200 bg-slate-50 text-slate-500'
                                                }`}>
                                                    <span className="block font-semibold">{m.replyTo.name}</span>
                                                    <span className="block max-h-10 overflow-hidden">{m.replyTo.content}</span>
                                                </span>
                                            )}
                                            {renderWorkbenchMessageContent(m, emojiMap, artifact => {
                                                void downloadWorkbenchArtifact(config, artifact).catch(error => addToast(error?.message || '文件下载失败', 'error'));
                                            })}
                                        </button>
                                    </div>
                                </div>
                                );
                            })}
                            {busy && thinkingSpeaker && (
                                <div className={`flex gap-2.5 ${avatarRowAlign}`}>
                                    {showAssistantAvatar && (thinkingAvatar ? (
                                        <img
                                            src={thinkingAvatar}
                                            alt="avatar"
                                            loading="lazy"
                                            decoding="async"
                                            style={{ transform: `translateY(${avatarOffsetY}px)` }}
                                            className={`${avatarSizeClass} ${avatarRadiusClass} object-cover shadow-sm ring-1 ring-black/5 shrink-0`}
                                        />
                                    ) : (
                                        <div
                                            style={{ transform: `translateY(${avatarOffsetY}px)` }}
                                            className={`${avatarSizeClass} ${avatarRadiusClass} ${thinkingSpeaker === 'character' ? 'bg-violet-100 text-violet-700' : 'bg-slate-900 text-white'} flex items-center justify-center text-[11px] font-semibold shrink-0`}
                                        >
                                            {thinkingInitial}
                                        </div>
                                    ))}
                                    <div className="rounded-2xl rounded-bl-sm px-5 py-3 text-[15px] text-slate-500 bg-white border border-black/5 shadow-sm">
                                        正在思考
                                    </div>
                                </div>
                            )}
                            <div ref={bottomRef} />
                        </div>
                    </div>

                    <div
                        className="shrink-0 px-3 pt-2 pb-3 border-t border-white/70"
                        style={{
                            paddingBottom: 'max(0.75rem, var(--safe-bottom))',
                            background: 'linear-gradient(135deg, #fbf5ed 0%, #f7f0ef 35%, #f4f1fb 72%, #edf5ff 100%)',
                        }}
                    >
                        {selectionMode && (
                            <div className="mb-2 rounded-2xl border border-slate-200 bg-white/90 px-3 py-2 shadow-sm backdrop-blur flex items-center gap-2">
                                <span className="text-xs font-semibold text-slate-600">已选 {selectedMessageIds.size} 条</span>
                                <button
                                    type="button"
                                    onClick={deleteSelectedMessages}
                                    disabled={selectedMessageIds.size === 0}
                                    className="ml-auto h-8 px-3 rounded-lg bg-rose-500 text-white text-xs font-semibold active:scale-95 disabled:opacity-40"
                                >
                                    删除
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setSelectionMode(false); setSelectedMessageIds(new Set()); }}
                                    className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-slate-500 text-xs font-semibold active:scale-95"
                                >
                                    取消
                                </button>
                            </div>
                        )}
                        {emojiPanelOpen && (
                            <div className="mb-2 rounded-2xl border border-white/80 bg-white/88 shadow-sm backdrop-blur overflow-hidden">
                                <div className="px-3 pt-3 pb-2 flex gap-1.5 overflow-x-auto workbench-index-scroll">
                                    {emojiCategoryOptions.map(cat => (
                                        <button
                                            key={cat.id}
                                            type="button"
                                            onClick={() => setActiveEmojiCategory(cat.id)}
                                            className={`h-7 px-3 rounded-lg shrink-0 text-[11px] font-semibold border ${
                                                activeEmojiCategory === cat.id
                                                    ? 'bg-slate-900 text-white border-slate-900'
                                                    : 'bg-slate-50 text-slate-500 border-slate-200'
                                            }`}
                                        >
                                            {cat.name}
                                        </button>
                                    ))}
                                </div>
                                <div className="max-h-44 overflow-y-auto px-3 pb-3 workbench-index-scroll">
                                    {visibleEmojis.length > 0 ? (
                                        <div className="grid grid-cols-5 sm:grid-cols-7 gap-2">
                                            {visibleEmojis.map(emoji => (
                                                <button
                                                    key={`${emoji.name}-${emoji.url}`}
                                                    type="button"
                                                    onClick={() => sendEmoji(emoji)}
                                                    disabled={busy}
                                                    title={emoji.name}
                                                    className="h-14 rounded-xl border border-slate-200 bg-white flex flex-col items-center justify-center gap-0.5 active:scale-95 disabled:opacity-40"
                                                >
                                                    <img
                                                        src={emoji.url}
                                                        alt={emoji.name}
                                                        loading="lazy"
                                                        decoding="async"
                                                        className="h-8 w-8 object-contain"
                                                    />
                                                    <span className="w-full px-1 text-[9px] text-slate-400 truncate">{emoji.name}</span>
                                                </button>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="py-8 text-center text-xs text-slate-400">
                                            暂无可用表情包
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        <div className="rounded-2xl border border-white/80 bg-white/72 shadow-sm overflow-hidden backdrop-blur">
                            {quotedMessage && (
                                <div className="mx-3 mt-3 rounded-xl border border-slate-200 bg-white/80 px-3 py-2 flex items-start gap-2">
                                    <div className="min-w-0 flex-1">
                                        <div className="text-[11px] font-semibold text-slate-500">引用 {roleLabel(quotedMessage)}</div>
                                        <div className="mt-0.5 text-xs text-slate-400 truncate">{workbenchMessageText(quotedMessage)}</div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setQuotedMessage(null)}
                                        className="h-6 w-6 rounded-md flex items-center justify-center text-slate-400 hover:bg-slate-100 active:scale-95"
                                        aria-label="取消引用"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M18 6 6 18M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>
                            )}
                            <textarea
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        void send();
                                    }
                                }}
                                rows={2}
                                placeholder="描述任务"
                                className="w-full min-h-[58px] max-h-32 resize-none px-4 pt-3 text-sm outline-none bg-transparent"
                            />
                            <div className="px-2.5 pb-2.5 flex items-center gap-2">
                                {participantEnabled && (
                                    <button
                                        type="button"
                                        onClick={() => void nudgeParticipant()}
                                        disabled={busy || !selectedParticipant}
                                        className="h-8 w-8 rounded-lg flex items-center justify-center active:scale-95 disabled:opacity-35 bg-white/70 text-slate-500 border border-slate-200"
                                        aria-label="催动角色回应"
                                        title="催动角色回应"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 2 4 14h7l-1 8 10-13h-7l0-7Z" />
                                        </svg>
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => void nudgeAssistant()}
                                    disabled={busy || !assistantAvailable}
                                    className="h-8 w-8 rounded-lg flex items-center justify-center active:scale-95 disabled:opacity-35 bg-white/70 text-slate-500 border border-slate-200"
                                    aria-label="请 AI 助理回应"
                                    title={assistantAvailable ? (workExecutable ? '请 CLI AI 助理回应' : '请备用 AI 助理回应') : 'AI 助理不可用'}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" />
                                        <path strokeLinecap="round" d="M18.5 15.5v3M20 17h-3M5.5 4.5v2M6.5 5.5h-2" />
                                    </svg>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setEmojiPanelOpen(prev => !prev)}
                                    className={`h-8 w-8 rounded-lg flex items-center justify-center active:scale-95 ${
                                        emojiPanelOpen ? 'bg-slate-900 text-white' : 'bg-white/70 text-slate-500 border border-slate-200'
                                    }`}
                                    aria-label="表情包"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 9h.01M16 9h.01M8.5 14.5c1.8 1.7 5.2 1.7 7 0" />
                                    </svg>
                                </button>
                                <button
                                    onClick={() => void send()}
                                    disabled={!input.trim() || busy}
                                    className="ml-auto h-8 w-8 rounded-lg bg-slate-900 text-white flex items-center justify-center active:scale-95 disabled:opacity-35"
                                    aria-label="发送"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M22 2L11 13" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M22 2l-7 20-4-9-9-4 20-7Z" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => setIndexOpen(prev => !prev)}
                    className="absolute top-1/2 -translate-y-1/2 z-20 h-11 w-7 rounded-l-xl border border-r-0 border-slate-200 bg-white/92 shadow-sm backdrop-blur flex items-center justify-center text-slate-500 active:scale-95 transition-[right,transform] duration-200"
                    style={{ right: indexOpen ? 'clamp(150px, 38%, 240px)' : 0 }}
                    aria-label={indexOpen ? '收起索引' : '展开索引'}
                    title={indexOpen ? '收起索引' : '展开索引'}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 transition-transform ${indexOpen ? '' : 'rotate-180'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" />
                    </svg>
                </button>
                <WorkbenchIndex
                    activeSessionId={session?.id}
                    conversations={conversations}
                    usageText={usageText}
                    open={indexOpen}
                    canExecute={workExecutable}
                    onNewConversation={newConversation}
                    onSelectConversation={selectConversation}
                    onRenameConversation={renameConversation}
                    onDeleteConversation={deleteConversation}
                />
            </div>

            {progressPanelOpen && (
                <div className="absolute inset-0 z-50 bg-black/20 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-3" onClick={() => { setProgressPanelOpen(false); setProgressModeMenuOpen(false); }}>
                    <section
                        className="w-full sm:max-w-2xl max-h-[82%] bg-[#F7F8FB] border border-white/80 rounded-lg shadow-2xl overflow-hidden flex flex-col"
                        onClick={event => event.stopPropagation()}
                        aria-label="Code 进度卡"
                    >
                        <header className="relative shrink-0 px-4 py-3 bg-white border-b border-slate-200 flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                                <h2 className="text-sm font-semibold text-slate-900">Code 进度卡</h2>
                                <p className="mt-0.5 text-[11px] text-slate-400 truncate">{session?.title || '当前对话'} · 手动生成</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => void summarizeProgressCard()}
                                disabled={summaryBusy || busy || !session || messages.length === 0}
                                className="h-9 px-3 rounded-lg bg-slate-900 text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-35 active:scale-95"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${summaryBusy ? 'animate-pulse' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
                                </svg>
                                {summaryBusy ? '总结中' : '生成新卡'}
                            </button>
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => setProgressModeMenuOpen(prev => !prev)}
                                    disabled={summaryBusy}
                                    className={`h-9 w-9 rounded-lg border flex items-center justify-center active:scale-95 disabled:opacity-35 ${progressModeMenuOpen ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-500'}`}
                                    aria-label="选择进度卡总结模式"
                                    title={progressSummaryMode === 'codex' ? 'Codex 优先' : '角色总结'}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h11m0 0-3-3m3 3-3 3M16 17H5m0 0 3 3m-3-3 3-3" />
                                    </svg>
                                </button>
                                {progressModeMenuOpen && (
                                    <div className="absolute right-0 top-11 z-10 w-44 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl">
                                        {([
                                            { id: 'codex' as const, label: 'Codex 优先', hint: '失败时回退角色' },
                                            { id: 'character' as const, label: '角色总结', hint: selectedParticipant?.name || '需要选择角色' },
                                        ]).map(option => (
                                            <button
                                                key={option.id}
                                                type="button"
                                                onClick={() => { setProgressSummaryMode(option.id); setProgressModeMenuOpen(false); }}
                                                className={`w-full rounded-md px-3 py-2 text-left active:scale-[0.98] ${progressSummaryMode === option.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                                            >
                                                <span className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-800">
                                                    {option.label}
                                                    {progressSummaryMode === option.id && (
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4 4L19 6" /></svg>
                                                    )}
                                                </span>
                                                <span className="mt-0.5 block text-[10px] text-slate-400">{option.hint}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <button type="button" onClick={() => { setProgressPanelOpen(false); setProgressModeMenuOpen(false); }} className="h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-500 flex items-center justify-center active:scale-95" aria-label="关闭">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M18 6 6 18M6 6l12 12" /></svg>
                            </button>
                        </header>
                        <div className="min-h-0 flex-1 overflow-y-auto workbench-index-scroll p-3 sm:p-4 space-y-3">
                            {progressCards.length === 0 ? (
                                <div className="min-h-52 flex flex-col items-center justify-center text-center px-6">
                                    <div className="h-11 w-11 rounded-lg border border-slate-200 bg-white text-slate-400 flex items-center justify-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M8 6h8M8 10h8M8 14h5" /><rect x="4" y="3" width="16" height="18" rx="2" /></svg>
                                    </div>
                                    <p className="mt-3 text-sm font-semibold text-slate-700">还没有进度卡</p>
                                    <p className="mt-1 text-xs text-slate-400">点“生成新卡”后才会总结当前 Code 对话。</p>
                                </div>
                            ) : progressCards.map((card, index) => {
                                const fields = parseProgressCard(card.content);
                                const status = fields['状态'] || '待确认';
                                const statusClass = status.includes('已完成')
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : status.includes('阻塞')
                                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                                        : status.includes('进行中')
                                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                                            : 'bg-slate-50 text-slate-600 border-slate-200';
                                return (
                                    <article key={card.id} className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
                                        <div className="px-4 py-3 border-b border-slate-100 flex items-start gap-3">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] font-semibold text-slate-400">#{progressCards.length - index}</span>
                                                    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${statusClass}`}>{status}</span>
                                                </div>
                                                <h3 className="mt-2 text-sm font-semibold text-slate-900 break-words">{fields['任务'] || session?.title || '未命名任务'}</h3>
                                            </div>
                                            <time className="shrink-0 text-[10px] text-slate-400">{new Date(card.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
                                        </div>
                                        <dl className="px-4 py-3 grid gap-3">
                                            {(['决策', '进度', '待办', '备注'] as const).map(label => fields[label] ? (
                                                <div key={label} className="grid grid-cols-[42px_minmax(0,1fr)] gap-2 text-xs leading-relaxed">
                                                    <dt className="font-semibold text-slate-400">{label}</dt>
                                                    <dd className="text-slate-700 whitespace-pre-wrap break-words">{fields[label]}</dd>
                                                </div>
                                            ) : null)}
                                        </dl>
                                    </article>
                                );
                            })}
                        </div>
                    </section>
                </div>
            )}

            {actionTarget && (
                <div
                    className="absolute inset-0 z-40 bg-black/10 flex items-end justify-center px-4 pb-5"
                    onClick={() => setActionTarget(null)}
                >
                    <div
                        className="w-full max-w-sm rounded-2xl bg-white shadow-xl border border-slate-100 p-2 space-y-1"
                        onClick={e => e.stopPropagation()}
                    >
                        {canEditMessage(actionTarget) && (
                            <button
                                type="button"
                                onClick={() => startEditingMessage(actionTarget)}
                                className="w-full h-11 rounded-xl px-3 flex items-center gap-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 active:scale-[0.99]"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
                                </svg>
                                编辑内容
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => {
                                setQuotedMessage(actionTarget);
                                setActionTarget(null);
                            }}
                            className="w-full h-11 rounded-xl px-3 flex items-center gap-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 active:scale-[0.99]"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10 11H5.5A2.5 2.5 0 0 0 3 13.5V18h4.5A2.5 2.5 0 0 0 10 15.5V11Z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 11h-4.5A2.5 2.5 0 0 0 14 13.5V18h4.5A2.5 2.5 0 0 0 21 15.5V11Z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6V4M14 6V4" />
                            </svg>
                            引用
                        </button>
                        <button
                            type="button"
                            onClick={() => startMultiSelect(actionTarget)}
                            className="w-full h-11 rounded-xl px-3 flex items-center gap-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 active:scale-[0.99]"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 11 12 14 22 4" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                            </svg>
                            多选
                        </button>
                        <button
                            type="button"
                            onClick={() => void deleteSingleMessage(actionTarget)}
                            className="w-full h-11 rounded-xl px-3 flex items-center gap-3 text-left text-sm font-semibold text-rose-500 hover:bg-rose-50 active:scale-[0.99]"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8 6V4h8v2M19 6l-1 14H6L5 6" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10 11v5M14 11v5" />
                            </svg>
                            删除
                        </button>
                    </div>
                </div>
            )}

            {editTarget && (
                <div
                    className="absolute inset-0 z-[55] flex items-center justify-center bg-slate-950/20 p-4 backdrop-blur-[2px]"
                    onClick={() => { setEditTarget(null); setEditContent(''); }}
                >
                    <div
                        className="w-full max-w-md rounded-2xl border border-white/80 bg-white p-4 shadow-2xl"
                        onClick={event => event.stopPropagation()}
                    >
                        <h3 className="text-sm font-semibold text-slate-900">编辑内容</h3>
                        <textarea
                            value={editContent}
                            onChange={event => setEditContent(event.target.value)}
                            autoFocus
                            rows={6}
                            className="mt-3 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-800 outline-none focus:border-violet-200 focus:bg-white"
                        />
                        <div className="mt-3 grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => { setEditTarget(null); setEditContent(''); }}
                                className="h-10 rounded-xl bg-slate-100 text-xs font-semibold text-slate-600 active:scale-[0.99]"
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={() => void saveEditedMessage()}
                                className="h-10 rounded-xl bg-slate-900 text-xs font-semibold text-white active:scale-[0.99]"
                            >
                                保存
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {helpOpen && (
                <div
                    className="absolute inset-0 z-[60] flex items-center justify-center bg-slate-950/25 p-3 backdrop-blur-[2px]"
                    onClick={() => setHelpOpen(false)}
                >
                  <div
                    className="flex max-h-[88%] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/80 bg-[#F7F6FC] text-slate-900 shadow-2xl"
                    onClick={event => event.stopPropagation()}
                  >
                    <header className="shrink-0 border-b border-white/80 bg-white/72 backdrop-blur-xl">
                        <div className="flex items-center gap-3 px-4 py-3">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-violet-100 bg-violet-50 text-violet-600">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="9" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.8 9a2.35 2.35 0 1 1 3.5 2.05c-.8.46-1.3.96-1.3 1.95" />
                                    <path strokeLinecap="round" d="M12 17h.01" />
                                </svg>
                            </span>
                            <div className="min-w-0">
                                <h2 className="text-base font-semibold">Code 使用指南</h2>
                                <p className="mt-0.5 text-[11px] text-slate-500">连接 AI 助理、操作电脑，并邀请角色一起工作</p>
                            </div>
                        </div>
                    </header>

                    <main className="workbench-index-scroll flex-1 overflow-y-auto">
                        <div className="mx-auto w-full max-w-2xl px-5 py-5">
                            <section className="border-b border-slate-200/80 pb-5">
                                <div className="flex items-center gap-2">
                                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-white">1</span>
                                    <h3 className="text-sm font-semibold">先理解两个状态</h3>
                                </div>
                                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    <div className="rounded-lg border border-white bg-white/75 px-3 py-3">
                                        <div className="text-xs font-semibold text-slate-800">仅聊天</div>
                                        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">电脑桥接未连接。配置备用聊天 API 后，星光可催动 AI 助理讨论；闪电催动角色。两者都不能操作电脑。</p>
                                    </div>
                                    <div className="rounded-lg border border-emerald-100 bg-emerald-50/65 px-3 py-3">
                                        <div className="text-xs font-semibold text-emerald-800">电脑已连接</div>
                                        <p className="mt-1 text-[11px] leading-relaxed text-emerald-700/75">自动切换到已连接的 CLI 助理，可读取和修改当前项目、运行命令。</p>
                                    </div>
                                </div>
                            </section>

                            <section className="border-b border-slate-200/80 py-5">
                                <div className="flex items-center gap-2">
                                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-white">2</span>
                                    <h3 className="text-sm font-semibold">在电脑上部署桥接</h3>
                                </div>
                                <ol className="mt-3 space-y-3 text-[11px] leading-relaxed text-slate-600">
                                    <li><strong className="text-slate-800">登录 CLI：</strong>先在电脑终端完成 Codex 或 Claude Code 自己的登录。</li>
                                    <li>
                                        <strong className="text-slate-800">进入 SullyOS 项目目录并启动：</strong>
                                        <code className="mt-1.5 block overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 font-mono text-[10px] text-slate-100">pnpm workbench:bridge</code>
                                    </li>
                                    <li>
                                        <strong className="text-slate-800">手机访问电脑：</strong>让桥接监听局域网，并设置 Key。
                                        <code className="mt-1.5 block overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 font-mono text-[10px] text-slate-100">pnpm workbench:bridge -- --host 0.0.0.0 --port 3001 --token YOUR_KEY</code>
                                    </li>
                                </ol>
                                <div className="mt-3 border-l-2 border-violet-300 pl-3 text-[11px] leading-relaxed text-slate-500">
                                    电脑关闭后桥接会离线。手机仍可保存对话、催动角色；配置备用聊天 API 后，AI 助理仍可聊天，但不能操作电脑。
                                </div>
                            </section>

                            <section className="border-b border-slate-200/80 py-5">
                                <div className="flex items-center gap-2">
                                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-white">3</span>
                                    <h3 className="text-sm font-semibold">设置里的每一项</h3>
                                </div>
                                <div className="mt-3 divide-y divide-slate-200/70 text-[11px]">
                                    {[
                                        ['模式', '远程用于手机连接电脑地址；CLI 用于当前电脑上的本机地址。两边分别保存。'],
                                        ['CLI 路由', '选择 Codex、Claude Code 或自定义命令；连接后显示的 AI 名称来自实际路由。'],
                                        ['地址与 Key', '本机通常填写 http://localhost:3001；手机填写电脑局域网或 Tailscale 地址，并使用启动桥接时的 Key。'],
                                        ['自定义指令', '只提供给 AI 助理，例如“修改 prompt 前先给完整版本确认”。不会改变角色人格。'],
                                        ['模型与档位', '桥接在线后读取 CLI 可用模型；档位控制速度与思考强度。'],
                                        ['Code Memory', '保存跨对话仍有用的偏好和已确认规则，可查看、修改或删除。'],
                                        ['备用聊天 API', 'CLI 离线时接替 AI 助理。复用同一段 Code 历史与自定义指令，但没有文件和命令权限。'],
                                    ].map(([title, body]) => (
                                        <div key={title} className="grid grid-cols-[5.25rem_1fr] gap-3 py-2.5">
                                            <span className="font-semibold text-slate-800">{title}</span>
                                            <span className="leading-relaxed text-slate-500">{body}</span>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            <section className="border-b border-slate-200/80 py-5">
                                <div className="flex items-center gap-2">
                                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-white">4</span>
                                    <h3 className="text-sm font-semibold">聊天时怎么控制谁说话</h3>
                                </div>
                                <div className="mt-3 space-y-2 text-[11px] leading-relaxed text-slate-600">
                                    <p><strong className="text-slate-800">发送：</strong>只把你的消息加入当前 Code 对话，不会自动让两个人轮流说下去。</p>
                                    <p><strong className="text-slate-800">星光：</strong>只催动已连接的 AI 助理回复一次。</p>
                                    <p><strong className="text-slate-800">闪电：</strong>只催动当前选择的角色回复一次。</p>
                                    <p><strong className="text-slate-800">一起工作：</strong>打开后选择一个角色。角色能看到当前 Code 对话和 AI 助理的发言，但回复只留在 Code。</p>
                                </div>
                            </section>

                            <section className="border-b border-slate-200/80 py-5">
                                <div className="flex items-center gap-2">
                                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-white">5</span>
                                    <h3 className="text-sm font-semibold">对话、进度卡和备份</h3>
                                </div>
                                <div className="mt-3 space-y-2 text-[11px] leading-relaxed text-slate-600">
                                    <p><strong className="text-slate-800">右侧索引：</strong>新建、切换、改名或删除独立对话。每个对话保存自己的完整历史。</p>
                                    <p><strong className="text-slate-800">进度卡：</strong>手动总结当前任务。可由 AI 助理或角色生成；角色版会同步成该角色普通聊天里的卡片。</p>
                                    <p><strong className="text-slate-800">删除对话：</strong>删除逐句历史；已经生成的进度卡和 Code Memory 仍作为任务索引保留。</p>
                                    <p><strong className="text-slate-800">同步与导出：</strong>Code 设置、对话、进度卡、Memory 和交互数据都随 SullyOS 完整备份、普通导入导出与增量同步处理。</p>
                                </div>
                            </section>

                            <section className="py-5">
                                <h3 className="text-sm font-semibold">最短使用流程</h3>
                                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">设置 CLI，按需再填备用聊天 API → 新建对话 → 发送需求 → 按星光叫当前可用的 AI 助理，或按闪电叫角色 → 阶段完成后手动生成进度卡。</p>
                            </section>

                            <button
                                type="button"
                                onClick={() => setHelpOpen(false)}
                                className="mb-4 h-11 w-full rounded-lg bg-slate-900 text-sm font-semibold text-white shadow-sm active:scale-[0.99]"
                            >
                                返回 Code
                            </button>
                        </div>
                    </main>
                  </div>
                </div>
            )}

            {settingsOpen && (
                <div className="absolute inset-0 z-50 bg-white flex flex-col text-slate-900">
                    <div className="shrink-0 border-b border-slate-200 bg-white/95" style={{ paddingTop: 'var(--safe-top)' }}>
                        <div className="px-3 py-2.5 flex items-center gap-2">
                            <IconButton label="返回 Code" onClick={() => setSettingsOpen(false)}>
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
                                </svg>
                            </IconButton>
                            <div className="min-w-0 flex-1">
                                <h2 className="text-sm font-semibold">Code 设置</h2>
                                <p className="text-[11px] text-slate-500 mt-0.5">执行模式、CLI 路由、模型、工作档位和用量</p>
                            </div>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto bg-[#f8fafc] workbench-index-scroll">
                        <div className="p-4 space-y-5">
                            <section className="space-y-3">
                                <h3 className="text-xs font-semibold text-slate-500">模式</h3>
                                <div className="grid grid-cols-2 gap-2">
                                    {(['computer', 'cli'] as const).map(runtimeMode => (
                                        <button
                                            key={runtimeMode}
                                            onClick={() => setDraftConfig(prev => ({
                                                ...prev,
                                                runtimeMode,
                                                bridgeUrl: runtimeMode === 'cli'
                                                    ? (prev.cliBridgeUrl || 'http://localhost:3001')
                                                    : (prev.remoteBridgeUrl || ''),
                                            }))}
                                            className={`h-10 rounded-xl border text-xs font-semibold ${draftConfig.runtimeMode === runtimeMode ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 text-slate-600 border-slate-200'}`}
                                        >
                                            {runtimeMode === 'computer' ? '远程' : 'CLI'}
                                        </button>
                                    ))}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setConnectionOpen(prev => !prev)}
                                    className="w-full h-7 flex items-center gap-2 text-left active:scale-[0.995]"
                                    aria-expanded={connectionOpen}
                                >
                                    <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-slate-400 truncate">
                                        {draftConfig.runtimeMode === 'cli'
                                            ? 'CLI 连接当前设备上的 CLI 服务'
                                            : '远程用于手机连接电脑上的 CLI 服务'}
                                    </span>
                                    <span className="max-w-[42%] truncate text-[10px] text-slate-300">
                                        {draftConfig.bridgeUrl || '未填写地址'}
                                    </span>
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${connectionOpen ? 'rotate-180' : ''}`}
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
                                    </svg>
                                </button>
                                {connectionOpen && (
                                    <div className="space-y-3">
                                        <input
                                            value={draftConfig.bridgeUrl}
                                            onChange={e => setDraftConfig(prev => ({
                                                ...prev,
                                                bridgeUrl: e.target.value,
                                                ...(prev.runtimeMode === 'cli'
                                                    ? { cliBridgeUrl: e.target.value }
                                                    : { remoteBridgeUrl: e.target.value }),
                                            }))}
                                            placeholder={draftConfig.runtimeMode === 'cli' ? 'http://localhost:3001' : 'http://电脑IP:3001'}
                                            className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-mono outline-none focus:bg-white focus:border-slate-400"
                                        />
                                        <input
                                            value={draftConfig.token}
                                            onChange={e => setDraftConfig(prev => ({ ...prev, token: e.target.value }))}
                                            placeholder="Key，可留空"
                                            type="password"
                                            className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-mono outline-none focus:bg-white focus:border-slate-400"
                                        />
                                    </div>
                                )}
                            </section>

                            <section className="space-y-3">
                                <h3 className="text-xs font-semibold text-slate-500">CLI 路由</h3>
                                <div className="grid grid-cols-3 gap-2">
                                    {(['codex', 'claude', 'custom'] as const).map(agent => (
                                        <button
                                            key={agent}
                                            onClick={() => {
                                                setDraftConfig(prev => ({ ...prev, defaultAgent: agent, selectedModel: '' }));
                                                setModelOptions([]);
                                                setModelStatus('idle');
                                            }}
                                            className={`h-9 rounded-xl border text-xs font-semibold ${draftConfig.defaultAgent === agent ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}
                                        >
                                            {agent === 'codex' ? 'Codex' : agent === 'claude' ? 'Claude Code' : '自定义'}
                                        </button>
                                    ))}
                                </div>
                                {draftConfig.defaultAgent === 'custom' && (
                                    <input
                                        value={draftConfig.customAgentCommand || ''}
                                        onChange={e => setDraftConfig(prev => ({ ...prev, customAgentCommand: e.target.value }))}
                                        placeholder="例如: codex --approval never"
                                        className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-mono outline-none focus:bg-white focus:border-slate-400"
                                    />
                                )}
                            </section>

                            <section className="space-y-3">
                                <h3 className="text-xs font-semibold text-slate-500">工作档位</h3>
                                <div className="grid grid-cols-3 gap-2">
                                    {(['fast', 'balanced', 'deep'] as const).map(profile => (
                                        <button
                                            key={profile}
                                            onClick={() => setDraftConfig(prev => ({ ...prev, modelProfile: profile }))}
                                            className={`h-9 rounded-xl border text-xs font-semibold ${draftConfig.modelProfile === profile ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}
                                        >
                                            {profileLabel(profile)}
                                        </button>
                                    ))}
                                </div>
                            </section>

                            <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => setInstructionsOpen(prev => !prev)}
                                    className="w-full h-11 px-3 flex items-center gap-2 text-left active:scale-[0.995]"
                                    aria-expanded={instructionsOpen}
                                >
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-xs font-semibold text-slate-500">自定义指令</span>
                                        {!instructionsOpen && draftConfig.customInstructions && (
                                            <span className="block mt-0.5 text-[11px] font-normal text-slate-400 truncate">
                                                {draftConfig.customInstructions}
                                            </span>
                                        )}
                                    </span>
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${instructionsOpen ? 'rotate-180' : ''}`}
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
                                    </svg>
                                </button>
                                {instructionsOpen && (
                                    <div className="px-3 pb-3 space-y-3">
                                        <div className="flex flex-col items-center gap-2 py-1">
                                            <button
                                                type="button"
                                                onClick={() => codexAvatarInputRef.current?.click()}
                                                className="h-16 w-16 rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center text-slate-500 shadow-sm active:scale-95"
                                                aria-label="更换 Code 头像"
                                                title="更换 Code 头像"
                                            >
                                                {draftConfig.codexAvatar ? (
                                                    <img src={draftConfig.codexAvatar} alt="Code 头像" className="h-full w-full object-cover" />
                                                ) : (
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l-4 3 4 3" />
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 9l4 3-4 3" />
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l-4 14" />
                                                    </svg>
                                                )}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => codexAvatarInputRef.current?.click()}
                                                className="text-[11px] font-semibold text-slate-500 active:scale-95"
                                            >
                                                更换 Code 头像
                                            </button>
                                            <input
                                                ref={codexAvatarInputRef}
                                                type="file"
                                                accept="image/*"
                                                className="hidden"
                                                onChange={e => {
                                                    void updateCodexAvatar(e.target.files?.[0]);
                                                    e.currentTarget.value = '';
                                                }}
                                            />
                                        </div>
                                        <textarea
                                            value={draftConfig.customInstructions || ''}
                                            onChange={e => setDraftConfig(prev => ({ ...prev, customInstructions: e.target.value }))}
                                            placeholder="例如：优先小步提交；先读代码再改；遇到冲突先停下说明。"
                                            rows={4}
                                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:bg-white focus:border-slate-400 resize-none"
                                        />
                                    </div>
                                )}
                            </section>

                            <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => setCodeMemoryOpen(prev => !prev)}
                                    className="w-full h-11 px-3 flex items-center gap-2 text-left active:scale-[0.995]"
                                    aria-expanded={codeMemoryOpen}
                                >
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-xs font-semibold text-slate-500">Code Memory</span>
                                        <span className="block mt-0.5 text-[11px] font-normal text-slate-400 truncate">
                                            {codeMemories.length ? `${codeMemories.length} 条长期规则` : '暂无长期规则'}
                                        </span>
                                    </span>
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${codeMemoryOpen ? 'rotate-180' : ''}`}
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
                                    </svg>
                                </button>
                                {codeMemoryOpen && (
                                    <div className="px-3 pb-3 space-y-2">
                                        <p className="text-[11px] leading-relaxed text-slate-400">
                                            进度卡会自动提炼这些跨 Code 对话长期规则；这里可以改或删。
                                        </p>
                                        {codeMemories.length === 0 ? (
                                            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">
                                                还没有 Code Memory
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                {codeMemories.map(memory => (
                                                    <div key={memory.id} className="rounded-xl border border-slate-200 bg-slate-50 p-2 space-y-2">
                                                        <textarea
                                                            value={codeMemoryDrafts[memory.id] ?? memory.content}
                                                            onChange={e => setCodeMemoryDrafts(prev => ({ ...prev, [memory.id]: e.target.value }))}
                                                            rows={2}
                                                            className="w-full rounded-lg border border-white bg-white px-2.5 py-2 text-xs leading-relaxed text-slate-700 outline-none focus:border-slate-300 resize-none"
                                                        />
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span className="text-[10px] text-slate-400">
                                                                {new Date(memory.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                                            </span>
                                                            <div className="flex items-center gap-1.5">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void saveCodeMemory(memory)}
                                                                    className="h-7 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-600 active:scale-95"
                                                                >
                                                                    保存
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void deleteCodeMemory(memory.id)}
                                                                    className="h-7 w-7 rounded-lg border border-rose-100 bg-white text-rose-400 flex items-center justify-center active:scale-95"
                                                                    aria-label="删除 Code Memory"
                                                                    title="删除"
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M18 6 6 18M6 6l12 12" />
                                                                    </svg>
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </section>

                            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                                <button
                                    type="button"
                                    onClick={() => setFallbackApiOpen(prev => !prev)}
                                    className="flex min-h-12 w-full items-center gap-2 px-3 py-2.5 text-left active:scale-[0.995]"
                                    aria-expanded={fallbackApiOpen}
                                >
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-xs font-semibold text-slate-500">备用聊天 API</span>
                                        <span className="mt-0.5 block truncate text-[11px] font-normal text-slate-400">
                                            {draftConfig.fallbackApiBaseUrl?.trim() && draftConfig.fallbackApiModel?.trim()
                                                ? `已配置 · ${draftConfig.fallbackApiModel.trim()}`
                                                : '未配置 · CLI 离线时接替 AI 助理'}
                                        </span>
                                    </span>
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${fallbackApiOpen ? 'rotate-180' : ''}`}
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
                                    </svg>
                                </button>
                                {fallbackApiOpen && (
                                    <div className="space-y-3 border-t border-slate-100 px-3 pb-3 pt-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <p className="text-[11px] leading-relaxed text-slate-400">电脑或 CLI 离线时接替 AI 助理，仅聊天，不读取文件或运行命令。API 地址格式与系统 API 配置一致。</p>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setDraftConfig(prev => ({
                                                        ...prev,
                                                        fallbackApiBaseUrl: apiConfig.baseUrl || '',
                                                        fallbackApiKey: apiConfig.apiKey || '',
                                                        fallbackApiModel: apiConfig.model || '',
                                                    }));
                                                    setFallbackModelOptions([]);
                                                    setFallbackModelStatus('idle');
                                                    addToast(apiConfig.baseUrl ? '已引用系统 API 配置' : '系统 API 尚未配置', apiConfig.baseUrl ? 'success' : 'info');
                                                }}
                                                className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[10px] font-semibold text-slate-500 active:scale-95"
                                            >
                                                引用系统 API
                                            </button>
                                        </div>
                                        <input
                                            value={draftConfig.fallbackApiBaseUrl || ''}
                                            onChange={e => setDraftConfig(prev => ({ ...prev, fallbackApiBaseUrl: e.target.value }))}
                                            placeholder={apiConfig.baseUrl || 'https://...'}
                                            className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-mono outline-none focus:bg-white focus:border-slate-400"
                                        />
                                        <input
                                            value={draftConfig.fallbackApiKey || ''}
                                            onChange={e => setDraftConfig(prev => ({ ...prev, fallbackApiKey: e.target.value }))}
                                            placeholder="API Key"
                                            type="password"
                                            className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-mono outline-none focus:bg-white focus:border-slate-400"
                                        />
                                        <div className="flex gap-2">
                                            {fallbackModelOptions.length > 0 ? (
                                                <select
                                                    value={draftConfig.fallbackApiModel || ''}
                                                    onChange={e => setDraftConfig(prev => ({ ...prev, fallbackApiModel: e.target.value }))}
                                                    className="min-w-0 flex-1 h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:bg-white focus:border-slate-400"
                                                    aria-label="备用 API 模型"
                                                >
                                                    <option value="">选择模型</option>
                                                    {!!draftConfig.fallbackApiModel && !fallbackModelOptions.some(model => model.id === draftConfig.fallbackApiModel) && (
                                                        <option value={draftConfig.fallbackApiModel}>{draftConfig.fallbackApiModel}</option>
                                                    )}
                                                    {fallbackModelOptions.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
                                                </select>
                                            ) : (
                                                <input
                                                    value={draftConfig.fallbackApiModel || ''}
                                                    onChange={e => setDraftConfig(prev => ({ ...prev, fallbackApiModel: e.target.value }))}
                                                    placeholder="模型 ID"
                                                    className="min-w-0 flex-1 h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-mono outline-none focus:bg-white focus:border-slate-400"
                                                />
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => void refreshFallbackModelOptions()}
                                                disabled={fallbackModelStatus === 'loading' || !draftConfig.fallbackApiBaseUrl?.trim()}
                                                className="h-10 w-10 shrink-0 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 flex items-center justify-center active:scale-95 disabled:opacity-40"
                                                aria-label="刷新备用 API 模型"
                                                title="刷新模型"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${fallbackModelStatus === 'loading' ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 11a8 8 0 1 0 2 5.3M20 4v7h-7" />
                                                </svg>
                                            </button>
                                        </div>
                                        <input
                                            value={draftConfig.fallbackApiName || ''}
                                            onChange={e => setDraftConfig(prev => ({ ...prev, fallbackApiName: e.target.value }))}
                                            placeholder="显示名：AI 助理"
                                            className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:bg-white focus:border-slate-400"
                                        />
                                    </div>
                                )}
                            </section>

                            <section className="space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <h3 className="text-xs font-semibold text-slate-500">模型</h3>
                                        <p className="mt-1 text-[11px] text-slate-400">
                                            {bridgeStatus === 'online' ? '由当前 CLI 账户提供' : '连接 CLI 后读取可用模型'}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => void refreshModelOptions(draftConfig)}
                                        disabled={modelStatus === 'loading'}
                                        className="w-9 h-9 shrink-0 rounded-xl border border-slate-200 bg-white text-slate-500 flex items-center justify-center disabled:opacity-45"
                                        aria-label="刷新模型列表"
                                        title="刷新模型列表"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 ${modelStatus === 'loading' ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
                                        </svg>
                                    </button>
                                </div>
                                {modelOptions.length > 0 ? (
                                    <select
                                        value={draftConfig.selectedModel || ''}
                                        onChange={e => setDraftConfig(prev => ({ ...prev, selectedModel: e.target.value }))}
                                        className="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                                    >
                                        <option value="">跟随 CLI 默认</option>
                                        {!!draftConfig.selectedModel && !modelOptions.some(model => model.id === draftConfig.selectedModel) && (
                                            <option value={draftConfig.selectedModel}>{draftConfig.selectedModel}</option>
                                        )}
                                        {modelOptions.map(model => (
                                            <option key={model.id} value={model.id}>{model.label}</option>
                                        ))}
                                    </select>
                                ) : (
                                    <input
                                        value={draftConfig.selectedModel || ''}
                                        onChange={e => setDraftConfig(prev => ({ ...prev, selectedModel: e.target.value }))}
                                        placeholder={modelStatus === 'loading' ? '正在读取模型列表…' : '模型 ID；留空则跟随 CLI 默认'}
                                        disabled={modelStatus === 'loading'}
                                        className="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-mono outline-none focus:border-slate-400 disabled:opacity-55"
                                    />
                                )}
                                {draftConfig.selectedModel && modelOptions.length > 0 && (
                                    <p className="text-[11px] text-slate-400">
                                        {modelOptions.find(model => model.id === draftConfig.selectedModel)?.description || `将使用 ${draftConfig.selectedModel}`}
                                    </p>
                                )}
                            </section>

                            <section className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-xs font-semibold text-slate-500">用量监控</h3>
                                    <span className="text-[11px] text-slate-400">官方 + 本地</span>
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
                                    <div className="rounded-lg border border-white bg-white px-3 py-2.5 space-y-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <div>
                                                <div className="text-[11px] text-slate-400">官方用量</div>
                                                <div className="mt-1 text-sm font-semibold text-slate-800">{officialUsageTitle}</div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => void refreshOfficialUsage(draftConfig)}
                                                disabled={officialUsageStatus === 'loading' || !draftConfig.bridgeUrl.trim()}
                                                className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-500 active:scale-95 disabled:opacity-40"
                                            >
                                                {officialUsageStatus === 'loading' ? '同步中' : '刷新'}
                                            </button>
                                        </div>
                                        {officialUsagePercent !== undefined && (
                                            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${officialUsagePercent}%` }} />
                                            </div>
                                        )}
                                        <div className="text-[11px] text-slate-400">{officialUsageHint}</div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        {[
                                            ['当前', usageStats.current],
                                            ['本周', usageStats.week],
                                            ['本月', usageStats.month],
                                            ['累计', usageStats.total],
                                        ].map(([label, value]) => (
                                            <div key={label} className="rounded-lg border border-white bg-white px-3 py-2">
                                                <div className="text-[11px] text-slate-400">{label}</div>
                                                <div className="mt-1 text-sm font-semibold text-slate-800">{formatTokens(Number(value))}</div>
                                            </div>
                                        ))}
                                    </div>
                                    {usageLimit > 0 && (
                                        <div className="space-y-1.5">
                                            <div className="flex items-center justify-between text-[11px] text-slate-500">
                                                <span>月度提醒进度</span>
                                                <span>{usagePct}%</span>
                                            </div>
                                            <div className="h-1.5 rounded-full bg-white overflow-hidden">
                                                <div className="h-full rounded-full bg-slate-900 transition-all" style={{ width: `${usagePct}%` }} />
                                            </div>
                                        </div>
                                    )}
                                    <input
                                        value={draftConfig.monthlyUsageLimit || ''}
                                        onChange={e => setDraftConfig(prev => ({ ...prev, monthlyUsageLimit: Number(e.target.value || 0) }))}
                                        placeholder="月度提醒上限，可留空"
                                        type="number"
                                        min={0}
                                        className="mt-3 w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                                    />
                                </div>
                            </section>

                            <div className="grid grid-cols-2 gap-2 sticky bottom-0 bg-[#f8fafc] pt-2 pb-1" style={{ paddingBottom: 'max(0.25rem, var(--safe-bottom))' }}>
                                <button onClick={testBridge} disabled={testing || !draftConfig.bridgeUrl.trim()} className="h-10 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-600 active:scale-95 disabled:opacity-40">
                                    {testing ? '测试中' : '测试连接'}
                                </button>
                                <button onClick={savePanelConfig} className="h-10 rounded-xl bg-slate-900 text-white text-xs font-semibold active:scale-95">
                                    保存设置
                                </button>
                            </div>
                            {testResult && (
                                <p className={`text-xs ${testResult.includes('成功') || testResult === '已保存' ? 'text-emerald-600' : 'text-rose-600'}`}>{testResult}</p>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorkbenchApp;


