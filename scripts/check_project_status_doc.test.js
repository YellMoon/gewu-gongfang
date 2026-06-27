const assert = require('assert');
const fs = require('fs');
const path = require('path');

const STATUS_DOC = path.join(process.cwd(), 'docs/project-status-2026-06-27.md');

assert.ok(fs.existsSync(STATUS_DOC), 'current project status document should exist');

const doc = fs.readFileSync(STATUS_DOC, 'utf-8');

for (const required of [
  '阿里云后端',
  '微信小程序',
  '等待审核',
  '本地数据主机',
  '移动硬盘题库',
  'NAS 备份',
  '离线同步',
  '权限边界',
  '不打包',
  '不上传夸克网盘',
  'gewu/master',
]) {
  assert.ok(doc.includes(required), `status document should mention: ${required}`);
}

assert.ok(doc.includes('5.0.34'), 'status document should record current deployed/uploaded version');
assert.ok(doc.includes('I:/GewuQuestionBank'), 'status document should record active question bank path');
assert.ok(doc.includes('\\\\192.168.124.2\\lin1225_存储空间1'), 'status document should record NAS backup share');
assert.ok(doc.includes('https://physicsedu.xyz/scheduling'), 'status document should record cloud API base URL');
assert.ok(doc.includes('发布线上版'), 'status document should describe the next action after miniapp approval');

console.log('project status document checks passed');
