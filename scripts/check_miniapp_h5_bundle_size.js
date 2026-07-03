const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'miniapp', 'dist');
const JS_DIR = path.join(DIST_DIR, 'js');
const CHUNK_DIR = path.join(DIST_DIR, 'chunk');
const APP_CSS_PATH = path.join(DIST_DIR, 'css', 'app.css');

const MAX_JS_ASSET_BYTES = 245 * 1024;
const MAX_ASYNC_CHUNK_BYTES = 130 * 1024;
const MAX_ENTRYPOINT_BYTES = 360 * 1024;

function fail(message) {
  throw new Error(`[miniapp-h5-bundle] ${message}`);
}

function listJsFiles(dir) {
  if (!fs.existsSync(dir)) fail(`missing H5 output directory: ${path.relative(ROOT_DIR, dir)}`);
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.join(dir, name));
}

function fileSize(filePath) {
  if (!fs.existsSync(filePath)) fail(`missing file: ${path.relative(ROOT_DIR, filePath)}`);
  return fs.statSync(filePath).size;
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function assertMax(label, actual, max) {
  if (actual > max) {
    fail(`${label} is ${formatKb(actual)}, budget is ${formatKb(max)}`);
  }
}

function main() {
  const initialJsFiles = listJsFiles(JS_DIR);
  const asyncChunkFiles = fs.existsSync(CHUNK_DIR) ? listJsFiles(CHUNK_DIR) : [];
  const appCssSize = fs.existsSync(APP_CSS_PATH) ? fileSize(APP_CSS_PATH) : 0;
  const entrypointBytes = initialJsFiles.reduce((sum, filePath) => sum + fileSize(filePath), 0) + appCssSize;

  for (const filePath of initialJsFiles) {
    assertMax(`initial JS ${path.relative(DIST_DIR, filePath)}`, fileSize(filePath), MAX_JS_ASSET_BYTES);
  }

  for (const filePath of asyncChunkFiles) {
    assertMax(`async chunk ${path.relative(DIST_DIR, filePath)}`, fileSize(filePath), MAX_ASYNC_CHUNK_BYTES);
  }

  assertMax('H5 app entrypoint', entrypointBytes, MAX_ENTRYPOINT_BYTES);

  console.log('miniapp H5 bundle size checks passed');
  console.log(JSON.stringify({
    entrypoint: formatKb(entrypointBytes),
    initialJs: initialJsFiles.map((filePath) => ({
      file: path.relative(DIST_DIR, filePath).replace(/\\/g, '/'),
      size: formatKb(fileSize(filePath)),
    })),
    largestAsyncChunk: asyncChunkFiles
      .map((filePath) => ({
        file: path.relative(DIST_DIR, filePath).replace(/\\/g, '/'),
        bytes: fileSize(filePath),
      }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 5)
      .map((item) => ({ file: item.file, size: formatKb(item.bytes) })),
  }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  MAX_JS_ASSET_BYTES,
  MAX_ASYNC_CHUNK_BYTES,
  MAX_ENTRYPOINT_BYTES,
};
