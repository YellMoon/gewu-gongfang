# 格物工坊小程序 8.4.0 全页面运行验收

- 微信开发者工具实机场景：42/42（覆盖 22 个注册页面）
- 截图：42
- 数据源：仅本机 fixture，不访问生产业务接口
- 结果：通过

| 场景 | 页面 | 角色 | 检查状态 | 路由/文字 | 截图 |
|---|---|---|---|---|---|
| login-guest | pages/login/index | guest | cloud-login | 通过 | 01-login-guest.png |
| privacy-guest | pages/login/privacy | guest | privacy-content | 通过 | 02-privacy-guest.png |
| desktop-auth-phone | pages/desktop-authorization/index | guest | phone-required | 通过 | 03-desktop-auth-phone.png |
| desktop-auth-network | pages/desktop-authorization/index | guest | network-error | 通过 | 04-desktop-auth-network.png |
| desktop-registration-guest | pages/desktop-online-registration/index | guest | scan-code | 通过 | 05-desktop-registration-guest.png |
| home-super-admin | pages/index/index | super_admin | admin-dashboard | 通过 | 06-home-super-admin.png |
| home-student | pages/index/index | student | student-dashboard | 通过 | 07-home-student.png |
| home-visitor | pages/index/index | visitor | empty-modules | 通过 | 08-home-visitor.png |
| home-unrecognized | pages/index/index | unrecognized-student | unrecognized-account | 通过 | 09-home-unrecognized.png |
| schedule-admin-empty | pages/schedule/index | admin | empty-day | 通过 | 10-schedule-admin-empty.png |
| schedule-student-empty | pages/schedule/index | student | empty-day | 通过 | 11-schedule-student-empty.png |
| schedule-unrecognized-empty | pages/schedule/index | unrecognized-student | unrecognized-empty | 通过 | 12-schedule-unrecognized-empty.png |
| schedule-detail-admin-missing | pages/schedule/detail/index | admin | missing-record | 通过 | 13-schedule-detail-admin-missing.png |
| schedule-detail-student-missing | pages/schedule/detail/index | student | missing-record | 通过 | 14-schedule-detail-student-missing.png |
| schedule-edit-admin-boundary | pages/schedule/edit/index | admin | miniapp-readonly-boundary | 通过 | 15-schedule-edit-admin-boundary.png |
| schedule-edit-student-boundary | pages/schedule/edit/index | student | miniapp-readonly-boundary | 通过 | 16-schedule-edit-student-boundary.png |
| students-admin-empty | pages/students/index | admin | empty | 通过 | 17-students-admin-empty.png |
| students-teacher-empty | pages/students/index | teacher | empty | 通过 | 18-students-teacher-empty.png |
| student-detail-admin-missing | pages/student-detail/index | admin | missing-student | 通过 | 19-student-detail-admin-missing.png |
| student-detail-student-missing | pages/student-detail/index | student | missing-student | 通过 | 20-student-detail-student-missing.png |
| courses-admin-empty | pages/courses/index | admin | empty | 通过 | 21-courses-admin-empty.png |
| courses-teacher-empty | pages/courses/index | teacher | empty | 通过 | 22-courses-teacher-empty.png |
| teachers-admin-empty | pages/teachers/index | admin | empty | 通过 | 23-teachers-admin-empty.png |
| teachers-teacher-empty | pages/teachers/index | teacher | empty | 通过 | 24-teachers-teacher-empty.png |
| payments-admin-empty | pages/payments/index | admin | empty | 通过 | 25-payments-admin-empty.png |
| stats-admin-empty | pages/stats/index | admin | empty | 通过 | 26-stats-admin-empty.png |
| question-super-admin-empty | pages/question-bank/index | super_admin | preview-empty | 通过 | 27-question-super-admin-empty.png |
| question-student-empty | pages/question-bank/index | student | preview-empty | 通过 | 28-question-student-empty.png |
| question-student-offline | pages/question-bank/index | student | preview-offline | 通过 | 29-question-student-offline.png |
| question-student-forbidden | pages/question-bank/index | student | preview-forbidden | 通过 | 30-question-student-forbidden.png |
| question-unrecognized | pages/question-bank/index | unrecognized-student | four-sample-experience | 通过 | 31-question-unrecognized.png |
| assets-admin-import | pages/assets/index | admin | import-task | 通过 | 32-assets-admin-import.png |
| settings-admin-online | pages/settings/index | admin | online | 通过 | 33-settings-admin-online.png |
| settings-student-online | pages/settings/index | student | online | 通过 | 34-settings-student-online.png |
| settings-unrecognized | pages/settings/index | unrecognized-student | unrecognized-account-application | 通过 | 35-settings-unrecognized.png |
| admin-users-super-admin | pages/admin/users/index | super_admin | pending-review | 通过 | 36-admin-users-super-admin.png |
| admin-users-admin-readonly | pages/admin/users/index | admin | ordinary-admin-read-only | 通过 | 37-admin-users-admin-readonly.png |
| forbidden-student | pages/forbidden/index | student | blocked-module | 通过 | 38-forbidden-student.png |
| unrecognized-welcome | pages/unrecognized-experience/index | unrecognized-student | welcome | 通过 | 39-unrecognized-welcome.png |
| application-visitor | pages/account-application/index | visitor | not-submitted | 通过 | 40-application-visitor.png |
| application-visitor-offline | pages/account-application/index | visitor | network-error | 通过 | 41-application-visitor-offline.png |
| cloud-account-super-admin-empty | pages/cloud-account-admin/index | super_admin | empty | 通过 | 42-cloud-account-super-admin-empty.png |

完整机器可读证据：C:\Users\83423\.openclaw\workspace\scheduling-system\output\miniapp-8.4.0-ui-coverage\runtime-scenario-matrix\matrix.json
