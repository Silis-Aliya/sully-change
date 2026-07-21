# SullyOS Fork Maintenance Log

This file is the handoff log for the Silis-Aliya SullyOS fork. Keep it short, practical, and updated after every upstream merge or custom feature change.

## Next-Window Prompt

Copy this block into a new Codex window when continuing maintenance:

```text
You are maintaining my SullyOS fork at D:\SullyOS-fork.

Important rules:
- Preserve my custom features first: music together, XHS Lite simple mode, XHS phone channel / Pixel MCP, WebDAV QuickSync, GitHub backup proxy, mobile restore batching, device detection, memory palace vector anomaly tools.
- When merging upstream, do not overwrite my OSContext / chat prompt / post-processing changes blindly.
- If editing prompts, show me the full prompt first and wait for confirmation.
- After changes, run npm run build.
- Keep this file updated with what changed, risk points, and follow-up checks.

Current known baseline:
- upstream/master merged through 98c6c1e.
- Remote master was updated to c5155c7.
- Last verified build passed.
- Vercel deployment after that push succeeded.
```

## 2026-07-21 Upstream Refresh to ac7f739

### Result

- Fetched upstream and found `upstream/master` advanced from `98c6c1e` to `ac7f739`.
- Merged latest upstream into `codex/merge-upstream-20260721`.
- Resolved conflicts in:
  - `apps/Settings.tsx`
  - `context/OSContext.tsx`
- Built successfully with `pnpm build`.

### Upstream Changes Integrated

- Loyal user recruitment feature:
  - `components/LoyalUserRecruitmentEvent.tsx`
  - `utils/loyalUserEligibility.ts`
  - `utils/loyalUserRecruitment.ts`
  - `worker/loyal-recruitment/*`
- Nostalgic desktop appearance option.
- Chat module card avatar hiding fix.
- Backup import policy guard replacing the older CSY migration path.
- Worker build script update for loyal recruitment worker bundling.

### Conflict Notes

- `apps/Settings.tsx`: kept local `cloudRestoreProvider` state for WebDAV/GitHub restore source and upstream `showCommunityMigration` state for the loyal recruitment controller.
- `context/OSContext.tsx`: kept local music together / QuickSync / backup / XHS / proactive changes while adopting upstream nostalgia-preserving wallpaper migration logic.
- Removed old CSY migration references in favor of upstream `assertSupportedSullyBackup`.

### Follow-Up Checks

- `pnpm build` passed, including `loyal-recruitment` worker bundling.
- Manual runtime checks still recommended for Settings, Appearance, backup import/restore, QuickSync, music together, and XHS phone channel.

## 2026-07-21 Merge Baseline

### Result

- Merged upstream latest into the fork.
- Restored custom SullyOS features.
- Recovered upstream local-date fixes that were initially covered by local conflict resolution.
- Merged upstream appearance asset handling into the local OSContext without replacing custom features.
- Built successfully with `npm run build`.
- Pushed current HEAD to remote `master`.
- Vercel deployment succeeded.

### Key Commits

- `f2af6dc` - Merge upstream SullyOS updates
- `96853c4` - Restore local SullyOS custom features after upstream merge
- `ec47dcd` - Restore upstream local date fixes
- `c5155c7` - Merge upstream appearance asset handling

### Upstream Changes Integrated

- Launcher / Appearance refinements.
- Default paper-style wallpaper and appearance defaults.
- Custom icon outline handling.
- Blobref handling for wallpapers, lock wallpapers, custom icons, and appearance presets.
- Local date utilities for daily schedule and prompt date handling.
- Related daily schedule, life record, memory palace date fixes.

### Custom Features Preserved

- Music together / together listening:
  - invite, accept, reject, leave
  - wake scheduling
  - `MUSIC_WAKE_AFTER`
  - `MUSIC_ACTION: next_song | pick_song | set_mode | leave`
- Netease music page / lyric page together-listening entry points.
- WebDAV QuickSync:
  - fixed latest delta name
  - overwrite latest instead of timestamp pile-up
  - update manifest only after upload succeeds
  - cleanup old quick sync timestamp deltas
  - mobile batched restore/write safety
- WebDAV full backup cleanup:
  - only cleans `Sully_Backup_` zip files
  - does not delete quick sync deltas
- GitHub backup proxy:
  - default Cloudflare Worker proxy
  - old unstable proxy avoided
  - proxy toggle persists
- Mobile import batching:
  - normal data 200 per batch
  - `memory_links` 400 per batch
  - `memory_vectors` 30 per batch
  - `setTimeout(0)` yield between batches
- Device detection:
  - Android / iPhone / iPad / iPod / Mobile / Tablet
  - iPadOS desktop UA detection via `MacIntel + maxTouchPoints`
  - realtime context includes phone / tablet / computer
- Memory palace vector anomaly tools:
  - total memory count
  - vector success count
  - missing vector count
  - preview first 20 missing-vector memories
  - one-click delete missing-vector memories
- XHS Lite simple mode:
  - search
  - browse
  - detail
  - share card
  - like
  - profile
  - no post / favorite / comment / reply in simple mode
- XHS phone channel / Pixel MCP:
  - `pixel-agent-server.js`
  - `utils/xhsPhoneChannel.ts`
  - health/open/observe/browse/search/open detail/like/share/profile actions
  - settings panel for MCP URL, Pixel ADB address, token, and connection test

## Important Risk Points

### OSContext Is High Risk

`context/OSContext.tsx` is the most collision-prone file. It now contains both:

- upstream appearance/blobref migration logic
- local backup/sync/XHS/music/device/proactive changes

Do not replace this file wholesale from upstream. Merge specific blocks only.

### Prompt Files Need Confirmation

Before editing prompts, show the full prompt and get confirmation.

Important prompt-related files:

- `utils/chatPrompts.ts`
- `utils/applyAssistantPostProcessing.ts`
- `utils/chatParser.ts`
- `utils/context.ts`

### XHS Modes Can Conflict

Avoid enabling multiple XHS operation paths at the same time unless intentionally testing:

- old/full XHS Lite
- XHS Lite simple mode
- XHS phone channel / Pixel MCP

If multiple modes expose similar tags, the model can choose the wrong channel.

### XHS Phone Channel Is Experimental

It depends on external runtime state:

- cloud Pixel Agent server online
- valid long-lived token
- Pixel online and unlocked
- Tailscale connected
- ADB state is `device`
- XHS app logged in and readable

Failure should be treated as channel/runtime failure first, not necessarily frontend code failure.

### Build Passing Is Not Full Regression

`npm run build` confirms TypeScript/build integrity. It does not prove:

- WebDAV upload/pull works
- GitHub backup upload works
- XHS cookie is valid
- Pixel channel can control the phone
- music together wake timers fire
- imported backups restore correctly on mobile

## Daily Maintenance Flow

### Before Any Change

```bash
cd D:\SullyOS-fork
git status --short --branch
```

If dirty, understand what changed before editing. Do not reset user changes.

### Normal Local Development

```bash
npm run build
```

For UI testing:

```bash
npm run dev
```

### After Editing

1. Run build:

```bash
npm run build
```

2. Check status:

```bash
git status --short --branch
```

3. Commit with a specific message:

```bash
git add <changed-files>
git commit -m "Short clear message"
```

4. Push only after build passes:

```bash
git push origin HEAD:master
```

### Upstream Merge Flow

1. Fetch upstream:

```bash
git fetch upstream
```

2. Create a safety branch:

```bash
git switch -c codex/merge-upstream-YYYYMMDD
```

3. Merge upstream:

```bash
git merge upstream/master
```

4. Resolve conflicts carefully. High-risk files:

- `context/OSContext.tsx`
- `utils/chatPrompts.ts`
- `utils/applyAssistantPostProcessing.ts`
- `apps/Chat.tsx`
- `context/MusicContext.tsx`
- `hooks/useChatAI.ts`
- `utils/chatRequestPayload.ts`

5. Build:

```bash
npm run build
```

6. Push a review branch first:

```bash
git push -u origin codex/merge-upstream-YYYYMMDD
```

7. Only push to `master` after confirming:

```bash
git push origin HEAD:master
```

## Regression Checklist

Run this when a merge/deploy looks risky:

- Chat opens and sends a normal reply.
- Prompt/token monitor still renders.
- Settings page opens.
- XHS Lite simple mode UI exists and saves config.
- XHS Lite simple mode can search/browse/detail/share if cookie is valid.
- XHS phone channel config UI exists and test connection reports useful status.
- Together listening invite/accept/leave works.
- Music page and lyric page still have together-listening entry.
- WebDAV QuickSync upload/pull does not create timestamp piles.
- Full WebDAV backup cleanup does not delete quick sync deltas.
- GitHub backup proxy config persists.
- Memory palace vector anomaly management opens.
- Mobile restore/import does not freeze on large batches.
- Appearance presets still save/apply/import.
- Custom icon upload still works.
- Lock wallpaper behavior still works if used.

## Current Deployment Note

The deployment after pushing `c5155c7` to remote `master` succeeded. Treat this as the current stable deployed baseline unless a later entry says otherwise.
