'use strict';

const fs = require('fs');
const path = require('path');

const requiredFiles = ['index.html', 'asset-manifest.json'];

function assertRendererBuildReady(buildDir) {
  const missing = requiredFiles.filter(file => {
    const filePath = path.join(buildDir, file);
    return !fs.existsSync(filePath) || fs.statSync(filePath).size <= 0;
  });
  if (missing.length > 0) {
    throw new Error(`Renderer build is incomplete: ${missing.join(', ')}`);
  }
  return true;
}

async function waitForRendererBuild(buildDir, timeoutMs = 240000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return assertRendererBuildReady(buildDir);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for renderer build after ${timeoutMs}ms: ${lastError?.message || 'unknown error'}`);
}

async function main() {
  const buildDir = path.resolve(process.argv[2] || path.join(process.cwd(), 'build'));
  await waitForRendererBuild(buildDir);
  console.log(`renderer build ready: ${buildDir}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { assertRendererBuildReady, waitForRendererBuild };
