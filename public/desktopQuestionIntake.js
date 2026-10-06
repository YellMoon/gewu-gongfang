'use strict';
const fs = require('fs'), path = require('path');
const { createQuestionImportParser } = require('../shared/questionImportParser');

function createDesktopQuestionIntake({ appRoot, workRoot, pythonBin } = {}) {
  const parserPath = path.join(appRoot, 'modules', 'question-bank', 'parsers', 'parse_word.py');
  const bundledPython = pythonBin || path.join(appRoot, 'runtime', 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3');
  if (!fs.existsSync(bundledPython)) throw new Error('QUESTION_INTAKE_PYTHON_UNAVAILABLE');
  fs.mkdirSync(workRoot, { recursive: true, mode: 0o700 });
  const parser = createQuestionImportParser({ workRoot, parserPath, pythonBin: bundledPython });
  return Object.freeze({
    async parse(input) {
      if (!input || typeof input !== 'object' || Object.keys(input).sort().join(',') !== 'bytes,sourceFileName,sourceType'
        || !(input.bytes instanceof Uint8Array) || input.bytes.length < 1 || input.bytes.length > 64 * 1024 * 1024
        || typeof input.sourceFileName !== 'string' || input.sourceFileName.length > 512 || /[\\/\u0000\r\n]/.test(input.sourceFileName)) {
        throw new Error('QUESTION_IMPORT_PARSE_INPUT_INVALID');
      }
      if (/\.doc$/iu.test(input.sourceFileName) && (input.bytes[0] !== 0x50 || input.bytes[1] !== 0x4b)) {
        throw new Error('QUESTION_INTAKE_DOC_CONVERSION_REQUIRED');
      }
      return parser.parse({ ...input, bytes: Buffer.from(input.bytes) });
    },
  });
}
module.exports = { createDesktopQuestionIntake };
