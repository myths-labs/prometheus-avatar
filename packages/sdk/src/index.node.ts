/**
 * What `import ... from '@prometheusavatar/core'` resolves to under the "node"
 * export condition: the browser-safe entry plus MemoryBridge, exactly the surface
 * of 0.11.0–0.11.4. Bundlers that target the browser never pick this file.
 *
 * @module @prometheusavatar/core
 */

export * from './index';
export * from './node';
