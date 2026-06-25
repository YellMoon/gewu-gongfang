const { Router } = require('express');
const { getInstance } = require('../database');
const {
  publishHeartbeat,
  publishSnapshot,
  fetchPendingTasks,
} = require('../services/cloudRelayClient');

const router = Router();

function hostDeviceId() {
  return process.env.GEWU_DEVICE_ID || 'unknown';
}

function buildSnapshotPayload(db) {
  if (typeof db.exportAllData === 'function') return db.exportAllData();

  return {
    students: typeof db.getAllStudents === 'function' ? db.getAllStudents() : [],
    courses: typeof db.getAllCourses === 'function' ? db.getAllCourses() : [],
    schedules: typeof db.getAllSchedules === 'function' ? db.getAllSchedules() : [],
    teachers: typeof db.getAllTeachers === 'function' ? db.getAllTeachers() : [],
    rooms: typeof db.getAllRooms === 'function' ? db.getAllRooms() : [],
    schools: typeof db.getAllSchools === 'function' ? db.getAllSchools() : [],
    institutions: typeof db.getAllInstitutions === 'function' ? db.getAllInstitutions() : [],
  };
}

router.post('/heartbeat', async (_req, res, next) => {
  try {
    const result = await publishHeartbeat({
      hostDeviceId: hostDeviceId(),
      status: 'online',
      baseUrl: process.env.GEWU_HOST_BASE_URL || '',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/snapshot', async (_req, res, next) => {
  try {
    const db = getInstance();
    const result = await publishSnapshot({
      snapshotType: 'full',
      payload: buildSnapshotPayload(db),
      sourceDeviceId: hostDeviceId(),
      version: new Date().toISOString(),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/tasks/pending', async (_req, res, next) => {
  try {
    const result = await fetchPendingTasks();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
