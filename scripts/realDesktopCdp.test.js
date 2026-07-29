'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { waitForSocketClose, readReplacementCdpPort } = require('./realDesktopCdp');

async function main() {
  const alreadyClosed = new EventEmitter();
  alreadyClosed.readyState = 3;
  await Promise.race([
    waitForSocketClose(alreadyClosed),
    new Promise((_, reject) => setTimeout(() => reject(new Error('ALREADY_CLOSED_SOCKET_HUNG')), 100)),
  ]);

  const closing = new EventEmitter();
  closing.readyState = 2;
  const done = waitForSocketClose(closing);
  setImmediate(() => closing.emit('close'));
  await done;

  const stuck = new EventEmitter();
  stuck.readyState = 1;
  await Promise.race([
    waitForSocketClose(stuck, 20),
    new Promise((_, reject) => setTimeout(() => reject(new Error('STUCK_SOCKET_CLOSE_HUNG')), 100)),
  ]);

  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-cdp-port-'));
  try {
    fs.writeFileSync(path.join(profileRoot, 'DevToolsActivePort'), '45211\n/devtools/browser/test\n', 'utf8');
    assert.strictEqual(readReplacementCdpPort(profileRoot, 45210), 45211);
    assert.strictEqual(readReplacementCdpPort(profileRoot, 45211), null);
  } finally {
    fs.rmSync(profileRoot, { recursive: true, force: true });
  }
  const source = fs.readFileSync(path.join(__dirname, 'realDesktopCdp.js'), 'utf8');
  assert(!source.includes("await send('Runtime.enable');"),
    'CDP_CONNECT_MUST_NOT_WAIT_FOR_OPTIONAL_RUNTIME_ENABLE');
  assert(source.includes("await send('Runtime.evaluate'"),
    'CDP_EVALUATE_COMMAND_REQUIRED');
  console.log('real desktop CDP close lifecycle tests passed');
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
