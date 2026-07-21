import { safeResponseJson } from './safeApi';

export interface XhsPhoneChannelConfig {
    enabled?: boolean;
    mcpUrl: string;
    deviceAddress?: string;
    accessToken?: string;
}

export type XhsPhoneChannelStatus = {
    overall: 'connected' | 'partial' | 'unavailable';
    server: 'connected' | 'failed' | 'unknown';
    pixel: 'online' | 'offline' | 'unauthorized' | 'unknown';
    tailscale: 'connected' | 'failed' | 'unknown';
    xhs: 'available' | 'failed' | 'unknown';
    screen: 'available' | 'failed' | 'unknown';
    message: string;
};

export type XhsPhoneActivityResult =
    | {
        ok: true;
        mode: 'browse' | 'search' | 'open_detail' | 'like_current' | 'share_current' | 'my_profile';
        keyword?: string;
        observationText: string;
        shareLink?: string;
        clipboardText?: string;
        raw?: any;
    }
    | { ok: false; reason: 'not_enabled' | 'not_configured' | 'failed'; message: string };

class XhsPhoneChannelError extends Error {
    constructor(
        public readonly stage: 'server' | 'pixel' | 'adb' | 'xhs' | 'screen',
        message: string,
        public readonly status: XhsPhoneChannelStatus,
        public readonly detail?: string,
    ) {
        super(message);
        this.name = 'XhsPhoneChannelError';
    }
}

type McpJsonRpcResponse = {
    jsonrpc?: '2.0';
    id?: number;
    result?: any;
    error?: { code: number; message: string; data?: any };
};

type McpSession = {
    sessionId: string | null;
    initialized: boolean;
    tools: string[];
};

const MCP_PROTOCOL_VERSION = '2024-11-05';
const sessions = new Map<string, McpSession>();
let requestId = 0;

const blankStatus = (): XhsPhoneChannelStatus => ({
    overall: 'unavailable',
    server: 'unknown',
    pixel: 'unknown',
    tailscale: 'unknown',
    xhs: 'unknown',
    screen: 'unknown',
    message: '',
});

const normalizeMcpUrl = (raw: string): string => raw.trim().replace(/\/+$/, '');

const fetchWithTimeout = async (url: string, init: RequestInit = {}, timeoutMs = 60000): Promise<Response> => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        window.clearTimeout(timer);
    }
};

const getSession = (mcpUrl: string): McpSession => {
    let session = sessions.get(mcpUrl);
    if (!session) {
        session = { sessionId: null, initialized: false, tools: [] };
        sessions.set(mcpUrl, session);
    }
    return session;
};

const mcpHeaders = (config: XhsPhoneChannelConfig, sessionId?: string | null): HeadersInit => {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
    };
    const token = config.accessToken?.trim();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    return headers;
};

const buildRequest = (method: string, params?: any, isNotification = false): any => {
    const req: any = { jsonrpc: '2.0', method, params };
    if (!isNotification) req.id = ++requestId;
    return req;
};

const parseSse = (text: string, expectedId?: number): McpJsonRpcResponse | null => {
    const events = text.split(/\r?\n\r?\n/);
    for (const event of events.reverse()) {
        const data = event.split(/\r?\n/)
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart())
            .join('\n');
        if (!data || data === '[DONE]') continue;
        try {
            const parsed = JSON.parse(data);
            if (expectedId == null || parsed.id === expectedId) return parsed;
        } catch { /* try previous */ }
    }
    return null;
};

const parseMcpResponse = async (resp: Response, expectedId?: number): Promise<McpJsonRpcResponse | null> => {
    if (resp.status === 202) return null;
    const contentType = resp.headers.get('content-type') || '';
    const text = await resp.text();
    if (contentType.includes('text/event-stream') || /^\s*(event:|data:)/.test(text)) {
        const parsed = parseSse(text, expectedId);
        if (parsed) return parsed;
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`MCP: 无法解析响应: ${text.slice(0, 300)}`);
    }
};

const mcpPost = async (mcpUrl: string, config: XhsPhoneChannelConfig, body: any, expectResponse = true): Promise<McpJsonRpcResponse | null> => {
    const session = getSession(mcpUrl);
    const res = await fetchWithTimeout(mcpUrl, {
        method: 'POST',
        headers: mcpHeaders(config, session.sessionId),
        body: JSON.stringify(body),
    });
    const newSessionId = res.headers.get('Mcp-Session-Id') || res.headers.get('mcp-session-id');
    if (newSessionId) session.sessionId = newSessionId;
    if (res.status === 401 || res.status === 403) throw new Error('MCP 鉴权失败：访问 Token 无效或未填写');
    if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new Error(`MCP HTTP ${res.status}: ${err.slice(0, 200)}`);
    }
    if (!expectResponse) return null;
    return parseMcpResponse(res, body.id);
};

const ensureMcpInitialized = async (mcpUrl: string, config: XhsPhoneChannelConfig): Promise<McpSession> => {
    const session = getSession(mcpUrl);
    if (session.initialized) return session;

    const init = await mcpPost(mcpUrl, config, buildRequest('initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'SullyOS-XhsPhone', version: '1.0.0' },
    }));
    if (init?.error) throw new Error(`MCP Initialize failed: ${init.error.message}`);
    await mcpPost(mcpUrl, config, buildRequest('notifications/initialized', {}, true), false).catch(() => null);

    const listed = await mcpPost(mcpUrl, config, buildRequest('tools/list'));
    if (listed?.error) throw new Error(`MCP tools/list failed: ${listed.error.message}`);
    const tools = listed?.result?.tools;
    session.tools = Array.isArray(tools) ? tools.map((t: any) => String(t?.name || '')).filter(Boolean) : [];
    session.initialized = true;
    return session;
};

const callXhsPhoneTool = async (config: XhsPhoneChannelConfig | undefined, toolName: string, args: Record<string, any> = {}): Promise<any> => {
    const resolved = requireXhsPhoneConfig(config);
    if (!resolved.ok) throw new Error(resolved.message);
    const { mcpUrl, config: cfg } = resolved;
    const session = await ensureMcpInitialized(mcpUrl, cfg);
    if (session.tools.length > 0 && !session.tools.includes(toolName)) {
        throw new Error(`MCP 工具不存在: ${toolName}。当前工具: ${session.tools.join(', ')}`);
    }
    const resp = await mcpPost(mcpUrl, cfg, buildRequest('tools/call', { name: toolName, arguments: args }));
    if (resp?.error) throw new Error(`MCP ${toolName} failed: ${resp.error.message}`);
    const result = resp?.result;
    if (result?.isError) {
        const text = Array.isArray(result.content) ? result.content.map((c: any) => c?.text || '').join('\n') : '';
        throw new Error(text || `${toolName} 执行失败`);
    }
    if (Array.isArray(result?.content)) {
        const text = result.content.filter((c: any) => c?.type === 'text').map((c: any) => c.text || '').join('\n').trim();
        if (!text) return result;
        try { return JSON.parse(text); } catch { return { text }; }
    }
    return result;
};

const makeDetail = (status: XhsPhoneChannelStatus, detail?: string): string => {
    const lines = [
        `MCP：${status.server === 'connected' ? '已连接' : status.server === 'failed' ? '连接失败' : '未知'}`,
        `Pixel：${status.pixel === 'online' ? '在线' : status.pixel === 'unauthorized' ? 'ADB 未授权' : status.pixel === 'offline' ? '不在线' : '未知'}`,
        `Tailscale：${status.tailscale === 'connected' ? '已连通' : status.tailscale === 'failed' ? '未连通' : '未知'}`,
        `小红书：${status.xhs === 'available' ? '可打开' : status.xhs === 'failed' ? '打开失败' : '未知'}`,
        `屏幕读取：${status.screen === 'available' ? '可用' : status.screen === 'failed' ? '失败' : '未知'}`,
    ];
    if (detail) lines.push('', detail);
    return lines.join('\n');
};

export const formatXhsPhoneStatus = (status: XhsPhoneChannelStatus): string => makeDetail(status);

const normalizeObservation = (data: any): string => {
    if (!data) return '（MCP 未返回内容）';
    if (typeof data === 'string') return data;
    if (typeof data.text === 'string') return data.text;
    if (typeof data.observationText === 'string') return data.observationText;
    if (typeof data.observation === 'string') return data.observation;
    const texts = Array.isArray(data.texts) ? data.texts.map((t: any) => String(t).trim()).filter(Boolean) : [];
    if (texts.length) return texts.slice(0, 100).map((t: string, i: number) => `${i + 1}. ${t}`).join('\n');
    if (typeof data.xml === 'string') return data.xml.slice(0, 4000);
    return JSON.stringify(data, null, 2).slice(0, 6000);
};

const extractShareLink = (data: any): string => {
    const candidates = [
        data?.shareLink,
        data?.link,
        data?.url,
        data?.shortUrl,
        data?.sourceUrl,
        data?.clipboardText,
        data?.text,
        data?.observationText,
        data?.observation,
    ];
    for (const candidate of candidates) {
        const text = typeof candidate === 'string' ? candidate : '';
        const match = text.match(/(?:https?:\/\/)?(?:www\.)?(?:xhslink\.com|xiaohongshu\.com)\/[A-Za-z0-9/_?&=.%:-]+/i);
        if (match?.[0]) {
            return /^https?:\/\//i.test(match[0]) ? match[0] : `https://${match[0]}`;
        }
    }
    return '';
};

const requireXhsPhoneConfig = (config?: XhsPhoneChannelConfig): { ok: true; mcpUrl: string; config: XhsPhoneChannelConfig } | XhsPhoneActivityResult => {
    if (!config?.enabled) return { ok: false, reason: 'not_enabled', message: '小红书手机通道未开启' };
    const mcpUrl = normalizeMcpUrl(config.mcpUrl || '');
    if (!mcpUrl) return { ok: false, reason: 'not_configured', message: '请先填写小红书手机 MCP 地址' };
    return { ok: true, mcpUrl, config: { ...config, mcpUrl } };
};

const runToolActivity = async (
    config: XhsPhoneChannelConfig | undefined,
    mode: XhsPhoneActivityResult extends { ok: true; mode: infer M } ? M : never,
    toolName: string,
    args: Record<string, any> = {},
): Promise<XhsPhoneActivityResult> => {
    const resolved = requireXhsPhoneConfig(config);
    if (!resolved.ok) return resolved;
    try {
        const data = await callXhsPhoneTool(resolved.config, toolName, args);
        return {
            ok: true,
            mode,
            keyword: args.keyword,
            observationText: normalizeObservation(data),
            shareLink: extractShareLink(data) || undefined,
            clipboardText: typeof data?.clipboardText === 'string' ? data.clipboardText : undefined,
            raw: data,
        };
    } catch (e: any) {
        return { ok: false, reason: 'failed', message: e?.message || String(e) };
    }
};

const combineFlowObservation = (sections: Array<{ title: string; text: string }>): string =>
    sections
        .filter(s => s.text.trim())
        .map(s => `## ${s.title}\n${s.text.trim()}`)
        .join('\n\n')
        .slice(0, 10000);

const runXhsPhoneBrowseFlow = async (config?: XhsPhoneChannelConfig): Promise<XhsPhoneActivityResult> => {
    const resolved = requireXhsPhoneConfig(config);
    if (!resolved.ok) return resolved;
    try {
        const feed = await callXhsPhoneTool(resolved.config, 'xhs_phone_browse');
        const sections = [{ title: '刷首页时看到的内容', text: normalizeObservation(feed) }];
        let share: any = null;
        try {
            const detail = await callXhsPhoneTool(resolved.config, 'xhs_phone_open_detail');
            sections.push({ title: '点开感兴趣笔记后读到的正文和评论区', text: normalizeObservation(detail) });
            try {
                share = await callXhsPhoneTool(resolved.config, 'xhs_phone_share_current');
                sections.push({ title: '当前笔记分享链接', text: normalizeObservation(share) });
            } catch (shareErr: any) {
                sections.push({ title: '复制当前笔记分享链接失败', text: shareErr?.message || String(shareErr) });
            }
        } catch (detailErr: any) {
            sections.push({ title: '点开笔记详情失败', text: detailErr?.message || String(detailErr) });
        }
        return {
            ok: true,
            mode: 'browse',
            observationText: combineFlowObservation(sections),
            shareLink: extractShareLink(share) || undefined,
            clipboardText: typeof share?.clipboardText === 'string' ? share.clipboardText : undefined,
            raw: { feed, share },
        };
    } catch (e: any) {
        return { ok: false, reason: 'failed', message: e?.message || String(e) };
    }
};

const runXhsPhoneSearchFlow = async (config: XhsPhoneChannelConfig | undefined, keyword: string): Promise<XhsPhoneActivityResult> => {
    const resolved = requireXhsPhoneConfig(config);
    if (!resolved.ok) return resolved;
    try {
        const search = await callXhsPhoneTool(resolved.config, 'xhs_phone_search', { keyword });
        const sections = [{ title: `搜索「${keyword}」时看到的内容`, text: normalizeObservation(search) }];
        let share: any = null;
        try {
            const detail = await callXhsPhoneTool(resolved.config, 'xhs_phone_open_detail');
            sections.push({ title: '点开相关笔记后读到的正文和评论区', text: normalizeObservation(detail) });
            try {
                share = await callXhsPhoneTool(resolved.config, 'xhs_phone_share_current');
                sections.push({ title: '当前笔记分享链接', text: normalizeObservation(share) });
            } catch (shareErr: any) {
                sections.push({ title: '复制当前笔记分享链接失败', text: shareErr?.message || String(shareErr) });
            }
        } catch (detailErr: any) {
            sections.push({ title: '点开搜索结果详情失败', text: detailErr?.message || String(detailErr) });
        }
        return {
            ok: true,
            mode: 'search',
            keyword,
            observationText: combineFlowObservation(sections),
            shareLink: extractShareLink(share) || undefined,
            clipboardText: typeof share?.clipboardText === 'string' ? share.clipboardText : undefined,
            raw: { search, share },
        };
    } catch (e: any) {
        return { ok: false, reason: 'failed', message: e?.message || String(e) };
    }
};

export const runXhsPhoneBrowse = async (config?: XhsPhoneChannelConfig): Promise<XhsPhoneActivityResult> =>
    runXhsPhoneBrowseFlow(config);

export const runXhsPhoneSearch = async (config: XhsPhoneChannelConfig | undefined, keyword: string): Promise<XhsPhoneActivityResult> =>
    runXhsPhoneSearchFlow(config, keyword);

export const runXhsPhoneOpenDetail = async (config?: XhsPhoneChannelConfig): Promise<XhsPhoneActivityResult> =>
    runToolActivity(config, 'open_detail', 'xhs_phone_open_detail');

export const runXhsPhoneLikeCurrent = async (config?: XhsPhoneChannelConfig): Promise<XhsPhoneActivityResult> =>
    runToolActivity(config, 'like_current', 'xhs_phone_like_current');

export const runXhsPhoneShareCurrent = async (config?: XhsPhoneChannelConfig): Promise<XhsPhoneActivityResult> =>
    runToolActivity(config, 'share_current', 'xhs_phone_share_current');

export const runXhsPhoneMyProfile = async (config?: XhsPhoneChannelConfig): Promise<XhsPhoneActivityResult> =>
    runToolActivity(config, 'my_profile', 'xhs_phone_my_profile');

export const testXhsPhoneChannel = async (config: XhsPhoneChannelConfig): Promise<XhsPhoneChannelStatus> => {
    const mcpUrl = normalizeMcpUrl(config.mcpUrl || '');
    if (!mcpUrl) {
        const status = { ...blankStatus(), message: '请先填写小红书手机 MCP 地址' };
        throw new XhsPhoneChannelError('server', status.message, status);
    }

    const status = blankStatus();
    try {
        await ensureMcpInitialized(mcpUrl, { ...config, mcpUrl });
        status.server = 'connected';
    } catch (e: any) {
        status.server = 'failed';
        status.message = '无法连接小红书手机 MCP。请检查云服务器 MCP 是否在线、地址/Token 是否正确。';
        throw new XhsPhoneChannelError('server', status.message, status, e?.message || String(e));
    }

    let health: any = null;
    try {
        health = await callXhsPhoneTool({ ...config, mcpUrl }, 'xhs_phone_health', { deviceAddress: config.deviceAddress });
    } catch (e: any) {
        status.pixel = 'unknown';
        status.tailscale = 'unknown';
        status.message = 'MCP 已连接，但无法检查 Pixel。';
        throw new XhsPhoneChannelError('pixel', status.message, status, e?.message || String(e));
    }

    const state = String(health?.state || health?.deviceState || '').toLowerCase();
    if (state === 'device' || health?.pixel === 'online') {
        status.pixel = 'online';
        status.tailscale = 'connected';
    } else if (state === 'unauthorized') {
        status.pixel = 'unauthorized';
        status.tailscale = 'connected';
        status.message = 'MCP 找到了 Pixel，但设备未授权。请在 Pixel 上允许 ADB 调试。';
        throw new XhsPhoneChannelError('adb', status.message, status, makeDetail(status));
    } else {
        status.pixel = 'offline';
        status.tailscale = 'failed';
        status.message = 'MCP 已连接，但找不到 Pixel。请检查 Pixel 是否打开 Tailscale，以及 ADB TCP 是否开启。';
        throw new XhsPhoneChannelError('pixel', status.message, status, JSON.stringify(health || {}));
    }

    try {
        const opened = await callXhsPhoneTool({ ...config, mcpUrl }, 'xhs_phone_open');
        if (opened?.ok === false) throw new Error(opened?.error || '打开失败');
        status.xhs = 'available';
    } catch (e: any) {
        status.xhs = 'failed';
        status.overall = 'partial';
        status.message = 'Pixel 在线，但 MCP 无法打开小红书。请检查小红书是否已安装/登录。';
        throw new XhsPhoneChannelError('xhs', status.message, status, e?.message || String(e));
    }

    try {
        const observed = await callXhsPhoneTool({ ...config, mcpUrl }, 'xhs_phone_observe');
        const text = normalizeObservation(observed);
        if (!text.trim()) throw new Error('observe 返回为空');
        status.screen = 'available';
    } catch (e: any) {
        status.screen = 'failed';
        status.overall = 'partial';
        status.message = '小红书可能打开了，但 MCP 读屏失败。请检查手机是否锁屏、权限是否正常。';
        throw new XhsPhoneChannelError('screen', status.message, status, e?.message || String(e));
    }

    status.overall = 'connected';
    status.message = '小红书手机 MCP 已连接';
    return status;
};

export const isXhsPhoneChannelError = (e: unknown): e is XhsPhoneChannelError => e instanceof XhsPhoneChannelError;
