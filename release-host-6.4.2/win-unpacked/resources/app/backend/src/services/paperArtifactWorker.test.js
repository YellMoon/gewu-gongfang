const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runPaperArtifactWorker } = require('./paperArtifactWorker');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-paper-worker-'));
  const finalPath = path.join(root, 'late.pdf');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(Object.assign(new Error('deadline'), { code: 'PAPER_JOB_DEADLINE_EXCEEDED' })), 30);
  try {
    await assert.rejects(() => runPaperArtifactWorker({
      workerPath: path.join(__dirname, 'paperArtifactWorker.fixture.js'),
      workerData: { syncRenderMs: 100, finalPath },
      signal: controller.signal,
    }), error => error.code === 'PAPER_JOB_DEADLINE_EXCEEDED');
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.strictEqual(fs.existsSync(finalPath), false, 'a terminated synchronous renderer must never publish after the absolute deadline');
  } finally {
    clearTimeout(timer);
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('paper artifact worker deadline checks passed');
})().catch(error => { console.error(error); process.exit(1); });
