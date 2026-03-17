import WebSocket from 'ws';
async function test() {
    try {
        const res = await fetch("http://localhost:8081/api/volcengine-realtime-token");
        if (!res.ok) throw new Error("Fetch failed: " + await res.text());
        const { token, appId, endpoint, model } = await res.json();

        console.log("Testing ?api_key=...")
        const ws1 = new WebSocket(`${endpoint}?model=${model}&appid=${appId}&api_key=${encodeURIComponent(token)}`);
        ws1.on('open', () => { console.log('✅ ws1 (api_key) OPEN'); ws1.close(); });
        ws1.on('error', (e) => console.log('❌ ws1 ERROR', e.message));
        ws1.on('close', (c, r) => console.log('❌ ws1 CLOSE', c, r?.toString()));

        console.log("Testing ?authorization=Bearer...")
        const ws2 = new WebSocket(`${endpoint}?model=${model}&appid=${appId}&authorization=Bearer%20${encodeURIComponent(token)}`);
        ws2.on('open', () => { console.log('✅ ws2 (authorization) OPEN'); ws2.close(); });
        ws2.on('error', (e) => console.log('❌ ws2 ERROR', e.message));
        ws2.on('close', (c, r) => console.log('❌ ws2 CLOSE', c, r?.toString()));

        console.log("Testing subprotocol...")
        const ws3 = new WebSocket(`${endpoint}?model=${model}&appid=${appId}`, [
            "realtime",
            `openai-insecure-api-key.${token}`,
            "openai-beta.realtime-v1"
        ]);
        ws3.on('open', () => { console.log('✅ ws3 (subprotocols) OPEN'); ws3.close(); });
        ws3.on('error', (e) => console.log('❌ ws3 ERROR', e.message));
        ws3.on('close', (c, r) => console.log('❌ ws3 CLOSE', c, r?.toString()));
    } catch (e) {
        console.error(e);
    }
}
test();
