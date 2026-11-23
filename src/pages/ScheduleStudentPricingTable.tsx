import React from 'react';
import { Form, InputNumber } from 'antd';
import AutoCloseSelect from '../components/AutoCloseSelect';
import { BillingUnit, Student, StudentAttendanceStatus, StudentCoursePricing } from '../types';
import { INSTITUTION_UNBOUND_STUDENT_ID } from '../utils/financialDetails';

const attendanceOptions = [
  { value: StudentAttendanceStatus.NORMAL, label: '正常出勤' },
  { value: StudentAttendanceStatus.LEAVE, label: '请假' },
  { value: StudentAttendanceStatus.CANCELLED, label: '取消' },
];

interface Props {
  pricings: StudentCoursePricing[];
  students: Student[];
  billingUnit: BillingUnit;
  hasCourse: boolean;
  editable: boolean;
}

export default function ScheduleStudentPricingTable({ pricings, students, billingUnit, hasCourse, editable }: Props) {
  const unit = Number(billingUnit) === BillingUnit.PER_SESSION ? '元/次' : '元/小时';
  const names = new Map(students.map(student => [student.id, student.name]));

  return (
    <section className="schedule-editor__students" aria-labelledby="schedule-editor-students">
      <div className="schedule-editor__section-heading">
        <h3 id="schedule-editor-students">{editable ? '学生出勤和费用' : '默认学生出勤和费用'}</h3>
        {pricings.length > 0 && <span className="schedule-editor__count">{pricings.length} 条明细</span>}
      </div>
      {pricings.length === 0 ? (
        <div className="schedule-editor__empty">
          {hasCourse ? '该课程未绑定学生信息' : '选择课程后显示学生出勤和费用'}
        </div>
      ) : (
        <div className="schedule-editor__table-wrap">
          <table className="schedule-editor__table" aria-labelledby="schedule-editor-students">
            <thead>
              <tr>
                <th scope="col">学生</th>
                <th scope="col">出勤</th>
                <th scope="col" className="schedule-editor__money">学费<span className="schedule-editor__unit">（{unit}）</span></th>
                <th scope="col" className="schedule-editor__money">课时费<span className="schedule-editor__unit">（{unit}）</span></th>
              </tr>
            </thead>
            <tbody>
              {pricings.map(pricing => {
                const student = pricing.student_id === INSTITUTION_UNBOUND_STUDENT_ID
                  ? '机构排课'
                  : names.get(pricing.student_id) || '未知学生';
                const status = pricing.status || StudentAttendanceStatus.NORMAL;
                const field = (key: string) => ['studentPricings', pricing.student_id, key];
                return (
                  <tr key={pricing.student_id}>
                    <th scope="row">{student}</th>
                    <td>
                      {editable ? (
                        <Form.Item
                          name={field('status')}
                          noStyle
                          getValueProps={value => ({ value: value ?? status })}
                        >
                          <AutoCloseSelect aria-label={`${student} 出勤`} options={attendanceOptions} />
                        </Form.Item>
                      ) : attendanceOptions.find(option => option.value === Number(status))?.label ?? '正常出勤'}
                    </td>
                    {(['tuition', 'teacher_fee'] as const).map(key => (
                      <td className="schedule-editor__money" key={key}>
                        {editable ? (
                          <Form.Item
                            name={field(key)}
                            noStyle
                            getValueProps={value => ({ value: value === undefined ? pricing[key] ?? 0 : value })}
                          >
                            <InputNumber min={0} controls={false} aria-label={`${student} ${key === 'tuition' ? '学费' : '课时费'}`} />
                          </Form.Item>
                        ) : pricing[key] ?? 0}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
