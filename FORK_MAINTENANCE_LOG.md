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
- After changes, run pnpm build.
- Deployment default: after fetching/checking upstream and confirming there are no new upstream commits to merge, a user request to `push`, deploy, or update Vercel means push the verified current release directly to `Silis-Aliya/sully-change` `master` so Vercel production deploys. Do not stop at a feature-branch push. If upstream has advanced, conflicts exist, or verification failed, stop and report before touching production `master`.
- Keep this file updated with what changed, risk points, and follow-up checks.

Current known baseline:
- upstream/master merged through a5e8230.
- Current fork release branch is `codex/merge-upstream-20260721`.
- Last verified full suite passed at 127 files / 1212 tests after the action-receipt, portable-sync, XHS Lite, and upstream compatibility fixes.
- Last verified production build passed after the music sharing, together-listening, Code/XHS, backup, and upstream merge fixes.
- The feature branch and Vercel production repository `Silis-Aliya/sully-change` `master` must point to the same verified release commit.
- Vercel should auto-deploy from `master` after the push; verify the deployment dashboard before treating production as updated.
```

## Merge Attention: Fork Decisions and Card Placement

- Confirmed fork decisions override conflicting upstream behavior. Do not restore an upstream rule merely because an old upstream test, comment, or implementation still expects it.
- Current protected chat rule: music shares and together-listening invitations are chat-owned messages, not centered modules. They stay on the actual sender/inviter side; character-side cards keep the outer character avatar; together-listening cards also keep their internal participant avatars.
- Code/Workbench has its own layout and may use centered tool/progress cards. Do not generalize Code card layout back into normal chat.
- For any new feature or new card type, or any change that would affect card alignment, sender ownership, outer avatars, internal avatars, or message/card ordering, stop before implementation and explicitly alert the user that the change may revisit the earlier card-layout plan.
- Present concrete choices instead of choosing silently:
  - **A. Chat-owned message:** follows the real sender left/right and uses that sender's normal outer avatar.
  - **B. Centered module:** centered independently and has no normal message-side ownership/avatar.
  - **C. Card-specific rule:** describe the exact sender, alignment, avatar, and ordering behavior for this card.
- State the current fork behavior and the upstream behavior beside those options, recommend one, and wait for the user's choice before changing runtime layout.
- If an upstream merge touches `components/chat/MessageItem.tsx`, `utils/messageItemModuleLayout.test.ts`, chat card metadata, or module-alignment settings, re-audit this decision explicitly and report any conflict before resolving it.

## Optional Future Idea: XHS Image Understanding

- This is a non-binding design note, not a current defect, required task, merge requirement, or standing recommendation.
- Current XHS behavior may remain text-first: characters and Code assistants read the title, body, author, comments, link, and available card metadata. The card cover is visual UI media and is not currently sent to models as multimodal input.
- A possible future implementation, only if the user explicitly asks to let models inspect XHS post images, is: use the authenticated Lite service to fetch a limited number of images, compress/cache or expose them through short-lived signed URLs, and attach them as `image_url` parts for vision-capable models while retaining a text-only fallback.
- Such an implementation would need an explicit product decision about first image vs. up to three images vs. user-triggered viewing, plus review of account-risk, request volume, privacy, payload size, model compatibility, and cost.
- Do not implement this idea merely because it appears in this log. Do not repeatedly ask whether the user wants it during ordinary audits, upstream merges, or unrelated XHS work. Revisit it only when the user explicitly requests XHS image understanding or asks to review this future idea.

## 2026-07-24 Workbench Bridge Token Hardening

- The Workbench CLI bridge now refuses to start on non-loopback hosts such as `0.0.0.0` unless `--token` or `WORKBENCH_BRIDGE_TOKEN` is set.
- The bridge also reads `%USERPROFILE%\.sullyos-workbench-bridge-token` and repo-local `.workbench-bridge-token`, so existing autostart tasks can recover after the token file is placed.
- Local unauthenticated debugging remains possible only with loopback hosts (`localhost`, `127.0.0.1`, or `::1`).
- `scripts/start-workbench-bridge.bat` now loads the token from `WORKBENCH_BRIDGE_TOKEN`, `%USERPROFILE%\.sullyos-workbench-bridge-token`, or `.workbench-bridge-token` before prompting interactively.
- `scripts/autostart-workbench-bridge.cmd` now loads the same token sources and fails fast instead of waiting for manual input at login.
- `scripts/install-workbench-bridge-startup.ps1` now rejects non-local scheduled-task installs without `-Token`.
- Cloudflare named tunnel remains the intended remote path; random temporary public tunnel access should not be used for Code bridge exposure.
- Code no longer probes the Cloudflare `/health` route on mount or every 10 seconds. Connection checks happen only through the explicit test command or lazily before a real AI-assistant request.
- A lazy check failure, including `401`, `403`, or `Unauthorized`, only changes the capability label to `电脑未连接`, switches to Inspiration when needed, and silently uses the fallback API when configured. It must not create a `SYSTEM ERROR` message or repeated error toast.
- A successful lazy check marks the computer connected and continues the requested assistant turn. A later real bridge disconnect returns to the same silent offline path.

## 2026-07-24 Portable Data Audit And Upstream Refresh

- Audited persisted user/character records, character groups, action receipts, options, chat/Code cards, and referenced images against full export/import and QuickSync.
- Character action receipts are ordinary persisted `messages`; hiding system logs changes rendering only and does not remove them from history, character context, backup, or incremental sync.
- QuickSync already propagated row and local-setting additions, edits, and deletions. It now also writes and applies explicit `blob_assets` deletion lists, so replacing or removing the last synced image reference does not leave the receiving device with an orphaned avatar, wallpaper, or card image.
- Fixed QuickSync metadata serialization order so local-setting changes are included in the delta's published counts and progress total.
- Added persistent Post Office identity/base URL, Signal authorship/reuse records, and mobile-game skin settings to incremental settings coverage. Post Office admin credentials and one-turn Signal whispers remain intentionally device-local.
- Merged `upstream/master` through a5e8230. Kept the fork's shared Chat/Code XHS resolver, card placement rules, music-session context, and Code surface behavior while adopting upstream OpenRouter heartbeat parsing, Gemini MCP tool compatibility, character-scoped emoji filtering, Memory Palace fixes, and normalized XHS Lite comments/interactions.
- Updated the shared XHS resolver to use upstream's safe nested comment normalizer instead of maintaining a second raw-comment parser.
- Hardened `safeResponseJson` for Response-compatible proxy/test objects that omit `headers`; normal browser responses remain unchanged.
- Verification: 127 test files / 1212 tests passed; production build passed.

## 2026-07-24 Music Sharing, Together Listening, Code/XHS, and Backup Audit

### Upstream and Deployment

- Rechecked `upstream/master`; no newer upstream commit was present beyond 3255ee7, so no merge was performed.
- Continued development on `codex/merge-upstream-20260721`.
- Pushed the fork to GitHub and updated the Vercel production repository `Silis-Aliya/sully-change` on `master`.
- Current documented release head: ef24df1 (`show together listening exits on the actor side`).

### Music Sharing

- Added a Share action to music Now Playing. It sends the current track to a selected character's normal chat as the existing `music_card` with share intent.
- Added character-initiated sharing through `[[MUSIC_SHARE:N]]`, restricted to the supplied shareable-song list.
- Split normal-chat music tools into three states: a short always-available daily share guide, full collect/react/invite guidance only when the user shared a music card in the current turn, and the existing player controls while already listening together.
- Daily character sharing uses `[[MUSIC_SHARE:N]]`; `[[MUSIC_TOGETHER_REQUEST]]` may accompany that same-turn share but must not be sent alone without a song.
- Music cards carry and render title, artist, album, cover, and playable track data. Prompt context expands this metadata instead of exposing only `[音乐分享]`.
- User-sent and character-sent music cards preserve the actual sender side.
- Characters can collect shared or currently playing tracks through `MUSIC_ACTION:add`, `add|歌单标题`, or `add_new|新歌单标题|描述`; results persist in `character.musicProfile.playlists`.
- Characters do not receive or analyse raw audio. They receive current song metadata and available music context; no per-message lyric/comment lookup or extra listening-analysis model call was added.

### Together-Listening Lifecycle

- Added character-created invitations through `[[MUSIC_TOGETHER_REQUEST]]` and reused the established accept/reject invitation UI.
- Invitation cards are owned by the inviter. Avatar order is inviter first and invitee second, and result copy identifies the participant who actually accepted.
- The Now Playing together indicator displays both participants and preserves inviter-first ordering.
- Changing tracks does not silently end an active together-listening session.
- Active or pending sessions block duplicate invitations from either side, including repeated model directives.
- Accepting a character-created invitation keeps the user's existing queue, starts with the shared song, and switches the queue to shuffle; later manual mode changes remain authoritative.
- User and character exits reuse the established exit-event design while preserving actor ownership: user exits render on the user/right side and character exits on the assistant/left side.
- The user's Now Playing exit control opens a centered two-option confirmation dialog.
- Active together-listening session state is transient and is intentionally not restored by import/export or QuickSync.

### Code / Workbench

- Extended Workbench rendering so ordinary-chat Xiaohongshu share payloads and links use the same normalized card path in Code for both user and character messages.
- Workbench image messages now remain multimodal for character requests instead of being flattened to `[图片]`.
- Bridge requests carry recent Code image data; the computer bridge writes up to three images to request-scoped temporary files and passes them to Codex CLI through `--image`, then removes the files.
- Increased the authenticated bridge request-body default to 4 MB for compressed Code images; each decoded CLI image is capped at 2 MB.
- Chat and Workbench now call the same `resolveXhsShareLink` pipeline for short-link expansion, note ID/token extraction, MCP/Lite detail loading, comments, and card metadata.
- A short-link expansion failure is reported as a real read failure and does not create a fake empty card; a resolved link may still retain basic metadata when the configured detail service fails.
- Existing already-saved malformed text bubbles are not destructively rewritten; newly parsed or rendered records use the corrected path.
- Added a temporary progress-card author correction control for historically misattributed records. Corrections propagate to related Workbench summary and chat/code-card records so export and incremental sync retain the selected author.
- Remove the temporary author selector only after the user confirms all historical progress cards have been corrected.

### Backup, Import/Export, and QuickSync

- Character records include `musicProfile.playlists`, so character music collections are covered by full export/import and character-row QuickSync.
- Chat messages include music shares, invitations, invitation results, and exit events.
- Added the `songs` and `vr_music` stores and generated-audio prefixes including `acestep_` and `mmmusic_` to the global backup/sync inventory.
- Workbench/Code settings, conversations, summaries, tasks, cards, and metadata are included. Real project file bodies outside the app database remain excluded.
- Worldbook records and mounted worldbook snapshots are included, so edits to world settings are preserved.
- QuickSync remains whole-record last-write-wins; simultaneous edits to the same row on two devices can overwrite one another.
- Ephemeral UI/runtime state, including the current together-listening session, is intentionally excluded.

### Verification

- The full-suite baseline passed at 109 files / 1163 tests before the final narrow UI ownership fixes.
- Focused music-card, prompt-context, together-invitation, duplicate-session, Code/XHS parsing, and backup tests passed after their respective changes.
- Repeated production builds passed through the documented release head.

## 2026-07-23 Upstream Refresh to 3255ee7

### Result

- Fetched upstream and found `upstream/master` advanced from `ece65a3` to `3255ee7`.
- Merged latest upstream into `codex/merge-upstream-20260721`.
- Resolved conflicts in:
  - `apps/Chat.tsx`
  - `apps/MemoryPalaceApp.tsx`
  - `hooks/useChatAI.ts`
  - `types.ts`
- Kept `AGENTS.md` untracked and out of the merge commit.

### Upstream Changes Integrated

- Decoupled chat raw-context range from Memory Palace high-water mark:
  - adaptive range for auto-memory characters
  - manual 20-5000 message range
  - user breakpoint constrained inside the maximum readable range
- Added safer Xiaohongshu / RedNote link handling:
  - `rednote.com`
  - mobile `xhslink.cn`
  - stricter hostname checks before extracting note IDs
- Added Memory Palace range-selection search helpers and tests.
- Included voice transcripts and metadata-backed cards in memory-context relevance.
- Added psyche card long-press copy behavior and iOS copy fallback refinements.

### Conflict / Risk Notes

- `apps/Chat.tsx`: adopted upstream full-message history for AI raw-range management so UI display filters do not shift prompt boundaries.
- `hooks/useChatAI.ts`: kept local filtering that prevents `[Code 进度]` system cards from entering emotion evaluation, while adopting upstream `evalChar` freshness fix.
- `types.ts`: kept local `music_invite_result` / `code_card` message types and added upstream `voice`.
- `components/chat/MessageItem.tsx`: music cards remain ordinary chat-owned messages rather than centered modules: they stay on the actual sender/inviter side and character-side cards keep the outer message avatar; together-listening cards also retain their internal participant avatars.
- `utils/chatPrompts.ts`: auto-merged a context-breakpoint code-path update only; no prompt prose was changed by conflict resolution.

### Verification

- `pnpm vitest run utils/chatContextRange.test.ts utils/webpageExtractor.test.ts utils/videoParser.test.ts utils/memoryPalace/rangeSelection.test.ts utils/memoryPalace/querySanitizer.test.ts utils/memoryPalace/bufferCount.test.ts utils/backupRoundtrip.test.ts utils/messageItemModuleLayout.test.ts` passed.
- `pnpm build` passed.

### Follow-Up Checks

- Manual runtime check recommended for Chat settings' `AI 原文读取范围`, Memory Palace range selection, mobile `xhslink.cn` share cards, RedNote links, psyche long-press copy on iOS, and music-together card layout.

## 2026-07-23 Workbench Mobile Polish / Upstream Check

### Result

- Checked `upstream/master`; no new upstream commits were available, so no merge commit was needed.
- Added normal-chat-style image sending to Code/Workbench:
  - input bar now has an image button
  - selected screenshots/images are compressed with the same mobile chat settings
  - image messages render as image bubbles
  - quote/copy/context fall back to `[图片]` instead of leaking base64
  - fallback chat API can send Workbench images as OpenAI-compatible `image_url` parts when the model supports vision
- Fixed Code assistant avatar rendering:
  - avatar upload now immediately saves into active Workbench config, not only the settings draft
  - old Codex messages prefer the current Code avatar over stale per-message `speakerAvatar`
  - unresolved blobref avatars still show the side avatar fallback instead of disappearing
- Fixed iOS horizontal wobble in the Code transcript:
  - message scroll area now locks horizontal overscroll
  - message bubbles and file cards use `min-width: 0` / bounded widths
  - file preview code stays inside the card instead of stretching the whole page
- Kept `AGENTS.md` untracked and out of the push.

### Verification

- `git fetch upstream` completed successfully.
- `git log --oneline HEAD..upstream/master` returned no commits.
- `npm run build` passed after the local Workbench changes.

### Risk Notes

- Computer CLI bridge is still a text-stdin route; uploaded images are represented as `[图片]` there. Full visual understanding currently requires the fallback chat API path with a vision-capable model.
- Image messages are stored in `workbench_messages`, so full backup and QuickSync include them as normal Workbench message data; large screenshot volume can increase backup size.
- The iOS wobble fix intentionally hides page-level horizontal overflow. If a future card needs horizontal inspection, it must scroll inside its own card, not the whole transcript.

## 2026-07-22 Code Bridge Startup / Mobile Remote Fix

### Result

- Clarified and enforced the Code bridge model: the CLI bridge is an independent computer-side HTTP service and does not require SullyOS to be open in the computer browser.
- Bridge `/health` now reports the HTTP bridge as online even if the CLI probe fails, returning `cliStatus` / `cliError` separately so mobile Code settings do not show "not connected" when only the Codex/Claude executable probe failed.
- Bridge CORS responses now include `Access-Control-Allow-Private-Network: true` for HTTPS SullyOS pages calling a LAN bridge from Chrome-like browsers.
- Added `pnpm workbench:bridge:startup`, backed by `scripts/install-workbench-bridge-startup.ps1`, to register the bridge as a Windows user-logon scheduled task.
- Workbench bridge config now resolves addresses by client device:
  - mobile clients prefer `remoteBridgeUrl` and will not accidentally use `localhost`
  - desktop clients prefer `cliBridgeUrl` / `http://localhost:3001`
  - both URLs are still stored separately in `workbench_bridge_config_v1`
- Updated Code settings/help copy so users configure phone remote address separately from the local computer address.
- Code token monitoring in settings now shows only local estimated `本周` and `本月` usage.
- Code AI assistant avatar uploads are compressed, stored in `blob_assets`, and saved as `codexAvatar: "blobref:*"` inside `workbench_bridge_config_v1`.
- Code message/thinking/settings avatar rendering now resolves `blobref:*`, so the AI assistant avatar survives backup/restore and QuickSync delta pull.

### Verification

- `pnpm vitest run utils/workbenchBridge.test.ts utils/localSettingsBackup.test.ts utils/quickSync.test.ts` passed.
- `pnpm build` passed.
- PowerShell startup installer parsed successfully with `[scriptblock]::Create(...)`.

### Manual Setup Note

- On the computer, run `pnpm workbench:bridge:startup -- -Token YOUR_KEY` once to start the bridge automatically after Windows login.
- On the phone, Code remote address must be the computer LAN/Tailscale address such as `http://电脑IP:3001`, not `http://localhost:3001`.
- Vercel should be updated after pushing this fix to `master`.

## 2026-07-22 Upstream Refresh to ece65a3

### Result

- Fetched upstream and found `upstream/master` advanced from `680659b` to `ece65a3`.
- Merged latest upstream into `codex/merge-upstream-20260721`.
- Git auto-merged cleanly with no conflict markers.
- Built successfully with `pnpm build`.

### Upstream Changes Integrated

- Spark request race fixes:
  - prevent duplicate refresh/comment/reply requests
  - avoid stale feed snapshots overwriting newer posts or comments
  - add `utils/socialFeedMerge.ts` and focused tests
- API call log ambient context snapshot:
  - request logging keeps the app context from request start instead of later navigation state
- Phone contact alias editing:
  - real contacts can have a manual remark name / relationship label
  - `identityManual` prevents later scans from overwriting a user-confirmed alias, including intentionally blank aliases

### Conflict / Risk Notes

- `context/OSContext.tsx` and `types.ts` were changed on both sides but auto-merged cleanly.
- No prompt files were edited.
- Custom fork areas for Workbench, QuickSync, music together, XHS phone channel, chat prompts, and assistant post-processing were not directly changed by this upstream refresh.
- Existing untracked `AGENTS.md` was left untouched.

### Follow-Up Checks

- Manual runtime check recommended for Spark feed refresh/comments and Check Phone contact detail alias editing.

## 2026-07-21 Workbench App

### Result

- Added a standalone `工作区` app for work conversations, isolated from the main chat history and Memory Palace.
- Added independent IndexedDB stores for workbench sessions, messages, and one-line summaries.
- Added an in-app `Code 设置` subpage with collapsible connection mode, local CLI / remote connection, CLI routing, work profile, endpoint key, and usage.
- Work mode sends messages to the configured Workbench API endpoint when the computer/local CLI service is online.
- The Workbench top bar has an iOS-style `一起工作` switch: off sends to the configured CLI endpoint, on lets the selected character work together temporarily.
- `一起工作` performs a one-turn character consultation and writes the reply only back into the workbench stream.
- Main character prompts can read only Code progress cards explicitly written into that same character's normal chat, not full workbench transcripts or other characters' Code notes.
- Full backup/restore and QuickSync delta sync now include workbench DB stores and workbench local settings.
- Workbench settings keep CLI routing and work profile separated; they intentionally do not duplicate system API Key/Base URL/main-chat model settings.
- Workbench UI uses a Codex-like soft warm-white / pale violet-blue gradient surface with a right-side task/project index rail.
- Workbench usage monitoring shows current session / weekly / monthly / lifetime token counts, using local estimates until the bridge supplies exact CLI usage metadata.
- `工作区` and `灵感区` are capability modes over one shared Code conversation list. Switching modes never switches or hides conversation history.
- When the CLI bridge is offline there is no Codex/Claude Code assistant: sending records the user's Code message only, while the lightning button can explicitly invite the selected character to reply. When online, chat mode routes to the CLI without computer writes and work mode enables bridge-enforced project execution.
- Workbench index conversation list now shows real per-space sessions only when they exist; session titles can be edited inline, first messages generate default titles, and the row-level SVG `X` deletes the whole session history.
- Code `一起工作` now reuses the normal chat request payload instead of adding a separate workbench role prompt: selected characters read their usual chat context plus the current Code conversation as temporary history, then the reply is written only to Code.
- Code chat bubbles render `[[SEND_EMOJI: name]]` as local sticker images while keeping heavier chat side-effect actions out of the Code surface.
- Code input now includes a local sticker picker; sending a sticker creates a Code-only user message and follows the same current-space reply route without writing to normal chat.
- Code `一起工作` now formats main-chat context as clean role messages instead of raw timestamped chat logs, avoiding log-prefix echoes without adding another prompt rule.
- Code assistant replies now reuse the chat bubble splitting path (`splitResponse` / `chunkText`) so character replies land as multiple natural Code messages instead of one large block.
- Code failures show the global red `SYSTEM ERROR` toast only and never create an error message inside the Code transcript.
- Code `一起工作` is now treated as a chat IF-line: the selected character receives normal main-chat history first, then Code's current user/selected-character messages as the newest temporary history. Code-only assistant/system messages are not converted into system log blocks for the character.
- Code progress cards are now manual-only: the top-bar card button runs the confirmed Codex progress-card prompt, writes the result to `workbench_summaries`, and renders it inside Code as a structured system card. If `一起工作` is enabled, the same card is also written as a `code_card` system message only to the selected character's normal chat. Automatic per-message workbench summaries are disabled.
- Code together-work context uses a three-layer priority: latest normal chat keeps character continuity, the current Code conversation owns technical details and execution decisions, and other Code conversations are visible only through progress cards in that character's normal chat.
- Pure Codex/AI Code chat also receives a compact task index built from other Code sessions' latest progress cards; the current session still owns all technical details and execution decisions.

### Isolation Rules

- Workbench messages must not be stored in the normal `messages` table.
- Workbench `一起工作` consultations must not create main chat messages.
- Workbench `一起工作` consultations must not run Memory Palace ingestion or write workbench transcripts into memories.
- Only manual `[Code 进度]` / `[Code 进度-角色名]` cards may cross from Code into normal chat, and only for the selected `一起工作` character.
- Workbench API config and participant state must stay covered by both local settings backup and QuickSync.
- Code backup coverage includes sessions, messages, progress summaries, Code Memory, and artifact metadata. Project file bodies remain on the bridge computer and are not copied into SullyOS backups.
- Code editable settings travel in `workbench_bridge_config_v1`, including bridge URL/Key, CLI route, selected model, work profile, custom instructions, Code avatar, usage limit, and selected together-work character.
- Remote and local CLI endpoints are stored separately inside `workbench_bridge_config_v1`: `remoteBridgeUrl` is the phone-to-computer address, while `cliBridgeUrl` is the current-computer address (default `http://localhost:3001`). Switching modes swaps the active URL without overwriting the other one; legacy single-URL configs migrate into the mode that was active when saved.
- QuickSync must treat local-setting removals as real delta deletes; clearing a Code setting on one device must clear it on the receiving device instead of reviving an older value.
- Deleting a Code conversation syncs removal of its transcript while preserving its progress-card, Code Memory, and artifact indexes by design.

### Follow-Up Checks

- Manual runtime check still recommended on phone and desktop:
  - workbench app opens from launcher
  - Code 设置 subpage saves/restores
  - work mode handles missing Workbench API gracefully
  - Sully mode replies without adding main chat messages
  - QuickSync pull brings workbench records/settings to the other device

## 2026-07-21 Local Settings Backup / QuickSync

### Result

- Added a shared localStorage settings backup layer for small configuration values.
- Full backup/export now includes `localStorageSettings`.
- Full restore/import now restores `localStorageSettings`.
- QuickSync delta upload now includes the same local settings snapshot.
- QuickSync delta pull now restores the local settings snapshot.
- QuickSync now also includes chat themes and whitelisted settings assets from the IndexedDB `assets` store.
- QuickSync now scans synced records/settings for `blobref:*` image references and includes the referenced `blob_assets` image bodies incrementally.
- Built successfully with `pnpm build`.

### Custom Features Preserved / Covered

- XHS Lite simple-mode cookie in `os_realtime_config.xhsMcpConfig.cookie`.
- XHS phone channel token/config in `os_realtime_config.xhsPhoneConfig`.
- WebDAV password and GitHub backup token in `os_cloud_backup_config`.
- MCP server tokens, Luckin/McD tokens, proxy worker URL, push/VAPID config, chat prompt settings, translation settings, and other small user preferences.
- Upstream loyal recruitment local state and custom base URL via `sullyos_*` keys.
- Upstream nostalgic appearance via `os_theme.desktopVariant`.
- Appearance presets, custom icons, widgets, decorations, custom fonts, room custom assets, social profile assets, bank custom furniture assets, and custom chat CSS presets via whitelisted `assets` records.
- Blob-backed wallpaper, lock wallpaper, avatars, room images, widgets, decorations, and other synced images referenced by `blobref:*`.

### Notes

- The snapshot is intentionally limited to known small settings and prefixes, not arbitrary large localStorage cache blobs.
- QuickSync asset coverage is intentionally limited to settings/customization assets and referenced image blobs, not runtime caches such as generated voice/music blobs.
- Referenced image blobs are tracked in the QuickSync manifest so the first sync after this change may upload needed image bodies, then later syncs only upload changed/new referenced blobs.
- Added `utils/localSettingsBackup.test.ts`.
- Added `utils/quickSync.test.ts`.
- Verified:
  - `pnpm vitest run utils/localSettingsBackup.test.ts utils/quickSync.test.ts utils/backupExport.test.ts utils/backupRoundtrip.test.ts`
  - `pnpm build`

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

### Backup / QuickSync Coverage Is Required

User requirement: anything that affects normal use, login state, customization, passwords/tokens/cookies, or user-facing settings must be included in both full backup/restore and QuickSync delta upload/pull.

This includes:

- XHS Lite simple-mode cookie and XHS phone channel token/config.
- WebDAV/GitHub backup passwords and tokens.
- API config, model presets, MCP servers/tokens, Luckin/McD tokens, worker/proxy URLs, push/VAPID settings.
- Appearance/theme choices, nostalgic desktop option, custom icons, appearance presets, widgets, decorations, custom fonts, room custom assets, custom chat CSS presets.
- Upstream-added user-facing options or local state, such as loyal recruitment state/base URL.

Intentional exclusions:

- Generated voice cache.
- Generated music cache.
- Runtime cache blobs that do not affect configuration or customization.

When upstream adds any new setting, toggle, localStorage key, IndexedDB config store, or `assets`-backed customization, check:

- `utils/localSettingsBackup.ts`
- `utils/quickSync.ts`
- `types.ts` `FullBackupData`
- `context/OSContext.tsx` export/import paths
- full backup tests and QuickSync tests

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

`pnpm build` confirms TypeScript/build integrity. It does not prove:

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
pnpm build
```

For UI testing:

```bash
pnpm dev
```

### After Editing

1. Run build:

```bash
pnpm build
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
pnpm build
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
- Desktop wallpaper, lock wallpaper, custom icons, avatars, widgets, room images, and other blob-backed images survive QuickSync upload/pull.
- XHS Lite cookie, WebDAV/GitHub credentials, MCP tokens, and other user settings survive full backup restore.
- The same settings/customizations survive QuickSync upload/pull between phone and computer.
- Code opens with one shared conversation list; switching `工作区` / `灵感区` does not hide or fork history.
- With CLI offline, normal Code send records only the user message and never fabricates a Codex reply.
- Lightning produces exactly one selected-character reply and does not start an assistant/character reply loop.
- Code character replies understand the latest Code user/AI-assistant messages without leaking internal context labels.
- Code request failures show only the global `SYSTEM ERROR` toast and leave no error bubble/history row.
- Code quote, single delete, multi-select delete, sticker transparency, and system-gray user bubbles work on mobile and desktop.
- Creating a manual Code progress card updates the current task index; deleting the transcript preserves its progress/Memory/artifact indexes.
- Full backup and QuickSync restore Code sessions, messages, summaries, Code Memory, artifact metadata, Code avatar, custom instructions, route/model, and bridge settings.
- A fresh QuickSync from the complete-vector device reduces vector missing counts on the receiving device; vector deletions also propagate.
- Pixel Home layout changes and deletions propagate through QuickSync compound keys.

## Code Workspace Notes

- Code app message actions should mirror main chat basics: long press/right click opens quote, delete, and multi-select delete.
- Code quote/delete state is stored only in `workbench_messages`; deleting Code messages or sessions must not delete main chat messages, summaries, or Memory Palace entries.
- Together-work character replies in Code can read temporary Code/main-chat context, but replies are written back only to Code.
- Code together-work should behave like a temporary branch from normal chat: normal chat later sees only the selected character's manual Code progress cards, while Code calls can append the current Code branch onto normal chat history for that one reply.
- When a character returns to Code after normal chat, they should read the newest normal chat context plus the current Code session; other Code sessions may inspire through progress cards but must not override current-session technical details unless the user explicitly brings them up.
- Pure Codex/AI mode may reference other Code tasks by title/progress-card summary, but must not load or assume full details from other sessions.
- Code "工作区" and "灵感区" are capability modes, not separate conversation buckets. The conversation list should stay shared; switching modes should not hide existing Code conversations.
- The hidden Code device/capability system prompt is generated by SullyOS, not guessed by Codex. In inspiration mode, Code should only produce plans, drafts, small snippets, and thought summaries; it must not claim to read/write project files or output large project files. Only when work mode is available and execution mode is active may it read/write project files or run commands.
- Code Memory extraction runs only after the user manually creates a Code progress card. It uses a conservative prompt that stores only confirmed long-term user preferences and confirmed architecture/rule/workflow decisions, never code bodies, temporary todos, experiments, unconfirmed ideas, private chat, or model suggestions.
- A selected character's manual `code_card` remains visible to normal chat and Memory Palace retrieval, but emotion evaluation, relationship/impression extraction, and monthly/manual chat archiving must skip it so technical decisions do not flatten the character into an assistant voice.
- Code file output uses artifact cards. Project files remain on the bridged computer; SullyOS stores only file metadata, relative path, size, hash, and a small preview, and downloads the full file again from the bridge when requested. QuickSync/full backup include this metadata, not large project bytes. SullyOS-owned small artifacts may use blob-backed storage and travel in full backups.
- Chat-only Code mode and computer-execution mode share the same conversation history. The bridge must enforce permissions itself: read-only/plan in chat mode and workspace-scoped writes in execution mode. Prompt wording is only behavioral guidance and must never be the sole permission boundary.
- QuickSync should cover all full-backup user data stores except explicitly excluded music/audio/runtime caches. Memory Palace vectors are first-class delta data: vector upserts and deletes must sync across devices.
- QuickSync manifest keys must follow each IndexedDB store's real keyPath. `memory_vectors` uses `memoryId` rather than `id`; otherwise vector rows disappear from every delta manifest and processing on one device never reaches another.
- `pixel_home_layouts` uses the compound key `[charId, roomId]`. QuickSync encodes that key for manifests and restores the array key before IndexedDB deletion, so room/desktop layout changes and removals propagate incrementally.

## Current Deployment Note

Last recorded stable deployment was `ecc01ab` on remote `master` from 2026-07-21. The 2026-07-22 Code workspace / QuickSync work plus upstream refresh is merged through `9740321`, with the maintenance log updated for publishing to remote `master`. Vercel should auto-deploy from `master` after the push; verify the deployment dashboard before treating production as updated.

## 2026-07-22 Code Workspace And Sync Audit

### Final Product Rules

- `Code` is a standalone app and an IF-line from normal chat, not another normal-chat room. Its complete transcript stays in `workbench_messages` and is never written into the normal `messages` stream.
- The Code conversation list is shared. `工作区` and `灵感区` are capability modes for the current conversation, not independent history folders.
- CLI offline means there is no Codex/Claude Code assistant. Sending records the user's Code message only. The lightning button explicitly asks the selected character for one reply and never enables an automatic back-and-forth loop.
- Ordinary send always records the user's message without forcing an immediate reply, even while the CLI is online. The lightning button requests exactly one character turn; the adjacent non-code sparkle SVG requests exactly one connected AI-assistant turn. This lets the user send several short messages before deciding who should respond.
- CLI online chat mode may answer, plan, explain, and produce small snippets but must not modify project files or run write commands. Work mode enables project execution. The bridge must enforce this boundary; prompt text is not a security boundary.
- The assistant display name comes from the connected route/bridge identity, such as `Codex` or `Claude Code`; the UI must not pretend an offline generic model is Codex.
- Code assistant replies are one assistant turn. Character replies may be split into natural IM bubbles through the normal chat splitting/rendering path.
- Code errors use the global red `SYSTEM ERROR` toast only. They must not create error bubbles or persist error messages in the Code transcript.

### Character Context And Memory Isolation

- A character invited through `一起工作` receives the normal stable character/user/relationship context, a limited recent normal-chat background, volatile realtime context, then the current Code conversation as the newest and highest-priority task context.
- The current Code context includes messages from the user, the connected AI assistant, and the selected character. Internal labels used to distinguish assistant speakers are prompt-only and must never leak into visible bubbles.
- Other Code conversations are represented only by their manually generated progress-card index. Their full transcripts and code details are not injected unless a future explicit retrieval flow is added.
- Character replies are written only into the current Code conversation. They do not become normal-chat messages and do not directly enter Memory Palace.
- The Code character surface keeps personality, relationship, recent normal-chat background, IM style, stickers, quoting, and bilingual behavior. It excludes voice/action tags, transfer, scheduled-message, diary, search, LIFE, music actions, HTML, MCP/XHS/food-ordering, and other normal-chat side-effect tools.
- Hidden system context is required in Code, but visible normal-chat system logs are not copied wholesale. Relevant hidden context is limited to character continuity, current time/realtime state, Code capability/device state, the current Code thread, progress indexes, stickers, quote rules, and bilingual rules.
- Manual `[Code 进度]` cards may be copied to the selected character's normal chat as `code_card`. Normal chat can reference these summaries, while emotion evaluation, relationship/impression extraction, and monthly/manual chat archiving skip `code_card` so technical work does not turn the character into an assistant persona.
- Code Memory is extracted only when the user manually creates a progress card. It stores at most confirmed long-term preferences and confirmed architecture/rule/workflow decisions; code bodies, temporary todos, experiments, rejected ideas, private chat, and unconfirmed model suggestions are excluded. The settings page provides a visible editor/delete surface for these entries.

### Conversations, Progress Cards, And Files

- Code supports quote, single delete, and multi-select delete. Quote resolution follows the normal-chat matching behavior instead of relying only on the most recent message.
- Deleting a Code conversation removes its detailed transcript and leaves a session tombstone for cross-device deletion propagation. Existing progress cards, Code Memory, and artifact indexes are intentionally preserved.
- Manual progress cards are cumulative anchors for a long Code conversation. Codex/Claude receives the current thread's saved progress context plus recent messages, preventing early decisions from falling out of a long context window.
- Progress-card generation is manual only. The connected CLI assistant is preferred; if it fails and a character is selected, the role-specific fallback may summarize in that character's voice.
- The header progress icon opens a dedicated visual progress-card panel instead of immediately calling a model. The panel lists every manually generated card for the current Code conversation, renders task/status/decision/progress/todo/note as separate fields, and provides the explicit `生成新卡` command. A successful generation refreshes and opens the newest card; storage remains `workbench_summaries`, so existing backup and QuickSync coverage is unchanged.
- The progress-card panel has an adjacent SVG source selector. `Codex 优先` remains the default and preserves the existing fallback to the selected character when CLI summarization fails; `角色总结` directly uses the currently selected together-work character. Card persistence, Code Memory extraction, and normal-chat writeback remain identical after either source is chosen.
- In the Code conversation stream, progress summaries are rendered as standalone system cards. They have no speaker avatar, no `System · time` header, and no outer chat bubble around the existing card surface. Long-press selection/deletion remains attached to the standalone card.
- When a selected character is participating, normal-chat writeback is stored as that character's `assistant`-side `code_card` rather than a horizontal system log. The normal chat therefore renders the character avatar and its dedicated Code card UI. The card carries the originating Workbench session ID and summary ID, uses the same summary content as the Code-side card, and now renders the `备注` field as well.
- Large project files remain on the bridged computer. SullyOS stores an artifact card with name, path, size, hash, timestamps, and a short preview; downloading requests the real file from the bridge again. Large project bytes are not copied into IndexedDB, full backups, or QuickSync.
- Small SullyOS-owned files may use blob-backed artifact storage. Sticker messages render as transparent media without the user's text-bubble background; user text bubbles use the system gray style.
- Code message avatars follow the ordinary chat appearance settings for vertical alignment, Y offset, size, shape, and AI-avatar visibility. Workbench no longer applies a fixed top margin that leaves short bubbles visually misaligned.
- Code speaker avatars are isolated by message identity. AI-assistant replies store and render the configured Code avatar; character replies store the selected character ID and neural-link avatar. Neither path may fall back to the other speaker's avatar. The avatar snapshot lives in message metadata, so it is covered by the existing Code backup and QuickSync paths.
- Pending/thinking UI also tracks the explicit trigger source. Clicking the character lightning shows only that character's avatar; clicking the AI-assistant control shows only the configured Code avatar. It no longer infers the pending speaker from the global together-work switch, and the pending avatar follows ordinary chat appearance settings.
- Character-side Code context keeps all three speakers structurally separate: the user remains an API `user` message, the selected character remains `assistant`, and CLI/Codex is injected as external `system` context with its discovered agent name. This avoids treating CLI text as user text and avoids visible identity labels that a character may imitate. Any accidental legacy `[用户 ...]`, `[AI 助手 ...]`, or `[角色 ...]` marker is stripped before bubble storage.
- Browser-to-CLI serialization includes each message's resolved speaker name. The bridge formats recent history as `用户`, `角色 <name>`, `AI 助手 <name>`, or `系统` before invoking Codex/Claude Code, preventing a character's suggestion from being mistaken for a direct user instruction.
- The CLI bridge prompt begins with a confirmed dynamic `[AI 助手身份]` block. It names the active agent (`Codex`, `Claude Code`, or custom CLI), defines user/assistant/character as three independent participants, treats only `用户` lines as direct user speech, forbids impersonating or continuing character dialogue, and limits each trigger to one assistant reply. Existing device, capability, file-output, model-profile, custom-instruction, task-context, and user-request blocks remain unchanged after it.
- Character replies in Code reuse ordinary chat's prompt builder for character identity, relationship background, memories, and volatile state, while the structurally typed current Code thread is placed once at the very end of the API request. This ordering is intentional: normal chat supplies background, but cannot override the active Code topic through its recency tail. Code text is also supplied separately as the Memory Palace recall query without duplicating it in normal-chat history.

### Backup And QuickSync Coverage

- Full/text backup and restore include `workbench_sessions`, `workbench_messages`, `workbench_summaries`, `workbench_memories`, and `workbench_artifacts`.
- User/character records, character groups, persisted options, action receipts, chat cards, and Code messages inherit full-backup and QuickSync coverage from their owning IndexedDB row or portable local-storage setting. Additions, edits, and deletions are all part of the contract.
- QuickSync includes all five Code stores and `workbench_bridge_config_v1` / `workbench_mode_v1`. Bridge URL, Key, CLI route, selected model, profile, Codex-only custom instructions, Code avatar, usage limit, and selected participant travel across devices.
- Clearing an included setting creates a local-storage delta deletion. A removed value must be removed on the receiving device rather than revived from stale local data.
- Persistent Post Office identity/base URL, Signal authorship/reuse records, and desktop/mobile-game skin choices are included in QuickSync as well as full backup. The Post Office admin token and one-turn Signal whisper remain intentionally device-local.
- Wallpaper, lock wallpaper, user/character avatars, custom app icons, widgets, room images, card images, and other referenced images sync through asset rows plus `blob_assets`. QuickSync carries blob additions, replacements, and deletions; removing the last synced reference must remove the receiving device's orphaned blob. Code avatar is resized before local-storage persistence to remain inside the portable-settings size limit.
- Audio/music and runtime caches remain intentionally excluded. Project file bodies also remain excluded.
- Memory Palace vector rows use IndexedDB keyPath `memoryId`. QuickSync now uses `memoryId` for manifest hashes, upserts, and deletes. The previous generic `id/key/name` lookup silently omitted every vector row.
- Pixel Home layouts use compound keyPath `[charId, roomId]`. QuickSync now serializes compound keys for manifest comparison and restores the array key before IndexedDB deletion. This covers incremental room/layout changes and removals.
- Existing delta archives created before the vector-key fix do not retroactively contain vectors. After deployment, upload a fresh QuickSync delta from the device whose vectors are complete, then pull it on the other device. The first new upload treats the existing vectors/layouts as additions and self-heals the old empty manifest.

### Verification Completed

- QuickSync/local-settings focused tests: 8 passed.
- Full Vitest suite: 103 files, 1117 tests passed.
- Production build: passed with `pnpm build`.
- `git diff --check`: passed; only expected Windows LF/CRLF notices remain.
- Installed official `@openai/codex` CLI (`codex-cli 0.145.0`) and confirmed `Logged in using ChatGPT` on the development PC.
- Windows may resolve the Codex desktop-app alias before npm's CLI and return `spawn EPERM`. The bridge now automatically prefers npm's native `codex.exe` under the installed `@openai/codex-win32-x64` package, while `WORKBENCH_CODEX_BIN` remains available as an override.
- Real bridge smoke test passed: `/health` identified `Codex`, `/models` returned account-backed model metadata, and a chat-only `/message` request returned `连接成功` without artifacts.
- Fixed a settings-state split where `检测连接` could mark the bridge online while leaving the tested draft URL out of the active send config. A successful connection test now saves and activates that exact config immediately, so the next ordinary Code message reaches the connected CLI without requiring a second `保存` action.
- Bridge status now rechecks the active endpoint every 10 seconds and drives both the settings result text and the AI-assistant sparkle button. A stale manual `连接成功` label can no longer remain while the active endpoint is offline; successful manual tests also avoid a temporary disabled-button flicker during the immediate background recheck.

### Remaining Risks And Required Manual Checks

- Unit tests cannot prove a real phone/WebDAV/browser storage round trip. Before release, perform one phone-to-PC and one PC-to-phone QuickSync using real wallpaper/avatar assets, a deleted setting, Memory Palace vectors, a Pixel Home layout, and a Code conversation.
- Verify a real Codex bridge and a real Claude Code bridge separately: identity/model discovery, chat-only restrictions, execution permissions, artifact download, official usage reporting, reconnect behavior, and invalid-Key errors.
- Verify that CLI offline never creates an assistant message; ordinary send only records the user message, while lightning produces exactly one selected-character response.
- Verify that a character can answer about the newest Code user/assistant exchange, can still reflect recent normal-chat relationship context, and does not repeat internal markers such as `[当前 Code 对话 / 角色名]`.
- Verify that Code stickers from both user and character render as transparent media and that quote/delete/multi-select work on old as well as recent messages.
- Do not assume Vercel contains these fixes until the remote `master` push completes and the deployment dashboard reports success.

## 2026-07-22 Code Automatic Capability And Fallback API

- `工作区` and `灵感区` are no longer user-selected conversation categories. Code keeps one shared conversation list and derives the current capability automatically: an online computer bridge means computer execution; otherwise the app is chat-only.
- Code settings now include a separate OpenAI-compatible fallback chat API with its own base URL, Key, model ID, and display name. It reuses the existing Code conversation, progress index, device state, and Codex custom instructions without adding a separate fallback persona prompt.
- The AI sparkle button routes one turn at a time. An online CLI bridge always has priority; when it is offline, the configured fallback API answers; when neither is available, the button is disabled. Ordinary send still only records a message, and the lightning button still requests exactly one character reply.
- Fallback replies cannot create bridge artifacts and are always chat-only. They do not receive an execution route, workspace file transport, or command result channel.
- The fallback API fields live inside `workbench_bridge_config_v1`. Full settings export/import and QuickSync local-setting deltas therefore include additions, edits, and deletions for the fallback URL, Key, model, and display name.
- The fallback API model field can fetch an OpenAI-compatible `/models` list and switch to a selector when models are returned. Providers that do not expose a model list, or return an error, still support manually entering a model ID.
- A follow-up backup audit found that `workbench_artifacts` was exported and had an import section but was absent from the import writer's available-store whitelist, so full restore silently skipped file-card metadata. The whitelist now includes `workbench_artifacts`; QuickSync already covered it correctly.

### Fallback API Configuration Notes

- The fallback API uses the same OpenAI-compatible base-URL convention as the system API: the saved value is the provider base URL, while Code appends `/models` for discovery and `/chat/completions` for replies.
- The fallback panel provides `引用系统 API`, which copies the current system API URL, Key, and model into the Code settings draft. This is a one-time copy rather than a permanent binding; later edits remain isolated between system chat and Code fallback.
- The fallback URL, Key, model, and display name remain part of `workbench_bridge_config_v1`, so full/text backup, GitHub/WebDAV restore, and QuickSync setting upserts/deletions carry them between devices.
- Risk: not every OpenAI-compatible provider exposes `GET /models`. Failure or an empty list must leave manual model-ID entry available and must not erase the user's existing model value.
- Risk: copying the system API also copies its Key into Code's portable settings. This is intentional for the owner's cross-device workflow, but exports and cloud backups must still be treated as credential-bearing private data.

### Upstream Check Before Release

- Refreshed `upstream/master` before publishing on 2026-07-22. The latest upstream commit is `ece65a3` (PR #421, manual phone contact aliases), with PR #420's Spark request-race fixes included.
- The upstream changes were merged locally in `9740321` with no conflicts. Rebuild and focused tests passed after the merge; release requires remote `master` push plus Vercel deployment verification.
