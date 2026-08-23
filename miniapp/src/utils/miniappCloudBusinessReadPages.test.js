'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const pages = [
  ['pages/students/index.tsx', 'studentApi'],
  ['pages/courses/index.tsx', 'courseApi'],
  ['pages/teachers/index.tsx', 'teacherApi'],
  ['pages/payments/index.tsx', 'paymentApi'],
  ['pages/schedule/index.tsx', 'scheduleApi'],
  ['pages/student-detail/index.tsx', 'studentApi'],
  ['pages/schedule/detail/index.tsx', 'scheduleApi'],
  ['pages/stats/index.tsx', 'statsApi'],
];

for (const [relativePath, retiredApi] of pages) {
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  assert.match(source, /pullFromCloudBusinessProjection/, `${relativePath} must refresh only from the cloud-scoped business projection`);
  assert.ok(!source.includes(retiredApi), `${relativePath} must not call the retired local-backend ${retiredApi}`);
}

console.log('miniapp cloud business read-page checks passed');
