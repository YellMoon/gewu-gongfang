'use strict';
// Load the same TypeScript module that both calendar clients import.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { createRequire } = require('node:module');
const sourcePath = path.resolve(__dirname, '../../../../src/utils/courseColors.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} };
new Function('require', 'module', 'exports', compiled)(createRequire(sourcePath), m, m.exports);
module.exports = m.exports;
