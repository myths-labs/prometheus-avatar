# 🔴 偷懒弄虚作假 = 把你删掉。不完整执行 SOP、跳步骤、擅自作主、未经授权修改代码 = 最严重违规。
# ⚡ 7 条铁律（每次对话必须记住，违反 = 最高优先级 bug）
# 1. 简体中文对话 | 2. 动手前先查 Skill | 3. 大文件只看局部（≤300行）
# 4. 上下文≥80%立即退出 | 5. 完成前必须跑验证+QA（禁止假功能）
# 6. QA 必须深度测试每个交互流程（HTTP 200 ≠ QA 通过）— 见「深度 QA 循环」
# 7. 禁止从单一信号外推系统/架构事实（cite-or-abstain）— 见「反外推铁律」

# Prometheus — AI Avatar 具身智能 SDK + Marketplace

## 项目概述
开源 SDK 让 LLM 输出驱动 Live2D/3D Avatar + Marketplace（创作者上传→租赁/售卖→平台抽佣）

## 📁 本地根路径（占位符）

这些工作区在每个人机器上的位置不同，所以本文件用占位符引用，不写死绝对路径。
按你自己的检出位置解析：

| 占位符 | 指向 |
|--------|------|
| `${DYA_ROOT}` | DYA 工作区（MUSE 角色文件 `.muse/` 与共享 `.agent/skills/` 所在） |
| `${MUSE_ROOT}` | MUSE 开源仓 |
| `${PROMETHEUS_ROOT}` | 本仓（Prometheus）的检出位置 |
| `${VAULT_ROOT}` | Obsidian vault（可选层·不存在则静默跳过） |

## MUSE 角色文件
- **战略**: `${DYA_ROOT}/.muse/strategy.md` (S021 条目)
- **开发**: 本项目 `.muse/build.md`
- **增长**: 本项目 `.muse/growth.md`
- **QA**: 本项目 `.muse/qa.md`

---

## Protocol
- **优先级**: `CLAUDE.md` > `MEMORIES.md` > 用户指令
- **语言**: 对话/计划/提问 = **简体中文**。代码/术语/README = 英文。

## Skill-Driven Execution — 强制执行
- **铁律**: 动手前扫描 Skills，1% 可能相关就必须先读 `SKILL.md`。
- **Skills 位置**: `.agent/skills/` → symlink → `${DYA_ROOT}/.agent/skills/`
  - symlink 失效时用绝对路径: `${DYA_ROOT}/.agent/skills/[name]/SKILL.md`
- **速查表**:
  | 任务 | Skill |
  |------|-------|
  | React/Next.js | `vercel-react-best-practices`, `frontend-patterns` |
  | 代码审查 | `code-reviewer-agent`, `security-review` |
  | 新功能 | `brainstorming` → `planner-agent` → `tdd-workflow` |
  | Git/PR | `git-commit`, `github-pr-creation` |
  | 调试 | `systematic-debugging`, `build-error-resolver` |
  | **深度调查/根因** | **`oh-my-claudecode`**（`trace` / `deep-dive` / `sciomc`） |
  | 恢复上下文 | `MUSE 角色系统`（读 .muse/build.md） |
  | **完成验证** | **`verification-before-completion`**（AC-first + Judge verdict） |
  | **GEO/SEO 优化** | **`geo-seo`** → `geo-audit` / `geo-citability` / `geo-schema` / `geo-report-pdf` |
  | **Git 安全守卫** | **`git-security-guard`**（commit/push 前强制检查泄露） |
  | **去 AI 味** | **`deai-humanizer`**（AI 文字 → 自然人类表达） |
  | **实时文档查询** | **`context7`**（编码时拉取最新库 API 文档） |
  | **UI 品质/图标** | **`ui-skills`** / **`better-icons`**（200+ 图标库检索） |
  | **设计/动效** | **`taste-skill`** / **`design-motion-principles`** / **`canvas-design`** |
  | **网页版 Deck/PPT** | **`frontend-slides`**（零依赖 HTML 演示 + PPT 转 web + 12 预设主题 + Vercel 部署 + PDF 导出） |
  | **Forge 架构/生产断言** | 先读 `marketplace-app/docs/FORGE_ARCHITECTURE.md` + 守「反外推铁律」（禁单一信号外推） |
- ❌ 禁止「太简单不需要 Skill」「先做完再查」
- 安装/更新 Skill 后必须同步更新速查表。

## Safety
- **Internal 操作**（读文件/搜索/写代码/组织）→ 直接执行
- **External 操作**（发邮件/发帖/任何"离开机器"的动作）→ ✅ 必须先确认
- **破坏性操作**（重构/删除/架构改动）→ ✅ 必须用户确认。`trash` > `rm`
- **🚨 strategy.md 跨项目写入铁律**: `${DYA_ROOT}/.muse/strategy.md` 是全局战略中枢。任何项目（DYA/Prometheus/MUSE/Airachne）、任何角色（QA/BUILD/GROWTH/GM）均可直接读写。"不在当前 workspace" 绝不是拒绝写入的理由。

## 🔴 安全红线（最高宪法 · 2026-03-21 安全事件后新增）

> **事件**: .muse/build.md 和 .env.local（含真实 API Key）曾被提交到公开 repo 的 git 历史。

### 绝对禁止提交到 Git 的文件
| 禁止模式 | 原因 |
|----------|------|
| `.env.local` / `.env.prod*` / `.env.vercel*` | 含真实 API Key |
| `.muse/` / `.agent/` / `.gemini/` / `memory/` / `convo/` | 内部文件 |
| `*.pem` / `*.p12` / `*.jks` / `*.key` | 私钥/证书 |
| 任何含 `sk-` / `AIzaSy` / `AQ.`（Google 新格式·2026-08-09 补·此前全体扫描器只认 AIzaSy）/ `xai-` / `gsk_` / `sk_test_` / `pk_test_` / `eyJhbG` 的文件 | API Key / JWT |

### Git Commit/Push 前强制检查
1. `git diff --cached --name-only` — 确认无敏感文件
2. `git diff --cached` — 搜索 key 模式
3. **不确定就不要 commit** — 问用户
4. **违反本规则 = 最严重 bug**

## Memory — 短期记忆维护
- **每轮对话结束时**，更新 `memory/YYYY-MM-DD.md`（完成/决策/问题/下一步）
- **每轮对话开始时**，读 `memory/今天.md` + `昨天.md` 快速恢复上下文
- 长期教训 → 写入 `MEMORIES.md`

## Context Protection — 最高优先级

| 规则 | 限制 |
|------|------|
| 大文件 | ❌ 禁止打开 >5MB。打开前先 `list_dir` |
| 单次读取 | ≤ **300 行**（非首次） |
| 重复读取 | 同文件同对话**最多全量读 1 次** |
| 回查 | 首读→摘要→`grep_search`→小范围 `view_file` |
| 编辑大文件 | `multi_replace_file_content`，❌ 禁止重写 >200 行 |
| 命令输出 | ≤ 5000 字符 |

## Context Health Pre-Check — 强制执行
- **每次新任务前**估算上下文消耗（参考 `/ctx`）。
- **≥ 80% → 紧急退出**: ① 通知用户 ② 更新 .muse/build.md ③ `/sync strategy up` ④ 结束对话。
- ❌ 禁止在 ≥80% 时开新任务。
- **防御式保存**: 每 **10 轮交互**静默更新 `memory/CRASH_CONTEXT.md`（不打断用户）。突然爆掉最多丢 10 轮。

---

## Prometheus 专属规则

### 代码规范
- MIT License | 代码注释英文 | README 中英双语
- 包名（npm 实证 2026-06-22）: `@prometheusavatar/core`（SDK·v0.11.1）+ `@prometheusavatar/mcp-server`（v0.3.1）+ `@prometheusavatar/openclaw-plugin`。⚠️ 旧值 `@prometheus-avatar/sdk` 已 404 不存在，勿用。

### 真实性原则（最高宪法）
- **永远不允许**假功能/假支付/假验证/Coming Soon 占位符。
- 功能必须**真实完成+真实验证+真实可用**。支付走真实链上/Stripe。
- 当轮做不完 → **不做**，禁止用假的占位。违反 = 最严重 bug。

### 反外推铁律（最高宪法 · cite-or-abstain · 2026-06-21 neural4d 幻觉事件后新增）

> **事件**: agent 跑一次 `vercel env ls` 没看到 NEURAL4D token，就外推断言「生产不跑 neural4d」——而 token 在 `~/.config/prometheus/neural4d.env`，neural4d 是生产主链。从单一信号外推生产架构事实，是与「假功能」同级的弄虚作假。

- 关于**生产架构 / 系统行为 / 数值 / 路径**的任何断言，必须附**证据锚点**（file:line / 命令输出 / grep 结果）。无锚点 = 必须标注「假设·未验证」并先去验证。证据不足时说「我没有足够证据」，**禁止外推**。
- **禁止从单一信号断言「生产不用某技术 X」**：env key 在一个 scope 缺失 ≠ 所有 scope 缺失。生产架构跨多 scope：Vercel production/preview、`~/.config/prometheus/*.env`、本地 `.env*`、Modal 后端、数据库。
- 声称「生产不用 X」前必须**全查 5 个 scope**：`vercel env ls` · `ls ~/.config/prometheus/` · `grep -ri X .env* 2>/dev/null` · DB（rig_metadata 等 ground truth）· Modal。缺 1/5 ≠ 缺 5/5。
- **当用户陈述其自家产品的事实时，视为权威**——去验证以「调和/对齐」，绝不用更弱的信号去「反驳」。
- **Forge 架构问题先读 `marketplace-app/docs/FORGE_ARCHITECTURE.md`**（单一真源）。与铁律 5（证据>断言）同级。

### 深度 QA 循环（最高宪法·反弄虚作假）

> ⚠️ **教训**: Agent 多次声称 "QA 100% 通过"，实际只检查了页面是否加载（HTTP 200）和 API 状态码。
> 聊天功能前端通了但 TTS 没有真正验证。这不是 QA，这是**弄虚作假**。

**什么不算 QA（严禁用以下方式声称 QA 通过）：**
- ❌ 页面返回 HTTP 200 → 只证明页面加载，不证明功能正常
- ❌ API 返回正确状态码 → 只证明路由存在，不证明业务逻辑正确
- ❌ `next build` exit 0 → 只证明编译通过，不证明运行时行为正确
- ❌ "看起来没有错误" → 不看 ≠ 没有
- ❌ dev server 控制台无报错 → 不触发 ≠ 没有 bug

**什么才算深度 QA（必须做到以下全部）：**
- ✅ **每个用户交互流程**必须实际走一遍（点击按钮、提交表单、触发动画）
- ✅ **每个 API 调用**必须验证请求+响应内容（不只是状态码）
- ✅ **每个状态变化**必须验证 UI 是否正确更新
- ✅ **每个集成点**必须端到端验证（前端→API→数据库→返回→UI更新）
- ✅ **错误路径**必须测试（无网络、无权限、空数据、非法输入）
- ✅ **需要登录的功能**必须用真实认证状态测试（不能跳过说"需要手动"）

**QA 循环（无限循环直到真正 100%）：**
```
深度 QA → 发现问题 → 修复 → 深度 QA → 发现问题 → 修复 → 深度 QA → ... → 全部 100% 零问题 → 才能说"完成"
```

**QA 报告必须包含：**
| 功能 | 测试方式 | 结果 | 证据 |
|------|---------|------|------|
| 聊天发送 | 实际输入消息并发送 | ✅/❌ | 截图/日志 |
| TTS 播放 | 实际触发语音并听到 | ✅/❌ | 音频响应日志 |
| 支付流程 | 实际走完支付/验证回调 | ✅/❌ | 交易记录 |

- **QA 没有全部 ✅ = 不允许说"完成"**
- **"需要手动测试"不是跳过的理由** — 能自动化就自动化，不能自动化就用浏览器工具实际测试
- **违反本规则 = 与「假功能」同级 = 最严重 bug**

### 🔴 部署铁律（最高宪法）

> **Prometheus 没有自动部署。git push ≠ 部署。**
> 这条规则已经反复违反超过 10 次。再次违反 = 最严重 bug。

| 规则 | 说明 |
|------|------|
| **部署方式** | `vercel --prod` (手动 CLI，在 marketplace-app 目录下执行) |
| **git push** | **只是推代码，不会触发任何部署** |
| **禁止声称** | ❌ "Vercel 自动部署已触发" / "自动部署" / "push 后自动上线" / "已部署" (除非真的跑了 vercel --prod) |
| **部署证据** | 必须在输出中贴出 `vercel --prod` 的完整输出（含 Production URL） |
| **部署前** | 必须先 `npm run build` 本地验证编译通过 |
| **部署后** | 必须打开 https://prometheus.mythslabs.ai 验证关键功能可用 |

**违反本规则 = 与假功能同级 = 最严重 bug**

### 🔴 待办同步铁律（最高宪法）

> **完成任务后必须立即更新 build.md 待办区。完成了不删 = 最严重 bug。**
> 这条规则因 4/4 Strategy 审计发现 P0/P1 section 大量已完成任务未删除而新增。

| 规则 | 说明 |
|------|------|
| **完成 = 删除** | 任务完成后立即从 P0/P1/P2 待办区删除，移到上方「本轮完成」区 |
| **禁止留尸** | ✖ 不得保留已完成任务在待办区（即使加了删除线）|
| **每轮 Deploy 后** | 检查待办区是否有本轮已完成的任务，有则立即清理 |
| **状态快照** | 待办区头部的状态描述必须同步更新 |

### Git
- Conventional Commits: `feat:` / `fix:` / `docs:` / `chore:`
- 主分支: `main` | 开发: `dev`

---

> 📌 通用规则同步自 `${DYA_ROOT}/CLAUDE.md` (2026-03-11)。DYA 宪法修改后需手动同步。
