import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatParser } from './chatParser';
import { DB } from './db';

vi.mock('@capacitor/local-notifications', () => ({
    LocalNotifications: {
        checkPermissions: vi.fn(async () => ({ display: 'denied' })),
        schedule: vi.fn(),
    },
}));

const createdIds: number[] = [];

afterEach(async () => {
    if (createdIds.length) await DB.deleteMessages(createdIds.splice(0));
});

describe('schedule_message receipts', () => {
    it('records a readable system receipt after scheduling a future message', async () => {
        const charId = `schedule-message-${Date.now()}`;
        const timeStr = '2099-01-02 08:30:00';
        const content = await ChatParser.parseAndExecuteActions(
            `晚点说\n[schedule_message | ${timeStr} | fixed | 早安，记得吃饭]`,
            charId,
            'Silis',
            vi.fn(),
        );

        const messages = await DB.getRecentMessagesByCharId(charId, 20, true);
        createdIds.push(...messages.map(message => message.id).filter((id): id is number => typeof id === 'number'));
        const receipt = messages.find(message => message.role === 'system' && message.content.includes('安排了定时消息'));

        expect(content).toBe('晚点说');
        expect(receipt?.content).toBe(`Silis 安排了定时消息 "早安，记得吃饭" (${timeStr})`);
    });
});
