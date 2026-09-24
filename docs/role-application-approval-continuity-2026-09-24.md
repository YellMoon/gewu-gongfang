# Role approval continuity

Date: 2026-09-24. Scope: own application result reading across approval.

Inspection found that mine() reused visitor-only authorization. Approval creates
the live role grant immediately, and cloud-context re-reads grants for every
signed session. Thus the same valid applicant ticket became forbidden when
checking its successful result. The existing mock tests never changed roles
after approval and did not catch this transition.

A regression using the actual signed miniapp account service failed with
CLOUD_ROLE_APPLICATION_ACCESS_DENIED. It now verifies teacher/student/family
approval, the unchanged signed token, own result, another account's isolation,
disabled/invalid session rejection, and refusal of a second formal-role submit.
The real HTTP route returns 200/approved for reading and 403 for resubmission.

Only mine() now uses the verified current account rather than requiring no
roles. Submission remains visitor-only. The repository still derives account
from the verified token and tenant from server configuration. No request accepts
an arbitrary account identifier. No SQL, role grant or profile creation rules
changed, and no new endpoint or migration was added.

Tests passed: miniappRoleApplicationService (includes continuity), full
test:role-applications, miniappCloudAccountService, update-version and independent
release version. PostgreSQL assertions additionally prove approved history is
readable for its own account and absent for another tenant/account.

Automatic classification is a cloud patch, 8.11.21 to 8.11.22 (gateway package
tracks the cloud component). Desktop 8.9.8, miniapp 8.8.24 and NAS 8.8.3 unchanged.
Six unrelated tracked modifications and protected untracked work are excluded.

Deployment, real production application/review UI, and final role-scope checks
remain pending. These regression results alone are not production acceptance.
