// Ports for the local fake website. The desktop line may only use 3480-3499 and 54860-54869 for this package:
//
//  - 3486 is the K10 fake website. The by-hand end-to-end run (test/e2e-evidence.mjs) uses it.
//  - 54860-54869 are for `npm test`: node --test runs the test files in parallel processes and each test starts its
//    own fake website, so they need to coexist. Each server takes the first free port of the range and gives it back
//    when the test is done.
//
// Nothing here ever kills a process that holds a port: a busy port is simply skipped, and if every port stays busy
// for `waitMs` the test fails with a message that says so.
export const E2E_PORT = 3486;
export const TEST_PORT_RANGE = Array.from({ length: 10 }, (_, index) => 54860 + index);

function tryListen(server, port) {
    return new Promise((resolve, reject) => {
        const onError = error => { server.off('listening', onListening); reject(error); };
        const onListening = () => { server.off('error', onError); resolve(); };
        server.once('error', onError); server.once('listening', onListening);
        server.listen(port, '127.0.0.1');
    });
}

/** Listen on `ports` (first free one wins); wait and try again while all of them are busy. */
export async function listenOnFreePort(server, { ports = TEST_PORT_RANGE, waitMs = 120_000 } = {}) {
    const deadline = Date.now() + waitMs;
    for (;;) {
        for (const port of ports) {
            try { await tryListen(server, port); return port; }
            catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
        }
        if (Date.now() > deadline) throw new Error(`no free port among ${ports.join(', ')}: they are reserved for the K10 fake website`);
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}
