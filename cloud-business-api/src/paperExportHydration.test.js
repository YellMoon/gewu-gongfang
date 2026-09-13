'use strict';

const assert = require('node:assert/strict');
const { renderPaperExport } = require('./paperExportRenderer');
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1kAAAAASUVORK5CYII=', 'base64');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const input = {
  format: 'word', title: 'Hydration regression', answerPosition: 'end', formulaMode: 'word-native',
  snapshot: Array.from({ length: 6 }, (_, index) => ({
    id: `hydration-${index}`, stem: `Question ${index}`, answer: '', explanation: '', options: [],
    richContent: null,
    assets: [{ assetKey: String(index).repeat(64), fileName: `${index}.png`, mimeType: 'image/png', assetType: 'image' }],
  })),
};

async function verifyHydration() {
  const failures = [];
  let active = 0;
  let peak = 0;
  const order = [];
  const rendered = await renderPaperExport(input, { resolveQuestionAsset: async asset => {
    active++;
    peak = Math.max(peak, active);
    order.push(asset.questionId);
    await delay(5);
    active--;
    return pixel;
  } });
  assert.ok(rendered.bytes.length > 0);
  assert.equal(active, 0);
  assert.deepEqual(order, input.snapshot.map(question => question.id));
  try { assert.ok(peak <= 2, `asset requests must be bounded, observed ${peak}`); } catch (error) { failures.push(error); }

  active = 0;
  const pending = Object.assign(new Error('pending'), { code: 'CLOUD_PAPER_EXPORT_MEDIA_PENDING' });
  let activeAtRejection = null;
  let started = 0;
  try {
    await renderPaperExport(input, { resolveQuestionAsset: async asset => {
      started++;
      active++;
      try {
        if (asset.questionId === 'hydration-0') { await delay(1); throw pending; }
        await delay(40);
        return pixel;
      } finally { active--; }
    } });
    assert.fail('pending media must reject the render');
  } catch (error) {
    assert.equal(error, pending);
    activeAtRejection = active;
  }
  await delay(60); // Drain the old implementation before reporting its failures.
  try { assert.equal(activeAtRejection, 0, 'worker must not defer while hydration requests are still running'); } catch (error) { failures.push(error); }
  try { assert.equal(started, input.snapshot.length, 'pending media must enqueue every remaining asset before deferring'); } catch (error) { failures.push(error); }
  const withFormula = { ...input, snapshot: input.snapshot.map((question, index) => ({
    ...question, richContent: index === 0 ? [{ type: 'formula', latex: String.raw`\unknownnativecommand{x}` }] : null,
  })) };
  for (let tick = 0; tick < 3; tick++) {
    const requested = [];
    try {
      await renderPaperExport(withFormula, { resolveQuestionAsset: async asset => {
        requested.push(asset.questionId);
        if (asset.questionId === 'hydration-5') throw pending;
        return pixel;
      } });
      assert.fail('pending media must not render');
    } catch (error) {
      try { assert.equal(error, pending, 'no formula conversion until every asset is ready'); } catch (failure) { failures.push(failure); }
    }
    try { assert.equal(requested.length, 6, 'each bounded preparation pass must reach all assets'); } catch (error) { failures.push(error); }
  }
  const broken = Object.assign(new Error('invalid media'), { code: 'CLOUD_PAPER_EXPORT_MEDIA_INVALID' });
  started = 0;
  await assert.rejects(() => renderPaperExport(input, { resolveQuestionAsset: async () => { started++; throw broken; } }), error => error === broken);
  assert.equal(started, 1, 'genuine errors still fail immediately with no detached requests');
  if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join('; '));
  console.log('paper export bounded hydration and failure drain tests passed');
}

module.exports = verifyHydration;
if (require.main === module) verifyHydration().catch(error => { console.error(error); process.exitCode = 1; });
