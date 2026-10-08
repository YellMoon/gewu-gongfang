'use strict';
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');
const ts = require('typescript');
const shared = require('./courseColors');
const source = cp.execFileSync('git', ['show', 'e84589c99b5faaa67c0c167e15253ecdc66da0f4:src/utils/courseColors.ts'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
const original = { exports: {} };
new Function('module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(original, original.exports);
const desktop = original.exports;
const rooms = [{ id: 'east', name: '东湖上课点' }, { id: 'west', name: '西区B教室' }];
const courses = [
  { id: 'one', room_id: 'east,west', color: '#000000' },
  { id: 'two', room_name: '  南区C教室, 备用地址 ' },
  { id: 'three', room_id: 'west', room_name: '旧地点' },
  { id: 'four', room_id: '', room_name: '' },
  ...Array.from({ length: 30 }, (_, index) => ({ id: 'extra-' + index, room_name: '杭州地点 ' + index })),
];
assert.deepEqual(shared.buildCourseColorMap(courses, rooms), desktop.buildCourseColorMap(courses, rooms));
assert.deepEqual(shared.autoAssignCourseColors(courses, rooms), desktop.autoAssignCourseColors(courses, rooms));
for (const color of Object.values(shared.buildCourseColorMap(courses, rooms))) {
  assert.equal(shared.getTextColorForBackground(color), desktop.getTextColorForBackground(color));
  assert.equal(shared.getBorderColorForBackground(color), desktop.getBorderColorForBackground(color));
}
assert.equal(shared.buildCourseColorMap([{ id: 'scoped', calendar_color: '#FCE4EC' }]).scoped, '#FCE4EC');
for (const invalid of ['red', '#FFF', 'url(https://example.invalid)', '#123456;background:red']) {
  assert.equal(shared.buildCourseColorMap([{ id: 'invalid', calendar_color: invalid }]).invalid, desktop.DEFAULT_COURSE_COLOR);
}
console.log('shared palette preserves original desktop sorting, room precedence, wraparound and contrast; scoped derived colors validated');
