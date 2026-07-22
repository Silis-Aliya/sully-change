import type {
    APIConfig,
    CharacterProfile,
    GroupProfile,
    Message,
    RealtimeConfig,
    UserProfile,
    WorkbenchBridgeConfig,
    WorkbenchArtifact,
    WorkbenchOfficialUsage,
    WorkbenchMemory,
    WorkbenchMessage,
    WorkbenchMode,
    WorkbenchSummary,
} from '../types';
import { extractContent, safeResponseJson } from './safeApi';

export const WORKBENCH_CONFIG_KEY = 'workbench_bridge_config_v1';
export const WORKBENCH_MODE_KEY = 'workbench_mode_v1';

export const DEFAULT_WORKBENCH_CONFIG: WorkbenchBridgeConfig = {
    bridgeUrl: '',
    remoteBridgeUrl: '',
    cliBridgeUrl: 'http://localhost:3001',
    token: '',
    runtimeMode: 'computer',
    defaultAgent: 'codex',
    customAgentCommand: '',
    selectedModel: '',
    modelProfile: 'balanced',
    customInstructions: '',
    codexAvatar: '',
    monthlyUsageLimit: 0,
    participantEnabled: false,
    participantCharacterId: '',
    fallbackApiBaseUrl: '',
    fallbackApiKey: '',
    fallbackApiModel: '',
    fallbackApiName: 'AI 助理',
};

export type WorkbenchCapabilityMode = 'work' | 'inspiration';
export type WorkbenchClientDevice = 'mobile' | 'desktop';
export type WorkbenchModelOption = {
    id: string;
    label: string;
    description?: string;
    reasoningEfforts?: string[];
};

export const fetchWorkbenchFallbackModels = async (config: WorkbenchBridgeConfig): Promise<WorkbenchModelOption[]> => {
    const base = String(config.fallbackApiBaseUrl || '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('请先填写备用聊天 API 地址');
    const res = await fetch(`${base}/models`, {
        headers: config.fallbackApiKey ? { Authorization: `Bearer ${config.fallbackApiKey}` } : undefined,
    });
    if (!res.ok) throw new Error(`备用 API 模型列表读取失败 (${res.status})`);
    const data = await safeResponseJson(res);
    const rows = Array.isArray((data as any)?.data)
        ? (data as any).data
        : Array.isArray((data as any)?.models)
            ? (data as any).models
            : [];
    return rows.flatMap((row: any) => {
        const id = String(typeof row === 'string' ? row : row?.id || row?.name || '').trim();
        return id ? [{ id, label: String(row?.label || row?.display_name || id) }] : [];
    });
};

export const detectWorkbenchClientDevice = (): WorkbenchClientDevice => {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return 'desktop';
    const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
    if (nav.userAgentData?.mobile === true) return 'mobile';
    if (/Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(nav.userAgent || '')) return 'mobile';
    const coarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const narrowViewport = Math.min(window.innerWidth || Infinity, window.screen?.width || Infinity) <= 820;
    return coarsePointer && narrowViewport ? 'mobile' : 'desktop';
};

const LOCAL_BRIDGE_URL_RE = /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/.*)?$/i;

const normalizeBridgeUrl = (value?: string): string => String(value || '').trim().replace(/\/+$/, '');

const isLocalBridgeUrl = (value?: string): boolean => LOCAL_BRIDGE_URL_RE.test(normalizeBridgeUrl(value));

export const resolveWorkbenchBridgeConfigForClient = (
    config: WorkbenchBridgeConfig,
    _device: WorkbenchClientDevice = detectWorkbenchClientDevice(),
): WorkbenchBridgeConfig => {
    const remoteBridgeUrl = normalizeBridgeUrl(config.remoteBridgeUrl);
    const cliBridgeUrl = normalizeBridgeUrl(config.cliBridgeUrl || DEFAULT_WORKBENCH_CONFIG.cliBridgeUrl);
    const legacyUrl = normalizeBridgeUrl(config.bridgeUrl);
    const activeUrl = remoteBridgeUrl || (!isLocalBridgeUrl(legacyUrl) ? legacyUrl : '');
    return {
        ...config,
        remoteBridgeUrl,
        cliBridgeUrl,
        bridgeUrl: activeUrl,
        runtimeMode: 'computer',
    };
};

export type WorkbenchDeviceCapability = {
    space: WorkbenchCapabilityMode;
    bridgeOnline: boolean;
    executeMode: boolean;
};

export type WorkbenchBridgeReply = {
    reply: string;
    agent?: string;
    displayName?: string;
    artifacts?: Array<Omit<WorkbenchArtifact, 'sessionId' | 'storageKind' | 'createdAt'>>;
};

export const loadWorkbenchBridgeConfig = (): WorkbenchBridgeConfig => {
    try {
        const raw = localStorage.getItem(WORKBENCH_CONFIG_KEY);
        if (!raw) return resolveWorkbenchBridgeConfigForClient({ ...DEFAULT_WORKBENCH_CONFIG });
        const parsed = JSON.parse(raw) as Partial<WorkbenchBridgeConfig>;
        const legacyUrl = String(parsed.bridgeUrl || '').trim();
        const cliBridgeUrl = String(parsed.cliBridgeUrl ?? DEFAULT_WORKBENCH_CONFIG.cliBridgeUrl).trim();
        const remoteBridgeUrl = String(
            parsed.remoteBridgeUrl
            ?? (!isLocalBridgeUrl(legacyUrl) ? legacyUrl : '')
            ?? '',
        ).trim();
        return resolveWorkbenchBridgeConfigForClient({
            ...DEFAULT_WORKBENCH_CONFIG,
            ...parsed,
            runtimeMode: 'computer',
            remoteBridgeUrl,
            cliBridgeUrl,
            bridgeUrl: remoteBridgeUrl,
        });
    } catch {
        return resolveWorkbenchBridgeConfigForClient({ ...DEFAULT_WORKBENCH_CONFIG });
    }
};

export const saveWorkbenchBridgeConfig = (config: WorkbenchBridgeConfig): void => {
    const runtimeMode: WorkbenchBridgeConfig['runtimeMode'] = 'computer';
    const bridgeCandidate = normalizeBridgeUrl(config.bridgeUrl);
    const remoteBridgeUrl = normalizeBridgeUrl(config.remoteBridgeUrl) || (!isLocalBridgeUrl(bridgeCandidate) ? bridgeCandidate : '');
    const cliBridgeUrl = normalizeBridgeUrl(config.cliBridgeUrl ?? DEFAULT_WORKBENCH_CONFIG.cliBridgeUrl);
    localStorage.setItem(WORKBENCH_CONFIG_KEY, JSON.stringify({
        ...config,
        bridgeUrl: remoteBridgeUrl,
        remoteBridgeUrl,
        cliBridgeUrl,
        token: config.token.trim(),
        runtimeMode,
        customAgentCommand: config.customAgentCommand?.trim() || '',
        selectedModel: config.selectedModel?.trim() || '',
        modelProfile: config.modelProfile || 'balanced',
        customInstructions: config.customInstructions?.trim() || '',
        codexAvatar: config.codexAvatar || '',
        monthlyUsageLimit: Number(config.monthlyUsageLimit || 0),
        participantEnabled: !!config.participantEnabled,
        participantCharacterId: config.participantCharacterId || '',
        fallbackApiBaseUrl: normalizeBridgeUrl(config.fallbackApiBaseUrl),
        fallbackApiKey: config.fallbackApiKey?.trim() || '',
        fallbackApiModel: config.fallbackApiModel?.trim() || '',
        fallbackApiName: config.fallbackApiName?.trim() || 'AI 助理',
    }));
};

export const loadWorkbenchMode = (): WorkbenchMode => {
    try {
        return localStorage.getItem(WORKBENCH_MODE_KEY) === 'sully' ? 'sully' : 'codex';
    } catch {
        return 'codex';
    }
};

export const saveWorkbenchMode = (mode: WorkbenchMode): void => {
    localStorage.setItem(WORKBENCH_MODE_KEY, mode);
};

const bridgeHeaders = (config: WorkbenchBridgeConfig): HeadersInit => ({
    'Content-Type': 'application/json',
    ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
});

export const testWorkbenchBridge = async (config: WorkbenchBridgeConfig): Promise<string> => {
    if (!config.bridgeUrl.trim()) throw new Error('请先填写电脑桥接地址');
    const base = config.bridgeUrl.trim().replace(/\/+$/, '');
    const res = await fetch(`${base}/health`, {
        method: 'POST',
        headers: bridgeHeaders(config),
        body: JSON.stringify({
            agent: config.defaultAgent,
            customAgentCommand: config.customAgentCommand || undefined,
        }),
    });
    if (!res.ok) throw new Error(`电脑桥接连接失败 (${res.status})`);
    const text = await res.text().catch(() => '');
    return text || '电脑桥接 online';
};

const asPercent = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.min(100, Math.round(value)));
    if (typeof value === 'string') {
        const parsed = Number(value.replace('%', '').trim());
        if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, Math.round(parsed)));
    }
    return undefined;
};

export const fetchWorkbenchOfficialUsage = async (config: WorkbenchBridgeConfig): Promise<WorkbenchOfficialUsage> => {
    if (!config.bridgeUrl.trim()) throw new Error('请先填写电脑桥接地址');
    const base = config.bridgeUrl.trim().replace(/\/+$/, '');
    const res = await fetch(`${base}/usage`, { headers: bridgeHeaders(config) });
    if (!res.ok) throw new Error(`官方 Codex 用量不可读取 (${res.status})`);
    const data = await res.json().catch(() => null);
    if (!data || typeof data !== 'object') throw new Error('官方 Codex 用量返回格式无效');
    const record = data as Record<string, any>;
    const weeklyPercent = asPercent(record.weeklyPercent ?? record.weekPercent ?? record.percent ?? record.usedPercent);
    const remainingPercent = asPercent(record.remainingPercent ?? record.remaining ?? record.availablePercent);
    const usedPercent = weeklyPercent ?? (remainingPercent === undefined ? undefined : 100 - remainingPercent);
    return {
        label: typeof record.label === 'string' ? record.label : undefined,
        weeklyPercent,
        remainingPercent,
        usedPercent,
        resetAt: typeof record.resetAt === 'string' ? record.resetAt : undefined,
        updatedAt: Date.now(),
        raw: record,
    };
};

export const fetchWorkbenchModels = async (config: WorkbenchBridgeConfig): Promise<WorkbenchModelOption[]> => {
    if (!config.bridgeUrl.trim()) throw new Error('请先填写 CLI 地址');
    const base = config.bridgeUrl.trim().replace(/\/+$/, '');
    const res = await fetch(`${base}/models`, {
        method: 'POST',
        headers: bridgeHeaders(config),
        body: JSON.stringify({
            agent: config.defaultAgent,
            customAgentCommand: config.customAgentCommand || undefined,
        }),
    });
    if (!res.ok) throw new Error(`模型列表读取失败 (${res.status})`);
    const data = await res.json().catch(() => null);
    const rows = data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).models)
        ? (data as { models: unknown[] }).models
        : [];
    return rows.flatMap(row => {
        if (!row || typeof row !== 'object') return [];
        const item = row as Record<string, unknown>;
        const id = String(item.id || '').trim();
        if (!id) return [];
        return [{
            id,
            label: String(item.label || id),
            description: typeof item.description === 'string' ? item.description : undefined,
            reasoningEfforts: Array.isArray(item.reasoningEfforts)
                ? item.reasoningEfforts.map(String).filter(Boolean)
                : undefined,
        }];
    });
};

export const sendWorkbenchBridgeMessage = async (
    config: WorkbenchBridgeConfig,
    args: {
        sessionId: string;
        mode: WorkbenchMode;
        capabilityMode?: 'chat' | 'execute';
        content: string;
        recentMessages: WorkbenchMessage[];
        taskIndex?: string;
    },
): Promise<WorkbenchBridgeReply> => {
    if (!config.bridgeUrl.trim()) {
        return { reply: '电脑桥接还没有配置。请点 Code 右上角设置，选择远程或 CLI，并填写地址。' };
    }
    const base = config.bridgeUrl.trim().replace(/\/+$/, '');
    const res = await fetch(`${base}/message`, {
        method: 'POST',
        headers: bridgeHeaders(config),
        body: JSON.stringify({
            sessionId: args.sessionId,
            mode: args.mode,
            capabilityMode: args.capabilityMode || 'chat',
            clientDevice: detectWorkbenchClientDevice(),
            runtimeMode: config.runtimeMode || 'computer',
            agent: config.defaultAgent,
            customAgentCommand: config.customAgentCommand || undefined,
            selectedModel: config.selectedModel || undefined,
            modelProfile: config.modelProfile || 'balanced',
            customInstructions: config.customInstructions || undefined,
            monthlyUsageLimit: config.monthlyUsageLimit || undefined,
            content: args.content,
            recentMessages: args.recentMessages.map(serializeWorkbenchMessage),
            taskIndex: args.taskIndex || undefined,
        }),
    });
    if (!res.ok) throw new Error(`电脑桥接请求失败 (${res.status})`);
    const data = await res.json().catch(() => null);
    if (data && typeof data === 'object') {
        const record = data as Record<string, any>;
        return {
            reply: String(record.reply || record.content || record.message || ''),
            agent: typeof record.agent === 'string' ? record.agent : undefined,
            displayName: typeof record.displayName === 'string' ? record.displayName : undefined,
            artifacts: Array.isArray(record.artifacts) ? record.artifacts : [],
        };
    }
    return { reply: typeof data === 'string' ? data : '' };
};

export const sendWorkbenchFallbackMessage = async (
    config: WorkbenchBridgeConfig,
    args: {
        content: string;
        recentMessages: WorkbenchMessage[];
        taskIndex?: string;
    },
): Promise<WorkbenchBridgeReply> => {
    const base = String(config.fallbackApiBaseUrl || '').trim().replace(/\/+$/, '');
    const model = String(config.fallbackApiModel || '').trim();
    if (!base || !model) throw new Error('请先配置备用聊天 API 和模型');

    const history = args.recentMessages.map(message => ({
        role: message.role === 'user' ? 'user' : 'assistant',
        content: `[${message.role === 'user' ? '用户' : message.role === 'character' || message.role === 'sully' ? `角色 ${message.metadata?.speakerName || ''}`.trim() : `AI 助手 ${message.metadata?.speakerName || ''}`.trim()}]\n${workbenchContentForContext(message)}`,
    }));
    const systemParts = [
        config.customInstructions?.trim(),
        `[当前设备]\n当前客户端设备：${detectWorkbenchClientDevice() === 'mobile' ? '手机/平板' : '电脑'}\n电脑桥接：未连接\n当前能力：仅聊天`,
        args.taskIndex?.trim() ? `当前 Code 进度索引：\n${args.taskIndex.trim()}` : '',
    ].filter(Boolean);
    const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(config.fallbackApiKey ? { Authorization: `Bearer ${config.fallbackApiKey}` } : {}),
        },
        body: JSON.stringify({
            model,
            messages: [
                ...(systemParts.length ? [{ role: 'system', content: systemParts.join('\n\n') }] : []),
                ...history,
                { role: 'user', content: args.content },
            ],
            stream: false,
        }),
    });
    if (!res.ok) throw new Error(`备用聊天 API 请求失败 (${res.status})`);
    const data = await safeResponseJson(res);
    return {
        reply: extractContent(data).trim(),
        agent: 'fallback',
        displayName: config.fallbackApiName?.trim() || 'AI 助理',
    };
};

export const downloadWorkbenchArtifact = async (
    config: WorkbenchBridgeConfig,
    artifact: Pick<WorkbenchArtifact, 'name' | 'relativePath'>,
): Promise<void> => {
    if (!config.bridgeUrl.trim() || !artifact.relativePath) throw new Error('电脑桥接未连接或文件路径无效');
    const base = config.bridgeUrl.trim().replace(/\/+$/, '');
    const res = await fetch(`${base}/artifact?path=${encodeURIComponent(artifact.relativePath)}`, {
        headers: config.token ? { Authorization: `Bearer ${config.token}` } : undefined,
    });
    if (!res.ok) throw new Error(`文件下载失败 (${res.status})`);
    const url = URL.createObjectURL(await res.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = artifact.name || 'download';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
};

export const CODEX_PROGRESS_CARD_PROMPT = `根据当前 Code 对话进行固定格式总结。

要求：
只总结任务目标、当前状态、已确认决策、已完成进度、待办/阻塞。

用简短内容写明功能、用途，关键信息。

语气保持中性、清晰简洁准确。 

输出必须是纯文本。

严格遵守以下格式：
[Code 进度]
任务：{一句话任务名}
状态：{进行中/已完成/待确认/阻塞}
决策：{本轮确认的关键决策；没有则写“暂无新增”}
进度：{本轮完成了什么}
待办：{下一步；没有则写“暂无”}
备注：{已尝试的废弃决策}`;

export const summarizeWorkbenchProgressCardWithBridge = async (
    config: WorkbenchBridgeConfig,
    args: {
        sessionId: string;
        sessionTitle?: string;
        messages: WorkbenchMessage[];
        taskIndex?: string;
    },
): Promise<string> => {
    const transcript = args.messages.slice(-80).map(m => {
        const speaker = workbenchSpeaker(m);
        const content = workbenchContentForContext(m);
        return `${speaker}: ${content}`;
    }).join('\n');
    const result = await sendWorkbenchBridgeMessage(config, {
        sessionId: args.sessionId,
        mode: 'codex',
        content: [
            CODEX_PROGRESS_CARD_PROMPT,
            '',
            `当前 Code 对话：${args.sessionTitle || '未命名任务'}`,
            '',
            transcript || '（暂无对话内容）',
        ].join('\n'),
        recentMessages: args.messages.slice(-10),
        taskIndex: args.taskIndex,
    });
    return result.reply;
};

export const CODE_MEMORY_EXTRACTION_PROMPT = `[系统提示：根据当前 Code 对话和进度卡，提取值得跨对话长期保留的 Code Memory。

仅保留未来继续项目时仍有用且已确认的信息：
- 用户明确表达过的长期偏好、命名偏好、UI/交互偏好、工作流偏好。
- 已确定的架构、规则与工作流决策

排除：
- 代码全文、diff及大段文件内容
- 临时待办、试错、废案和未确认想法
- 模型建议，除非用户已确认
- 闲聊、情绪及私密内容

不得推测或补充。每条独立成句，简短明确，最多5条。只输出Memory内容，不解释、不加标题、不使用JSON；没有可保留内容时只输出：暂无。]`;

const normalizeCodeMemoryLine = (line: string): string => line
    .replace(/^[-*]\s*/, '')
    .replace(/^\d+[.)、]\s*/, '')
    .trim();

export const parseCodeMemoryExtraction = (text: string): string[] => {
    const cleaned = text.trim();
    if (!cleaned || cleaned === '暂无') return [];
    return cleaned
        .split(/\n+/)
        .map(normalizeCodeMemoryLine)
        .filter(line => line && line !== '暂无')
        .slice(0, 5);
};

export const extractWorkbenchCodeMemories = async (
    apiConfig: APIConfig,
    args: {
        sessionTitle?: string;
        messages: WorkbenchMessage[];
        progressCard: string;
    },
): Promise<string[]> => {
    if (!apiConfig.baseUrl || !apiConfig.model) throw new Error('请先配置主 API');
    const transcript = args.messages.slice(-80).map(m => {
        const speaker = workbenchSpeaker(m);
        const content = workbenchContentForContext(m);
        return `${speaker}: ${content}`;
    }).join('\n');
    const res = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(apiConfig.apiKey ? { Authorization: `Bearer ${apiConfig.apiKey}` } : {}),
        },
        body: JSON.stringify({
            model: apiConfig.model,
            messages: [
                { role: 'system', content: CODE_MEMORY_EXTRACTION_PROMPT },
                {
                    role: 'user',
                    content: [
                        `当前 Code 对话：${args.sessionTitle || '未命名任务'}`,
                        '',
                        '[当前 Code 对话]',
                        transcript || '（暂无对话内容）',
                        '',
                        '[本轮进度卡]',
                        args.progressCard,
                    ].join('\n'),
                },
            ],
            temperature: 0.1,
            stream: false,
        }),
    });
    if (!res.ok) throw new Error(`Code Memory 提炼失败 (${res.status})`);
    const data = await safeResponseJson(res);
    return parseCodeMemoryExtraction(extractContent(data));
};

export const buildCharacterProgressCardPrompt = (args: {
    userName: string;
    charName: string;
    sessionTitle?: string;
    messages: WorkbenchMessage[];
}): string => {
    const transcript = args.messages.slice(-80).map(m => {
        const speaker = workbenchSpeaker(m);
        const content = workbenchContentForContext(m);
        return `${speaker}: ${content}`;
    }).join('\n');

    return `[系统提示（非用户发言）：你正在 Code 区与${args.userName}一起讨论。下面是本轮 Code 对话的临时内容，根据内容整理一张进度卡。]

当前 Code 对话：${args.sessionTitle || '未命名任务'}

${transcript || '（暂无对话内容）'}

要求：
以你的语气和性格总结任务目标、当前状态、已确认决策、已完成进度、待办/阻塞。

用简短内容写明功能、用途和关键信息。

内容保持清晰、简洁、准确。

输出必须是纯文本。

严格遵守以下格式：
[Code 进度]
任务：{一句话任务名}
状态：{进行中/已完成/待确认/阻塞}
决策：{本轮确认的关键决策；没有则写“暂无新增”}
进度：{本轮完成了什么}
待办：{下一步；没有则写“暂无”}
备注：{简易思考和规划意见}`;
};

export const summarizeWorkbenchProgressCardWithCharacter = async (args: {
    apiConfig: APIConfig;
    char: CharacterProfile;
    userProfile: UserProfile;
    groups: GroupProfile[];
    realtimeConfig?: RealtimeConfig;
    sessionTitle?: string;
    messages: WorkbenchMessage[];
}): Promise<string> => {
    const { apiConfig, char, userProfile, groups, realtimeConfig } = args;
    if (!apiConfig.baseUrl || !apiConfig.model) throw new Error('请先配置主 API');
    const { DB } = await import('./db');
    const { ChatPrompts } = await import('./chatPrompts');
    const { buildChatRequestPayload } = await import('./chatRequestPayload');
    const { loadMusicPlaybackSnapshot } = await import('../context/MusicContext');
    const emojis = await DB.getEmojis().catch(() => []);
    const categories = await DB.getEmojiCategories().catch(() => []);
    const visibleEmojiSet = ChatPrompts.filterVisibleEmojis(emojis, categories, char.id);
    const contextLimit = Math.min(char.contextLimit || 500, 120);
    const historyMsgs = await DB.getRecentMessagesByCharId(char.id, contextLimit, true).catch(() => []);
    const payload = await buildChatRequestPayload({
        char,
        userProfile,
        groups,
        emojis: visibleEmojiSet.emojis,
        categories: visibleEmojiSet.categories,
        historyMsgs,
        recentMsgsHint: historyMsgs.slice(-80),
        contextLimit,
        realtimeConfig,
        musicSnapshot: loadMusicPlaybackSnapshot(),
        htmlMode: { enabled: !!(char as any).htmlModeEnabled, customPrompt: (char as any).htmlModeCustomPrompt },
        thinkingChain: { enabled: !!(char as any).showThinkingChain, customPrompt: (char as any).thinkingChainCustomPrompt },
    });
    const messages = [
        ...payload.fullMessages,
        {
            role: 'user',
            content: buildCharacterProgressCardPrompt({
                userName: userProfile?.name || '用户',
                charName: char.name,
                sessionTitle: args.sessionTitle,
                messages: args.messages,
            }),
        },
    ];
    const res = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(apiConfig.apiKey ? { Authorization: `Bearer ${apiConfig.apiKey}` } : {}),
        },
        body: JSON.stringify({
            model: apiConfig.model,
            messages,
            temperature: 0.65,
            stream: false,
        }),
    });
    if (!res.ok) throw new Error(`角色进度卡总结失败 (${res.status})`);
    const data = await safeResponseJson(res);
    return extractContent(data).trim();
};

export const buildWorkbenchSummaryText = (content: string, now = Date.now(), label = '工作区'): string => {
    const stamp = new Date(now).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
    const oneLine = content.replace(/\s+/g, ' ').trim();
    const clipped = oneLine.length > 28 ? `${oneLine.slice(0, 28)}...` : oneLine;
    return `[${label}] ${stamp} ${clipped || '更新了一轮工作对话'}`.slice(0, 50);
};

export const buildWorkbenchSummaryPrompt = async (): Promise<string> => {
    const { DB } = await import('./db');
    const summaries = await DB.getRecentWorkbenchSummaries(8).catch(() => []);
    if (!summaries.length) return '';
    return [
        '[工作区摘要便签]',
        '以下只是一句话工作状态摘要，不是聊天历史，也不应写入记忆宫殿：',
        ...summaries.map(s => `- ${s.content}`),
    ].join('\n');
};

export const buildWorkbenchCodeMemoryIndex = async (limit = 20): Promise<string> => {
    const { DB } = await import('./db');
    const memories = await DB.getRecentWorkbenchMemories(limit).catch(() => [] as WorkbenchMemory[]);
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const memory of [...memories].sort((a, b) => b.updatedAt - a.updatedAt)) {
        const content = memory.content.replace(/\s+/g, ' ').trim();
        const key = content.toLowerCase();
        if (!content || seen.has(key)) continue;
        seen.add(key);
        lines.push(`- ${content}`);
        if (lines.length >= limit) break;
    }
    return lines.join('\n');
};

export const buildWorkbenchCurrentProgressContext = async (sessionId: string, limit = 6): Promise<string> => {
    if (!sessionId) return '';
    const { DB } = await import('./db');
    const summaries = await DB.getRecentWorkbenchSummaries(Math.max(limit * 6, limit)).catch(() => [] as WorkbenchSummary[]);
    const currentSummaries = summaries
        .filter(summary => summary.sessionId === sessionId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(-limit);
    if (!currentSummaries.length) return '';
    return [
        '[当前 Code 对话已保存进度卡]',
        ...currentSummaries.map(summary => {
            const stamp = new Date(summary.createdAt).toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
            });
            const author = summary.sourceName || (summary.source === 'character' ? '角色' : summary.source === 'codex' ? 'Code' : '');
            const authorLine = author ? `作者：${author}\n` : '';
            const content = summary.content.trim();
            return `--- ${stamp} ---\n${content.includes('作者：') || !authorLine ? '' : authorLine}${content}`;
        }),
    ].join('\n\n');
};

export const buildWorkbenchTaskIndex = async (currentSessionId?: string, limit = 6): Promise<string> => {
    const { DB } = await import('./db');
    const [sessions, summaries, codeMemoryIndex] = await Promise.all([
        DB.getWorkbenchSessions().catch(() => []),
        DB.getRecentWorkbenchSummaries(Math.max(limit * 4, limit)).catch(() => []),
        buildWorkbenchCodeMemoryIndex().catch(() => ''),
    ]);
    const sessionMap = new Map(sessions.map(s => [s.id, s]));
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const summary of [...summaries].sort((a, b) => b.createdAt - a.createdAt)) {
        if (summary.sessionId === currentSessionId || seen.has(summary.sessionId)) continue;
        const session = sessionMap.get(summary.sessionId);
        if (!session) continue;
        seen.add(summary.sessionId);
        const stamp = new Date(summary.createdAt).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
        const title = session.title || '未命名任务';
        const author = summary.sourceName || (summary.source === 'character' ? '角色' : summary.source === 'codex' ? 'Code' : '');
        const content = `${author ? `作者：${author}；` : ''}${summary.content.replace(/\s+/g, ' ').trim()}`;
        lines.push(`- ${title} · ${stamp}: ${content.slice(0, 260)}`);
        if (lines.length >= limit) break;
    }
    return [
        codeMemoryIndex.trim() ? `[Code Memory]\n${codeMemoryIndex.trim()}` : '',
        lines.length ? `[其他 Code 对话进度索引]\n${lines.join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
};

const WORKBENCH_SYNTHETIC_ID_BASE = -9_000_000;

const workbenchSpeaker = (m: WorkbenchMessage): string => {
    if (m.role === 'user') return '用户';
    if (m.role === 'codex') return 'Code';
    if (m.role === 'system') return '系统';
    return m.metadata?.speakerName || '一起工作的角色';
};

const formatWorkbenchContextTime = (timestamp?: number): string => {
    const date = new Date(Number(timestamp) || Date.now());
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
};

const workbenchContentForContext = (m: WorkbenchMessage): string => {
    const content = m.type === 'emoji'
        ? `[表情: ${m.metadata?.emojiName || '表情包'}]`
        : m.content;
    return `[${formatWorkbenchContextTime(m.createdAt)}] ${content}`;
};

const serializeWorkbenchMessage = (m: WorkbenchMessage) => ({
    role: m.role,
    speakerName: workbenchSpeaker(m),
    kind: m.kind,
    type: m.type || 'text',
    mode: m.mode,
    content: workbenchContentForContext(m),
    replyTo: m.replyTo,
    createdAt: m.createdAt,
});

const messageContentForCodeContext = (m: Message): string => {
    if (m.type === 'emoji') return '[表情]';
    if (m.type === 'image') return '[图片]';
    if (m.type !== 'text') return `[${m.type}] ${m.content || ''}`.trim();
    return m.content;
};

const formatMainChatForCodeContext = (messages: Message[]) => messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
        role: m.role,
        content: messageContentForCodeContext(m),
    }))
    .filter(m => m.content.trim());

const workbenchToChatMessages = (
    messages: WorkbenchMessage[],
    char: CharacterProfile,
    content: string,
    sessionTitle?: string,
    capability?: WorkbenchDeviceCapability,
): Message[] => {
    const cleanContent = content.trim();
    const hasCurrentTurn = !!cleanContent && messages.some(m => m.role === 'user' && m.content.trim() === cleanContent);
    const source = hasCurrentTurn
        ? messages
        : !cleanContent
            ? messages
        : [
            ...messages,
            {
                id: 'workbench-current-turn',
                sessionId: 'workbench-current',
                role: 'user' as const,
                kind: 'chat' as const,
                mode: 'sully' as const,
                content,
                createdAt: Date.now(),
                status: 'sent' as const,
            },
        ];
    const codeMessages = source.map((m, index) => {
        const isCurrentCharacter =
            (m.role === 'character' || m.role === 'sully')
            && (m.metadata?.characterId === char.id || m.metadata?.speakerName === char.name);
        const isCliAgent = m.role === 'codex';
        if (m.role !== 'user' && !isCurrentCharacter && !isCliAgent) return null;
        // Keep all three speakers structurally distinct. CLI/Codex is external
        // system context, never user text or the character's assistant history.
        const role: Message['role'] = isCurrentCharacter
            ? 'assistant'
            : isCliAgent
                ? 'system'
                : 'user';
        const sourceContent = workbenchContentForContext(m);
        const contentText = isCliAgent
            ? `AI 助手 ${workbenchSpeaker(m)} 的发言：${sourceContent}`
            : sourceContent;
        return {
            id: WORKBENCH_SYNTHETIC_ID_BASE - index,
            charId: char.id,
            role,
            type: 'text',
            content: contentText,
            replyTo: m.replyTo ? {
                id: WORKBENCH_SYNTHETIC_ID_BASE - 10000 - index,
                content: m.replyTo.content,
                name: m.replyTo.name,
            } : undefined,
            timestamp: m.createdAt,
            metadata: { source: 'workbench', workbenchRole: m.role },
        };
    }).filter((m): m is Message => !!m);
    return codeMessages;
};

export const consultCharacterFromWorkbench = async (args: {
    apiConfig: APIConfig;
    char: CharacterProfile;
    userProfile: UserProfile;
    groups: GroupProfile[];
    realtimeConfig?: RealtimeConfig;
    recentMessages: WorkbenchMessage[];
    content: string;
    sessionTitle?: string;
    taskIndex?: string;
    capability?: WorkbenchDeviceCapability;
}): Promise<string> => {
    const { apiConfig, userProfile, groups, realtimeConfig, recentMessages, content } = args;
    if (!apiConfig.baseUrl || !apiConfig.model) throw new Error('请先配置主 API');
    const { DB } = await import('./db');
    const { ChatPrompts } = await import('./chatPrompts');
    const { buildChatRequestPayload } = await import('./chatRequestPayload');
    const { loadMusicPlaybackSnapshot } = await import('../context/MusicContext');
    const emojis = await DB.getEmojis().catch(() => []);
    const categories = await DB.getEmojiCategories().catch(() => []);
    const visibleEmojiSet = ChatPrompts.filterVisibleEmojis(
        emojis,
        categories,
        args.char.id,
    );
    const mainChatLimit = args.char.contextLimit || 500;
    const mainChatMessages = await DB.getRecentMessagesByCharId(args.char.id, mainChatLimit).catch(() => []);
    const workbenchChatMessages = workbenchToChatMessages(
        recentMessages,
        args.char,
        content,
        args.sessionTitle,
        args.capability,
    );
    const mainBackgroundCap = Math.min(60, Math.max(24, Math.floor(mainChatLimit * 0.18)));
    const mainTake = Math.min(mainBackgroundCap, Math.max(0, mainChatLimit - workbenchChatMessages.length));
    const mainBackground = mainChatMessages.slice(-mainTake);
    const codeRecallHint = recentMessages
        .slice(-20)
        .map(workbenchContentForContext)
        .filter(Boolean)
        .join('\n')
        .slice(-4000);
    const char = { ...args.char, memoryPalaceInjection: undefined } as CharacterProfile;
    const payload = await buildChatRequestPayload({
        char,
        userProfile,
        groups,
        emojis: visibleEmojiSet.emojis,
        categories: visibleEmojiSet.categories,
        historyMsgs: mainBackground,
        recentMsgsHint: mainBackground.slice(-200),
        recallQueryHint: codeRecallHint,
        contextLimit: mainChatLimit,
        realtimeConfig,
        musicSnapshot: loadMusicPlaybackSnapshot(),
        htmlMode: { enabled: !!(char as any).htmlModeEnabled, customPrompt: (char as any).htmlModeCustomPrompt },
        thinkingChain: { enabled: !!(char as any).showThinkingChain, customPrompt: (char as any).thinkingChainCustomPrompt },
        promptSurface: {
            surface: 'code',
            codeSessionTitle: args.sessionTitle,
            taskIndex: args.taskIndex,
        },
    });
    // Ordinary chat remains relationship/recency background. The structurally
    // typed Code thread is placed last so the active task, not normal-chat recency,
    // owns the reply. Code is not duplicated inside the ordinary history block.
    const messages = [
        ...payload.fullMessages,
        ...workbenchChatMessages.map(message => ({
            role: message.role,
            content: message.content,
        })),
    ];
    const res = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(apiConfig.apiKey ? { Authorization: `Bearer ${apiConfig.apiKey}` } : {}),
        },
        body: JSON.stringify({
            model: apiConfig.model,
            messages,
            temperature: 0.85,
            stream: false,
        }),
    });
    if (!res.ok) throw new Error(`一起工作请求失败 (${res.status})`);
    const data = await safeResponseJson(res);
    return extractContent(data).trim();
};

export const consultSullyFromWorkbench = consultCharacterFromWorkbench;
