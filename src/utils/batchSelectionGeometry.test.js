const assert = require('assert');

(async () => {
  const {
    SLOT_HEIGHT,
    timeToSlot,
    slotToTime,
    pointerYToAbsoluteSlot,
    selectionIntersectsSchedule,
    moveTimeBySlots,
    applyBatchScheduleDrag,
    formatBatchConflictMessage,
  } = await import('./batchSelectionGeometry.mjs');

// UTF-8: UTC projections must be selected and copied by their local calendar day.
process.env.TZ = 'Asia/Shanghai';
const cloudLesson={id:'cloud',course_name:'物理',start_time:'2026-09-07T16:30:00Z',end_time:'2026-09-07T17:30:00Z',status:1,
  calculated_tuition:180,calculated_teacher_fee:120,billing_unit:1,teacher_fee_mode:1,student_pricings:[{student_id:'student',tuition:180,teacher_fee:120}]};
const cloudBefore=JSON.stringify(cloudLesson);
const cloudCopy=applyBatchScheduleDrag({schedules:[cloudLesson],selectedIds:['cloud'],weekDates:['2026-09-07','2026-09-08','2026-09-09'],dayDelta:1,slotDelta:12,isCopy:true,generateId:()=> 'cloud-copy'});
assert.deepStrictEqual(cloudCopy.changedIds,['cloud-copy'],'ISO projections must not silently skip selected lessons');
const copiedCloud=cloudCopy.nextSchedules.find(s=>s.id==='cloud-copy');
assert.strictEqual(copiedCloud.start_time,'2026-09-08T17:30:00.000Z');
assert.strictEqual(copiedCloud.end_time,'2026-09-08T18:30:00.000Z');
assert.strictEqual(copiedCloud.calculated_tuition,180);
assert.strictEqual(copiedCloud.calculated_teacher_fee,120);
assert.deepStrictEqual(copiedCloud.student_pricings,cloudLesson.student_pricings);
assert.strictEqual(JSON.stringify(cloudLesson),cloudBefore,'copy must not rewrite its source');
const mixedConflict=applyBatchScheduleDrag({schedules:[cloudLesson,{id:'occupied',course_name:'已有课程',status:1,start_time:'2026-09-09 01:45',end_time:'2026-09-09 02:00'}],selectedIds:['cloud'],weekDates:['2026-09-08','2026-09-09'],dayDelta:1,slotDelta:12,isCopy:false});
assert.strictEqual(mixedConflict.success,false,'mixed legacy/cloud timestamps must retain overlap rejection');
const pair=[cloudLesson,{...cloudLesson,id:'second',start_time:'2026-09-08T16:30:00Z',end_time:'2026-09-08T17:30:00Z'}];
const pairBefore=JSON.stringify(pair);
const pairMove=applyBatchScheduleDrag({schedules:pair,selectedIds:['cloud','second'],
  weekDates:['2026-09-08','2026-09-09','2026-09-10','2026-09-11'],dayDelta:2,slotDelta:0,isCopy:false});
assert.deepStrictEqual(pairMove.changedIds,['cloud','second']);
assert.deepStrictEqual(pairMove.nextSchedules.map(s=>s.start_time),['2026-09-09T16:30:00.000Z','2026-09-10T16:30:00.000Z']);
assert.strictEqual(JSON.stringify(pair),pairBefore,'batch moves must not mutate input projections');
// UTF-8: the original 24:00 endpoint belongs to the end of the selected day.
for(const end of ['2026-09-08 24:00','2026-09-08T16:00:00.000Z']) {
  const midnight=applyBatchScheduleDrag({schedules:[{id:'midnight',status:1,start_time:'2026-09-08 23:00',end_time:end}],
    selectedIds:['midnight'],weekDates:['2026-09-08','2026-09-09'],dayDelta:1,slotDelta:-12,isCopy:false});
  assert.equal(midnight.nextSchedules[0].start_time,'2026-09-09T14:00:00.000Z');
  assert.equal(midnight.nextSchedules[0].end_time,'2026-09-09T15:00:00.000Z','24:00 moved earlier must remain a one-hour lesson');
}

assert.strictEqual(timeToSlot(8, 0), 0);
assert.deepStrictEqual(slotToTime(0), { hour: 8, minute: 0 });

// The day body may start before/after 8:00. Pointer coordinates are relative to
// the visible body, so they must be shifted by data-min-start-slot before being
// compared with absolute schedule slots.
assert.strictEqual(pointerYToAbsoluteSlot(0, -12), -12);
assert.strictEqual(pointerYToAbsoluteSlot(2 * SLOT_HEIGHT + 0.1, -12), -10);

// A schedule that starts exactly at the selection's lower edge is visually
// outside the rectangle and must not be selected as an extra row.
assert.strictEqual(
  selectionIntersectsSchedule({ selectionStartSlot: 0, selectionEndSlotExclusive: 24, scheduleStartSlot: 24, scheduleEndSlot: 36 }),
  false
);
assert.strictEqual(
  selectionIntersectsSchedule({ selectionStartSlot: 0, selectionEndSlotExclusive: 24, scheduleStartSlot: 23, scheduleEndSlot: 36 }),
  true
);

// Drag preview and final persisted time must apply the same slot delta to both
// start and end, preserving duration and matching the visible ghost position.
assert.deepStrictEqual(moveTimeBySlots('10:00', '12:00', -12), {
  start: { hour: 9, minute: 0 },
  end: { hour: 11, minute: 0 },
});

const schedules = [
  {
    id: 'lesson-a',
    course_name: '数学',
    start_time: '2026-06-29 10:00',
    end_time: '2026-06-29 11:00',
    status: 1,
  },
  {
    id: 'lesson-a_cpy_old',
    course_name: '旧复制课',
    start_time: '2026-06-30 14:00',
    end_time: '2026-06-30 15:00',
    status: 1,
  },
];

const copied = applyBatchScheduleDrag({
  schedules,
  selectedIds: ['lesson-a'],
  weekDates: ['2026-06-29', '2026-06-30'],
  dayDelta: 1,
  slotDelta: 0,
  isCopy: true,
  generateId: () => 'lesson-a-copy',
});

assert.strictEqual(copied.success, true);
assert.strictEqual(copied.nextSchedules.length, 3);
assert.ok(copied.nextSchedules.some(item => item.id === 'lesson-a-copy'));
assert.strictEqual(copied.nextSchedules.find(item => item.id === 'lesson-a').start_time, '2026-06-29 10:00');
assert.deepStrictEqual(copied.changedIds, ['lesson-a-copy']);

const moved = applyBatchScheduleDrag({
  schedules,
  selectedIds: ['lesson-a'],
  weekDates: ['2026-06-29', '2026-06-30'],
  dayDelta: 1,
  slotDelta: 12,
  isCopy: false,
});

assert.strictEqual(moved.success, true);
assert.strictEqual(moved.nextSchedules.find(item => item.id === 'lesson-a').start_time, '2026-06-30T03:00:00.000Z');
assert.strictEqual(moved.nextSchedules.find(item => item.id === 'lesson-a').end_time, '2026-06-30T04:00:00.000Z');
assert.deepStrictEqual(moved.changedIds, ['lesson-a']);

const conflict = applyBatchScheduleDrag({
  schedules,
  selectedIds: ['lesson-a'],
  weekDates: ['2026-06-29', '2026-06-30'],
  dayDelta: 1,
  slotDelta: 48,
  isCopy: false,
});

assert.strictEqual(conflict.success, false);
assert.strictEqual(conflict.conflictName, '旧复制课');
assert.strictEqual(formatBatchConflictMessage('旧复制课'), '时间冲突：与「旧复制课」时间段重叠，批量操作已取消');

  console.log('batchSelectionGeometry tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
