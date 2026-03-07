# Prometheus PRD — AI Avatar 具身智能框架 + Marketplace

## 背景

JC 与 AI 深度协作后产生的需求：**给 AI Agent 一个可视化的、能实时语音/文字交互的虚拟形象**。OpenClaw（龙虾）247K+ GitHub Stars = 巨大目标用户池。目前 OpenClaw 生态没有一个成熟的 Avatar/具身智能解决方案。

**Codename**: Prometheus（普罗米修斯给人类带火种，Prometheus 给 AI 带躯壳）

---

## 核心定位

**一句话**：给你的龙虾套上一个有声有色、能看能说的躯壳 — 5 分钟接入，即刻拥有具身智能。

**目标用户**：OpenClaw (龙虾) 用户 — 已有 AI Agent，想要给它加上可视化虚拟形象

**核心价值**：
1. **开源 SDK** — 无缝接入任何 LLM Agent，文字/语音驱动 Avatar 实时交互
2. **Marketplace** — 全球最大的 AI Agent 虚拟形象交易市场

---

## Marketplace 交易品类

| 品类 | 描述 | 举例 |
|------|------|------|
| 🎨 **皮肤 (Skins)** | 完整 Avatar 外观 | 二次元少女、赛博朋克机器人、像素风、写实人脸 |
| 🧠 **性格 (Personas)** | 行为预设 — 影响表情频率/幅度/反应风格 | 高冷学霸（少表情+慢眨眼）、元气少女（大表情+频繁微笑）、恶魔导师（皱眉多+冷笑） |
| 🗣️ **声音 (Voices)** | TTS 声音包 | 温柔女声、低沉男声、中性机器人、方言包、名人模仿（合规需注意） |
| 👗 **服饰 (Outfits)** | 可穿戴衣物 | 校服、西装、和服、太空服、睡衣 |
| 🎩 **配件 (Accessories)** | 头饰/眼镜/耳环等 | 猫耳、墨镜、耳机、光环、角 |
| ✨ **特效 (Effects)** | 粒子/背景/转场 | 樱花飘落、雷电环绕、赛博网格背景、节日主题 |
| 💃 **动作包 (Motion Packs)** | 待机/反应动画 | 鼓掌、摇头、跳舞、打瞌睡、思考中摸下巴 |
| 🖼️ **背景/场景 (Scenes)** | 虚拟空间 | 咖啡厅、太空站、日式房间、赛博城市、直播间 |
| 😊 **表情包 (Expression Packs)** | 扩展表情集 | 颜艺包（夸张表情）、微表情包（细腻情绪）、emoji风格 |
| 🎁 **主题套装 (Theme Bundles)** | 皮肤+服饰+背景+特效打包 | 「赛博朋克全套」「圣诞限定」「日系校园」 |
| 🔌 **能力插件 (Ability Plugins)** | 扩展 Avatar 功能 | 手势识别、AR 面部追踪、多 Avatar 联动 |

---

## 技术架构

### 整体架构

```
┌─────────────────────────────────────────────────┐
│  用户的 OpenClaw Agent                            │
│  (任何 LLM: Claude/GPT/Gemini/本地模型)          │
└──────────────┬──────────────────────────────────┘
               │ 文字/语音 输出
               ▼
┌─────────────────────────────────────────────────┐
│  Prometheus SDK (@prometheus-avatar/core)        │
│  ┌────────────┐  ┌────────────┐  ┌───────────┐ │
│  │ TTS Engine │  │ Lip Sync   │  │ Emotion   │ │
│  │ (可插拔)    │  │ Engine     │  │ Analyzer  │ │
│  └─────┬──────┘  └─────┬──────┘  └─────┬─────┘ │
│        │              │              │         │
│  ┌─────▼──────────────▼──────────────▼─────┐   │
│  │         Avatar Renderer                   │   │
│  │    (Live2D / 3D VRM — 可插拔)             │   │
│  └───────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  Prometheus Marketplace (Web)                    │
│  浏览/购买/上传 Avatar 资产                       │
└─────────────────────────────────────────────────┘
```

### 技术选型

| 层 | 技术 | 理由 |
|---|------|------|
| **SDK 核心** | TypeScript | OpenClaw 生态全 TS，无缝集成 |
| **Live2D 渲染** | Cubism SDK for Web | 官方 SDK，内置 CRI LipSync，免版税 |
| **3D 渲染** | Three.js + VRM | 开源，WebXR 兼容，VTuber 生态标准 |
| **TTS** | Web Speech API (默认) + 可插拔 (ElevenLabs/Azure/sherpa-onnx) | 零配置即可用，高需求用户可切换 |
| **情感分析** | 规则引擎 (MVP) → LLM-based (v2) | MVP 用关键词+标点匹配，v2 接 LLM |
| **Marketplace 前端** | Next.js + Vercel | 与 DYA 技术栈一致，快速部署 |
| **Marketplace 后端** | Supabase | 与 DYA 技术栈一致，Auth/Storage/DB |
| **支付** | Stripe (全球) + 支付宝 & 微信 (中国) | MVP 先 Stripe |

### OpenClaw 集成方式

Prometheus 作为 **OpenClaw Plugin** 集成：

```json
// openclaw.plugin.json
{
  "id": "prometheus-avatar",
  "name": "Prometheus Avatar",
  "version": "0.1.0",
  "type": "tool",
  "configSchema": {
    "avatarId": { "type": "string", "description": "Avatar model ID from Marketplace" },
    "ttsProvider": { "type": "string", "enum": ["web-speech", "elevenlabs"], "default": "web-speech" }
  }
}
```

用户安装：`openclaw plugins install prometheus-avatar`

---

## MVP 范围（推荐：小版 ~3-5 天）

### ✅ MVP 包含

| 功能 | 详情 |
|------|------|
| **Web Demo 页面** | 一个网页：输入文字/语音 → Avatar 实时反应 |
| **Live2D 渲染** | Cubism SDK 集成，加载 .model3.json 模型 |
| **嘴型同步** | CRI LipSync (音频驱动) + 文字输入时简单嘴型动画 |
| **TTS** | Web Speech API 默认，文字→语音→驱动嘴型 |
| **情感表情** | 规则引擎：分析文字中的 ! ? 😊 😢 等 → 切换表情参数 |
| **3 个预制 Avatar** | Airachne Preview Edition（自有 IP）+ 2 个 CC 开源模型 |
| **LLM 接入** | 接 OpenClaw Agent / Claude API / OpenAI API |
| **OpenClaw Plugin** | `openclaw.plugin.json` + 安装脚本 |
| **npm 包** | `@prometheus-avatar/core` 可独立使用 |
| **README** | 中英双语，5分钟快速开始 |
| **创作者上传** | 创作者注册/上传 Avatar 资产/基础审核流程，开放生态从 Day 1 开始 |

### ❌ MVP 不包含

| 延后到 v1 | 理由 |
|-----------|------|
| 3D VRM 渲染 | Live2D 先跑通，3D 作为第二渲染引擎 |
| 多 Avatar 同屏 | 复杂度高 |
| AR/摄像头面部追踪 | Phase 2 |
| 自定义 Persona 编辑器 | Phase 2 |

> [!IMPORTANT]
> **Marketplace + 创作者上传随 SDK 一起发布。** 空 marketplace 不是 marketplace。趁首周热度拉创作者入驻，快速填充商品。创作者赚大头，我们赚佣金，皆大欢喜。

---

## 商业模式

| 收入来源 | 模式 | 时间线 |
|---------|------|--------|
| **Marketplace 抽佣** | 每笔交易 10-20%，大头给创作者 | MVP |
| **Premium Avatar** | 官方 Myths Labs 出品。首发 **Airachne Preview Edition**（自有 IP，先知版）。**Aithena 保留做后续独立 reveal**（希腊12主神级别，值得更大舞台） | MVP |
| **Pro 订阅** | 高级 TTS voices / 无限 Avatar 切换 / 优先支持 | v1 |
| **企业 API** | 批量使用/白标方案 | v2 |

---

## 时间线

| 阶段 | 时间 | 目标 |
|------|------|------|
| **MVP** | Day 1-5 | SDK + Web Demo + 3 Avatar + LLM 接入 + OpenClaw Plugin + Marketplace（浏览+购买+创作者上传） |
| **开源发布** | Day 5-7 | README + Demo GIF + GitHub Release + npm publish + Marketplace + 创作者招募 同步上线 |
| **社区引爆** | Day 7-10 | GitHub / X / 小红书 / Reddit / OpenClaw 社区 + 创作者招募帖 |
| **v1 3D 支持** | Week 3-4 | Three.js + VRM 渲染引擎 |

---

## 验证计划

### 自动化验证
- SDK 构建：`npm run build` 无报错
- Demo 页面：`npm run dev` → 浏览器打开 → Avatar 渲染正常
- OpenClaw Plugin：`openclaw plugins install ./` 安装成功

### 手动验证
1. **核心体验**：打开 Demo 页面 → 输入 "Hello, how are you?" → Avatar 嘴巴动、TTS 播放语音、表情变化
2. **LLM 集成**：配置 Claude API key → 连续对话 → Avatar 实时反应
3. **Avatar 切换**：在 3 个预制 Avatar 间切换 → 每个都能正常渲染和交互
4. **OpenClaw 安装**：在一个 OpenClaw 实例中安装 plugin → Agent 输出时 Avatar 同步反应

### 上线指标
- GitHub Star 增速 > 100/天（发布首周）
- npm 周下载 > 100（发布首周）
- OpenClaw 社区帖子互动 > 50 条

---

## 风险与应对

| 风险 | 概率 | 应对 |
|------|:----:|------|
| Live2D SDK 许可证限制 | 中 | Cubism SDK 免费用于独立开发者/小团队；开源项目需确认 redistribution 条款。备选：pixi-live2d-display (社区包) |
| 预制 Avatar 版权 | 高 | 不能随便用别人的模型。需要：①自己做 ②委托制作 ③使用明确 CC/MIT 许可的模型 |
| OpenClaw API 变更 | 低 | Plugin API 相对稳定，但需要跟踪 OpenClaw releases |
| 与现有 VTuber 工具竞争 | 中 | Prometheus 差异化 = 专为 AI Agent 设计（vs VTuber 工具专为直播设计） |

> [!IMPORTANT]
> **预制 Avatar 版权方案已确定**：首发 **Airachne Preview Edition**（自有 IP，零版权风险）+ 1-2 个 CC 开源模型 + 创作者上传内容。**Aithena 保留做后续更大 reveal**（希腊12主神级别，值得独立事件）。如 Airachne 的 Live2D 模型需从 3D 转制（Nano Banana Pro），需在 MVP 开始前完成资产准备。

---

## 与 DYA 的战略关系

1. **品牌曝光**：Prometheus 开源爆发 → JC/Myths Labs 知名度 → DYA 间接受益
2. **技术复用**：Supabase/Vercel/Next.js 技术栈一致
3. **独立产品线**：Prometheus 有自己的 PM 和商业模式，不依赖 DYA
4. **融资叙事**：展示 JC 的技术广度和执行速度（36天 DYA + X天 Prometheus）
