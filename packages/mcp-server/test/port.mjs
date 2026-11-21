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

// Each website takes the port after the one the previous website of this process used, so a website that was shut down a moment
// ago (its sockets may still be on their way out, for example after a request the client gave up on) is not met again by the next
// test's first request on the very same port.
let nextIndex = 0;

/** Listen on `ports` (first free one, starting after the last one used by this process, wins); wait and try again while all of them are busy. */
export async function listenOnFreePort(server, { ports = TEST_PORT_RANGE, waitMs = 120_000 } = {}) {
    const deadline = Date.now() + waitMs;
    for (;;) {
        for (let step = 0; step < ports.length; step++) {
            const index = (nextIndex + step) % ports.length, port = ports[index];
            try { await tryListen(server, port); nextIndex = (index + 1) % ports.length; return port; }
            catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
        }
        if (Date.now() > deadline) throw new Error(`no free port among ${ports.join(', ')}: they are reserved for the K10 fake website`);
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}
