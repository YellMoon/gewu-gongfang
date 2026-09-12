// UTF-8 display labels; never rewrite stored school or enrollment data.

export function studentSchoolLabel(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text.startsWith('[')) return text;
  try {
    const names = JSON.parse(text);
    if (Array.isArray(names) && names.every(name => typeof name === 'string')) {
      return names.map(name => name.trim()).filter(Boolean).join('\u3001');
    }
  } catch { /* Preserve an unstructured name without changing stored data. */ }
  return text;
}

export function studentGradeLabel(student: { grade_year?: number; grade_current?: string }): string {
  if (!student.grade_year) return student.grade_current || '';
  // Same September school-year boundary as desktop calculateGrade; parity is
  // checked against the actual desktop function without importing its bundle.
  const now = new Date();
  const schoolYear = now.getFullYear() - (now.getMonth() + 1 < 9 ? 1 : 0);
  const years = schoolYear - student.grade_year;
  if (years < 0) return '\u672a\u5165\u5b66';
  if (years === 0) return '\u9ad8\u4e00';
  if (years === 1) return '\u9ad8\u4e8c';
  if (years === 2) return '\u9ad8\u4e09';
  return '\u9ad8\u590d\u751f';
}
