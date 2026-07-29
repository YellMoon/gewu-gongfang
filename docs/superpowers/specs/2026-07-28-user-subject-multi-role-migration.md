# Deferred: User Subject, Multi-Role, and Optional Business Profiles

Execute after the cloud-relay architecture migration and its real two-desktop verification.

## Required model

- `user_id` is the only persistent identity subject.
- Role grants are additive: super administrator, administrator, teacher, and student are authorization labels, not alternate user identities.
- `teacher_id` and `student_id` are optional business-profile links. Administrator assignment must never require teacher linkage; role revocation must never delete a business profile.
- A registered desktop or miniapp user starts as visitor. Visitors see only their own linked data and the first ten question-bank items.
- Teacher/student role requests are submitted by the user and reviewed by the data-host super administrator. Administrator roles are created only by that review flow.

## Data and permission rules

- Students see only their own timetable and tuition values; no peer/course detail or lesson-pay data.
- Teachers see details for linked courses, including tuition and lesson pay, and finance filters limited to those courses.
- Super administrators and administrators can query/filter all authorized business data; only super administrators approve role requests.
- Personal asset statistics are owned by `user_id`; each user has multiple auto-classified or manually-created accounts (bank debit/credit cards, Alipay, WeChat, and others).

## Miniapp change

- Preserve the future automatic phone retrieval work but do not invoke it now.
- Use manual phone entry during miniapp login and register the user automatically as a visitor.
- Provide role-request entry from My/Profile and review it in the data-host desktop application.

## Verification gate

- Database migration keeps existing user/profile records and role history.
- Test every role independently and in combination, plus visitor, denied request, revoked role, and super-administrator review paths.
- Verify desktop and miniapp data scopes, including course, finance, asset account, question preview, and non-disclosure cases.
