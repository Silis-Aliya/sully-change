import React from 'react';

// 聊天「白框」自定义 CSS 编辑器（Appearance 全局默认 与 单角色定制 共用）。
// 设计原则：预设是「完整搭配」，点一下=直接替换成一套立刻见效的样式（不再是点了没反应、代码越堆越多的 +片段）。
// 文本框里始终是一整段可用 CSS，方便整段复制给别的 AI 改。
// 选择器钩子：.sully-chat-header 顶栏 / -back 返回 / -avatar 头像 / -name 名字 / -status 状态 /
//   -buffs 情绪栏(内含 button 即每个情绪胶囊) / -token / -trigger 小闪电 / -inputbar 输入栏 / -root 整屏。

// 几套写全的完整风格（头像边框、名字色、buff 背景色、token、闪电都配好），点击即替换。
const PRESETS: { name: string; code: string }[] = [
    {
        name: '奶油少女',
        code: `/* 奶油少女 */
.sully-chat-header{
  background:linear-gradient(135deg,#ffe3ef,#fff2e2 55%,#f1e7ff)!important;
  border-bottom:none!important;
  box-shadow:0 6px 18px rgba(214,160,180,.18);
  border-radius:0 0 22px 22px;
}
.sully-chat-name{color:#c2587f!important;}
.sully-chat-avatar{border:2px solid #ffb8d4!important;box-shadow:0 0 0 4px rgba(255,184,212,.25)!important;}
.sully-chat-buffs button{background:#fff0f6!important;color:#d6478b!important;border-color:#ffc6df!important;}
.sully-chat-trigger{color:#e86aa6!important;}
.sully-chat-token{background:#fff0f6!important;color:#c76aa0!important;border-color:#ffd4e6!important;}`,
    },
    {
        name: '霓虹夜',
        code: `/* 霓虹夜 */
.sully-chat-header{
  background:#0e0b1e!important;
  border-bottom:1px solid rgba(168,85,247,.45)!important;
  box-shadow:0 0 26px rgba(168,85,247,.3);
}
.sully-chat-name{color:#e9d5ff!important;text-shadow:0 0 10px rgba(192,132,252,.9);}
.sully-chat-status{color:#a78bfa!important;}
.sully-chat-back,.sully-chat-trigger{color:#67e8f9!important;}
.sully-chat-avatar{border:2px solid #67e8f9!important;box-shadow:0 0 12px rgba(103,232,249,.6)!important;}
.sully-chat-buffs button{background:rgba(103,232,249,.12)!important;color:#a5f3fc!important;border-color:rgba(103,232,249,.4)!important;}
.sully-chat-token{background:rgba(168,85,247,.15)!important;color:#d8b4fe!important;border-color:rgba(168,85,247,.4)!important;}`,
    },
    {
        name: '薄荷奶绿',
        code: `/* 薄荷奶绿 */
.sully-chat-header{
  background:linear-gradient(135deg,#e3f9ee,#f0fff4 60%,#e0f5ff)!important;
  border-bottom:none!important;
  box-shadow:0 6px 16px rgba(120,190,160,.16);
  border-radius:0 0 20px 20px;
}
.sully-chat-name{color:#2f8f6b!important;}
.sully-chat-avatar{border:2px solid #8fe0bf!important;box-shadow:0 0 0 4px rgba(143,224,191,.25)!important;}
.sully-chat-buffs button{background:#e7faf0!important;color:#22936a!important;border-color:#abe6cd!important;}
.sully-chat-trigger{color:#2bb088!important;}
.sully-chat-token{background:#e7faf0!important;color:#3a9b76!important;border-color:#bdebd6!important;}`,
    },
    {
        name: '暮光紫',
        code: `/* 暮光紫 */
.sully-chat-header{
  background:linear-gradient(135deg,#3b2a63,#5a3f86 55%,#7e5aa6)!important;
  border-bottom:none!important;
  box-shadow:0 8px 22px rgba(80,50,130,.3);
  border-radius:0 0 18px 18px;
}
.sully-chat-name{color:#fce7ff!important;}
.sully-chat-status{color:#d6bcfa!important;}
.sully-chat-back,.sully-chat-trigger{color:#f5d0fe!important;}
.sully-chat-avatar{border:2px solid rgba(255,255,255,.7)!important;box-shadow:0 4px 14px rgba(0,0,0,.3)!important;}
.sully-chat-buffs button{background:rgba(255,255,255,.16)!important;color:#fbe8ff!important;border-color:rgba(255,255,255,.3)!important;}
.sully-chat-token{background:rgba(255,255,255,.14)!important;color:#f0e0ff!important;border-color:rgba(255,255,255,.25)!important;}`,
    },
    {
        name: '极简白',
        code: `/* 极简白 */
.sully-chat-header{background:#ffffff!important;border-bottom:1px solid #eef1f5!important;box-shadow:none!important;}
.sully-chat-name{color:#1f2937!important;}
.sully-chat-avatar{border:1.5px solid #e5e7eb!important;}
.sully-chat-buffs button{background:#f5f6f8!important;color:#6b7280!important;border-color:#e5e7eb!important;}
.sully-chat-trigger{color:#6366f1!important;}
.sully-chat-token{background:#f5f6f8!important;color:#9ca3af!important;border-color:#e5e7eb!important;}`,
    },
];

const ChromeCssEditor: React.FC<{ value: string; onChange: (css: string) => void }> = ({ value, onChange }) => {
    return (
        <div>
            <div className="mb-2 text-[10px] leading-relaxed text-slate-400">
                点下面任一套「完整风格」即可一键套用（会替换文本框内容、立刻生效）。也可直接改文本框里的 CSS，
                或整段复制给别的 AI 帮你改。选择器：
                <code className="mx-0.5 rounded bg-slate-100 px-1 text-slate-500">.sully-chat-header/-avatar/-name/-buffs/-token/-trigger/-back/-inputbar/-root</code>。
            </div>
            <div className="mb-3 flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                    <button key={p.name} onClick={() => onChange(p.code)}
                        className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] font-bold text-primary transition-all hover:bg-primary/15 active:scale-95">
                        {p.name}
                    </button>
                ))}
                {value && (
                    <button onClick={() => onChange('')}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-400 transition-all hover:bg-slate-50 active:scale-95">
                        清空
                    </button>
                )}
            </div>
            <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={'/* 点上面任一套，或在这里直接写 / 粘贴 CSS */\n.sully-chat-header{\n  background: linear-gradient(135deg,#ffe3ef,#f1e7ff) !important;\n  border-bottom: none !important;\n}'}
                spellCheck={false}
                rows={8}
                className="w-full resize-y rounded-2xl border border-slate-700 bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-200 outline-none focus:border-primary/50 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            />
        </div>
    );
};

export default ChromeCssEditor;
