import { describe, expect, it, vi } from 'vitest';
import {
    getRunningWorkbenchTask,
    runWorkbenchBackgroundTask,
    subscribeWorkbenchBackgroundTasks,
} from './workbenchBackgroundTasks';

describe('workbench background tasks', () => {
    it('keeps a task discoverable until its runner finishes', async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const events: string[] = [];
        const unsubscribe = subscribeWorkbenchBackgroundTasks(task => events.push(task.status));

        const running = runWorkbenchBackgroundTask('session-a', 'codex', async () => {
            await gate;
            return 'done';
        });

        expect(getRunningWorkbenchTask('session-a')?.speaker).toBe('codex');
        release();
        await expect(running).resolves.toBe('done');
        expect(getRunningWorkbenchTask('session-a')).toBeNull();
        expect(events).toEqual(['running', 'done']);
        unsubscribe();
        vi.clearAllTimers();
    });
});
