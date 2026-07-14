const { parentPort, workerData } = require('worker_threads');
const sharp = require('sharp');
const { latexToMathml, renderLatexSvg } = require('./formulaExportService');

(async () => {
  const { latex, display, limits } = workerData;
  if (workerData.task === 'mathml') {
    parentPort.postMessage({ mathml: latexToMathml(latex) });
    return;
  }
  const rendered = renderLatexSvg(latex, display);
  if (!(rendered.width > 0 && rendered.height > 0) || rendered.width > limits.width || rendered.height > limits.height) {
    throw Object.assign(new Error('formula render bounds exceed limit'), { code: 'FORMULA_RENDER_BOUNDS_LIMIT_EXCEEDED' });
  }
  const scale = Math.min(2, Math.sqrt(limits.rasterPixels / (rendered.width * rendered.height)));
  const target = { width: Math.max(1, Math.floor(rendered.width * scale)), height: Math.max(1, Math.floor(rendered.height * scale)) };
  if (target.width * target.height > limits.rasterPixels) throw Object.assign(new Error('formula raster pixel budget exceeded'), { code: 'FORMULA_RASTER_PIXEL_LIMIT_EXCEEDED' });
  const png = await sharp(Buffer.from(rendered.svg)).resize(target.width, target.height, { fit: 'fill' }).png().toBuffer();
  parentPort.postMessage({ ...rendered, png, target });
})().catch(error => parentPort.postMessage({ error: { code: error.code || 'FORMULA_RENDER_FAILED', message: error.message } }));
