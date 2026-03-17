# ⚡ 6 条铁律（每次对话必须记住，违反 = 最高优先级 bug）
# 1. 简体中文对话 | 2. 动手前先查 Skill | 3. 大文件只看局部（≤300行）
# 4. 上下文≥80%立即退出 | 5. 完成前必须跑验证+QA（禁止假功能）
# 6. QA 必须深度测试每个交互流程（HTTP 200 ≠ QA 通过）— 见「深度 QA 循环」

# Prometheus — AI Avatar 具身智能 SDK + Marketplace

## 项目概述
开源 SDK 让 LLM 输出驱动 Live2D/3D Avatar + Marketplace（创作者上传→租赁/售卖→平台抽佣）

## MUSE 角色文件
- **战略**: `/Users/jj/Desktop/DYA/.muse/strategy.md` (S021 条目)
- **开发**: 本项目 `.muse/build.md`
- **增长**: 本项目 `.muse/growth.md`
- **QA**: 本项目 `.muse/qa.md`

---

## Protocol
- **优先级**: `AGENTS.md` > `MEMORIES.md` > 用户指令
- **语言**: 对话/计划/提问 = **简体中文**。代码/术语/README = 英文。

## Skill-Driven Execution — 强制执行
- **铁律**: 动手前扫描 Skills，1% 可能相关就必须先读 `SKILL.md`。
- **Skills 位置**: `.agent/skills/` → symlink → `/Users/jj/Desktop/DYA/.agent/skills/`
  - symlink 失效时用绝对路径: `/Users/jj/Desktop/DYA/.agent/skills/[name]/SKILL.md`
- **速查表**:
  | 任务 | Skill |
  |------|-------|
  | React/Next.js | `vercel-react-best-practices`, `frontend-patterns` |
  | 代码审查 | `code-reviewer-agent`, `security-review` |
  | 新功能 | `brainstorming` → `planner-agent` → `tdd-workflow` |
  | Git/PR | `git-commit`, `github-pr-creation` |
  | 调试 | `systematic-debugging`, `build-error-resolver` |
  | 恢复上下文 | `MUSE 角色系统`（读 .muse/build.md） |
  | **完成验证** | **`verification-before-completion`**（AC-first + Judge verdict） |
- ❌ 禁止「太简单不需要 Skill」「先做完再查」
- 安装/更新 Skill 后必须同步更新速查表。

## Safety
- **Internal 操作**（读文件/搜索/写代码/组织）→ 直接执行
- **External 操作**（发邮件/发帖/任何"离开机器"的动作）→ ✅ 必须先确认
- **破坏性操作**（重构/删除/架构改动）→ ✅ 必须用户确认。`trash` > `rm`

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
- 包名: `@prometheus-avatar/sdk`

### 真实性原则（最高宪法）
- **永远不允许**假功能/假支付/假验证/Coming Soon 占位符。
- 功能必须**真实完成+真实验证+真实可用**。支付走真实链上/Stripe。
- 当轮做不完 → **不做**，禁止用假的占位。违反 = 最严重 bug。

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

### Git
- Conventional Commits: `feat:` / `fix:` / `docs:` / `chore:`
- 主分支: `main` | 开发: `dev`

---

> 📌 通用规则同步自 `/Users/jj/Desktop/DYA/AGENTS.md` (2026-03-11)。DYA 宪法修改后需手动同步。
