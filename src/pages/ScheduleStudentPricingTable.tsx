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
  feesEditable: boolean;
}

export default function ScheduleStudentPricingTable({ pricings, students, billingUnit, hasCourse, feesEditable }: Props) {
  const unit = Number(billingUnit) === BillingUnit.PER_SESSION ? '元/次' : '元/小时';
  const names = new Map(students.map(student => [student.id, student.name]));

  return (
    <section className="schedule-editor__students">
      {pricings.length === 0 ? (
        <div className="schedule-editor__empty">
          {hasCourse ? '该课程未绑定学生信息' : '选择课程后显示学生出勤和费用'}
        </div>
      ) : (
        <div className="schedule-editor__table-wrap">
          <table className="schedule-editor__table" aria-label="学生">
            <thead>
              <tr>
                <th scope="col">学生</th>
                <th scope="col">出勤</th>
                <th scope="col">学费</th>
                <th scope="col">课时费</th>
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
                      <Form.Item
                        name={field('status')}
                        noStyle
                        getValueProps={value => ({
                          value: value ?? status,
                          'data-attendance': value ?? status,
                        })}
                      >
                        <AutoCloseSelect aria-label={`${student} 出勤`} options={attendanceOptions} />
                      </Form.Item>
                    </td>
                    {(['tuition', 'teacher_fee'] as const).map(key => (
                      <td className="schedule-editor__money" key={key}>
                        <Form.Item
                          name={field(key)}
                          noStyle
                          getValueProps={value => ({ value: value === undefined ? pricing[key] ?? 0 : value })}
                        >
                          <InputNumber
                            min={0}
                            controls={false}
                            readOnly={!feesEditable}
                            suffix={<span className="schedule-editor__unit" aria-hidden="true">{unit}</span>}
                            title={feesEditable ? undefined : '课程默认费用'}
                            aria-label={`${student} ${key === 'tuition' ? '学费' : '课时费'}（${unit}）`}
                          />
                        </Form.Item>
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
