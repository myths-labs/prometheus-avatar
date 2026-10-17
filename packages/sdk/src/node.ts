/**
 * Node-only entry: `@prometheusavatar/core/node`
 *
 * MemoryBridge uses `fs`, `path`, `events` and `ws`, so it is kept out of the
 * browser-safe main entry. Import it from here:
 *
 *   import { MemoryBridge } from '@prometheusavatar/core/node';
 *
 * (Running under Node, `@prometheusavatar/core` itself still exports it for
 * backwards compatibility with 0.11.0–0.11.4; see src/index.node.ts.)
 *
 * @module @prometheusavatar/core/node
 */

export { MemoryBridge, MEMORY_BRIDGE_DEFAULT_ORIGINS } from './memory-bridge';
export type { MemoryBridgeOptions, ConversationMessage, MemoryBridgeMessage } from './memory-bridge';
