const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const python = path.join(root, 'runtime', 'python', process.platform === 'win32' ? 'python.exe' : 'python');
const parser = path.join(root, 'modules', 'question-bank', 'parsers', 'parse_word.py');

assert.ok(fs.existsSync(python), 'bundled Python runtime must exist');
assert.ok(fs.existsSync(parser), 'Word parser must exist');

const result = childProcess.spawnSync(python, [parser], { encoding: 'utf8', windowsHide: true });
assert.strictEqual(result.status, 1, result.stderr || result.stdout);
assert.match(result.stdout, /usage: parse_word\.py/);
assert.doesNotMatch(result.stderr, /ModuleNotFoundError/);

console.log('bundled Word parser bootstrap checks passed');
