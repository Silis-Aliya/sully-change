import { describe, expect, it } from 'vitest';
import { resolveWorkbenchBridgeConfigForClient, DEFAULT_WORKBENCH_CONFIG } from './workbenchBridge';

describe('workbench bridge config resolution', () => {
    it('uses the remote bridge URL on mobile instead of localhost', () => {
        const resolved = resolveWorkbenchBridgeConfigForClient({
            ...DEFAULT_WORKBENCH_CONFIG,
            bridgeUrl: 'http://localhost:3001',
            cliBridgeUrl: 'http://localhost:3001',
            remoteBridgeUrl: 'http://pc.local:3001',
            runtimeMode: 'cli',
        }, 'mobile');

        expect(resolved.bridgeUrl).toBe('http://pc.local:3001');
    });

    it('uses the configured private-domain bridge on desktop too', () => {
        const resolved = resolveWorkbenchBridgeConfigForClient({
            ...DEFAULT_WORKBENCH_CONFIG,
            bridgeUrl: 'http://pc.local:3001',
            cliBridgeUrl: 'http://localhost:3001',
            remoteBridgeUrl: 'http://pc.local:3001',
            runtimeMode: 'computer',
        }, 'desktop');

        expect(resolved.bridgeUrl).toBe('http://pc.local:3001');
        expect(resolved.remoteBridgeUrl).toBe('http://pc.local:3001');
    });
});
