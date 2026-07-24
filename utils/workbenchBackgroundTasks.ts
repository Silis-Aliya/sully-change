export type WorkbenchBackgroundSpeaker = 'codex' | 'character';
export type WorkbenchBackgroundStatus = 'running' | 'done' | 'error';

export interface WorkbenchBackgroundTaskSnapshot {
    id: string;
    sessionId: string;
    speaker: WorkbenchBackgroundSpeaker;
    status: WorkbenchBackgroundStatus;
    startedAt: number;
    finishedAt?: number;
    error?: string;
}

type Listener = (snapshot: WorkbenchBackgroundTaskSnapshot) => void;

const tasks = new Map<string, WorkbenchBackgroundTaskSnapshot>();
const listeners = new Set<Listener>();
let activeWorkbenchSessionId: string | null = null;

export const setActiveWorkbenchSessionSnapshot = (sessionId: string | null) => {
    activeWorkbenchSessionId = sessionId;
};

export const getActiveWorkbenchSessionSnapshot = () => activeWorkbenchSessionId;

const emit = (snapshot: WorkbenchBackgroundTaskSnapshot) => {
    listeners.forEach(listener => listener({ ...snapshot }));
};

export const getRunningWorkbenchTask = (sessionId?: string | null) => {
    if (!sessionId) return null;
    return Array.from(tasks.values()).find(task => task.sessionId === sessionId && task.status === 'running') || null;
};

export const subscribeWorkbenchBackgroundTasks = (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

export const runWorkbenchBackgroundTask = async <T>(
    sessionId: string,
    speaker: WorkbenchBackgroundSpeaker,
    runner: () => Promise<T>,
): Promise<T> => {
    if (getRunningWorkbenchTask(sessionId)) throw new Error('当前 Code 对话仍有回复正在生成');

    const snapshot: WorkbenchBackgroundTaskSnapshot = {
        id: `workbench_task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sessionId,
        speaker,
        status: 'running',
        startedAt: Date.now(),
    };
    tasks.set(snapshot.id, snapshot);
    emit(snapshot);

    try {
        const result = await runner();
        snapshot.status = 'done';
        snapshot.finishedAt = Date.now();
        emit(snapshot);
        return result;
    } catch (error: any) {
        snapshot.status = 'error';
        snapshot.finishedAt = Date.now();
        snapshot.error = error?.message || '后台回复失败';
        emit(snapshot);
        throw error;
    } finally {
        const cleanupTimer = globalThis.setTimeout(() => tasks.delete(snapshot.id), 5 * 60_000);
        (cleanupTimer as any)?.unref?.();
    }
};
