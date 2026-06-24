import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';

dayjs.extend(isoWeek);

const WEEK_DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const SLOT_DURATION_MINUTES = 5;
const DEFAULT_MIN_HOUR = 8;
const DEFAULT_MAX_HOUR = 23;

function cleanName(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}

function sanitizeFilePart(value) {
  return cleanName(value, '未命名').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
}

function sanitizeExcelSheetName(value) {
  const cleaned = cleanName(value, '课表').replace(/[\\/?*:[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 31) || '课表';
}

function getTeacherName(teacherId, teachers) {
  const found = teachers.find(item => String(item.id) === String(teacherId));
  return found ? found.name : '';
}

function getStudentName(studentId, students) {
  const found = students.find(item => String(item.id) === String(studentId));
  return found ? found.name : '';
}

function getCourseStudents(course, students) {
  const ids = (course && course.student_ids) || (course && course.student_pricings && course.student_pricings.map(item => item.student_id)) || [];
  return ids.map(id => getStudentName(id, students)).filter(Boolean);
}

function getScheduleCourse(schedule, courses) {
  return courses.find(item => String(item.id) === String(schedule.course_id));
}

function timeToSlot(timeText) {
  const parts = String(timeText || '00:00').split(':').map(Number);
  const hour = parts[0];
  const minute = parts[1] || 0;
  return Math.floor(((hour - DEFAULT_MIN_HOUR) * 60 + minute) / SLOT_DURATION_MINUTES);
}

function slotToTimeLabel(slot) {
  const totalMinutes = DEFAULT_MIN_HOUR * 60 + slot * SLOT_DURATION_MINUTES;
  const hour = Math.floor(totalMinutes / 60);
  const minute = ((totalMinutes % 60) + 60) % 60;
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

function dateRangeFromSchedules(schedules) {
  if (!schedules.length) return [dayjs(), dayjs()];
  const sorted = schedules
    .map(item => dayjs(item.start_time))
    .filter(item => item.isValid())
    .sort((a, b) => a.valueOf() - b.valueOf());
  return [sorted[0] || dayjs(), sorted[sorted.length - 1] || dayjs()];
}

function isCancelledOrLeave(schedule) {
  return schedule.status === 'CANCELLED' || schedule.status === 'LEAVE' || schedule.status === 2 || schedule.status === 3;
}

function buildScheduleExportModel(input) {
  const schedules = input.schedules || [];
  const courses = input.courses || [];
  const teachers = input.teachers || [];
  const students = input.students || [];
  const filterTeacher = input.filterTeacher;
  const filterStudent = input.filterStudent;
  const courseColorMap = input.courseColorMap || {};
  const fallbackRange = dateRangeFromSchedules(schedules);
  const rangeStart = dayjs((input.dateRange && input.dateRange[0]) || fallbackRange[0]).startOf('day');
  const rangeEnd = dayjs((input.dateRange && input.dateRange[1]) || fallbackRange[1]).endOf('day');

  const teacherName = filterTeacher ? getTeacherName(filterTeacher, teachers) : '全部老师';
  const studentName = filterStudent ? getStudentName(filterStudent, students) : '全部学生';
  const dateLabel = rangeStart.format('YYYYMMDD') + '-' + rangeEnd.format('YYYYMMDD');
  const fileName = sanitizeFilePart(teacherName) + '_' + sanitizeFilePart(studentName) + '_' + dateLabel + '_课表.xlsx';
  const sheetName = sanitizeExcelSheetName(teacherName + ' ' + studentName + ' ' + dateLabel + '课表');

  const firstMonday = rangeStart.startOf('isoWeek');
  const lastMonday = rangeEnd.startOf('isoWeek');
  const weeks = [];
  let cursor = firstMonday;
  while (cursor.valueOf() <= lastMonday.valueOf()) {
    const weekStart = cursor;
    const weekEnd = cursor.add(6, 'day');
    const weekSchedules = schedules
      .filter(schedule => {
        const start = dayjs(schedule.start_time);
        return start.isValid() && start.valueOf() >= weekStart.startOf('day').valueOf() && start.valueOf() <= weekEnd.endOf('day').valueOf();
      })
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

    let dynMinHour = DEFAULT_MIN_HOUR;
    let dynMaxHour = DEFAULT_MAX_HOUR;
    weekSchedules.filter(item => !isCancelledOrLeave(item)).forEach(schedule => {
      const startTime = String(schedule.start_time).split(' ')[1] || '';
      const endTime = String(schedule.end_time).split(' ')[1] || '';
      const startParts = startTime.split(':').map(Number);
      const endParts = endTime.split(':').map(Number);
      const startHour = startParts[0] + (startParts[1] || 0) / 60;
      const endHour = endParts[0] + (endParts[1] || 0) / 60;
      if (Number.isFinite(startHour) && startHour < dynMinHour) dynMinHour = Math.floor(startHour);
      if (Number.isFinite(endHour) && endHour > dynMaxHour) dynMaxHour = Math.ceil(endHour);
    });

    const minSlot = timeToSlot(String(dynMinHour).padStart(2, '0') + ':00');
    const maxSlot = timeToSlot(String(dynMaxHour).padStart(2, '0') + ':00');
    const coursesForWeek = weekSchedules.map(schedule => {
      const course = getScheduleCourse(schedule, courses);
      const start = dayjs(schedule.start_time);
      const end = dayjs(schedule.end_time);
      const startLabel = start.format('HH:mm');
      const endLabel = end.format('HH:mm');
      const title = schedule.course_name || (course && (course.display_name || course.name)) || '课程';
      const room = schedule.room || (course && course.room_name) || '';
      const lines = [title];
      const meta = filterStudent ? startLabel + '-' + endLabel : [room, startLabel + '-' + endLabel].filter(Boolean).join(' ');
      if (meta) lines.push(meta);
      return {
        id: schedule.id,
        dayIndex: Math.max(0, Math.min(6, start.isoWeekday() - 1)),
        startSlot: timeToSlot(startLabel),
        endSlot: timeToSlot(endLabel),
        rowOffset: timeToSlot(startLabel) - minSlot,
        rowSpan: Math.max(1, timeToSlot(endLabel) - timeToSlot(startLabel)),
        displayLines: lines,
        color: courseColorMap[schedule.course_id] || (course && course.color) || '#F5F7FA',
        textColor: '#1f1f1f',
        teacherName: course ? getTeacherName(course.teacher_id, teachers) : '',
        studentNames: getCourseStudents(course, students),
        status: schedule.status,
      };
    });

    weeks.push({
      title: '第' + (weeks.length + 1) + '周：' + weekStart.format('M月D日') + ' ~ ' + weekEnd.format('M月D日'),
      startDate: weekStart.format('YYYY-MM-DD'),
      endDate: weekEnd.format('YYYY-MM-DD'),
      dayHeaders: WEEK_DAYS.map((label, index) => label + '\n' + weekStart.add(index, 'day').format('M月D日')),
      minSlot,
      maxSlot,
      timeLabels: Array.from({ length: Math.max(1, maxSlot - minSlot) }, (_, index) => slotToTimeLabel(minSlot + index)),
      courses: coursesForWeek,
    });
    cursor = cursor.add(7, 'day');
  }

  return {
    teacherName,
    studentName,
    dateLabel,
    fileName,
    sheetName,
    weeks,
    hideRoom: !!filterStudent,
  };
}

function hexToArgb(hex) {
  const raw = String(hex || '#F5F7FA').replace('#', '').trim();
  const six = raw.length === 3 ? raw.split('').map(ch => ch + ch).join('') : raw.slice(0, 6);
  return 'FF' + (six || 'F5F7FA').toUpperCase().padEnd(6, 'A');
}

function borderColorForStatus(status) {
  if (status === 'LEAVE' || status === 2) return 'FFFAAD14';
  if (status === 'CANCELLED' || status === 3) return 'FFF5222D';
  return 'FF1890FF';
}

function setCell(sheet, row, col, value, style) {
  const address = XLSXAddress(row, col);
  sheet[address] = { t: 's', v: value, s: style };
}

function XLSXAddress(row, col) {
  let n = col + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters + String(row + 1);
}

function createScheduleWorkbook(XLSX, model) {
  const wb = XLSX.utils.book_new();
  const ws = {};
  const merges = [];
  const rows = [];
  const cols = [{ wch: 8 }].concat(Array.from({ length: 7 }, () => ({ wch: 22 })));
  let maxRow = 0;
  let currentRow = 0;

  const titleStyle = {
    font: { bold: true, sz: 14, color: { rgb: 'FF262626' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    fill: { patternType: 'solid', fgColor: { rgb: 'FFE6F7FF' } },
    border: { bottom: { style: 'thin', color: { rgb: 'FF91D5FF' } } },
  };
  const dayHeaderStyle = {
    font: { bold: true, color: { rgb: 'FFFFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    fill: { patternType: 'solid', fgColor: { rgb: 'FF1890FF' } },
    border: {
      top: { style: 'thin', color: { rgb: 'FFD9D9D9' } },
      bottom: { style: 'thin', color: { rgb: 'FFD9D9D9' } },
      left: { style: 'thin', color: { rgb: 'FFD9D9D9' } },
      right: { style: 'thin', color: { rgb: 'FFD9D9D9' } },
    },
  };
  const timeStyle = {
    font: { sz: 9, color: { rgb: 'FF8C8C8C' } },
    alignment: { horizontal: 'center', vertical: 'top' },
    border: { right: { style: 'thin', color: { rgb: 'FFD9D9D9' } } },
  };
  const gridStyle = {
    border: {
      bottom: { style: 'hair', color: { rgb: 'FFEFEFEF' } },
      right: { style: 'hair', color: { rgb: 'FFEFEFEF' } },
    },
  };

  model.weeks.forEach((week, weekIndex) => {
    setCell(ws, currentRow, 0, week.title, titleStyle);
    merges.push({ s: { r: currentRow, c: 0 }, e: { r: currentRow, c: 7 } });
    rows[currentRow] = { hpt: 24 };
    currentRow += 1;

    setCell(ws, currentRow, 0, '时间', dayHeaderStyle);
    week.dayHeaders.forEach((header, dayIndex) => setCell(ws, currentRow, dayIndex + 1, header, dayHeaderStyle));
    rows[currentRow] = { hpt: 34 };
    currentRow += 1;

    const bodyStartRow = currentRow;
    week.timeLabels.forEach((label, index) => {
      const row = bodyStartRow + index;
      rows[row] = { hpt: 4 };
      setCell(ws, row, 0, index % 12 === 0 ? label : '', timeStyle);
      for (let col = 1; col <= 7; col += 1) setCell(ws, row, col, '', gridStyle);
    });

    week.courses.forEach(course => {
      const row = bodyStartRow + course.rowOffset;
      const endRow = Math.max(row, row + course.rowSpan - 1);
      const col = course.dayIndex + 1;
      const borderColor = borderColorForStatus(course.status);
      setCell(ws, row, col, course.displayLines.join('\n'), {
        font: { bold: true, sz: 10, color: { rgb: 'FF1F1F1F' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        fill: { patternType: 'solid', fgColor: { rgb: hexToArgb(course.color) } },
        border: {
          top: { style: 'medium', color: { rgb: borderColor } },
          bottom: { style: 'medium', color: { rgb: borderColor } },
          left: { style: 'medium', color: { rgb: borderColor } },
          right: { style: 'medium', color: { rgb: borderColor } },
        },
      });
      if (endRow > row) merges.push({ s: { r: row, c: col }, e: { r: endRow, c: col } });
    });

    currentRow = bodyStartRow + week.timeLabels.length + (weekIndex === model.weeks.length - 1 ? 0 : 2);
    maxRow = Math.max(maxRow, currentRow);
  });

  ws['!ref'] = 'A1:H' + Math.max(1, maxRow);
  ws['!cols'] = cols;
  ws['!rows'] = rows;
  ws['!merges'] = merges;
  XLSX.utils.book_append_sheet(wb, ws, model.sheetName);
  return wb;
}

export {
  WEEK_DAYS,
  DEFAULT_MIN_HOUR,
  DEFAULT_MAX_HOUR,
  sanitizeExcelSheetName,
  buildScheduleExportModel,
  createScheduleWorkbook,
};
