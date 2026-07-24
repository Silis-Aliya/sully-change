/**
 * Small localStorage settings that should travel with backups and QuickSync.
 *
 * This intentionally includes private self-hosted credentials such as XHS
 * cookies, WebDAV/GitHub backup passwords, MCP tokens, and worker tokens. The
 * fork is personal-use first, and cross-device restore should reproduce the
 * working setup instead of silently dropping credentials.
 */

export const BACKUP_LOCAL_STORAGE_EXACT_KEYS: readonly string[] = [
    'os_theme',
    'os_api_config',
    'os_api_presets',
    'os_available_models',
    'os_realtime_config',
    'os_memory_palace_config',
    'os_remote_vector_config',
    'os_cloud_backup_config',
    'os_dream_collection',
    'os_last_active_char_id',
    'os_char_groups_expanded',
    'study_api_config',
    'study_tutor_presets',
    'instant_push_config_v1',
    'push_vapid_v1',
    'proactive_push_enabled_v1',
    'chat_translate_source_lang',
    'chat_translate_lang',
    'chat_archive_prompts',
    'chat_active_archive_prompt_id',
    'character_refine_prompts',
    'character_active_refine_prompt_id',
    'schedule_app_theme',
    'handbook_lifestream_depth',
    'groupchat_context_limit',
    'browser_brave_key',
    'browser_use_real_search',
    'bm25_mode',
    'tama_accent_hue',
    'tama_style_v2',
    'mg_style_v1',
    'tama_board_img',
    'tama_board_fg',
    'spark_char_handles',
    'spark_user_id',
    'spark_user_bg',
    'spark_social_profile',
    'room_custom_assets',
    'world_home_api',
    'world_custom_styles',
    'cp_tavern_style',
    'vr_help_seen',
    'vr_po_base',
    'vr_po_device',
    'signal_my_authorship',
    'signal_my_lines',
    'signal_notice_ack',
    'aetheros.mcp.servers',
    'aetheros.mcp.useNativeTools',
    'aetheros.luckin.mcpToken',
    'aetheros.luckin.mcpEnabled',
    'aetheros.mcd.mcpToken',
    'aetheros.mcd.mcpEnabled',
    'sully_proxy_worker_url_v1',
    'sully_video_parse_key_v1',
    'workbench_bridge_config_v1',
    'workbench_projects_v1',
    'workbench_mode_v1',
] as const;

const BACKUP_LOCAL_STORAGE_PREFIXES: readonly string[] = [
    'mp_lastMsgId_',
    'mp_personality_tried_',
    'mp_first_archive_notice_',
    'chat_translate_enabled_',
    'chat_translate_source_lang_',
    'chat_translate_lang_',
    'sullyos_',
] as const;

const MAX_VALUE_BYTES = 512 * 1024;

const byteLength = (value: string): number => {
    try {
        return new TextEncoder().encode(value).byteLength;
    } catch {
        return value.length;
    }
};

export const shouldBackupLocalStorageKey = (key: string): boolean => {
    if (BACKUP_LOCAL_STORAGE_EXACT_KEYS.includes(key as any)) return true;
    return BACKUP_LOCAL_STORAGE_PREFIXES.some(prefix => key.startsWith(prefix));
};

export const exportLocalStorageSettings = (): Record<string, string> | undefined => {
    try {
        const out: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !shouldBackupLocalStorageKey(key)) continue;
            const value = localStorage.getItem(key);
            if (typeof value !== 'string') continue;
            if (byteLength(value) > MAX_VALUE_BYTES) continue;
            out[key] = value;
        }
        return Object.keys(out).length > 0 ? out : undefined;
    } catch {
        return undefined;
    }
};

export const importLocalStorageSettings = (data: Record<string, string> | null | undefined): void => {
    if (!data || typeof data !== 'object') return;
    try {
        for (const [key, value] of Object.entries(data)) {
            if (!shouldBackupLocalStorageKey(key)) continue;
            if (typeof value !== 'string') continue;
            if (byteLength(value) > MAX_VALUE_BYTES) continue;
            localStorage.setItem(key, value);
        }
    } catch {
        /* localStorage unavailable or quota full: keep import best-effort */
    }
};

export const applyLocalStorageSettingsPatch = (
    upserts: Record<string, string> | null | undefined,
    deletes: string[] | null | undefined,
): void => {
    importLocalStorageSettings(upserts);
    if (!Array.isArray(deletes)) return;
    try {
        for (const key of deletes) {
            if (typeof key === 'string' && shouldBackupLocalStorageKey(key)) localStorage.removeItem(key);
        }
    } catch {
        /* localStorage unavailable: keep sync best-effort */
    }
};
