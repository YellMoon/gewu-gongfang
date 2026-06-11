function filterCourses(courses, filters = {}) {
  const { filterType, filterSource, filterTeacher, filterActive } = filters;

  let result = [...courses];
  if (filterType) {
    result = result.filter(course => course.type === filterType);
  }
  if (filterSource) {
    result = result.filter(course => course.source_type === filterSource);
  }
  if (filterTeacher) {
    result = result.filter(course => course.teacher_id === filterTeacher);
  }
  if (filterActive !== undefined) {
    result = result.filter(course => course.active === filterActive);
  }
  return result;
}

module.exports = {
  filterCourses,
};
