const fs = require('fs');
const path = require('path');
const { writePaperArtifact } = require('../../backend/src/services/paperArtifactService');
const { buildQuestions } = require('../../scripts/generate-formula-render-matrix');

(async () => {
  const here = __dirname;
  const captured = path.join(here, 'failed-word-native.docx');
  fs.mkdirSync(here, { recursive: true });
  try {
    await writePaperArtifact('word', {
      title: 'task13-debug',
      answerPosition: 'end',
      formulaMode: 'word-native',
    }, buildQuestions(), {
      root: path.join(here, 'store'),
      inspectVisibleArtifact(tempPath, format, manifest) {
        fs.copyFileSync(tempPath, captured);
        fs.writeFileSync(path.join(here, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        const error = new Error(`captured ${format}`);
        error.code = 'TASK13_DEBUG_CAPTURED';
        throw error;
      },
    });
  } catch (error) {
    if (error.code !== 'TASK13_DEBUG_CAPTURED') throw error;
  }
  process.stdout.write(`${captured}\n`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
