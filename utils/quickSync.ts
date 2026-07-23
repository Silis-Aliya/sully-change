import { DB } from './db';
import { applyLocalStorageSettingsPatch, exportLocalStorageSettings } from './localSettingsBackup';
import { BLOBREF_PREFIX } from './blobRef';
import { encodeVectorsForBackup, ensureFloat32 } from './memoryPalace/db';
import type { VectorIndexEntry } from './backupFormat';

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
    'themes',
    'emojis',
    'emoji_categories',
    'assets',
    'gallery',
    'user_profile',
    'diaries',
    'tasks',
    'anniversaries',
    'room_todos',
    'room_notes',
    'groups',
    'journal_stickers',
    'social_posts',
    'courses',
    'games',
    'worldbooks',
    'novels',
    'songs',
    'bank_transactions',
    'bank_data',
    'xhs_activities',
    'xhs_stock',
    'quizzes',
    'guidebook',
    'scheduled_messages',
    'life_sim',
    'hotnews_snapshots',
    'memory_nodes',
    'memory_vectors',
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
    'vr_novels',
    'vr_annotations',
    'cc_custom_parts',
    'vr_music',
    'vr_guestbook',
    'vr_letters',
    'vr_settings',
    'vr_scripts',
    'vr_plays',
    'vr_presets',
    'worlds',
    'world_episodes',
    'daily_schedule',
    'pixel_home_assets',
    'pixel_home_layouts',
    'workbench_sessions',
    'workbench_messages',
    'workbench_summaries',
    'workbench_memories',
    'workbench_artifacts',
] as const;

const QUICK_SYNC_ASSET_IDS = new Set([
    'wallpaper',
    'lock_wallpaper',
    'launcherWidgetImage',
    'custom_font_data',
    'room_custom_assets_list',
    'wallpaper_user_backup',
    'spark_social_profile',
    'spark_user_bg',
    'bank_custom_furniture_assets_v1',
    'chrome_css_presets',
]);

const QUICK_SYNC_ASSET_PREFIXES = [
    'icon_',
    'appearance_preset_',
    'widget_',
    'deco_',
    'pixel_char_',
    'pixel_home_theme_',
    'acestep_',
    'mmmusic_',
] as const;

const escapeRegExp = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const BLOBREF_RE = new RegExp(`${escapeRegExp(BLOBREF_PREFIX)}([A-Za-z0-9_-]+)`, 'g');

export const shouldIncludeQuickSyncRow = (storeName: string, row: any): boolean => {
    if (storeName !== 'assets') return true;
    const id = typeof row?.id === 'string' ? row.id : '';
    if (!id) return false;
    return QUICK_SYNC_ASSET_IDS.has(id) || QUICK_SYNC_ASSET_PREFIXES.some(prefix => id.startsWith(prefix));
};

export const collectBlobRefIds = (value: any): string[] => {
    const ids = new Set<string>();
    const seen = new WeakSet<object>();
    const visit = (node: any) => {
        if (node === null || node === undefined) return;
        if (typeof node === 'string') {
            for (const match of node.matchAll(BLOBREF_RE)) {
                if (match[1]) ids.add(match[1]);
            }
            return;
        }
        if (typeof node !== 'object') return;
        if (seen.has(node)) return;
        seen.add(node);
        if (node instanceof Blob) return;
        if (Array.isArray(node)) {
            for (const item of node) visit(item);
            return;
        }
        for (const item of Object.values(node)) visit(item);
    };
    visit(value);
    return Array.from(ids);
};

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

const hashBlob = async (blob: Blob): Promise<string> => {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${blob.type || 'application/octet-stream'}:${blob.size}:${hex}`;
};

const hashBytes = async (bytes: Uint8Array): Promise<string> => {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const digest = await crypto.subtle.digest('SHA-256', copy);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
};

export const recordKeyForQuickSync = (storeName: string, item: any): string | null => {
    if (storeName === 'pixel_home_layouts') {
        if (item?.charId === undefined || item?.roomId === undefined) return null;
        return `compound:${JSON.stringify([item.charId, item.roomId])}`;
    }
    const id = storeName === 'memory_vectors' ? item?.memoryId : item?.id ?? item?.key ?? item?.name;
    if (id === undefined || id === null) return null;
    return String(id);
};

export const restoreQuickSyncDeleteKey = (storeName: string, key: string | number): IDBValidKey => {
    if (storeName !== 'pixel_home_layouts' || typeof key !== 'string' || !key.startsWith('compound:')) {
        return key;
    }
    try {
        const compoundKey = JSON.parse(key.slice('compound:'.length));
        return Array.isArray(compoundKey) ? compoundKey : key;
    } catch {
        return key;
    }
};

const normalizeVectorRowForHash = async (row: any): Promise<Record<string, any>> => {
    const f32 = ensureFloat32(row.vector);
    const bytes = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
    return {
        memoryId: row.memoryId,
        charId: row.charId || '',
        dimensions: f32.length,
        model: row.model || '',
        vectorHash: await hashBytes(bytes),
    };
};

const hashQuickSyncRow = async (storeName: string, row: any): Promise<string> => {
    if (storeName === 'memory_vectors') {
        return hashText(stableStringify(await normalizeVectorRowForHash(row)));
    }
    return hashText(stableStringify(row));
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
        const rows = (await DB.getRawStoreData(storeName)).filter(row => shouldIncludeQuickSyncRow(storeName, row));
        const hashes: Record<string, string> = {};
        const map = new Map<string, any>();
        for (const row of rows) {
            const key = recordKeyForQuickSync(storeName, row);
            if (!key) continue;
            hashes[key] = await hashQuickSyncRow(storeName, row);
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
            if (storeName === 'memory_vectors') {
                const vectorPayload = encodeVectorsForBackup(upserts);
                zip.file(`stores/${storeName}.json`, JSON.stringify({ upserts: [], deletes }));
                zip.file('stores/memory_vectors.delta.bin', vectorPayload.bin);
                zip.file('stores/memory_vectors.delta.index.json', JSON.stringify(vectorPayload.index));
            } else {
                zip.file(`stores/${storeName}.json`, JSON.stringify({ upserts, deletes }));
            }
            meta.stores[storeName] = { upserts: upserts.length, deletes: deletes.length };
            changed += upserts.length + deletes.length;
        }
        onProgress?.(i + 1, QUICK_SYNC_STORES.length, `${storeName}: ${changed}`);
    }

    const localStorageSettings = exportLocalStorageSettings();
    const localSettingsHashes: Record<string, string> = {};
    for (const [key, value] of Object.entries(localStorageSettings || {})) {
        localSettingsHashes[key] = await hashText(value);
    }
    manifest.stores.local_storage_settings = localSettingsHashes;
    const previousLocalSettings = previous?.stores?.local_storage_settings || {};
    const localSettingsUpserts: Record<string, string> = {};
    const localSettingsDeletes = Object.keys(previousLocalSettings).filter(key => !(key in localSettingsHashes));
    for (const [key, hash] of Object.entries(localSettingsHashes)) {
        if (previousLocalSettings[key] !== hash && localStorageSettings) localSettingsUpserts[key] = localStorageSettings[key];
    }
    const blobRefIds = new Set<string>();
    for (const [storeName, map] of Object.entries(records)) {
        if (storeName === 'memory_vectors') continue;
        for (const row of map.values()) {
            collectBlobRefIds(row).forEach(id => blobRefIds.add(id));
        }
    }
    if (localStorageSettings) {
        collectBlobRefIds(localStorageSettings).forEach(id => blobRefIds.add(id));
    }
    const blobHashes: Record<string, string> = {};
    const blobEntries = new Map<string, Blob>();
    for (const id of blobRefIds) {
        const blob = await DB.getBlobAsset(id).catch(() => null);
        if (!blob) continue;
        blobHashes[id] = await hashBlob(blob);
        blobEntries.set(id, blob);
    }
    manifest.stores.blob_assets = blobHashes;
    const prevBlobHashes = previous?.stores?.blob_assets || {};
    const blobManifest: Record<string, { type: string; size: number }> = {};
    let blobUpserts = 0;
    for (const [id, hash] of Object.entries(blobHashes)) {
        if (prevBlobHashes[id] === hash) continue;
        const blob = blobEntries.get(id);
        if (!blob) continue;
        zip.file(`blob-assets/${id}`, blob);
        blobManifest[id] = { type: blob.type || 'application/octet-stream', size: blob.size || 0 };
        blobUpserts += 1;
        changed += 1;
    }
    if (blobUpserts) {
        meta.stores.blob_assets = { upserts: blobUpserts, deletes: 0 };
    }
    if (blobUpserts) {
        zip.file('blob-assets-manifest.json', JSON.stringify(blobManifest));
    }

    zip.file('quick-sync-meta.json', JSON.stringify(meta));
    zip.file('quick-sync-manifest.json', JSON.stringify(manifest));
    const localSettingsUpsertCount = Object.keys(localSettingsUpserts).length;
    if (localSettingsUpsertCount || localSettingsDeletes.length) {
        zip.file('local-storage-settings.json', JSON.stringify({
            upserts: localSettingsUpserts,
            deletes: localSettingsDeletes,
        }));
        meta.stores.local_storage_settings = {
            upserts: localSettingsUpsertCount,
            deletes: localSettingsDeletes.length,
        };
        changed += localSettingsUpsertCount + localSettingsDeletes.length;
    }
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

    const blobManifestFile = zip.file('blob-assets-manifest.json');
    if (blobManifestFile) {
        const blobManifest = JSON.parse(await blobManifestFile.async('string')) as Record<string, { type?: string }>;
        for (const [id, info] of Object.entries(blobManifest || {})) {
            const file = zip.file(`blob-assets/${id}`);
            if (!file) continue;
            const bytes = await file.async('uint8array');
            await DB.putBlobAsset(id, new Blob([bytes], { type: info?.type || 'application/octet-stream' }));
            changed += 1;
        }
    }

    for (const storeName of QUICK_SYNC_STORES) {
        const file = zip.file(`stores/${storeName}.json`);
        if (!file) continue;
        const patch = JSON.parse(await file.async('string')) as { upserts?: any[]; deletes?: Array<string | number> };
        let upserts = patch.upserts || [];
        if (storeName === 'memory_vectors') {
            const indexFile = zip.file('stores/memory_vectors.delta.index.json');
            const binFile = zip.file('stores/memory_vectors.delta.bin');
            if (indexFile && binFile) {
                const index = JSON.parse(await indexFile.async('string')) as VectorIndexEntry[];
                const bin = await binFile.async('uint8array');
                upserts = index.map((entry) => ({
                    memoryId: entry.memoryId,
                    charId: entry.charId,
                    dimensions: entry.dimensions,
                    model: entry.model,
                    vector: bin.slice(entry.byteOffset, entry.byteOffset + entry.byteLength),
                }));
            }
        }
        const storeTotal = upserts.length + (patch.deletes?.length || 0);
        const deleteKeys = (patch.deletes || []).map(key => restoreQuickSyncDeleteKey(storeName, key));
        await DB.applyRawStorePatch(storeName, upserts, deleteKeys, (storeDone) => {
            onProgress?.(done + storeDone, total || storeTotal);
        });
        done += storeTotal;
        changed += storeTotal;
        onProgress?.(done, total || done);
    }

    const localStorageFile = zip.file('local-storage-settings.json');
    if (localStorageFile) {
        const payload = JSON.parse(await localStorageFile.async('string')) as
            | Record<string, string>
            | { upserts?: Record<string, string>; deletes?: string[] };
        const isPatch = payload && typeof payload === 'object' && ('upserts' in payload || 'deletes' in payload);
        const upserts = isPatch ? (payload as { upserts?: Record<string, string> }).upserts || {} : payload as Record<string, string>;
        const deletes = isPatch ? (payload as { deletes?: string[] }).deletes || [] : [];
        applyLocalStorageSettingsPatch(upserts, deletes);
        changed += Object.keys(upserts || {}).length + deletes.length;
        done += Object.keys(upserts || {}).length + deletes.length;
        onProgress?.(done, total || done);
    }

    saveQuickSyncManifest(manifest);
    return { changed, meta };
};
