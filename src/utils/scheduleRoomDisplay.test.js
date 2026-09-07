const assert = require('assert');

(async () => {
  const { resolveScheduleRoomDisplay, resolveCalendarRoomDisplay } = await import('./scheduleRoomDisplay.mjs');

  const rooms = [
    { id: 'room-a-id', name: '东区A教室', address: '东区三楼' },
    { id: 'room-b-id', name: '西区B教室' },
  ];

  assert.strictEqual(
    resolveScheduleRoomDisplay({ room: 'room-a-id' }, {}, rooms),
    '东区A教室',
    'schedule room ids should render as room names'
  );

  assert.strictEqual(
    resolveScheduleRoomDisplay({ room: 'room-a-id' }, { room_id: 'room-a-id', room_name: '东区A教室' }, []),
    '东区A教室',
    'copied schedules should use the course room name while room data is not loaded'
  );

  assert.strictEqual(
    resolveScheduleRoomDisplay({}, { room_id: 'room-b-id' }, rooms),
    '西区B教室',
    'course room ids should resolve through the room list'
  );

  assert.strictEqual(
    resolveScheduleRoomDisplay({ room: '临时教室' }, {}, rooms),
    '临时教室',
    'custom room names should still display as entered'
  );

  const schedule = { id: 's1', room: '旧地址', updated_at: '2026-09-07T00:00:00.000Z' };
  const course = { id: 'c1', room_id: 'room-a-id', room_name: '东区A教室' };
  const original = JSON.stringify({ schedule, course, rooms });
  assert.strictEqual(resolveCalendarRoomDisplay(schedule, course, rooms), '东区A教室',
    'calendar must keep the original latest course address display after loading');
  assert.strictEqual(resolveCalendarRoomDisplay(schedule, { room_name: '' }, rooms), '旧地址');
  assert.strictEqual(resolveCalendarRoomDisplay({ room: 'room-b-id' }, {}, rooms), '西区B教室');
  assert.strictEqual(resolveScheduleRoomDisplay(schedule, course, rooms), '旧地址',
    'do not change address snapshot semantics outside the calendar');
  assert.strictEqual(JSON.stringify({ schedule, course, rooms }), original,
    'display derivation must not alter records or their version baseline');
  console.log('scheduleRoomDisplay tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
