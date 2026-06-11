const assert = require('assert');
const { filterCourses } = require('./courseFilters');

const CourseType = {
  ONE_ON_ONE: 1,
  GROUP: 3,
};

const CourseSourceType = {
  SELF: 1,
  INSTITUTION: 2,
};

const courses = [
  {
    id: 'active-match',
    type: CourseType.ONE_ON_ONE,
    source_type: CourseSourceType.SELF,
    teacher_id: 'teacher-a',
    active: true,
  },
  {
    id: 'ended-same-filters',
    type: CourseType.ONE_ON_ONE,
    source_type: CourseSourceType.SELF,
    teacher_id: 'teacher-a',
    active: false,
  },
  {
    id: 'active-other-type',
    type: CourseType.GROUP,
    source_type: CourseSourceType.SELF,
    teacher_id: 'teacher-a',
    active: true,
  },
  {
    id: 'active-other-source',
    type: CourseType.ONE_ON_ONE,
    source_type: CourseSourceType.INSTITUTION,
    teacher_id: 'teacher-a',
    active: true,
  },
  {
    id: 'active-other-teacher',
    type: CourseType.ONE_ON_ONE,
    source_type: CourseSourceType.SELF,
    teacher_id: 'teacher-b',
    active: true,
  },
];

const activeFiltered = filterCourses(courses, {
  filterType: CourseType.ONE_ON_ONE,
  filterSource: CourseSourceType.SELF,
  filterTeacher: 'teacher-a',
  filterActive: true,
});

assert.deepStrictEqual(
  activeFiltered.map(course => course.id),
  ['active-match'],
  'active status must combine with type/source/teacher filters'
);

const statusAgnosticFiltered = filterCourses(courses, {
  filterType: CourseType.ONE_ON_ONE,
  filterSource: CourseSourceType.SELF,
  filterTeacher: 'teacher-a',
  filterActive: undefined,
});

assert.deepStrictEqual(
  statusAgnosticFiltered.map(course => course.id),
  ['active-match', 'ended-same-filters'],
  'undefined active filter must not exclude ended courses'
);

console.log('courseFilters tests passed');
