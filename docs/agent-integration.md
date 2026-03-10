# AI Agent Integration Guide

Connect your own AI Agent to Prometheus Avatar — give it a face, voice, and body.

## Quick Start

1. Open the Avatar App → tap **Memory** (💡 lightbulb icon)
2. Scroll to **CUSTOM AGENT API** → toggle **ON**
3. Enter your **Endpoint URL**, **API Key**, and **Model Name**
4. Click **🔌 Test Connection** → verify ✅ Connected
5. Click **💾 Save Config**
6. Start chatting — your agent's responses will be spoken by the avatar

---

## Supported Endpoints

Prometheus works with **any OpenAI-compatible `chat/completions` endpoint**:

### Cloud LLM Providers

| Provider | Endpoint URL | Model Examples |
|----------|-------------|----------------|
| OpenAI | `https://api.openai.com/v1/chat/completions` | `gpt-4o`, `gpt-3.5-turbo` |
| Groq | `https://api.groq.com/openai/v1/chat/completions` | `llama-3.3-70b-versatile`, `mixtral-8x7b-32768` |
| DeepSeek | `https://api.deepseek.com/v1/chat/completions` | `deepseek-chat`, `deepseek-coder` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` | `gemini-2.0-flash`, `gemini-1.5-pro` |
| Together AI | `https://api.together.xyz/v1/chat/completions` | `meta-llama/Llama-3-70b-chat-hf` |
| Fireworks | `https://api.fireworks.ai/inference/v1/chat/completions` | `accounts/fireworks/models/llama-v3-70b` |
| Perplexity | `https://api.perplexity.ai/chat/completions` | `llama-3.1-sonar-large-128k-online` |

### Local Models

| Tool | Endpoint URL | Notes |
|------|-------------|-------|
| Ollama | `http://localhost:11434/v1/chat/completions` | Install from ollama.com |
| LM Studio | `http://localhost:1234/v1/chat/completions` | GUI for local models |
| vLLM | `http://localhost:8000/v1/chat/completions` | High-throughput serving |
| llama.cpp | `http://localhost:8080/v1/chat/completions` | `--api-oai` flag |

> **Note:** HTTP endpoints are allowed only for `localhost` / `127.0.0.1`. External endpoints must use HTTPS.

---

## Wrapping Your Agent with OpenAI-Compatible API

If your agent uses LangChain, CrewAI, AutoGen, or custom Python, wrap it with FastAPI:

### Minimal Example (FastAPI)

```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
import json

app = FastAPI()

async def my_agent(messages: list) -> str:
    """Replace with your agent logic."""
    # LangChain example:
    # from langchain.chat_models import ChatOpenAI
    # llm = ChatOpenAI(model="gpt-4o")
    # return llm.invoke(messages).content
    
    user_msg = messages[-1]["content"] if messages else "hello"
    return f"My agent received: {user_msg}"

@app.post("/v1/chat/completions")
async def chat(request: dict):
    messages = request.get("messages", [])
    stream = request.get("stream", False)
    reply = await my_agent(messages)

    if stream:
        async def generate():
            for word in reply.split():
                chunk = {"choices": [{"delta": {"content": word + " "}}]}
                yield f"data: {json.dumps(chunk)}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(generate(), media_type="text/event-stream")
    else:
        return {
            "choices": [{"message": {"role": "assistant", "content": reply}}]
        }
```

```bash
pip install fastapi uvicorn
uvicorn server:app --host 0.0.0.0 --port 8000
```

Then in Prometheus:
- **Endpoint URL:** `http://localhost:8000/v1/chat/completions`
- **Model Name:** (leave empty — your server doesn't need it)

### LangChain Agent Example

```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from langchain.chat_models import ChatOpenAI
from langchain.agents import initialize_agent, AgentType
from langchain.tools import DuckDuckGoSearchRun
import json

app = FastAPI()
llm = ChatOpenAI(model="gpt-4o", streaming=True)
tools = [DuckDuckGoSearchRun()]
agent = initialize_agent(tools, llm, agent=AgentType.ZERO_SHOT_REACT_DESCRIPTION)

@app.post("/v1/chat/completions")
async def chat(request: dict):
    messages = request.get("messages", [])
    user_input = messages[-1]["content"] if messages else ""
    result = agent.run(user_input)

    async def stream():
        for word in result.split():
            yield f'data: {json.dumps({"choices": [{"delta": {"content": word + " "}}]})}\n\n'
        yield "data: [DONE]\n\n"
    return StreamingResponse(stream(), media_type="text/event-stream")
```

---

## OpenClaw Plugin Protocol

If your agent is published as an OpenClaw Plugin, Prometheus can **auto-discover** its capabilities.

### How It Works

1. In the Memory panel → **OR CONNECT VIA OPENCLAW PLUGIN**
2. Enter your manifest URL: `https://your-agent.com/openclaw.plugin.json`
3. Click **🔍** → Prometheus loads the manifest
4. The API endpoint is **auto-derived** and Stage 2 is auto-configured

### Manifest Format (`openclaw.plugin.json`)

```json
{
  "name": "my-agent",
  "version": "1.0.0",
  "description": "My awesome AI agent",
  "author": "Your Name",
  "apiEndpoint": "https://my-agent.com/api/chat",
  "events": {
    "listens": ["agent:message", "agent:thinking"],
    "emits": ["avatar:speak", "avatar:emote"]
  }
}
```

### Endpoint Derivation

| Manifest Field | Result |
|---------------|--------|
| `apiEndpoint` specified | Uses that URL directly |
| No `apiEndpoint` | Derives from manifest URL: replaces `openclaw.plugin.json` with `api/chat` |

---

## System Prompt & Memory

### System Prompt

Define your agent's personality in the **System Prompt** field. This is sent as the first `system` message:

```json
{"role": "system", "content": "You are Luna, a creative writing assistant who speaks with warmth."}
```

### Memory / Context

Upload files (JSON/TXT/MD) or paste context. Sent as a second `system` message:

```json
{"role": "system", "content": "[Memory Context]\nUser prefers formal English. Last topic: quantum computing."}
```

### Full Message Flow

When a user sends "Hello", the proxy sends to your endpoint:

```json
{
  "model": "your-model-name",
  "messages": [
    {"role": "system", "content": "You are Luna..."},
    {"role": "system", "content": "[Memory Context]\nUser prefers..."},
    {"role": "user", "content": "Previous message..."},
    {"role": "assistant", "content": "Previous reply..."},
    {"role": "user", "content": "Hello"}
  ],
  "stream": true,
  "max_tokens": 1024
}
```

---

## Response Format

The proxy normalizes various response formats. Your endpoint can return:

### Streaming (SSE) — Preferred

```
data: {"choices": [{"delta": {"content": "Hello"}}]}
data: {"choices": [{"delta": {"content": " world"}}]}
data: [DONE]
```

Also supports: `{"token": "..."}` and `{"text": "..."}`

### Non-Streaming (JSON)

```json
{"choices": [{"message": {"content": "Hello world"}}]}
```

Also supports: `{"response": "..."}`, `{"reply": "..."}`, `{"content": "..."}`, `{"text": "..."}`

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| 401 Unauthorized | Wrong API key | Check Bearer Token field |
| 404 / model_not_found | Wrong model name | Verify exact model ID |
| 429 Too Many Requests | Rate limit | Wait or upgrade API plan |
| 502 Bad Gateway | Endpoint unreachable | Check URL and server status |
| HTTPS required | HTTP on external URL | Use HTTPS or run locally |
| Timeout (30s) | Slow endpoint | Optimize agent response time |

### Quick Test with curl

```bash
curl -X POST http://localhost:3000/api/agent-proxy \
  -H "Content-Type: application/json" \
  -d '{
    "endpoint": "https://api.groq.com/openai/v1/chat/completions",
    "apiKey": "your-key",
    "model": "llama-3.3-70b-versatile",
    "message": "Hello",
    "history": []
  }'
```

---

## Security

- **API keys** are sent per-request and never stored on the server
- **HTTPS enforced** for all external endpoints
- **Request timeout**: 30 seconds
- **Response size limit**: 2 MB
- All configuration stored in browser `localStorage` (privacy-first)
