'use strict';

const { startFixtureServer } = require('./capture-miniapp-ui-matrix');

async function main() {
  const fixtureServer = await startFixtureServer();
  fixtureServer.server.ref();
  process.stdout.write(`${JSON.stringify({ ready: true, baseUrl: fixtureServer.baseUrl })}\n`);
}

main().catch((error) => {
  console.error(error && (error.stack || error.message) || String(error));
  process.exitCode = 1;
});
