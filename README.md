# Sully Plus

Sully Plus 是基于 SullyOS / 手抓糯米机二改维护的个人 fork。

它保留原版“浏览器里的虚拟手机”和角色陪伴系统，同时把这一支 fork 调成更适合私人日常使用的形态：手机远程 Code、桌面 CLI 桥接、私有域名访问、小红书素材卡片、进度卡、增量导入导出、头像与媒体数据维护。

> 这不是上游 SullyOS 的官方发行版，而是一支持续二改的私人维护版。

## 这一支 Fork 是什么

Sully Plus 是一个 local-first 的虚拟手机 + 角色工作台。

核心方向：

- 保留角色聊天、记忆、人设、群聊、房间、音乐、电话、相册、日记、世界等原版体验。
- 增强 Code / Workbench，让角色、用户、Codex/CLI 可以在同一个 Code 对话里协作。
- 默认按“手机远程使用”理解 Code：手机连电脑桥接地址，不再假设只能填 `localhost`。
- 支持 Cloudflare Tunnel / 自定义域名作为桥梁，让电脑开着 bridge 就能被手机连接。
- 小红书链接和素材卡片可以进入聊天与 Code 上下文。
- 数据仍优先存在本地，靠导出/导入、WebDAV、GitHub 等方式迁移和备份。

这一支 fork 的目标不是把 SullyOS 做成公共 SaaS，而是把它变成一个更私人的日常操作系统。

## 主要改动

### Code / Workbench

Code 是这支 fork 的重点。

- Code 区可以连接本机 Codex CLI、Claude Code 或自定义 CLI。
- 手机端使用远程 bridge 地址，电脑端负责真正执行 CLI。
- 角色可以在 Code 区一起工作，也可以在说完之后单独 `@Codex` 让 AI 助理接手。
- 进度卡会记录来源和作者，避免把 Codex 写的总结误认为角色写的，或反过来混淆。
- 当前提供临时的进度卡作者修正入口，修正结果会进入导入/导出和增量同步；历史数据修完后可移除该入口。
- 当前 Code 进度索引默认收起，需要时手动展开。
- Code 长消息支持复制、引用、编辑、删除和多选删除。
- “正在思考”显示为聊天页一致的三个点输入状态。
- Code 助理头像进入导入/导出和增量数据流程。

### 桌面 CLI Bridge

桥接服务运行在电脑上。手机访问 bridge，bridge 再调用本机 CLI。

常用命令：

```bash
pnpm workbench:bridge
pnpm workbench:bridge:startup
```

`workbench:bridge:startup` 用于开机自动启动 bridge 的场景。目标体验是：

- 电脑开着。
- bridge 进程在运行。
- 手机可以通过远程地址连接 Code。
- 不要求电脑浏览器一直打开 SullyOS 页面。

注意：如果 bridge 能执行本机 CLI，它就等同于一种远程操作入口，必须加 token 或访问控制。

### 私有远程访问

这支 fork 默认按私人使用处理，不建议裸奔公网。

推荐方式：

- 电脑运行 Code bridge。
- Cloudflare Tunnel 或其他 HTTPS 隧道暴露 bridge。
- bridge 自身设置 token。
- 自定义域名可以公开解析，但访问应通过 token、Cloudflare Access 或其他鉴权保护。

也就是说：别人可以看见域名，不代表别人应该能打开或调用你的 bridge。

私有远程访问只建议使用绑定自己域名的 Cloudflare named tunnel；本 fork 不再依赖会生成随机公开地址的 Quick Tunnel。

### 小红书 / XHS

原聊天页已有小红书链接识别和卡片渲染。这支 fork 把相关能力补到 Code / Workbench：

- 在 Code 区发小红书链接，可以解析并渲染卡片。
- 用户和角色发送的普通聊天小红书分享会先走统一规范化，再在 Code 中按卡片渲染，避免拆成多条字段气泡。
- 小红书卡片会进入 Code 上下文，Codex/角色能看到标题、正文、作者、noteId、链接和评论摘录。
- Code 区角色如果输出小红书工具指令，会走 Workbench 专用后处理链，调用配置好的 MCP/Lite/手机通道并把结果插回 Code 对话。

小红书能力依赖你自己的配置，不包含公共账号或公共 cookie。

### 音乐分享与一起听

- 音乐 Now Playing 页可以把当前歌曲分享给角色的普通聊天，角色也能从自己的可分享歌曲中主动发歌。
- 分享卡片包含歌名、歌手、专辑、封面和播放信息；点击播放只切换自己的播放器，不会自动进入一起听。
- 角色可以按音乐人格和当下情境把歌曲收藏进 `musicProfile.playlists`，也可以发送可接受或拒绝的一起听邀请。
- 邀请卡、歌曲卡和退出记录按实际发送者或操作者显示；一起听期间展示双方头像，并阻止双方重复邀请。
- 角色读取歌曲资料和当前音乐上下文来回应，不读取或上传原始音频，也不会为每条聊天额外调用音乐分析模型。

### 数据、头像和备份

Sully Plus 仍然是 local-first。

- 聊天记录、角色、人设、设置和大部分应用数据存在 IndexedDB。
- 图片和头像尽量走 blob/ref 存储，避免一直塞 base64。
- 普通角色头像、Code 助理头像、小红书卡片、上传媒体等需要进入导入/导出和增量迁移流程。
- 角色音乐歌单、聊天音乐事件、`songs`、`vr_music`、生成音频资源、世界书和 Code / Workbench 数据均进入全局备份与 QuickSync 清单。
- 当前一起听会话属于临时运行状态，不跨刷新或导入恢复；Code 连接的真实项目文件内容不会打包进应用备份。
- QuickSync 对同一条记录采用后写覆盖，多设备同时修改同一记录时仍有覆盖风险。
- WebDAV / GitHub 备份应指向你自己的账号和私有空间。

浏览器缓存不是备份。重要数据请定期导出。

## 本地运行

安装依赖：

```bash
pnpm install
```

启动开发服务：

```bash
pnpm dev
```

构建生产包：

```bash
pnpm build
```

预览构建结果：

```bash
pnpm preview
```

## 部署 Web App

前端构建后是静态站点，可以部署到 Vercel、Netlify、Cloudflare Pages、GitHub Pages 或其他静态托管。

一般流程：

```bash
pnpm build
```

然后部署 `dist/`。

如果使用 Vercel，push 到绑定分支后应自动部署。若线上没有更新，优先检查：

- 当前改动是否已经 commit 并 push 到部署分支。
- Vercel 是否完成了最新一次部署。
- 浏览器 / PWA / Service Worker 是否仍在缓存旧资源。

## Worker

`pnpm build` 会同时构建 worker bundle。

常见目录：

- `worker/instant-push/`
- `worker/xhs-lite/`
- `worker/mcp-proxy/`
- `worker/post-office/`
- `worker/loyal-recruitment/`

涉及私有 token、cookie、额度、用户数据的 worker，建议部署到自己的账号，不要长期依赖上游作者或别人的公共实例。

## Android / Capacitor

```bash
pnpm build
pnpm cap:sync
pnpm cap:android
```

然后在 Android Studio 里运行或打包 APK。

## 设置入口

多数配置在应用内完成：

- 聊天 API：OpenAI-compatible Base URL / API Key / Model。
- TTS：MiniMax、Fish Audio 等语音配置。
- 备份：本地导出导入、WebDAV、GitHub。
- MCP：工具服务器、小红书、代理。
- Code：bridge 地址、token、CLI 路由、模型档位、备用聊天 API。
- 外观：主题、壁纸、聊天气泡、头像尺寸、Code 图标和默认名称。

`.env.local` 可以给开发环境放默认值，但应用内设置通常优先。

## 安全注意

- 不要提交真实 API Key、bridge token、Cloudflare token、小红书 cookie、WebDAV 密码、GitHub token。
- bridge endpoint 不要无鉴权暴露公网。
- “别人不知道 URL”不等于私有。
- 如果 bridge 能调用本机 CLI，请把它当成远程操作电脑的入口。
- 自定义域名建议配 Cloudflare Access 或等价鉴权。

## Fork 维护流程

合并上游或 push 前建议检查：

- 阅读 fork maintenance log，如果当前工作树里有。
- 重点看这些容易冲突的文件：
  - `context/OSContext.tsx`
  - `apps/Chat.tsx`
  - `apps/WorkbenchApp.tsx`
  - `utils/chatPrompts.ts`
  - `utils/workbenchBridge.ts`
  - `worker/`
- 跑构建：

```bash
pnpm build
```

- 手动验证：
  - 聊天页普通角色回复。
  - Code / Workbench 连接 bridge。
  - 手机远程 bridge 地址。
  - Code 区 `@Codex`。
  - 小红书链接卡片。
  - 进度卡作者显示。
  - 导入/导出和头像恢复。
  - 移动端安全区、顶部导航和输入框布局。

## 项目结构

- `apps/`：各个应用页面，包括 Chat、Settings、Workbench、Music、Room、World 等。
- `context/OSContext.tsx`：全局系统状态和很多跨应用流程。
- `utils/`：数据库、prompt、桥接、解析器、工具调用、导入导出等共享逻辑。
- `components/`：通用 UI 组件。
- `worker/`：Cloudflare Worker、Instant Push、XHS Lite、代理等。
- `scripts/`：本地 bridge、构建、代理和维护脚本。
- `docs/`：专题文档和交接说明。

## 上游与致谢

Sully Plus 基于 SullyOS / 手抓糯米机。原始项目的人设系统、虚拟手机概念、Sully 角色、核心 UI 世界和大量应用能力来自上游作者与社区贡献者。

这一支 fork 保留上游许可证和署名要求。发布自己的 fork 时，请继续保留：

- `LICENSE`
- 上游 required notice
- 原作者和相关贡献者署名
- 第三方项目许可说明

相关集成与贡献包括但不限于：

- ReiStandard / AMSG / Instant Push。
- xiaohongshu-skills。
- Spider_XHS / XHS Lite。
- NeteaseCloudMusicApi Enhanced。
- hot_news。
- 原 SullyOS 社区的 UI、教程、维护与调试贡献。

## License

许可证以仓库内 `LICENSE` 为准。

简要理解：

- 可以个人使用和非商业 fork。
- 不可以商业售卖源码、成品、会员或服务。
- 不要删除署名和 required notice。
- 不要把 Sully 角色、人设、台词风格或形象单独扒出来当免费角色包或商业 AI 角色素材。

如果你继续二改，请把上游 credit 留好。这个 fork 是站在原项目和社区维护上的，不是凭空长出来的。
