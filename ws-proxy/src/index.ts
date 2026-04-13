/**
 * Cloudflare Worker — WebSocket Relay Proxy
 *
 * Relays WebSocket connections from browser clients to upstream APIs
 * (Volcengine / MiniMax) that require Authorization headers which
 * browsers cannot set on WebSocket handshakes.
 *
 * Routes:
 *   /volcengine  → wss://ai-gateway.vei.volces.com/v1/realtime
 *   /minimax     → wss://api.minimax.chat/v1/realtime
 *   /fish        → wss://api.fish.audio/v1/tts/live
 *
 * The Worker adds the proper Authorization: Bearer header when
 * connecting to the upstream, then relays messages bidirectionally.
 */

interface Env {
    VOLCENGINE_API_KEY: string;
    VOLCENGINE_APP_ID: string;
    MINIMAX_API_KEY: string;
    MINIMAX_GROUP_ID: string;
    ZHIPU_API_KEY: string;
    OPENAI_API_KEY: string;
    XAI_API_KEY: string;
    FISH_AUDIO_API_KEY: string;
    ALLOWED_ORIGINS: string;
    ENVIRONMENT: string;
}

// ═══ Engine Configs ═══

interface EngineConfig {
    upstreamUrl: (params: URLSearchParams, env: Env) => string;
    headers: (env: Env, params?: URLSearchParams) => Record<string, string>;
    validate: (env: Env) => string | null; // returns error message or null
    /** If true, use subprotocol-based auth (OpenAI Realtime style) instead of header auth */
    subprotocolAuth?: boolean;
    /** Build upstream WebSocket subprotocols from client params */
    subprotocols?: (params: URLSearchParams, env: Env) => string[];
}

const ENGINES: Record<string, EngineConfig> = {
    volcengine: {
        upstreamUrl: (params, env) => {
            // 端到端实时语音大模型 endpoint (NOT ai-gateway)
            return `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel`;
        },
        headers: (env) => ({
            // 端到端实时语音大模型 uses specialized auth headers
            "X-Api-App-Key": env.VOLCENGINE_APP_ID,
            "X-Api-Access-Key": env.VOLCENGINE_API_KEY,
            "X-Api-Resource-Id": "volc.bigasr.sauc.duration",
        }),
        validate: (env) => {
            if (!env.VOLCENGINE_API_KEY) return "VOLCENGINE_API_KEY not configured";
            if (!env.VOLCENGINE_APP_ID) return "VOLCENGINE_APP_ID not configured";
            return null;
        },
    },
    minimax: {
        upstreamUrl: (params, env) => {
            const model = params.get("model") || "speech-02-hd";
            const groupId = params.get("group_id") || env.MINIMAX_GROUP_ID || "";
            return `wss://api.minimax.chat/v1/realtime?model=${model}${groupId ? `&group_id=${groupId}` : ""}`;
        },
        headers: (env) => ({
            "Authorization": `Bearer ${env.MINIMAX_API_KEY}`,
        }),
        validate: (env) => {
            if (!env.MINIMAX_API_KEY) return "MINIMAX_API_KEY not configured";
            return null;
        },
    },
    zhipu: {
        upstreamUrl: (params, _env) => {
            const model = params.get("model") || "glm-realtime";
            return `wss://open.bigmodel.cn/api/paas/v4/realtime?model=${model}`;
        },
        headers: (env) => ({
            "Authorization": `Bearer ${env.ZHIPU_API_KEY}`,
        }),
        validate: (env) => {
            if (!env.ZHIPU_API_KEY) return "ZHIPU_API_KEY not configured";
            return null;
        },
    },
    doubao: {
        // 豆包 End-to-End Realtime Voice Dialogue — binary frame protocol
        // Requires X-Api-* auth headers sent from client via query params
        upstreamUrl: (_params, _env) => {
            return `wss://openspeech.bytedance.com/api/v3/realtime/dialogue`;
        },
        headers: (env, params?: URLSearchParams) => {
            // Auth values come from client query params (populated from server /api/volcengine-realtime-token)
            const accessKey = params?.get("accessKey") || env.VOLCENGINE_API_KEY;
            const appId = params?.get("appId") || env.VOLCENGINE_APP_ID;
            const resourceId = params?.get("resourceId") || "volc.speech.dialog";
            const appKey = params?.get("appKey") || "PlgvMymc7f3tQnJ6";

            return {
                "X-Api-App-ID": appId,
                "X-Api-Access-Key": accessKey,
                "X-Api-Resource-Id": resourceId,
                "X-Api-App-Key": appKey,
            };
        },
        validate: (env) => {
            // Doubao gets credentials from query params, so env check is optional
            // But fall back to env if query params are missing
            return null;
        },
    },
    // ═══ Volcengine Streaming ASR — parallel real-time transcription ═══
    asr: {
        upstreamUrl: (_params, _env) => {
            return `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel`;
        },
        headers: (env, params?: URLSearchParams) => {
            const accessKey = params?.get("accessKey") || env.VOLCENGINE_API_KEY;
            const appId = params?.get("appId") || env.VOLCENGINE_APP_ID;
            const resourceId = params?.get("resourceId") || "volc.bigasr.sauc.duration";
            const connectId = params?.get("connectId") || crypto.randomUUID();

            return {
                "X-Api-App-Key": appId,
                "X-Api-Access-Key": accessKey,
                "X-Api-Resource-Id": resourceId,
                "X-Api-Connect-Id": connectId,
            };
        },
        validate: (_env) => null,
    },
    // ═══ OpenAI Realtime — proxied for China GFW bypass ═══
    openai: {
        upstreamUrl: (params, _env) => {
            const model = params.get("model") || "gpt-4o-realtime-preview";
            return `wss://api.openai.com/v1/realtime?model=${model}`;
        },
        headers: (_env) => ({}), // Auth via subprotocols, not headers
        validate: (_env) => null, // Token comes from client
        subprotocolAuth: true,
        subprotocols: (params, _env) => {
            // Client passes ephemeral token + desired subprotocols via query params
            const token = params.get("token") || "";
            return [
                "realtime",
                `openai-insecure-api-key.${token}`,
                "openai-beta.realtime-v1",
            ];
        },
    },
    // ═══ Grok/xAI Realtime — proxied for China GFW bypass ═══
    grok: {
        upstreamUrl: (_params, _env) => {
            return `wss://api.x.ai/v1/realtime`;
        },
        headers: (_env) => ({}), // Auth via subprotocols, not headers
        validate: (_env) => null, // Token comes from client
        subprotocolAuth: true,
        subprotocols: (params, _env) => {
            const token = params.get("token") || "";
            return [
                "realtime",
                `openai-insecure-api-key.${token}`,
                "openai-beta.realtime-v1",
            ];
        },
    },
    // ═══ Fish Audio TTS Live — WebSocket streaming for <1s voice latency ═══
    fish: {
        upstreamUrl: (_params: URLSearchParams, _env: Env) => {
            return `wss://api.fish.audio/v1/tts/live`;
        },
        headers: (_env: Env, params?: URLSearchParams) => {
            // BYOK: user can pass their own key via ?token= query param
            // Otherwise fall back to platform key from env
            const apiKey = params?.get("token")?.trim() || _env.FISH_AUDIO_API_KEY;
            return {
                "Authorization": `Bearer ${apiKey}`,
            };
        },
        validate: (_env: Env) => {
            // Token can come from query param (BYOK), so env key is optional
            return null;
        },
    },
};

// ═══ CORS ═══

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
    const allowed = (env.ALLOWED_ORIGINS || "https://prometheus.mythslabs.ai")
        .split(",")
        .map(s => s.trim());

    const effectiveOrigin = origin && (allowed.includes(origin) || allowed.includes("*"))
        ? origin
        : allowed[0];

    return {
        "Access-Control-Allow-Origin": effectiveOrigin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Upgrade, Connection, Authorization",
    };
}

// ═══ Main Handler ═══

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const origin = request.headers.get("Origin");

        // OPTIONS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
        }

        // Health check
        if (url.pathname === "/" || url.pathname === "/health") {
            return new Response(JSON.stringify({
                status: "ok",
                engines: Object.keys(ENGINES),
                rest_proxy: ["/fish-rest"],
                timestamp: new Date().toISOString(),
            }), {
                headers: { "Content-Type": "application/json", ...corsHeaders(origin, env) },
            });
        }

        // ═══ LB-10: REST Proxy for Fish Audio TTS (China GFW bypass) ═══
        // POST /fish-rest — proxies to https://api.fish.audio/v1/tts
        // China users hit this CF Worker instead of Vercel serverless
        // which may have latency issues from mainland China.
        if (url.pathname === "/fish-rest" && request.method === "POST") {
            const apiKey = url.searchParams.get("token")?.trim() || env.FISH_AUDIO_API_KEY;
            if (!apiKey) {
                return new Response(JSON.stringify({ error: "No Fish Audio API key" }), {
                    status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(origin, env) },
                });
            }

            try {
                const body = await request.arrayBuffer();
                const contentType = request.headers.get("Content-Type") || "application/json";

                const fishRes = await fetch("https://api.fish.audio/v1/tts", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "Content-Type": contentType,
                    },
                    body,
                });

                // Stream the audio response back
                const responseHeaders: Record<string, string> = {
                    ...corsHeaders(origin, env),
                };
                fishRes.headers.forEach((value, key) => {
                    if (key.toLowerCase() === "content-type" || key.toLowerCase() === "content-length") {
                        responseHeaders[key] = value;
                    }
                });

                return new Response(fishRes.body, {
                    status: fishRes.status,
                    headers: responseHeaders,
                });
            } catch (e: any) {
                console.error(`[REST-Proxy] fish-rest error:`, e.message);
                return new Response(JSON.stringify({ error: e.message }), {
                    status: 502, headers: { "Content-Type": "application/json", ...corsHeaders(origin, env) },
                });
            }
        }

        // Debug test endpoint: /test/{engine} — test upstream connection
        if (url.pathname.startsWith("/test/")) {
            const testEngine = url.pathname.split("/")[2];
            const engineConfig = ENGINES[testEngine];
            if (!engineConfig) {
                return new Response(JSON.stringify({ error: `Unknown engine: ${testEngine}` }), {
                    status: 404, headers: { "Content-Type": "application/json", ...corsHeaders(origin, env) },
                });
            }
            const validationError = engineConfig.validate(env);
            if (validationError) {
                return new Response(JSON.stringify({ error: validationError }), {
                    status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(origin, env) },
                });
            }
            const testUpstreamUrl = engineConfig.upstreamUrl(url.searchParams, env);
            const testFetchUrl = testUpstreamUrl.replace("wss://", "https://").replace("ws://", "http://");
            const testAuthHeaders = engineConfig.headers(env);
            try {
                const testRes = await fetch(testFetchUrl, {
                    headers: { "Upgrade": "websocket", ...testAuthHeaders },
                });
                const hasWebSocket = !!testRes.webSocket;
                let body = "";
                if (!hasWebSocket) {
                    try { body = await testRes.text(); } catch { }
                } else {
                    testRes.webSocket!.accept();
                    testRes.webSocket!.close(1000, "test complete");
                }
                return new Response(JSON.stringify({
                    engine: testEngine,
                    upstreamUrl: testUpstreamUrl.split("?")[0],
                    status: testRes.status,
                    hasWebSocket,
                    authPrefix: Object.values(testAuthHeaders)[0]?.slice(0, 15) + "...",
                    headers: Object.fromEntries(testRes.headers.entries()),
                    body: body.slice(0, 300),
                }), {
                    headers: { "Content-Type": "application/json", ...corsHeaders(origin, env) },
                });
            } catch (e: any) {
                return new Response(JSON.stringify({
                    engine: testEngine,
                    error: e.message,
                    stack: e.stack?.slice(0, 200),
                }), {
                    status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(origin, env) },
                });
            }
        }

        // Parse engine from path: /volcengine or /minimax
        const engineName = url.pathname.replace(/^\//, "").split("/")[0];
        const engine = ENGINES[engineName];

        if (!engine) {
            return new Response(JSON.stringify({
                error: `Unknown engine: ${engineName}`,
                available: Object.keys(ENGINES),
            }), {
                status: 400,
                headers: { "Content-Type": "application/json", ...corsHeaders(origin, env) },
            });
        }

        // Validate config
        const validationError = engine.validate(env);
        if (validationError) {
            return new Response(JSON.stringify({ error: validationError }), {
                status: 500,
                headers: { "Content-Type": "application/json", ...corsHeaders(origin, env) },
            });
        }

        // Must be WebSocket upgrade
        const upgradeHeader = request.headers.get("Upgrade");
        if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
            return new Response(JSON.stringify({
                error: "Expected WebSocket upgrade request",
                usage: `Connect via WebSocket: wss://${url.host}/${engineName}?model=...`,
            }), {
                status: 426,
                headers: { "Content-Type": "application/json", ...corsHeaders(origin, env) },
            });
        }

        // ═══ WebSocket Relay ═══

        const upstreamUrl = engine.upstreamUrl(url.searchParams, env);
        const authHeaders = engine.headers(env, url.searchParams);

        // ⚠️ Cloudflare Workers fetch() requires https:// not wss://
        // Workers handle the WebSocket upgrade internally via the Upgrade header
        const fetchUrl = upstreamUrl.replace("wss://", "https://").replace("ws://", "http://");

        console.log(`[WS-Relay] 🚀 ${engineName}: connecting to ${fetchUrl.split("?")[0]}...`);

        try {
            // Build fetch options — header auth vs subprotocol auth
            const fetchOptions: RequestInit & { headers: Record<string, string> } = {
                headers: {
                    "Upgrade": "websocket",
                    ...authHeaders,
                },
            };

            // For subprotocol-based auth (OpenAI/Grok), pass subprotocols via
            // Sec-WebSocket-Protocol header — CF Workers use this for WS upgrade
            if (engine.subprotocolAuth && engine.subprotocols) {
                const protocols = engine.subprotocols(url.searchParams, env);
                fetchOptions.headers["Sec-WebSocket-Protocol"] = protocols.join(", ");
                console.log(`[WS-Relay] 🔑 ${engineName}: using subprotocol auth (${protocols.length} protocols)`);
            }

            // Connect to upstream
            const upstreamResponse = await fetch(fetchUrl, fetchOptions);

            const upstreamWs = upstreamResponse.webSocket;
            if (!upstreamWs) {
                // Log detailed error info for debugging
                const status = upstreamResponse.status;
                let body = "";
                try { body = await upstreamResponse.text(); } catch { }
                const respHeaders = Object.fromEntries(upstreamResponse.headers.entries());
                console.error(`[WS-Relay] ❌ ${engineName}: upstream refused WebSocket upgrade`);
                console.error(`[WS-Relay] ❌ Status: ${status}`);
                console.error(`[WS-Relay] ❌ Body: ${body.slice(0, 500)}`);
                console.error(`[WS-Relay] ❌ Headers: ${JSON.stringify(respHeaders)}`);
                console.error(`[WS-Relay] ❌ Request URL: ${upstreamUrl}`);
                console.error(`[WS-Relay] ❌ Auth header prefix: ${Object.values(authHeaders)[0]?.slice(0, 20)}...`);
                return new Response(JSON.stringify({
                    error: `Upstream ${engineName} refused WebSocket upgrade (HTTP ${status})`,
                    detail: body.slice(0, 200),
                }), {
                    status: 502,
                    headers: { "Content-Type": "application/json", ...corsHeaders(origin, env) },
                });
            }

            upstreamWs.accept();

            // Create WebSocket pair for client
            const [clientWs, serverWs] = Object.values(new WebSocketPair());

            // For subprotocol auth engines, mirror the upstream's accepted protocol
            // so the browser client sees the correct Sec-WebSocket-Protocol in the response
            serverWs.accept();

            let clientClosed = false;
            let upstreamClosed = false;

            // Client → Upstream
            serverWs.addEventListener("message", (event) => {
                if (!upstreamClosed) {
                    try {
                        upstreamWs.send(event.data);
                    } catch (e) {
                        console.error(`[WS-Relay] ${engineName}: error sending to upstream:`, e);
                    }
                }
            });

            serverWs.addEventListener("close", (event) => {
                clientClosed = true;
                console.log(`[WS-Relay] ${engineName}: client closed (${event.code})`);
                if (!upstreamClosed) {
                    try { upstreamWs.close(event.code, event.reason); } catch { }
                }
            });

            // Upstream → Client
            upstreamWs.addEventListener("message", (event) => {
                if (!clientClosed) {
                    try {
                        serverWs.send(event.data);
                    } catch (e) {
                        console.error(`[WS-Relay] ${engineName}: error sending to client:`, e);
                    }
                }
            });

            upstreamWs.addEventListener("close", (event) => {
                upstreamClosed = true;
                console.log(`[WS-Relay] ${engineName}: upstream closed (${event.code} ${event.reason || ""})`);
                if (!clientClosed) {
                    try { serverWs.close(event.code, event.reason); } catch { }
                }
            });

            upstreamWs.addEventListener("error", (event) => {
                console.error(`[WS-Relay] ${engineName}: upstream error`);
                upstreamClosed = true;
                if (!clientClosed) {
                    try { serverWs.close(1011, `Upstream ${engineName} error`); } catch { }
                }
            });

            console.log(`[WS-Relay] ✅ ${engineName}: relay established`);

            return new Response(null, {
                status: 101,
                webSocket: clientWs,
            });

        } catch (error: any) {
            console.error(`[WS-Relay] ❌ ${engineName}: connection failed:`, error.message);
            return new Response(JSON.stringify({
                error: `Failed to connect to ${engineName}: ${error.message}`,
            }), {
                status: 502,
                headers: { "Content-Type": "application/json", ...corsHeaders(origin, env) },
            });
        }
    },
};
