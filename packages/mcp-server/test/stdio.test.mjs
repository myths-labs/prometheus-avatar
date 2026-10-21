// The built server, started the way Claude Desktop / Claude Code / Cursor start it: a child process speaking MCP over stdio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startFakeSite } from './fake-site.mjs';

const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');
const ORIGINAL = ['create_avatar', 'set_avatar_state', 'equip_asset', 'generate_asset', 'update_asset', 'generate_image_pro', 'list_marketplace', 'get_avatar_status', 'share_avatar', 'speak'];
const WORKSPACE = ['save_work', 'upsert_task', 'complete_task', 'log_visited_page', 'prometheus_read_workspace', 'prometheus_save_workspace_entry', 'prometheus_get_workspace_operation'];

test('the built server lists all 17 tools (the original 10 untouched) and a workspace tool round-trips over stdio', async () => {
    const site = await startFakeSite({ browse: true });
    const stateDirectory = mkdtempSync(join(tmpdir(), 'k10-stdio-'));
    const transport = new StdioClientTransport({ command: process.execPath, args: [entry], stderr: 'pipe',
        env: { PROMETHEUS_API_URL: site.url, PROMETHEUS_API_KEY: site.key, PROMETHEUS_MCP_STATE_DIR: stateDirectory } });
    let banner = '';
    const client = new Client({ name: 'stdio-test', version: '0' });
    try {
        transport.stderr?.on('data', chunk => { banner += chunk; });
        await client.connect(transport);
        const { tools } = await client.listTools();
        const names = tools.map(t => t.name);
        assert.equal(names.length, 17);
        for (const name of [...ORIGINAL, ...WORKSPACE]) assert.ok(names.includes(name), `${name} is registered`);
        assert.equal(new Set(names).size, 17, 'no duplicate names');
        const result = await client.callTool({ name: 'save_work', arguments: { content: 'Over stdio', external_key: 'stdio-check' } });
        const json = JSON.parse(result.content[0].text);
        assert.deepEqual([json.saved, json.action], [true, 'created']);
        assert.equal(site.list('work')[0].content, 'Over stdio');
        const info = client.getServerVersion();
        assert.equal(info.name, 'prometheus-avatar');
        assert.equal(info.version, JSON.parse((await import('node:fs')).readFileSync(join(dirname(entry), '..', 'package.json'), 'utf8')).version);
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.match(banner, /17 tools available/, 'the start-up banner counts the real number of tools');
    } finally { await client.close(); await site.close(); rmSync(stateDirectory, { recursive: true, force: true }); }
});
