import {
    LOYAL_RECRUITMENT_CUTOFF_AT,
    LOYAL_RECRUITMENT_CRITERIA_VERSION,
    type LoyalEligibilityResult,
} from './loyalUserEligibility';

export const LOYAL_RECRUITMENT_ATTEMPT_KEY = `sullyos_loyal_recruitment_${LOYAL_RECRUITMENT_CRITERIA_VERSION}`;
export const LOYAL_RECRUITMENT_EVENT = 'sullyos-loyal-recruitment-change';
export const LOYAL_RECRUITMENT_DEFAULT_BASE = 'https://noir2.cc.cd/recruit';
const LOYAL_RECRUITMENT_BASE_KEY = 'sullyos_loyal_recruitment_base';

export type LoyalRecruitmentStatus = 'declined' | 'failed' | 'passed_pending' | 'registered';

export interface LoyalRecruitmentAttempt {
    status: LoyalRecruitmentStatus;
    criteriaVersion: string;
    evaluatedAt: number;
    qq?: string;
    evaluation?: LoyalEligibilityResult;
    group?: string;
    password?: string;
    registeredAt?: number;
}

export interface RecruitmentRegistrationResult {
    registered: boolean;
    group: string;
    password: string;
}

export function normalizeQQ(value: string): string {
    return String(value || '').replace(/\s+/g, '');
}

export function isValidQQ(value: string): boolean {
    return /^[1-9]\d{4,11}$/.test(normalizeQQ(value));
}

/** 独立招募 Worker 地址；保留本机覆盖能力，方便未绑定正式域名时验收 workers.dev 部署。 */
export function getLoyalRecruitmentBase(): string {
    try {
        return (localStorage.getItem(LOYAL_RECRUITMENT_BASE_KEY) || LOYAL_RECRUITMENT_DEFAULT_BASE).replace(/\/+$/, '');
    } catch {
        return LOYAL_RECRUITMENT_DEFAULT_BASE;
    }
}

export function readLoyalRecruitmentAttempt(): LoyalRecruitmentAttempt | null {
    try {
        const raw = localStorage.getItem(LOYAL_RECRUITMENT_ATTEMPT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as LoyalRecruitmentAttempt;
        if (!parsed || parsed.criteriaVersion !== LOYAL_RECRUITMENT_CRITERIA_VERSION) return null;
        if (!['declined', 'failed', 'passed_pending', 'registered'].includes(parsed.status)) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function writeLoyalRecruitmentAttempt(attempt: LoyalRecruitmentAttempt): void {
    localStorage.setItem(LOYAL_RECRUITMENT_ATTEMPT_KEY, JSON.stringify(attempt));
    window.dispatchEvent(new CustomEvent(LOYAL_RECRUITMENT_EVENT, { detail: attempt }));
}

export function shouldShowLoyalRecruitment(): boolean {
    if (Date.now() < LOYAL_RECRUITMENT_CUTOFF_AT) return false;
    const attempt = readLoyalRecruitmentAttempt();
    return !attempt || attempt.status === 'passed_pending';
}

export function resetLoyalRecruitmentForTesting(): void {
    try { localStorage.removeItem(LOYAL_RECRUITMENT_ATTEMPT_KEY); } catch { /* ignore */ }
}

export async function submitQualifiedQQ(qqInput: string): Promise<RecruitmentRegistrationResult> {
    const qq = normalizeQQ(qqInput);
    if (!isValidQQ(qq)) throw new Error('请输入正确的 QQ 号');

    const base = getLoyalRecruitmentBase();
    const response = await fetch(`${base}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            qq,
            criteriaVersion: LOYAL_RECRUITMENT_CRITERIA_VERSION,
            cutoffAt: LOYAL_RECRUITMENT_CUTOFF_AT,
        }),
    });
    const data = await response.json().catch(() => ({})) as {
        ok?: boolean;
        registered?: boolean;
        group?: string;
        password?: string;
        error?: string;
    };
    if (!response.ok || data.ok === false) {
        throw new Error(data.error || `登记服务暂不可用（HTTP ${response.status}）`);
    }
    if (!data.group || !data.password) throw new Error('登记成功，但群信息尚未配置');
    return {
        registered: data.registered !== false,
        group: data.group,
        password: data.password,
    };
}
