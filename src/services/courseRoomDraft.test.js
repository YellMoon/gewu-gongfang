// UTF-8. Execute the actual cache methods; no production data or network writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync(require('node:path').join(__dirname, 'browserDatabase.ts'), 'utf8');
const ast = ts.createSourceFile('browserDatabase.ts', source, ts.ScriptTarget.Latest, true);
const methods = [];
const names = ['createCourse', 'updateCourse', 'addOrUpdateRoom', 'resolveCourseDraftRoom', 'recordAuthorityDraftBatch'];
function visit(n) { if (ts.isMethodDeclaration(n) && names.includes(n.name.getText(ast))) methods.push(n.getText(ast)); ts.forEachChild(n, visit); }
visit(ast);
const bridge = { desktopAuthority: { appendDraftBatchSync() { throw new Error('TEST_PERSIST_FAILED'); } } };
const Cache = new Function('window', 'createAuthorityDraftFromLocalMutation', ts.transpileModule(`class Cache {${methods.join('\n')}}; return Cache;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(bridge, value => value);
function setup(rooms = [], courses = []) {
  const cache = new Cache(); let seq = 0; const calls = [];
  cache.data = structuredClone({ rooms, courses });
  cache.generateId = () => `generated-${++seq}`;
  cache.saveData = () => calls.push({ kind: 'save' });
  cache.recordAuthorityDraft = (collection, action, recordId, value, baseVersion) => calls.push({ kind: 'single', changes: structuredClone([{ collection, action, recordId, value, baseVersion }]) });
  cache.recordAuthorityDraftBatch = changes => calls.push({ kind: 'batch', changes: structuredClone(changes) });
  return { cache, calls };
}
const room = { id: 'room-existing', name: 'Shared classroom', updated_at: '2026-09-07T00:00:00Z', count: 1 };
const original = { id: 'course-old', name: 'Physics', room_id: room.id, room_name: room.name, updated_at: '2026-09-07T00:00:00Z' };
for (const edit of [false, true]) {
  const { cache, calls } = setup([], edit ? [original] : []);
  const input = { name: 'Physics', room_id: 'New classroom', room_name: 'New classroom' };
  const snapshot = structuredClone(input);
  const course = edit ? cache.updateCourse(original.id, input) : cache.createCourse(input);
  assert.equal(course.room_id, cache.data.rooms[0].id, 'course must reference generated room ID, not address text');
  assert.equal(course.room_name, 'New classroom');
  assert.deepEqual(input, snapshot, 'caller form must not be mutated');
  assert.deepEqual(calls.map(c => c.kind), ['batch', 'save'], 'room and course must persist as one encrypted batch before cache save');
  assert.deepEqual(calls[0].changes.map(c => [c.collection, c.action]), [['rooms', 'create'], ['courses', edit ? 'update' : 'create']]);
  assert.equal(calls[0].changes[1].value.room_id, calls[0].changes[0].recordId);
  if (edit) assert.equal(calls[0].changes[1].baseVersion, original.updated_at);
}
for (const roomInput of [room.id, room.name]) {
  const { cache, calls } = setup([room]);
  const course = cache.createCourse({ name: 'Physics', room_id: roomInput, room_name: room.name });
  assert.equal(course.room_id, room.id);
  assert.deepEqual(cache.data.rooms, [room], 'reuse must not create duplicate address or update its version/count');
  assert.deepEqual(calls.map(c => c.kind), ['single', 'save']);
}
const { cache, calls } = setup([room], [original]);
assert.equal(cache.updateCourse('missing', { room_name: 'Unused address' }), undefined);
assert.equal(calls.length, 0);
assert.equal(cache.data.rooms.length, 1);
assert.equal(cache.updateCourse(original.id, { active: false }).room_id, room.id);
for (const updates of [{ room_name: 'New classroom' }, { room_id: room.id, room_name: 'Stale label' }]) {
  const { cache } = setup([room], [original]);
  const updated = cache.updateCourse(original.id, updates);
  assert.equal(updated.room_name, updates.room_id ? room.name : 'New classroom');
  assert.equal(updated.room_id, updates.room_id || cache.data.rooms[1].id);
}
for (const edit of [false, true]) {
  const { cache, calls } = setup([room], edit ? [original] : []);
  const before = structuredClone(cache.data);
  cache.authorityCacheCheckpoint = require('./authorityCacheCheckpoint.mjs').createAuthorityCacheCheckpoint(before);
  cache.restoreAuthorityCacheCheckpoint = restored => { cache.data = restored; };
  cache.recordAuthorityDraftBatch = Cache.prototype.recordAuthorityDraftBatch;
  const input = { room_id: 'New classroom', room_name: 'New classroom' };
  assert.throws(() => edit ? cache.updateCourse(original.id, input) : cache.createCourse(input), /TEST_PERSIST_FAILED/);
  assert.deepEqual(cache.data, before, 'failed encrypted batch must restore both address and course');
  assert.equal(calls.length, 0, 'failed draft persistence must not save changed cache');
}
console.log('course inline-room draft identity and atomic capture checks passed');
