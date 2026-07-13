const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EXPECTED_SHA256 = '631d6bfb41b2606837ee91488161917da7b5a700333b1e66c1ce05c74cd9dfdb';
const projectRoot = path.join(__dirname, '..');
const sourcePath = process.argv[2] || path.join(process.env.USERPROFILE || '', 'Desktop', '组卷导出模板.docx');
const targetPath = path.join(projectRoot, 'backend', 'resources', 'paper', 'default-paper-template.docx');

if (!fs.existsSync(sourcePath)) throw new Error(`template source not found: ${sourcePath}`);
const bytes = fs.readFileSync(sourcePath);
const actual = crypto.createHash('sha256').update(bytes).digest('hex');
if (actual !== EXPECTED_SHA256) throw new Error(`template SHA256 mismatch: expected ${EXPECTED_SHA256}, got ${actual}`);
fs.mkdirSync(path.dirname(targetPath), { recursive: true });
fs.writeFileSync(targetPath, bytes);
const imported = crypto.createHash('sha256').update(fs.readFileSync(targetPath)).digest('hex');
if (imported !== EXPECTED_SHA256) throw new Error(`import verification failed: ${imported}`);
console.log(`Imported default paper template (${imported})`);
