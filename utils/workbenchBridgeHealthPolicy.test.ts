import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Workbench bridge health policy', () => {
    const source = readFileSync(new URL('../apps/WorkbenchApp.tsx', import.meta.url), 'utf8');

    it('does not poll /health when Code opens', () => {
        expect(source).not.toContain('window.setInterval(check, 10_000)');
        expect(source).not.toContain('window.setTimeout(check, 250)');
    });

    it('checks the bridge lazily before an assistant request', () => {
        expect(source).toContain('if (!bridgeUsable && bridgeConfigured)');
        expect(source).toContain('await testWorkbenchBridge(config)');
        expect(source).toContain("throw makeSilentBridgeOfflineError()");
    });

    it('treats auth failures as silent bridge disconnects', () => {
        expect(source).toMatch(/Unauthorized.*40\[13\]/);
    });
});
