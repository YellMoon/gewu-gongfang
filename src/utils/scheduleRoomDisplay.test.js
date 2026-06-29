const assert = require('assert');

(async () => {
  const { resolveScheduleRoomDisplay } = await import('./scheduleRoomDisplay.mjs');

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

  console.log('scheduleRoomDisplay tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
