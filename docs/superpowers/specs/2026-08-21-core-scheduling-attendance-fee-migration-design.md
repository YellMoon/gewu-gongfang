# Core Scheduling Attendance and Fee Migration Design

## Scope

This active design defines the next cloud-business-authority shadow-import slice. It permits only local disposable PostgreSQL 17 proof and does not authorize a real source import, RDS/NAS write, cutover, or release.

The user-confirmed business scope is tenants, institutions, schools, rooms, teachers, students, courses, and schedules. Question-bank data has no approved migration data and assets are empty; neither is read, interpreted, or migrated by this slice.

## Verified source semantics

The approved SQLite snapshot has 1 tenant, 4 institutions, 15 schools, 15 rooms, 1 teacher, 60 students, 57 courses, and 589 schedules. All current source `deleted` values are zero. The target nevertheless preserves soft deletion and schedule states 1, 2, 3, and 4 for historic and future schedule deletion, completion, cancellation, and leave.

An explicit schedule `student_pricings` array is a per-session override. It contains `student_id`, `tuition`, `teacher_fee`, and attendance `status`; status 1 is normal, 3 is cancelled, and 4 is leave. The 209 explicit schedules contain 264 such rows. A schedule with no override follows the legacy course-default pricing/roster semantics: it uses `courses.student_pricings`. Of 380 schedules without an override, 310 derive from a course default and 70 have no roster at either level. The latter are valid no-roster schedules, not missing student rows.

Course default pricing has 69 rows, all resolving to existing students. A schedule override takes precedence over the course default. Normal attendance is billable; cancelled and leave rows remain attendance facts but are excluded from the legacy fee calculation. Saved `calculated_tuition` and `calculated_teacher_fee` must be preserved and reconciled against the structured effective roster; raw JSON is never an acceptable target representation.

Eighteen schedules in one named course contain only the sentinel student id `__institution_unbound__`, status 1, and zero tuition/teacher fee. They run from 2026-07-06 through 2026-07-25, all from 18:00 to 20:00, with a copied-id chain. That course has no default student pricing and no same-slot normal replacement in the snapshot. The user has declared these schedules obsolete after a later course-detail correction and rescheduling. They are therefore excluded under the immutable outcome `USER_DECLARED_OBSOLETE_LEGACY_SCHEDULE`: preserve source evidence and the user-declared exception binding, create no target schedule and never create a fake student, never silently replace them with a course default, and never delete the source row. `LEGACY_COPY_UNBOUND_PARTICIPANT` remains the fail-closed outcome for any future unapproved sentinel row.

The approved SQLite snapshot has empty sync-log, conflict, and rejection tables. That fact does not prove that the reported 3013 device-local changes never existed elsewhere; it only means this snapshot contains no independently verifiable command journal for them. Its current business rows remain the candidate state to validate and shadow-import. Any local change that is not reflected in that approved current state is not imported as a raw record: a later, separately authorized local-draft intake must verify its command shape and snapshot identity, show an impact preview, and submit each schedule create/change/delete, attendance change, or fee change as an idempotent user-confirmed cloud command. The real-source value/PII gate is defined in [核心排课真实旧库值语义与隐私准入设计](2026-08-21-core-scheduling-real-source-value-privacy-admission-design.md).

## Target model

The target preserves legacy business ids and tenant scope. Timestamps are finite `timestamptz`; amounts are exact `numeric`, not binary floats. Teacher/student contact and guardian fields are restricted and excluded from generic select, logs, audit, outbox, and export.

1. `business.teachers` and `business.students` preserve their source business fields, lifecycle, and timestamps.
2. `business.courses` preserves institution, teacher, optional room, closure state, billing settings, duration, display snapshots, lifecycle, and timestamps.
3. `business.course_student_pricings` has `(course_id, student_id)` as its key and contains the default per-student tuition and teacher fee. It never represents an attendance event.
4. `business.schedules` preserves source id, course, start/end, status, service/room display, saved totals, soft deletion, notes, and timestamps. A source schedule room is a display label, not a guessed room foreign key.
5. `business.schedule_student_overrides` has `(schedule_id, student_id)` as its key and stores only actual source override rows with attendance status, tuition, and teacher fee. Its presence selects the complete override roster; its absence selects the course default roster.

The fixed import order is tenant; institutions, schools, rooms; teachers, students; courses; course defaults; schedules; schedule overrides. The shadow ledger records source id, canonical source hash, target identity, target logical hash, and outcome for every admitted, quarantined, or user-declared-obsolete record. The obsolete exception must match this source inventory hash and the exact frozen schedule ids plus canonical hashes; a changed source row cannot reuse it. Unknown students, invalid time/amount/status, tenant/FK mismatch, reconciliation mismatch, and unapproved copy anomalies quarantine rather than being repaired.

## Verification and exclusions

Every shadow batch starts with business/admission catalog assertions, empty target relations, and stable before/after source fingerprints. It re-reads target keys, hashes, foreign keys, lifecycle states, attendance distributions, effective roster sources, and per-schedule money totals. Exact replay is read-only; changed source hashes conflict; uncertain commit or rollback destroys the database group.

The slice does not import question-bank data, asset data, NAS files, old device/session records, the 3013 local drafts, or any real source rows. It does not implement a business writer, API, release, or cutover.
