export const MUSIC_TRACK_CHANGED_EVENT = 'music-track-changed';

export interface MusicTrackInfo {
    id: number;
    name: string;
    artists: string;
}

export interface MusicWakePickableSong extends MusicTrackInfo {
    album?: string;
    albumPic?: string;
    duration?: number;
    fee?: number;
    local?: boolean;
    localAssetKey?: string;
    localMimeType?: string;
    localCoverStyle?: string;
    customAuthorCharIds?: string[];
    localLyrics?: string;
    lyricLineTimings?: number[];
    sourceLabel: string;
}

interface MusicWakePickableInput {
    charSongs?: Array<Partial<MusicWakePickableSong> & MusicTrackInfo & { addedAt?: number }>;
    userSongs?: Array<Partial<MusicWakePickableSong> & MusicTrackInfo>;
    currentSongId?: number | null;
    max?: number;
}

export function buildMusicWakePickableSongs(input: MusicWakePickableInput): MusicWakePickableSong[] {
    const max = Math.max(1, input.max || 10);
    const seen = new Set<number>();
    const out: MusicWakePickableSong[] = [];
    const push = (song: Partial<MusicWakePickableSong> & MusicTrackInfo, sourceLabel: string) => {
        if (!song || !Number.isFinite(song.id) || seen.has(song.id) || song.id === input.currentSongId) return;
        seen.add(song.id);
        out.push({
            id: song.id,
            name: song.name,
            artists: song.artists,
            album: song.album || '',
            albumPic: song.albumPic || '',
            duration: song.duration || 0,
            fee: song.fee || 0,
            local: song.local,
            localAssetKey: song.localAssetKey,
            localMimeType: song.localMimeType,
            localCoverStyle: song.localCoverStyle,
            customAuthorCharIds: song.customAuthorCharIds,
            localLyrics: song.localLyrics,
            lyricLineTimings: song.lyricLineTimings,
            sourceLabel,
        });
    };

    const charSongs = [...(input.charSongs || [])]
        .sort((a, b) => ((b as any).addedAt || 0) - ((a as any).addedAt || 0));
    for (const song of charSongs) {
        if (out.filter(s => s.sourceLabel === 'TA的歌').length >= 5) break;
        push(song, 'TA的歌');
    }
    for (const song of input.userSongs || []) {
        if (out.length >= max) break;
        push(song, '你的队列');
    }
    for (const song of charSongs) {
        if (out.length >= max) break;
        push(song, 'TA的歌');
    }
    return out.slice(0, max);
}

export function formatMusicWakePickableSongs(songs: MusicWakePickableSong[]): string {
    if (!songs.length) return '';
    return songs
        .map((song, index) => `${index + 1}. [${song.sourceLabel}]《${song.name}》 ${song.artists}`)
        .join('\n');
}

const musicWakePickableCache = new Map<string, MusicWakePickableSong[]>();

export function rememberMusicWakePickableSongs(charId: string, songs: MusicWakePickableSong[]): void {
    musicWakePickableCache.set(charId, songs.slice(0, 10));
}

export function getRememberedMusicWakePickableSongs(charId: string): MusicWakePickableSong[] {
    return musicWakePickableCache.get(charId) || [];
}

export interface MusicTrackChangeDetail {
    charIds: string[];
    previousSong: MusicTrackInfo;
    currentSong: MusicTrackInfo;
}

export function createMusicTrackChangeDetail(
    previousSong: MusicTrackInfo | null,
    currentSong: MusicTrackInfo | null,
    listeningCharIds: string[],
): MusicTrackChangeDetail | null {
    if (!previousSong || !currentSong || previousSong.id === currentSong.id || listeningCharIds.length === 0) {
        return null;
    }

    return {
        charIds: [...listeningCharIds],
        previousSong: {
            id: previousSong.id,
            name: previousSong.name,
            artists: previousSong.artists,
        },
        currentSong: {
            id: currentSong.id,
            name: currentSong.name,
            artists: currentSong.artists,
        },
    };
}

export function buildMusicTrackChangeHint(detail: MusicTrackChangeDetail, userName: string): string {
    const previous = `《${detail.previousSong.name}》- ${detail.previousSong.artists}`;
    const current = `《${detail.currentSong.name}》- ${detail.currentSong.artists}`;
    return `[系统提示（非${userName}发言）：你正在和${userName}一起听歌。刚才播放的是 ${previous}，现在播放器已经切换到 ${current}。一起听会话仍在继续；请根据新歌、关系和此刻气氛自然反应，可以评论、调侃或以后决定退出。不要为了“继续一起听”输出 [[MUSIC_ACTION:join]]，也不要提及你收到了系统提示。]`;
}

export function buildMusicInviteHint(song: MusicTrackInfo, userName: string): string {
    return `[系统提示（非${userName}发言）：${userName}邀请你一起听《${song.name}》— ${song.artists}。

结合歌曲、你和${userName}的关系、当前气氛与心情，自然决定是否加入，不必勉强。

接受时，只输出：
[[MUSIC_ACTION:join]]
[[MUSIC_WAKE_AFTER:Xm]]

X为5–20之间的整数，表示下次自然唤醒的分钟数。

拒绝时，只输出：
[[MUSIC_ACTION:reject]]

系统会自动渲染相应状态卡，因此不要添加“已接受/已拒绝”等状态文案，也不要提及系统提示。

本轮不得使用next_song、pick_song、set_mode或leave。
]`;
}

export function buildMusicWakeHint(input: {
    userName: string;
    song?: MusicTrackInfo | null;
    togetherDuration: string;
    progress: string;
    changeSummary?: string;
    pickableSongs?: string;
}): string {
    const songLine = input.song
        ? `当前歌曲：《${input.song.name}》— ${input.song.artists}`
        : '当前歌曲：暂无';
    const changeLine = input.changeSummary?.trim()
        ? input.changeSummary.trim()
        : '暂无';
    const pickableSongs = input.pickableSongs?.trim()
        ? input.pickableSongs.trim()
        : '';

    return `[系统提示（非${input.userName}发言）：这是“一起听”的一次自然唤醒。

${songLine}
已一起听：${input.togetherDuration}
播放进度：${input.progress}
上次唤醒后的变化：${changeLine}

结合你的性格、与${input.userName}的关系、歌曲氛围和当前心情，自然决定此刻要做什么。

你可以自然说些想说的话，也可以只调整播放器不说话；但如果没有任何播放器动作，就请说一句自然回应。

可选歌曲：
${pickableSongs || '暂无可选歌曲'}

如确实想调整播放器，可使用：
- \`[[MUSIC_ACTION:next_song]]\`
- \`[[MUSIC_ACTION:pick_song|N]]\`（N必须对应可选歌曲）
- \`[[MUSIC_ACTION:set_mode|shuffle]]\`
- \`[[MUSIC_ACTION:set_mode|loop]]\`
- \`[[MUSIC_ACTION:set_mode|single]]\`
- \`[[MUSIC_ACTION:leave]]\`

规则：
- \`next_song\`与\`pick_song\`最多使用一个。
- 三种播放模式最多选择一个。
- 可同时使用\`next_song\`和一个模式动作，也可完全不操作；但如果使用\`pick_song\`，不要同时使用\`set_mode|shuffle\`，点歌会默认按\`loop\`播放。
- 使用\`leave\`时不得使用其他动作，也不要输出唤醒时间。
- 若继续一起听，必须输出\`[[MUSIC_WAKE_AFTER:Xm]]\`，X为5–20的整数。
]`;
}
