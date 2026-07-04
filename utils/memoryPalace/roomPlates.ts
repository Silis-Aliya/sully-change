/**
 * Memory Palace — 房间门牌（Room Plates）
 *
 * 情景→语义的固化终点。房间装原始经历（MemoryNode，走向量召回），
 * 门牌写这些经历沉淀出的常驻认知（PlateEntry，每轮直接注入 System Prompt）。
 *
 * 两个更新触发点：
 *   1. EventBox 压缩/封盒（eventBoxCompression.ts）→ updatePlateFromBoxSummary()
 *      —— 盒子的结论就是最好的蒸馏原料，封盒即沉淀
 *   2. 认知消化（digestion.ts，50轮/手动）→ consolidateAllPlates()
 *      —— 四块门牌一次全量整理，容量压力挤掉过时条目
 *
 * 合并语义（不是追加）：LLM 每次输出目标房间的**完整**新条目列表，
 * 旧条目不被重新输出即被淘汰；带 basedOn 引用的条目继承 firstLearnedAt
 * 与 sourceCount（"这条认知是什么时候得知的、被印证过几次"）。
 *
 * 卧室门牌「我们之间」硬规则：只写现象与质地，禁止给关系命名——
 * 定义只存在于质地的负空间里。prompt 层约束 + mergePlateEntries 兜底过滤。
 */

import type { MemoryNode, PlateEntry, PlateRoom, RoomPlate } from './types';
import {
    PLATE_ENTRY_CAPS,
    PLATE_ENTRY_HARD_MAX_CHARS,
    PLATE_ENTRY_TARGET_CHARS,
    PLATE_ROOMS,
    PLATE_TITLES,
} from './types';
import { MemoryNodeDB, RoomPlateDB, plateId } from './db';
import type { LightLLMConfig } from './pipeline';
import { safeFetchJson } from '../safeApi';
import { safeParseJsonArray } from './jsonUtils';

// ─── 基础工具 ─────────────────────────────────────────

export function isPlateRoom(room: string): room is PlateRoom {
    return (PLATE_ROOMS as string[]).includes(room);
}

function generateEntryId(): string {
    return `pe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// 每个房间的条目标签前缀（与消化提示词的 U0/R0 标签习惯对齐）
const ROOM_LABEL_PREFIX: Record<PlateRoom, string> = {
    user_room: 'U',
    self_room: 'R',
    bedroom:   'B',
    study:     'S',
};

async function loadOrCreatePlate(charId: string, room: PlateRoom): Promise<RoomPlate> {
    const existing = await RoomPlateDB.get(charId, room);
    if (existing) return existing;
    return {
        id: plateId(charId, room),
        charId,
        room,
        entries: [],
        updatedAt: Date.now(),
        version: 0,
    };
}

// ─── 合并逻辑（纯函数，可测） ─────────────────────────

export interface PlateLLMItem {
    room: string;
    text: string;
    /** 引用现有条目标签（如 "U2"）= 这是对旧条目的延续/更新，继承 firstLearnedAt */
    basedOn?: string | null;
}

/**
 * 卧室兜底过滤：拦"给关系下定义"的条目。
 *
 * 窄匹配原则：只拦"我们(是/算是/成了)××"这种明确的命名句式，
 * 不拦定性词本身——"TA说我像她理想中的家人"是合法的质地描述。
 * 主约束在 prompt 层，这里只是最后一道窄栅栏，宁可漏过不可误杀。
 */
const BEDROOM_LABEL_RE = /我们(?:现在|如今|已经)?(?:是|算是|成了|成为|变成)[^，。；！？]{0,8}(?:恋人|情侣|男女朋友|男朋友|女朋友|夫妻|朋友|兄妹|姐弟|家人|知己|暧昧)/;

export function violatesBedroomRule(text: string): boolean {
    return BEDROOM_LABEL_RE.test(text);
}

/**
 * 把 LLM 输出的完整新列表合并进现有门牌条目。
 *
 * - basedOn 命中现有标签 → 继承 id/firstLearnedAt，sourceCount+1，
 *   文本未变时连 updatedAt 也不动（纯保留不算更新）
 * - 无 basedOn → 新条目
 * - 现有条目未被任何输出引用且未被原样保留 → 淘汰（容量压力语义）
 * - 超长截断、卧室命名过滤、cap 裁剪
 */
export function mergePlateEntries(
    room: PlateRoom,
    existing: PlateEntry[],
    items: Array<{ text: string; basedOn?: string | null }>,
    now: number,
): PlateEntry[] {
    const prefix = ROOM_LABEL_PREFIX[room];
    const byLabel = new Map<string, PlateEntry>();
    existing.forEach((e, i) => byLabel.set(`${prefix}${i}`, e));

    const merged: PlateEntry[] = [];
    const usedIds = new Set<string>();

    for (const item of items) {
        let text = (item.text || '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        if (text.length > PLATE_ENTRY_HARD_MAX_CHARS) {
            text = text.slice(0, PLATE_ENTRY_HARD_MAX_CHARS);
        }
        if (room === 'bedroom' && violatesBedroomRule(text)) {
            console.warn(`🚪 [RoomPlate] 卧室门牌拦截关系命名条目: "${text.slice(0, 40)}"`);
            continue;
        }

        const base = item.basedOn ? byLabel.get(String(item.basedOn).trim().toUpperCase()) : undefined;
        if (base && !usedIds.has(base.id)) {
            usedIds.add(base.id);
            const changed = base.text !== text;
            merged.push({
                ...base,
                text,
                updatedAt: changed ? now : base.updatedAt,
                sourceCount: base.sourceCount + 1,
            });
        } else {
            // 同文本条目已存在但 LLM 忘了标 basedOn → 按原样保留而不是当新条目重开
            const sameText = existing.find(e => e.text === text && !usedIds.has(e.id));
            if (sameText) {
                usedIds.add(sameText.id);
                merged.push({ ...sameText, sourceCount: sameText.sourceCount + 1 });
            } else {
                merged.push({
                    id: generateEntryId(),
                    text,
                    firstLearnedAt: now,
                    updatedAt: now,
                    sourceCount: 1,
                });
            }
        }
    }

    return merged.slice(0, PLATE_ENTRY_CAPS[room]);
}

// ─── LLM 蒸馏调用 ─────────────────────────────────────

const ROOM_RULES: Record<PlateRoom, string> = {
    user_room:
        `关于对方的**稳定事实**：家庭结构、成长经历、居住状况、身份职业、健康、忌讳雷区，` +
        `以及常被提起的重要他人（人物条目格式如「TA的朋友小美：大学室友，关系好，上月闹过矛盾已和好」）。` +
        `瞬时状态（今天累、这周忙）不收；正在进行中、还没有结论的事（在找工作、在备考）不收——那是事件盒的事，等有了结果再入。`,
    self_room:
        `我对**自己**的稳定认知：我是谁、性格底色、重要的转变、已经内化的领悟。不收对他人的看法。`,
    bedroom:
        `我们之间的**质地**：相处的习惯与仪式、只有彼此懂的梗、未言明的默契、拿不准却真实的感觉。` +
        `【硬规则】禁止给这段关系命名或分类——不得写出"我们是恋人/情侣/朋友/家人"这类定义句。` +
        `只描述现象和感受；说不清、不确定本身就是合法条目（如「我说不清我们算什么，但TA难过时第一个找的是我」）。`,
    study:
        `我的领域：我会什么、正在学什么、和对方共同钻研的东西。只收有积累的，不收一次性话题。`,
};

interface PlateMaterial {
    room: PlateRoom;
    /** 蒸馏原料：盒子 summary 或高价值记忆节点的内容 */
    lines: string[];
}

/**
 * 一次 LLM 调用整理若干房间的门牌。
 * 输入：每房间的现有条目（带标签）+ 新原料；输出：每房间完整的新条目列表。
 */
async function callPlateLLM(
    charName: string,
    userName: string,
    plates: RoomPlate[],
    materials: PlateMaterial[],
    llmConfig: LightLLMConfig,
): Promise<PlateLLMItem[]> {
    const materialByRoom = new Map(materials.map(m => [m.room, m.lines]));

    const roomBlocks = plates.map(plate => {
        const prefix = ROOM_LABEL_PREFIX[plate.room];
        const title = plate.room === 'user_room' ? `${userName}的事` : PLATE_TITLES[plate.room];
        const existingBlock = plate.entries.length > 0
            ? plate.entries.map((e, i) => `[${prefix}${i}] ${e.text}`).join('\n')
            : '（还没有条目）';
        const lines = materialByRoom.get(plate.room) || [];
        const materialBlock = lines.length > 0
            ? lines.map(l => `- ${l}`).join('\n')
            : '（本轮没有新材料，仅整理现有条目）';
        return `## 门牌「${title}」(room: ${plate.room}，上限 ${PLATE_ENTRY_CAPS[plate.room]} 条)
收录范围：${ROOM_RULES[plate.room]}

现有条目：
${existingBlock}

新材料（最近的经历/结论，从中蒸馏值得常驻的认知）：
${materialBlock}`;
    }).join('\n\n');

    const systemPrompt = `你是 ${charName}。你现在在独处，安静地整理自己的"底色认知"——那些不需要刻意回忆就知道的事：关于 ${userName}、关于你自己、关于你们之间。

下面每个"门牌"给出了现有条目和新材料。请为每个门牌输出**完整的新条目列表**：

1. **合并而非追加**：现有条目想保留就必须重新输出（带 basedOn 引用它的标签）；不输出 = 淘汰。事实变了就改写（如旧条目说「住家里」、新材料说搬去和别人同住 → 改写并 basedOn 旧条目）。
2. **只收沉淀下来的**：跨时间稳定为真的认知才配上门牌。一时的状态、没结论的进行时，都不收。
3. **每条 ${PLATE_ENTRY_TARGET_CHARS} 字以内**，写梗概不写叙事，不带日期不带"我记得"。
4. **不超过各门牌的条目上限**。位置不够时留最重要的——被迫舍弃是正常的。
5. ${userName} 直接用名字称呼。条目内容严禁使用半角双引号 "，引用一律用「」。

${roomBlocks}

严格输出 JSON 数组（没有变化的门牌也要完整输出其保留条目）：
[{"room": "user_room", "text": "……", "basedOn": "U0"}, {"room": "bedroom", "text": "……", "basedOn": null}]`;

    const data = await safeFetchJson(
        `${llmConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${llmConfig.apiKey}`,
            },
            body: JSON.stringify({
                model: llmConfig.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: '请开始整理。' },
                ],
                temperature: 0.3,
                max_tokens: 8000,
                stream: false,
            }),
        },
        2, 0, { appName: '记忆宫殿', purpose: '门牌整理' }
    );

    const reply = data.choices?.[0]?.message?.content || '';
    return safeParseJsonArray(reply)
        .filter(item => item && typeof item.text === 'string' && isPlateRoom(item.room)) as PlateLLMItem[];
}

/**
 * 核心流程：加载目标门牌 → LLM 整理 → 合并落库。
 *
 * LLM 输出里**一个条目都没提到的房间**跳过保存——区分"LLM 决定清空"
 * 和"LLM 忘了这个房间/输出被截断"，宁可保守不动，等下轮消化再整理。
 */
async function consolidatePlates(
    charId: string,
    charName: string,
    userName: string,
    materials: PlateMaterial[],
    llmConfig: LightLLMConfig,
): Promise<{ updated: PlateRoom[] }> {
    const rooms = materials.map(m => m.room);
    const plates = await Promise.all(rooms.map(r => loadOrCreatePlate(charId, r)));

    const hasMaterial = materials.some(m => m.lines.length > 0);
    const hasEntries = plates.some(p => p.entries.length > 0);
    if (!hasMaterial && !hasEntries) {
        return { updated: [] };
    }

    const items = await callPlateLLM(charName, userName, plates, materials, llmConfig);
    if (items.length === 0) {
        console.warn(`🚪 [RoomPlate] LLM 未返回有效条目，门牌保持不动`);
        return { updated: [] };
    }

    const now = Date.now();
    const updated: PlateRoom[] = [];
    for (const plate of plates) {
        const roomItems = items.filter(i => i.room === plate.room);
        if (roomItems.length === 0) continue;
        const mergedEntries = mergePlateEntries(plate.room, plate.entries, roomItems, now);
        plate.entries = mergedEntries;
        plate.updatedAt = now;
        plate.version += 1;
        await RoomPlateDB.save(plate);
        updated.push(plate.room);
        console.log(`🚪 [RoomPlate] 「${PLATE_TITLES[plate.room]}」v${plate.version}：${mergedEntries.length} 条`);
    }
    return { updated };
}

// ─── 触发点 1：EventBox 压缩/封盒 → 增量合并 ─────────

/**
 * 盒子压缩完成后，把这次整合的结论合并进该房间的门牌。
 * 由 eventBoxCompression 调用；失败只 warn，不影响压缩结果。
 */
export async function updatePlateFromBoxSummary(
    charId: string,
    room: string,
    summaryContent: string,
    llmConfig: LightLLMConfig,
    charName: string,
    userName?: string,
): Promise<void> {
    if (!isPlateRoom(room)) return;
    if (!summaryContent?.trim()) return;
    await consolidatePlates(
        charId, charName, userName || '用户',
        [{ room, lines: [summaryContent.trim()] }],
        llmConfig,
    );
}

// ─── 触发点 2：认知消化 → 四块门牌全量整理 ───────────

/** 每房间送入 LLM 的原料上限与单条截断长度 */
const MATERIAL_NODES_PER_ROOM = 15;
const MATERIAL_LINE_MAX_CHARS = 160;

/**
 * 从房间里挑蒸馏原料：盒子 summary 优先（它们已是整合过的结论），
 * 其余按 importance 降序补足；排除 archived（已被压进 summary）。
 */
function pickMaterialLines(nodes: MemoryNode[], room: PlateRoom): string[] {
    const candidates = nodes.filter(n => n.room === room && !n.archived);
    const summaries = candidates.filter(n => n.isBoxSummary);
    const others = candidates
        .filter(n => !n.isBoxSummary)
        .sort((a, b) => b.importance - a.importance || b.createdAt - a.createdAt);
    return [...summaries, ...others]
        .slice(0, MATERIAL_NODES_PER_ROOM)
        .map(n => n.content.replace(/\s+/g, ' ').trim().slice(0, MATERIAL_LINE_MAX_CHARS));
}

/**
 * 全量整理四块门牌。由 runCognitiveDigestion 在消化尾声调用，
 * 也可从 UI 手动触发。一次 LLM 调用覆盖全部房间。
 *
 * @param extraMaterial 消化状态机之外提交的蒸馏候选（synthesize_user /
 *   internalize / self_insight 的产出）。放在原料最前——它们是本次消化
 *   刚提炼的概括，优先级高于按 importance 挑出的旧节点，且不占节点配额。
 */
export async function consolidateAllPlates(
    charId: string,
    charName: string,
    userName: string | undefined,
    llmConfig: LightLLMConfig,
    extraMaterial?: Partial<Record<PlateRoom, string[]>>,
): Promise<{ updated: PlateRoom[] }> {
    const allNodes = await MemoryNodeDB.getByCharId(charId);
    const materials: PlateMaterial[] = PLATE_ROOMS.map(room => {
        const extra = (extraMaterial?.[room] || [])
            .map(l => l.replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .map(l => l.slice(0, MATERIAL_LINE_MAX_CHARS * 2)); // 领悟全文可到 200 字，放宽截断
        return {
            room,
            lines: [...extra, ...pickMaterialLines(allNodes, room)],
        };
    });
    return consolidatePlates(charId, charName, userName || '用户', materials, llmConfig);
}

// ─── 注入：格式化为常驻 System Prompt 段落 ───────────

/**
 * 门牌 → Markdown 段落。空门牌跳过；全空返回 ''。
 *
 * 注入框架是设计核心：这些是 constraint（认知底色，防说错话），
 * 不是 topic（不要老念叨）——对应人脑"背景知识常在但低激活"的状态。
 */
export function formatRoomPlatesSection(plates: RoomPlate[], userName?: string): string {
    const userLabel = userName || '用户';
    const byRoom = new Map(plates.map(p => [p.room, p]));
    const sections: string[] = [];

    for (const room of PLATE_ROOMS) {
        const plate = byRoom.get(room);
        if (!plate || plate.entries.length === 0) continue;
        const title = room === 'user_room' ? `关于${userLabel}` : PLATE_TITLES[room];
        const suffix = room === 'bedroom' ? '（没有名字，也不需要名字——只有质地）' : '';
        sections.push(
            `**${title}**${suffix}\n` +
            plate.entries.map(e => `- ${e.text}`).join('\n')
        );
    }

    if (sections.length === 0) return '';

    return `### 底色认知 (Resident Knowledge)
以下是你早已知道的背景。它们是你认知的底色，不是话题——不要主动提起，也不要逐条复述，只在相关时让它们自然影响你的反应、措辞与温度。

${sections.join('\n\n')}
`;
}

/** 加载某角色的全部门牌并格式化（纯 IDB 读，不调 LLM，供 pipeline 每轮注入用） */
export async function buildRoomPlatesInjection(charId: string, userName?: string): Promise<string> {
    try {
        const plates = await RoomPlateDB.getByCharId(charId);
        return formatRoomPlatesSection(plates, userName);
    } catch (e: any) {
        console.warn(`🚪 [RoomPlate] 加载门牌失败: ${e?.message || e}`);
        return '';
    }
}
