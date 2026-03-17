import WebSocket from 'ws';

const TOKEN = "be4d77db-2b28-4903-b097-f016d94a86bd"; // random uuid or fetch real one
const APP_ID = "ep-20250212133446-lk7px"; // I need real ones

async function testConnection() {
    // Let's get real token via API
    const res = await fetch("http://localhost:8081/api/volcengine-realtime-token");
    if (!res.ok) {
        console.error("Failed to get token", await res.text());
        return;
    }
    const { token, appId, endpoint, model } = await res.json();
    console.log("Got token", token.substring(0, 5) + "...");
    
    // test 1: ?api_key=
    const wsUrl = `${endpoint}?model=${model}&appid=${appId}&api_key=${encodeURIComponent(token)}`;
    console.log("Connecting to", wsUrl);
    
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
        console.log("TEST 1 OPEN");
        ws.close();
    });
    ws.on('error', (e) => console.log("TEST 1 ERROR", e.message));
    ws.on('close', (code, reason) => console.log("TEST 1 CLOSE", code, reason.toString()));
}

testConnection();
