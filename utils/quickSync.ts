import { DB } from './db';

export type QuickSyncManifest = {
    version: 1;
    createdAt: number;
    deviceId: string;
    stores: Record<string, Record<string, string>>;
};

export type QuickSyncDeltaMeta = {
    version: 1;
    createdAt: number;
    deviceId: string;
    baseCreatedAt?: number;
    stores: Record<string, { upserts: number; deletes: number }>;
};

export const QUICK_SYNC_PREFIX = 'Sully_QuickSync_delta_';
export const QUICK_SYNC_LATEST_NAME = 'Sully_QuickSync_delta_latest.zip';
export const QUICK_SYNC_MANIFEST_KEY = 'sully_quick_sync_manifest_v1';
export const QUICK_SYNC_DEVICE_KEY = 'sully_quick_sync_device_id_v1';

export const QUICK_SYNC_STORES = [
    'characters',
    'character_groups',
    'messages',
    'worldbooks',
    'memory_nodes',
    'memory_links',
    'topic_boxes',
    'anticipations',
    'event_boxes',
    'room_plates',
    'digest_reports',
    'memory_batches',
    'life_records',
    'med_plans',
    'life_record_settings',
    'handbook',
    'trackers',
    'tracker_entries',
    'worlds',
    'world_episodes',
    'daily_schedule',
] as const;

const getDeviceId = (): string => {
    try {
        const existing = localStorage.getItem(QUICK_SYNC_DEVICE_KEY);
        if (existing) return existing;
        const id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem(QUICK_SYNC_DEVICE_KEY, id);
        return id;
    } catch {
        return 'unknown-device';
    }
};

const stableStringify = (value: any): string => {
    const seen = new WeakSet<object>();
    const normalize = (v: any): any => {
        if (v === null || typeof v !== 'object') return v;
        if (seen.has(v)) return null;
        seen.add(v);
        if (Array.isArray(v)) return v.map(normalize);
        const out: Record<string, any> = {};
        for (const key of Object.keys(v).sort()) out[key] = normalize(v[key]);
        return out;
    };
    return JSON.stringify(normalize(value));
};

const hashText = async (text: string): Promise<string> => {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
};

const recordKey = (item: any): string | null => {
    const id = item?.id ?? item?.key ?? item?.name;
    if (id === undefined || id === null) return null;
    return String(id);
};

export const loadQuickSyncManifest = (): QuickSyncManifest | null => {
    try {
        const raw = localStorage.getItem(QUICK_SYNC_MANIFEST_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
};

export const saveQuickSyncManifest = (manifest: QuickSyncManifest): void => {
    try { localStorage.setItem(QUICK_SYNC_MANIFEST_KEY, JSON.stringify(manifest)); } catch { /* ignore */ }
};

export const buildQuickSyncManifest = async (
    onProgress?: (done: number, total: number, label: string) => void
): Promise<{ manifest: QuickSyncManifest; records: Record<string, Map<string, any>> }> => {
    const stores: QuickSyncManifest['stores'] = {};
    const records: Record<string, Map<string, any>> = {};
    for (let i = 0; i < QUICK_SYNC_STORES.length; i++) {
        const storeName = QUICK_SYNC_STORES[i];
        const rows = await DB.getRawStoreData(storeName);
        const hashes: Record<string, string> = {};
        const map = new Map<string, any>();
        for (const row of rows) {
            const key = recordKey(row);
            if (!key) continue;
            hashes[key] = await hashText(stableStringify(row));
            map.set(key, row);
        }
        stores[storeName] = hashes;
        records[storeName] = map;
        onProgress?.(i + 1, QUICK_SYNC_STORES.length, storeName);
    }
    return {
        manifest: { version: 1, createdAt: Date.now(), deviceId: getDeviceId(), stores },
        records,
    };
};

export const buildQuickSyncDelta = async (
    JSZipCtor: any,
    onProgress?: (done: number, total: number, label: string) => void
): Promise<{ blob: Blob; manifest: QuickSyncManifest; meta: QuickSyncDeltaMeta; changed: number }> => {
    const previous = loadQuickSyncManifest();
    const { manifest, records } = await buildQuickSyncManifest(onProgress);
    const zip = new JSZipCtor();
    const meta: QuickSyncDeltaMeta = {
        version: 1,
        createdAt: Date.now(),
        deviceId: manifest.deviceId,
        baseCreatedAt: previous?.createdAt,
        stores: {},
    };
    let changed = 0;

    for (let i = 0; i < QUICK_SYNC_STORES.length; i++) {
        const storeName = QUICK_SYNC_STORES[i];
        const prev = previous?.stores?.[storeName] || {};
        const next = manifest.stores[storeName] || {};
        const upserts: any[] = [];
        const deletes: string[] = [];

        for (const [key, hash] of Object.entries(next)) {
            if (prev[key] !== hash) {
                const item = records[storeName].get(key);
                if (item !== undefined) upserts.push(item);
            }
        }
        for (const key of Object.keys(prev)) {
            if (!(key in next)) deletes.push(key);
        }

        if (upserts.length || deletes.length) {
            zip.file(`stores/${storeName}.json`, JSON.stringify({ upserts, deletes }));
            meta.stores[storeName] = { upserts: upserts.length, deletes: deletes.length };
            changed += upserts.length + deletes.length;
        }
        onProgress?.(i + 1, QUICK_SYNC_STORES.length, `${storeName}: ${changed}`);
    }

    zip.file('quick-sync-meta.json', JSON.stringify(meta));
    zip.file('quick-sync-manifest.json', JSON.stringify(manifest));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    return { blob, manifest, meta, changed };
};

export const applyQuickSyncDelta = async (
    JSZipCtor: any,
    blob: Blob,
    onProgress?: (done: number, total: number) => void
): Promise<{ changed: number; meta: QuickSyncDeltaMeta }> => {
    const zip = await JSZipCtor.loadAsync(new File([blob], 'quick-sync.zip'));
    const metaFile = zip.file('quick-sync-meta.json');
    const manifestFile = zip.file('quick-sync-manifest.json');
    if (!metaFile || !manifestFile) throw new Error('这不是有效的快速同步增量包');
    const meta = JSON.parse(await metaFile.async('string')) as QuickSyncDeltaMeta;
    const manifest = JSON.parse(await manifestFile.async('string')) as QuickSyncManifest;
    let changed = 0;
    const total = Object.values(meta.stores || {}).reduce((sum, store) => sum + store.upserts + store.deletes, 0);
    let done = 0;

    for (const storeName of QUICK_SYNC_STORES) {
        const file = zip.file(`stores/${storeName}.json`);
        if (!file) continue;
        const patch = JSON.parse(await file.async('string')) as { upserts?: any[]; deletes?: Array<string | number> };
        const storeTotal = (patch.upserts?.length || 0) + (patch.deletes?.length || 0);
        await DB.applyRawStorePatch(storeName, patch.upserts || [], patch.deletes || [], (storeDone) => {
            onProgress?.(done + storeDone, total || storeTotal);
        });
        done += storeTotal;
        changed += storeTotal;
        onProgress?.(done, total || done);
    }

    saveQuickSyncManifest(manifest);
    return { changed, meta };
};
