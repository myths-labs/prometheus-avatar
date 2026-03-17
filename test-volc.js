const WebSocket = require('ws');
async function test() {
    const wsUrl = "wss://ai-gateway.vei.volces.com/v1/realtime?model=ep-20250212133446-lk7px&appid=fakeapp&authorization=Bearer%20be4d77db-2b28-4903-b097-f016d94a86bd";
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => console.log('✅ OPEN'));
    ws.on('error', (e) => console.log('❌ ERROR', e.message));
    ws.on('close', (c, r) => console.log('❌ CLOSE', c, r.toString()));
}
test();
