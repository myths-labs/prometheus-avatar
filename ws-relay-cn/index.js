/**
 * WebSocket Relay — Volcengine veFaaS (China)
 *
 * Relays WebSocket connections from browser clients to Doubao E2E
 * Realtime Voice Dialogue API. Runs on Volcengine veFaaS as a
 * Web Application Function behind API Gateway.
 *
 * Architecture:
 *   Browser → ws-cn.mythslabs.ai (API Gateway) → this function → openspeech.bytedance.com
 *   (China CDN, low latency)                                     (ByteDance internal network)
 *
 * Auth headers are injected server-side because browsers cannot
 * set custom headers on WebSocket handshake requests.
 */

const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const url = require("url");

// ═══ Config ═══

const PORT = parseInt(process.env.PORT || "8080", 10);
const UPSTREAM_URL = "wss://openspeech.bytedance.com/api/v3/realtime/dialogue";

// Auth defaults from environment (can be overridden per-connection via query params)
const DEFAULT_APP_ID = process.env.VOLCENGINE_APP_ID || "";
const DEFAULT_ACCESS_KEY = process.env.VOLCENGINE_API_KEY || "";
const DEFAULT_RESOURCE_ID = "volc.speech.dialog";
const DEFAULT_APP_KEY = process.env.VOLCENGINE_APP_KEY || "";

// CORS
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "https://prometheus.mythslabs.ai")
  .split(",")
  .map((s) => s.trim());

function isOriginAllowed(origin) {
  if (!origin) return true; // non-browser clients
  return ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes("*");
}

// ═══ HTTP Server ═══

const server = http.createServer((req, res) => {
  const origin = req.headers.origin || "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": isOriginAllowed(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // Health check
  res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
  res.end(
    JSON.stringify({
      status: "ok",
      service: "ws-relay-cn",
      upstream: "doubao-e2e-realtime",
      timestamp: new Date().toISOString(),
    })
  );
});

// ═══ WebSocket Server ═══

const wss = new WebSocketServer({ server });

wss.on("connection", (clientWs, req) => {
  const parsed = url.parse(req.url || "/", true);
  const params = parsed.query;

  // Auth: prefer query params (BYOK), fall back to env
  const appId = params.appId || DEFAULT_APP_ID;
  const accessKey = params.accessKey || DEFAULT_ACCESS_KEY;
  const resourceId = params.resourceId || DEFAULT_RESOURCE_ID;
  const appKey = params.appKey || DEFAULT_APP_KEY;

  if (!appId || !accessKey) {
    console.error("[Relay] Missing appId or accessKey");
    clientWs.close(4001, "Missing auth credentials");
    return;
  }

  console.log(`[Relay] New connection — appId=${appId.slice(0, 6)}...`);

  // Connect to upstream Doubao
  const upstream = new WebSocket(UPSTREAM_URL, {
    headers: {
      "X-Api-App-ID": appId,
      "X-Api-Access-Key": accessKey,
      "X-Api-Resource-Id": resourceId,
      "X-Api-App-Key": appKey,
    },
  });

  let clientClosed = false;
  let upstreamClosed = false;

  // ── Upstream events ──

  upstream.on("open", () => {
    console.log("[Relay] Upstream connected");
  });

  upstream.on("message", (data, isBinary) => {
    if (!clientClosed) {
      try {
        clientWs.send(data, { binary: isBinary });
      } catch (e) {
        console.error("[Relay] Error sending to client:", e.message);
      }
    }
  });

  upstream.on("close", (code, reason) => {
    upstreamClosed = true;
    console.log(`[Relay] Upstream closed (${code} ${reason || ""})`);
    if (!clientClosed) {
      try { clientWs.close(code, reason); } catch {}
    }
  });

  upstream.on("error", (err) => {
    console.error("[Relay] Upstream error:", err.message);
    upstreamClosed = true;
    if (!clientClosed) {
      try { clientWs.close(1011, "Upstream error"); } catch {}
    }
  });

  // ── Client events ──

  clientWs.on("message", (data, isBinary) => {
    if (!upstreamClosed) {
      try {
        upstream.send(data, { binary: isBinary });
      } catch (e) {
        console.error("[Relay] Error sending to upstream:", e.message);
      }
    }
  });

  clientWs.on("close", (code, reason) => {
    clientClosed = true;
    console.log(`[Relay] Client closed (${code})`);
    if (!upstreamClosed) {
      try { upstream.close(code, reason); } catch {}
    }
  });

  clientWs.on("error", (err) => {
    console.error("[Relay] Client error:", err.message);
    clientClosed = true;
    if (!upstreamClosed) {
      try { upstream.close(1011, "Client error"); } catch {}
    }
  });
});

// ═══ Start ═══

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[Relay] Listening on 0.0.0.0:${PORT}`);
  console.log(`[Relay] Upstream: ${UPSTREAM_URL}`);
  console.log(`[Relay] CORS: ${ALLOWED_ORIGINS.join(", ")}`);
});
