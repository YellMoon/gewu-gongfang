const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writePaperArtifact } = require('./paperArtifactService');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-paper-atomic-'));
  const tempDir = path.join(root, 'assets', 'paper-job-temp', 'job-1');
  const finalName = 'task-1_snapshot-abc.docx';
  const finalPath = path.join(root, 'assets', 'exports', finalName);
  try {
    const phases = [];
    const artifact = await writePaperArtifact('word', { title: 'atomic', answerPosition: 'hidden' }, [{ id: 'q1', stem: 'plain' }], {
      root, tempDir, finalFileName: finalName, onProgress: event => phases.push(event.phase),
      inspectVisibleArtifact: file => {
        assert.strictEqual(fs.existsSync(finalPath), false, 'final file must not exist before visible gate succeeds');
        assert.strictEqual(path.dirname(file), tempDir, 'renderer must write only into the task temp dir before the gate');
        return { sha256: 'a'.repeat(64), pageCount: null, formulaCount: 0, fallbackCount: 0, effectiveFormulaModes: [] };
      },
    });
    assert.strictEqual(artifact.fileName, finalName);
    assert.strictEqual(artifact.filePath, finalPath);
    assert.ok(fs.existsSync(finalPath));
    assert.deepStrictEqual(phases, ['rendering', 'validating', 'finalizing', 'completed']);
    assert.deepStrictEqual(fs.readdirSync(tempDir), [], 'successful atomic publish must leave no temp files');

    const controller = new AbortController(); controller.abort();
    await assert.rejects(() => writePaperArtifact('word', { title: 'cancelled' }, [{ id: 'q2', stem: 'plain' }], {
      root, tempDir, finalFileName: 'cancelled.docx', signal: controller.signal,
    }), error => error.code === 'ABORT_ERR');
    assert.strictEqual(fs.existsSync(path.join(root, 'assets', 'exports', 'cancelled.docx')), false);

    await assert.rejects(() => writePaperArtifact('word', { title: 'gate-fail' }, [{ id: 'q3', stem: 'plain' }], {
      root, tempDir, finalFileName: 'gate-fail.docx', inspectVisibleArtifact: () => { throw new Error('gate fail'); },
    }), /gate fail/);
    assert.strictEqual(fs.existsSync(path.join(root, 'assets', 'exports', 'gate-fail.docx')), false);
    assert.deepStrictEqual(fs.readdirSync(tempDir), [], 'failed atomic publish must clean temp and partial files');

    const raceController = new AbortController();
    await assert.rejects(() => writePaperArtifact('word', { title: 'cancel-after-gate' }, [{ id: 'q4', stem: 'plain' }], {
      root, tempDir, finalFileName: 'cancel-after-gate.docx', signal: raceController.signal,
      inspectVisibleArtifact: () => ({ sha256: 'b'.repeat(64), pageCount: null, formulaCount: 0, fallbackCount: 0, effectiveFormulaModes: [] }),
      faultInjection: { afterGate: () => raceController.abort() },
    }), error => error.code === 'ABORT_ERR');
    assert.strictEqual(fs.existsSync(path.join(root, 'assets', 'exports', 'cancel-after-gate.docx')), false, 'gate-after cancel must publish no final');

    await assert.rejects(() => writePaperArtifact('word', { title: 'crash-after-rename' }, [{ id: 'q5', stem: 'plain' }], {
      root, tempDir, finalFileName: 'crash-after-rename.docx',
      artifactIdentity: { artifactId: 'artifact-crash', jobKey: 'job-crash', snapshotHash: 'snapshot-crash' },
      inspectVisibleArtifact: file => ({ sha256: require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex'), pageCount: null, formulaCount: 0, fallbackCount: 0, effectiveFormulaModes: [] }),
      faultInjection: { afterRename: () => { throw Object.assign(new Error('simulated crash'), { code: 'SIMULATED_CRASH', preserveForRecovery: true }); } },
    }), error => error.code === 'SIMULATED_CRASH');
    assert.ok(fs.existsSync(path.join(root, 'assets', 'exports', 'crash-after-rename.docx')), 'rename-before-DB crash must retain final for reconciliation');
    assert.ok(fs.existsSync(path.join(root, 'assets', 'exports', 'crash-after-rename.docx.verified.json')), 'crash recovery sidecar must retain gate evidence');
    const crashSidecar = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'exports', 'crash-after-rename.docx.verified.json')));
    assert.deepStrictEqual([crashSidecar.artifactId, crashSidecar.jobKey, crashSidecar.snapshotHash], ['artifact-crash', 'job-crash', 'snapshot-crash']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('paper artifact atomic checks passed');
})().catch(error => { console.error(error); process.exit(1); });
