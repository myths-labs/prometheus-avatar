// A small stand-in for the Prometheus seller-channel routes, written from the Prometheus seller-channel API contract v1.1.
// It is a test double, not the real server: it enforces the rules the clients must respect
// (headers, no browser headers, one-time key, slow_down, per-key client name, error bodies).
// The same file is copied into the plugin and MCP server tests.
import http from 'node:http';
import crypto from 'node:crypto';

const MIN_VERSION = { 'prometheus-openclaw-plugin': '0.11.0', 'prometheus-mcp-server': '0.4.0' };
const cmp = (a, b) => {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
    return 0;
};

export async function startFakeSellerServer(opts = {}) {
    const state = {
        intervalSec: opts.intervalSec ?? 5,
        startLimit: opts.startLimit ?? 3,
        startCount: 0,
        codes: new Map(),      // device_code -> record
        keys: new Map(),       // key -> record
        requests: [],          // every request: {method, path, headers, body}
        published: [],         // bodies accepted by /publish
        deployed: [],          // bodies accepted by the old API-key deploy route
        avatarStates: [],      // bodies accepted by the companion-state route
        stateRoute: opts.stateRoute ?? 'ok',   // 'ok' | 'missing' (older platform build: 404, no error code) | 'reject' (401)
        xLinked: opts.xLinked ?? true,
        dailyUsed: 0,
        dailyCap: opts.dailyCap ?? 4,
    };
    const send = (res, status, body, extra = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...extra });
        res.end(JSON.stringify(body));
    };
    const err = (res, status, error, message, fix = null, extra = {}) => send(res, status, { error, message, fix_url: fix, ...extra });

    const server = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = raw ? JSON.parse(raw) : null; } catch { return err(res, 400, 'invalid_request', 'bad json'); }
        const path = req.url.split('?')[0];
        state.requests.push({ method: req.method, path, headers: { ...req.headers }, body });

        if (req.headers.origin || req.headers['sec-fetch-site']) {
            return err(res, 403, 'CHANNEL_KEY_BROWSER_USE', 'This key cannot be used from a browser.');
        }
        // The old API-key deploy route (pak_ keys, no channel header).
        if (path === '/api/marketplace/deploy' && req.method === 'POST') {
            if (!/^Bearer pak_\w+$/.test(String(req.headers.authorization || ''))) return err(res, 401, 'UNAUTHORIZED', 'A pak_ agent key is required.');
            state.deployed.push(body);
            return send(res, 200, { success: true, asset: { id: 'legacy_1', name: body?.name, url: 'https://prometheus.mythslabs.ai/marketplace?asset=legacy_1', file_url: '', thumbnail: '' } });
        }
        // The companion-state route (pak_ key; state / emotion whitelists as on the platform).
        if (path === '/api/agent/avatar/state' && req.method === 'POST') {
            if (state.stateRoute === 'missing') { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('<html>Not Found</html>'); }
            if (state.stateRoute === 'reject' || !/^Bearer pak_\w+$/.test(String(req.headers.authorization || ''))) return err(res, 401, 'UNAUTHORIZED', 'A pak_ agent key is required.');
            const okState = !body?.state || ['listening', 'thinking', 'acting', 'done'].includes(body.state);
            const okEmotion = !body?.emotion || ['happy', 'sad', 'angry', 'surprised', 'thinking', 'neutral'].includes(body.emotion);
            if (!okState || !okEmotion || (!body?.state && !body?.emotion)) return err(res, 400, 'INVALID_STATE', 'state or emotion not allowed');
            state.avatarStates.push({ ...body, at: Date.now() });
            return send(res, 200, { avatarId: 'av_1', companionState: body });
        }
        const clientHeader = String(req.headers['x-prometheus-client'] || '');
        const m = /^([\w-]+)\/([\d.]+) \((\w+)(?: ([^)]+))?\)$/.exec(clientHeader);
        if (!m) return err(res, 400, 'CHANNEL_CLIENT_MISMATCH', 'Missing or malformed X-Prometheus-Client header.');
        const [, hName, hVersion, hRuntime, hRuntimeVersion] = m;

        if (path === '/api/channels/link/start' && req.method === 'POST') {
            if (++state.startCount > state.startLimit) return send(res, 429, { error: 'RATE_LIMITED', message: 'Too many attempts. Try again later.', fix_url: null }, { 'Retry-After': '120' });
            if (!body?.client || body.client.name !== hName || body.client.version !== hVersion) {
                return err(res, 400, 'CHANNEL_CLIENT_MISMATCH', 'Header and body client differ.');
            }
            if (cmp(hVersion, MIN_VERSION[hName] || '0.0.0') < 0) {
                return err(res, 400, 'CHANNEL_CLIENT_UNSUPPORTED', 'Update the plugin: openclaw plugins update @prometheusavatar/openclaw-plugin');
            }
            if (body.channel === 'openclaw') {
                if (!hRuntimeVersion || body.runtime?.name !== 'openclaw' || body.runtime.version !== hRuntimeVersion) {
                    return err(res, 400, 'CHANNEL_RUNTIME_UNKNOWN', 'Unknown OpenClaw version.');
                }
                if (body.evidence) return err(res, 400, 'CHANNEL_HOST_MISMATCH', 'OpenClaw does not send evidence.');
            } else if (body.channel === 'hermes') {
                const ev = body.evidence;
                if (!ev || ev.env_channel !== 'hermes' || ev.ancestor !== 'hermes' || typeof ev.ancestor_depth !== 'number' || ev.sampling_declared !== true) {
                    return err(res, 403, 'CHANNEL_HOST_MISMATCH', 'This does not look like Hermes Agent.');
                }
            } else return err(res, 400, 'CHANNEL_RUNTIME_UNKNOWN', 'Unknown channel.');
            const device_code = 'dc_' + crypto.randomBytes(12).toString('hex');
            const user_code = 'KQ7M-4TZP';
            state.codes.set(device_code, { user_code, channel: body.channel, client_name: hName, status: 'pending', lastPoll: 0, interval: state.intervalSec, claimed: false });
            return send(res, 200, { device_code, user_code, verification_uri: `https://prometheus.mythslabs.ai/link?code=${user_code}`, expires_in: 600, interval: state.intervalSec });
        }

        if (path === '/api/channels/link/token' && req.method === 'POST') {
            if (body?.grant_type && body.grant_type !== 'urn:ietf:params:oauth:grant-type:device_code') return err(res, 400, 'invalid_request', 'grant_type');
            const rec = state.codes.get(body?.device_code);
            if (!rec || rec.claimed) return err(res, 400, 'invalid_grant', 'Unknown or used code.');
            const now = Date.now();
            if (rec.status === 'expired') return err(res, 400, 'expired_token', 'Code expired.');
            if (rec.status === 'denied') return err(res, 400, 'access_denied', 'Denied.');
            if (rec.lastPoll && now - rec.lastPoll < rec.interval * 1000 * 0.9) {
                rec.interval += 5; rec.lastPoll = now;
                return err(res, 400, 'slow_down', 'Polling too fast.', null, { interval: rec.interval });
            }
            rec.lastPoll = now;
            if (rec.status === 'pending') return err(res, 400, 'authorization_pending', 'Waiting for approval.');
            rec.claimed = true;
            const key = 'pch_' + crypto.randomBytes(16).toString('hex');
            state.keys.set(key, { channel: rec.channel, client_name: rec.client_name, active: true });
            return send(res, 200, { key, key_prefix: key.slice(0, 8), channel: rec.channel, identity_type: (state.xLinked && !opts.registrationNote) ? rec.channel : null, next_step: (state.xLinked || opts.registrationNote) ? null : 'link_x', registration_note: opts.registrationNote ?? null, x_linked: state.xLinked, next_url: `https://prometheus.mythslabs.ai/dashboard#${rec.channel}`, account_hint: 'a***@example.com' });
        }

        // Bearer routes
        const auth = /^Bearer (pch_[0-9a-f]+)$/.exec(String(req.headers.authorization || ''));
        const kr = auth && state.keys.get(auth[1]);
        if (!kr || !kr.active) return err(res, 401, 'CHANNEL_KEY_INACTIVE', 'This key is no longer active. Connect again.');
        if (kr.client_name !== hName) return err(res, 403, 'CHANNEL_CLIENT_MISMATCH', 'Client does not match this key.');

        if (path === '/api/channels/whoami' && opts.whoamiMissing) { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('<html>Not Found</html>'); }   // not built yet
        if (path === '/api/channels/whoami' && req.method === 'GET') {
            return send(res, 200, {
                channel: kr.channel, client_name: kr.client_name, key_prefix: auth[1].slice(0, 8), linked_at: '2026-10-01T00:00:00Z',
                account: { identity_type: kr.channel, is_member: false, fee: { platform: 0.12, member: 0.06 } },
                x_link: { linked: state.xLinked, handle: state.xLinked ? '@seller' : null, eligible_on: null },
                today: { used: state.dailyUsed, cap: state.dailyCap }, listings: { active: state.published.length, hidden: 0 },
                suspension: null, next_url: `https://prometheus.mythslabs.ai/dashboard#${kr.channel}`,
            });
        }
        if (path === '/api/channels/publish' && req.method === 'POST') {
            if (!state.xLinked) return err(res, 403, 'CHANNEL_X_REQUIRED', 'Link your X account first.', 'https://prometheus.mythslabs.ai/dashboard#openclaw');
            if (state.dailyUsed >= state.dailyCap) return err(res, 429, 'CHANNEL_DAILY_CAP', 'Daily limit reached.');
            if (!body?.draft_asset_id && (!body?.name || !body?.category)) return err(res, 400, 'VALIDATION_ERROR', 'name and category are required');
            state.dailyUsed++;
            state.published.push(body);
            const id = 'asset_' + state.published.length;
            return send(res, 200, { success: true, asset_id: id, url: `https://prometheus.mythslabs.ai/marketplace?asset=${id}`, creator_type: kr.channel, fee: { platform: 0.12, member: 0.06 }, bonus_hold_days: opts.bonusHoldDays ?? 3 });
        }
        if (path === '/api/channels/unlink-self' && req.method === 'POST') {
            kr.active = false;
            return send(res, 200, { ok: true, channel: kr.channel, hidden: body?.hide_listings ? state.published.length : 0 });
        }
        return err(res, 404, 'NOT_FOUND', 'No such route.');
    });
    await new Promise((r) => server.listen(opts.port ?? 0, '127.0.0.1', r));
    const { port } = server.address();
    return {
        url: `http://127.0.0.1:${port}`,
        state,
        approve(userCode = 'KQ7M-4TZP') { for (const r of state.codes.values()) if (r.user_code === userCode && r.status === 'pending') r.status = 'approved'; },
        deny() { for (const r of state.codes.values()) if (r.status === 'pending') r.status = 'denied'; },
        expire() { for (const r of state.codes.values()) if (r.status === 'pending') r.status = 'expired'; },
        revokeKeys() { for (const k of state.keys.values()) k.active = false; },
        async close() { await new Promise((r) => server.close(r)); },
    };
}
