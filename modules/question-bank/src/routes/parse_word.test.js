const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const express = require('express');

const parseWordRouter = require('./parse_word');

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-parse-word-route-'));
  const docxPath = path.join(tempDir, 'formula.docx');
  const python = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
  const create = spawnSync(python, [
    '-c',
    [
      'from docx import Document',
      'from docx.oxml import OxmlElement, parse_xml',
      'from docx.oxml.ns import qn',
      'import sys',
      'd=Document()',
      'p=d.add_paragraph(style="List Number")',
      'n=OxmlElement("w:numPr")',
      'i=OxmlElement("w:ilvl"); i.set(qn("w:val"), "0")',
      'v=OxmlElement("w:numId"); v.set(qn("w:val"), "5")',
      'n.extend([i,v]); p._p.get_or_add_pPr().append(n)',
      'p.add_run("Route formula ")',
      'p._p.append(parse_xml("<m:oMath xmlns:m=\\"http://schemas.openxmlformats.org/officeDocument/2006/math\\"><m:r><m:t>x</m:t></m:r></m:oMath>"))',
      'd.save(sys.argv[1])',
    ].join(';'),
    docxPath,
  ], { encoding: 'utf8' });
  assert.strictEqual(create.status, 0, create.stderr);

  const app = express();
  app.use('/parse-word', parseWordRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const form = new FormData();
    form.append('source_type', 'lecture');
    form.append('file', new Blob([fs.readFileSync(docxPath)]), 'formula.docx');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/parse-word`, { method: 'POST', body: form });
    const result = await response.json();
    assert.strictEqual(response.status, 200, JSON.stringify(result));
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.quality_report.formula_import.total, 1);
    assert.deepStrictEqual(result.quality_report.formula_import.by_source, { omml: 1 });
    assert.ok(Array.isArray(result.quality_report.formula_import.issues));
    assert.strictEqual(result.questions[0].rich_content.sections.stem.content[0].content.find((node) => node.type === 'formula').attrs.canonicalLatex, 'x');

    const originalPythonBin = process.env.PYTHON_BIN;
    process.env.PYTHON_BIN = path.join(tempDir, 'missing-python-binary.exe');
    try {
      const invalidForm = new FormData();
      invalidForm.append('source_type', 'lecture');
      invalidForm.append('file', new Blob([fs.readFileSync(docxPath)]), 'formula.docx');
      const invalidResponse = await fetch(`http://127.0.0.1:${server.address().port}/parse-word`, { method: 'POST', body: invalidForm });
      assert.strictEqual(invalidResponse.status, 500);
      await invalidResponse.json();
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      if (originalPythonBin === undefined) delete process.env.PYTHON_BIN;
      else process.env.PYTHON_BIN = originalPythonBin;
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  console.log('parse_word route integration test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
