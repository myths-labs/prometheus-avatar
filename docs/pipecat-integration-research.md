# Pipecat Integration Research

> 评估 Pipecat 框架作为 Prometheus 实时语音管道的可行性

## 现状 vs Pipecat

| 维度 | 当前方案 (Gemini Live API 直连) | Pipecat 方案 |
|------|------|------|
| **延迟** | ~200ms (WebSocket 直连) | ~200ms (WebRTC + Pipecat 管道) |
| **架构** | 前端直连 Gemini (ephemeral token) | Python 后端代理 → 前端 WebRTC |
| **语言** | 纯 JS/TS (Next.js) | 需添加 Python 后端 |
| **VAD** | Gemini 服务端 VAD | Pipecat 内置 VAD + 可定制 |
| **打断** | Gemini 内置 | Pipecat 原生支持 |
| **部署** | Vercel (serverless) | 需要 long-running Python 进程 |
| **成本** | 低 (无额外基础设施) | 高 (需 VPS/Cloud Run) |
| **扩展性** | 单用户 WebSocket | 多用户房间、电话 bot |

## Pipecat 架构核心

```
Audio Input → STT (Deepgram) → LLM (Gemini) → TTS (Cartesia/Gemini) → Audio Output
               ↕                    ↕                  ↕
          Frame Processor      Frame Processor    Frame Processor
```

- **Frames**: 数据包 (音频、文本、控制信号)
- **Processors**: 模块化处理器 (STT、LLM、TTS)
- **Pipelines**: 连接处理器的异步管道

## 推荐结论

### ⏸️ 暂不集成 — 保持现有 Gemini Live API 直连

**理由:**
1. **当前方案已达标** — ~200ms 延迟，Grok Companion 级别体验
2. **架构复杂度** — 添加 Python 后端 = 部署成本↑ + 维护负担↑
3. **Vercel 不兼容** — Pipecat 需要 long-running 进程，无法在 serverless 部署
4. **当前阶段优先级** — Prometheus 是 SDK/Marketplace 产品，不是电话 bot

### ✅ 何时该用 Pipecat

| 场景 | 触发条件 |
|------|----------|
| **电话 bot** | 需要 Twilio 集成 |
| **多用户房间** | 需要 LiveKit/Daily.co 房间管理 |
| **自定义 VAD** | Gemini 内置 VAD 不满足需求 |
| **多模态** | 需要同时处理视频 + 音频 + 屏幕共享 |
| **专业级音频** | 需要 echo cancellation、noise reduction |

### 📋 预留接口

当前 `useLiveVoice.ts` hook 已经模块化，未来替换为 Pipecat WebRTC 传输层时只需:
1. 把 WebSocket 连接换成 WebRTC peer connection
2. 把 ephemeral token 换成 Pipecat room token
3. 音频 I/O 管道不变 (mic → PCM → send; receive → play)
